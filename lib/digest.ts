import { Resend } from "resend";
import { db } from "./db";
import { CATEGORY_LABEL, JOB_TYPE_LABEL, STATUS_LABEL } from "./jobs";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const day = (d: Date) => d.toLocaleDateString("nb-NO", { day: "numeric", month: "short", timeZone: "Europe/Oslo" });

function appUrl(path: string) {
  return `${process.env.APP_URL ?? "http://localhost:3000"}${path}`;
}

export async function buildDigest(since: Date) {
  const now = new Date();
  const inAWeek = new Date(now.getTime() + 7 * 864e5);
  const [fresh, deadlines, followUps, emails] = await Promise.all([
    db.job.findMany({
      where: { status: "NY", firstSeenAt: { gte: since }, score: { gte: 60 } },
      orderBy: { score: "desc" },
      take: 25,
    }),
    db.job.findMany({
      where: { status: { in: ["INTERESSANT", "UNDER_ARBEID"] }, deadline: { gte: now, lte: inAWeek } },
      orderBy: { deadline: "asc" },
    }),
    db.job.findMany({ where: { nextStepDate: { lte: inAWeek }, status: { in: ["UNDER_ARBEID", "SENDT", "INTERVJU"] } }, orderBy: { nextStepDate: "asc" } }),
    db.email.findMany({ where: { createdAt: { gte: since } }, include: { job: true }, orderBy: { receivedAt: "desc" } }),
  ]);

  const sections: string[] = [];
  if (emails.length) {
    sections.push(
      `<h3>Svar i innboksen</h3><ul>${emails
        .map(
          (e) =>
            `<li><b>${e.classification}</b>: ${esc(e.subject)}${e.job ? ` — ${esc(e.job.company)}` : ""}${
              e.suggestedStatus ? ` (foreslått: ${STATUS_LABEL[e.suggestedStatus]})` : ""
            }</li>`,
        )
        .join("")}</ul>`,
    );
  }
  if (fresh.length) {
    sections.push(
      `<h3>Nye utlysninger (${fresh.length})</h3><ul>${fresh
        .map(
          (j) =>
            `<li><a href="${appUrl(`/jobb/${j.id}`)}"><b>${esc(j.title)}</b></a> — ${esc(j.company)}${
              j.city ? `, ${esc(j.city)}` : ""
            } · ${j.score}${j.jobType ? ` · ${JOB_TYPE_LABEL[j.jobType]}` : ""}${
              j.category ? ` · ${CATEGORY_LABEL[j.category]}` : ""
            }<br><small>${esc(j.scoreReason ?? "")}</small></li>`,
        )
        .join("")}</ul>`,
    );
  }
  if (deadlines.length) {
    sections.push(
      `<h3>Frister neste 7 dager</h3><ul>${deadlines
        .map((j) => `<li>${day(j.deadline!)}: <a href="${appUrl(`/jobb/${j.id}`)}">${esc(j.title)}</a> — ${esc(j.company)}</li>`)
        .join("")}</ul>`,
    );
  }
  if (followUps.length) {
    sections.push(
      `<h3>Neste steg</h3><ul>${followUps
        .map(
          (j) =>
            `<li>${day(j.nextStepDate!)}: ${esc(j.nextStep ?? "Oppfølging")} — <a href="${appUrl(`/jobb/${j.id}`)}">${esc(
              j.company,
            )}</a>${j.contactPhone ? ` (${esc(j.contactName ?? "")} ${esc(j.contactPhone)})` : ""}</li>`,
        )
        .join("")}</ul>`,
    );
  }
  return { count: fresh.length + deadlines.length + followUps.length + emails.length, newJobs: fresh.length, html: sections.join("") };
}

async function send(subject: string, html: string) {
  const { RESEND_API_KEY, DIGEST_TO, DIGEST_FROM } = process.env;
  if (!RESEND_API_KEY || !DIGEST_TO) return false;
  const { error } = await new Resend(RESEND_API_KEY).emails.send({
    from: DIGEST_FROM ?? "Jobba <onboarding@resend.dev>",
    to: DIGEST_TO,
    subject,
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${html}<p><a href="${appUrl("/")}">Åpne Jobba</a></p></div>`,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return true;
}

export const DEFAULT_SNIPE_THRESHOLD = 70;

/**
 * Sent from the frequent snipe runs: one e-mail as soon as a strong match
 * appears, so an application can go out the same day. Remembers what it has
 * already announced via the "snipeSentAt" setting.
 */
export async function sendSnipeAlert(): Promise<{ sent: number }> {
  const [lastRow, thresholdRow] = await Promise.all([
    db.setting.findUnique({ where: { key: "snipeSentAt" } }),
    db.setting.findUnique({ where: { key: "snipeThreshold" } }),
  ]);
  const since = lastRow ? new Date(lastRow.value) : new Date(Date.now() - 3 * 3600e3);
  const threshold = Number(thresholdRow?.value ?? DEFAULT_SNIPE_THRESHOLD);
  const jobs = await db.job.findMany({
    where: { status: "NY", firstSeenAt: { gt: since }, score: { gte: threshold } },
    orderBy: { score: "desc" },
    take: 10,
  });
  if (jobs.length === 0) return { sent: 0 };

  const top = jobs[0];
  const list = jobs
    .map(
      (j) =>
        `<li><a href="${appUrl(`/jobb/${j.id}`)}"><b>${esc(j.title)}</b></a> — ${esc(j.company)}${j.city ? `, ${esc(j.city)}` : ""} · ${j.score}${
          j.deadline ? ` · frist ${day(j.deadline)}` : j.deadlineText ? ` · ${esc(j.deadlineText)}` : ""
        }${j.contactPhone ? ` · ☎ ${esc(j.contactPhone)}` : ""}<br><small>${esc(j.scoreReason ?? "")}</small></li>`,
    )
    .join("");
  const sent = await send(
    jobs.length === 1 ? `Ny match: ${top.title} – ${top.company}` : `${jobs.length} nye matcher: ${top.title} – ${top.company} m.fl.`,
    `<ul>${list}</ul>`,
  );
  if (sent) {
    const now = new Date().toISOString();
    await db.setting.upsert({ where: { key: "snipeSentAt" }, create: { key: "snipeSentAt", value: now }, update: { value: now } });
  }
  return { sent: sent ? jobs.length : 0 };
}

export async function sendDigest(): Promise<{ sent: boolean; reason?: string }> {
  const lastRow = await db.setting.findUnique({ where: { key: "digestSentAt" } });
  const since = lastRow ? new Date(lastRow.value) : new Date(Date.now() - 864e5);
  const digest = await buildDigest(since);
  if (digest.count === 0) return { sent: false, reason: "ingenting nytt" };

  const sent = await send(
    digest.newJobs ? `Jobba: ${digest.newJobs} nye utlysninger` : "Jobba: frister og oppfølging",
    digest.html,
  );
  if (!sent) return { sent: false, reason: "RESEND_API_KEY/DIGEST_TO mangler" };
  const now = new Date().toISOString();
  await db.setting.upsert({ where: { key: "digestSentAt" }, create: { key: "digestSentAt", value: now }, update: { value: now } });
  return { sent: true };
}
