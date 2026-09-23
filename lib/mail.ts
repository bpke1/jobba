import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { classifyEmails, type EmailInput } from "./ai";
import { db } from "./db";
import { saveListings } from "./jobs";
import { isLinkedInJobAlert, parseLinkedInAlert } from "./sources/linkedin";

const ACTIVE = ["UNDER_ARBEID", "SENDT", "INTERVJU", "TILBUD"] as const;

/** Applicant-tracking systems that send on behalf of employers. */
const ATS_DOMAINS = [
  "teamtailor",
  "webcruiter",
  "reachmee",
  "jobylon",
  "workday",
  "myworkday",
  "easycruit",
  "hr-manager",
  "varbi",
  "recman",
  "finn.no",
  "greenhouse",
  "lever.co",
  "smartrecruiters",
  "successfactors",
  "jobbnorge",
  "talentech",
  "cvpartner",
];

// Kept narrow on purpose: "tilbud"/"offer" mostly match marketing mail, and a
// real offer comes from the employer's domain, which the hints already cover.
const SUBJECT_WORDS =
  /søknad|soknad|application|applying|stilling|intervju|interview|rekruttering|recruit|kandidat|candidate|internship|traineeprogram/i;

const FIRST_RUN_DAYS = 45;
const MAX_PER_RUN = 60;

type Applications = { id: string; company: string; title: string; contactEmail: string | null }[];

/** Company-name words (≥3 letters) and contact-email domains of active applications. */
function applicationHints(apps: Applications): string[] {
  const hints = new Set<string>();
  for (const a of apps) {
    const word = a.company
      .toLowerCase()
      .replace(/\b(asa|as|ab|ltd|group|norge|norway)\b/g, "")
      .trim()
      .split(/[^a-z0-9æøå]+/)[0];
    if (word && word.length >= 3) hints.add(word);
    const domain = a.contactEmail?.split("@")[1]?.toLowerCase();
    if (domain) hints.add(domain);
  }
  return [...hints];
}

export function looksRelevant(from: string, subject: string, hints: string[]): boolean {
  const f = from.toLowerCase();
  return (
    ATS_DOMAINS.some((d) => f.includes(d)) || hints.some((h) => f.includes(h)) || SUBJECT_WORDS.test(subject)
  );
}

function formatFrom(msg: FetchMessageObject): string {
  const a = msg.envelope?.from?.[0];
  if (!a) return "";
  return a.name ? `${a.name} <${a.address}>` : (a.address ?? "");
}

export interface MailReport {
  scanned: number;
  candidates: number;
  saved: number;
  /** jobs created from LinkedIn job-alert e-mails */
  alertJobIds: string[];
  error?: string;
}

/** The source row alert jobs are attributed to (created on first use). */
async function alertSourceId(): Promise<string> {
  const existing = await db.source.findFirst({ where: { type: "EMAIL_ALERT" } });
  if (existing) return existing.id;
  return (await db.source.create({ data: { type: "EMAIL_ALERT", name: "LinkedIn-varsler (e-post)", config: {} } })).id;
}

/**
 * Reads new messages from the inbox (read-only: nothing is marked seen, moved
 * or deleted), keeps the ones that look like replies to applications, and
 * lets Claude classify them and match them to a job. Only headers and a short
 * snippet are stored.
 */
export async function checkMail(): Promise<MailReport> {
  const { IMAP_HOST, IMAP_USER, IMAP_PASSWORD } = process.env;
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) {
    return { scanned: 0, candidates: 0, saved: 0, alertJobIds: [], error: "IMAP ikke konfigurert" };
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
    logger: false,
  });

  const apps: Applications = await db.job.findMany({
    where: { status: { in: [...ACTIVE] } },
    select: { id: true, company: true, title: true, contactEmail: true },
  });
  const hints = applicationHints(apps);
  const cursorRow = await db.setting.findUnique({ where: { key: "imapCursor" } });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });
  try {
    const mailbox = client.mailbox;
    if (!mailbox) throw new Error("INBOX not open");
    const uidValidity = String(mailbox.uidValidity);
    const [savedValidity, savedUid] = (cursorRow?.value ?? "").split(":");
    // A changed UIDVALIDITY means old UIDs are meaningless; fall back to a date window.
    const range =
      savedValidity === uidValidity && savedUid
        ? { uid: `${Number(savedUid) + 1}:*` }
        : { since: new Date(Date.now() - FIRST_RUN_DAYS * 864e5) };

    const headers: FetchMessageObject[] = [];
    let maxUid = Number(savedValidity === uidValidity ? savedUid : 0) || 0;
    for await (const msg of client.fetch(range, { uid: true, envelope: true }, { uid: true })) {
      // "n:*" always returns the newest message even when it's older than n.
      if (savedValidity === uidValidity && msg.uid <= Number(savedUid)) continue;
      headers.push(msg);
      maxUid = Math.max(maxUid, msg.uid);
    }

    // LinkedIn job alerts become jobs; they are not replies, so they skip classification.
    const alerts = headers.filter((m) => isLinkedInJobAlert(formatFrom(m), m.envelope?.subject ?? ""));
    const alertJobIds: string[] = [];
    if (alerts.length) {
      const sourceId = await alertSourceId();
      for (const m of alerts) {
        const full = await client.fetchOne(String(m.uid), { source: { maxLength: 600_000 } }, { uid: true });
        if (!full || !full.source) continue;
        const parsed = await simpleParser(full.source);
        const listings = parseLinkedInAlert(parsed.text ?? "", typeof parsed.html === "string" ? parsed.html : "");
        alertJobIds.push(...(await saveListings(listings, sourceId)));
      }
    }

    const candidates = headers
      .filter((m) => !alerts.includes(m) && looksRelevant(formatFrom(m), m.envelope?.subject ?? "", hints))
      .slice(-MAX_PER_RUN);

    const idOf = (m: FetchMessageObject) => m.envelope?.messageId ?? `uid-${uidValidity}-${m.uid}`;
    const known = new Set(
      (
        await db.email.findMany({
          where: { messageId: { in: candidates.map(idOf) } },
          select: { messageId: true },
        })
      ).map((e) => e.messageId),
    );

    const inputs: (EmailInput & { uid: number; messageId: string; receivedAt: Date })[] = [];
    for (const m of candidates) {
      const messageId = idOf(m);
      if (known.has(messageId)) continue;
      // Capped so a reply with a big attachment doesn't blow the time budget; the text part comes first.
      const full = await client.fetchOne(String(m.uid), { source: { maxLength: 300_000 } }, { uid: true });
      if (!full || !full.source) continue;
      const parsed = await simpleParser(full.source);
      const text = (parsed.text ?? "").replace(/\s+/g, " ").trim();
      inputs.push({
        key: String(m.uid),
        uid: m.uid,
        messageId,
        from: formatFrom(m),
        subject: m.envelope?.subject ?? "(uten emne)",
        snippet: text.slice(0, 500),
        receivedAt: m.envelope?.date ?? new Date(),
      });
    }

    const verdicts = inputs.length ? await classifyEmails(inputs, apps) : [];
    if (verdicts === null) throw new Error("Klassifisering feilet (mangler ANTHROPIC_API_KEY?)");

    let saved = 0;
    for (const v of verdicts) {
      const input = inputs.find((i) => i.key === v.key);
      if (!input || !v.relevant) continue;
      const jobId = v.jobId && apps.some((a) => a.id === v.jobId) ? v.jobId : null;
      await db.email.create({
        data: {
          messageId: input.messageId,
          uid: input.uid,
          from: input.from,
          subject: input.subject,
          receivedAt: input.receivedAt,
          snippet: input.snippet,
          classification: v.classification,
          confidence: v.confidence,
          suggestedStatus: jobId ? (v.suggestedStatus ?? null) : null,
          jobId,
        },
      });
      if (jobId) {
        await db.event.create({
          data: {
            jobId,
            type: "EMAIL",
            text: `${v.classification}: ${input.subject} (fra ${input.from})`,
            at: input.receivedAt,
          },
        });
      }
      saved++;
    }

    // Only advance the cursor once everything above succeeded, so a failed run is retried.
    if (maxUid > 0) {
      await db.setting.upsert({
        where: { key: "imapCursor" },
        create: { key: "imapCursor", value: `${uidValidity}:${maxUid}` },
        update: { value: `${uidValidity}:${maxUid}` },
      });
    }
    return { scanned: headers.length, candidates: candidates.length, saved, alertJobIds };
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}
