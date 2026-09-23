import type { JobStatus, Prisma } from "@prisma/client";
import { classify } from "./classify";
import { db } from "./db";
import type { JobListing } from "./jobposting";

export { CATEGORY_LABEL, JOB_TYPE_LABEL, STATUS_LABEL } from "./labels";
import { STATUS_LABEL } from "./labels";

/** Pipeline columns, in order. NY/FILTRERT live on the "Nye utlysninger" page instead. */
export const PIPELINE: JobStatus[] = ["INTERESSANT", "UNDER_ARBEID", "SENDT", "INTERVJU", "TILBUD", "AVSLAG"];

export const MIN_SCORE_SHOWN = 35;

export function dedupKey(company: string, title: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(asa|as|ab|ltd|plc|gmbh)\b/g, "")
      .replace(/[^a-z0-9æøå]+/g, " ")
      .trim();
  return `${norm(company)}|${norm(title)}`;
}

export function listingToData(l: JobListing): Omit<Prisma.JobUncheckedCreateInput, "dedupKey"> {
  return {
    url: l.url,
    externalId: l.externalId,
    title: l.title || "(uten tittel)",
    company: l.company || "(ukjent selskap)",
    description: l.description,
    streetAddress: l.streetAddress,
    postalCode: l.postalCode,
    city: l.city,
    country: l.country,
    remote: l.remote,
    employmentType: l.employmentType,
    deadline: l.deadline,
    deadlineText: l.deadlineText,
    datePosted: l.datePosted,
    postedAt: l.postedAt ?? l.datePosted ?? new Date(),
    contactName: l.contactName,
    contactTitle: l.contactTitle,
    contactPhone: l.contactPhone,
    contactEmail: l.contactEmail,
    logoUrl: l.logoUrl,
    raw: (l.raw ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

/** URLs from `urls` that are not stored yet, so we only fetch detail pages for new ads. */
export async function unseenUrls(urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  const seen = await db.job.findMany({ where: { url: { in: urls } }, select: { url: true } });
  const seenSet = new Set(seen.map((j) => j.url));
  return urls.filter((u) => !seenSet.has(u));
}

/**
 * Inserts listings that are new by both URL and company+title, so an ad
 * reposted under a fresh URL doesn't reappear in "Nye utlysninger".
 * Returns the ids of the inserted jobs.
 */
export async function saveListings(
  listings: JobListing[],
  sourceId: string | null,
  status: JobStatus = "NY",
): Promise<string[]> {
  const ids: string[] = [];
  for (const l of listings) {
    if (!l.url || !l.title) continue;
    const key = dedupKey(l.company, l.title);
    const existing = await db.job.findFirst({
      where: { OR: [{ url: l.url }, { dedupKey: key, firstSeenAt: { gt: new Date(Date.now() - 120 * 864e5) } }] },
      select: { id: true },
    });
    if (existing) continue;
    const c = classify(l);
    const job = await db.job.create({
      data: {
        ...listingToData(l),
        dedupKey: key,
        sourceId,
        jobType: c.jobType,
        category: c.category,
        score: c.score,
        scoreReason: c.reason,
        status: status === "NY" && c.score < MIN_SCORE_SHOWN ? "FILTRERT" : status,
      },
    });
    ids.push(job.id);
  }
  return ids;
}

/** Rule-based values for jobs stored before the classifier existed, or imported without them. */
export async function classifyUnclassified(): Promise<number> {
  const jobs = await db.job.findMany({ where: { jobType: null } });
  for (const j of jobs) {
    const c = classify(j);
    await db.job.update({
      where: { id: j.id },
      data: {
        jobType: c.jobType,
        category: c.category,
        score: j.score ?? c.score,
        scoreReason: j.scoreReason ?? c.reason,
        status: j.status === "NY" && c.score < MIN_SCORE_SHOWN ? "FILTRERT" : undefined,
      },
    });
  }
  return jobs.length;
}

const FOLLOW_UP_DAYS = 10;

export async function setStatus(jobId: string, status: JobStatus, note?: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status === status) return job;

  const data: Prisma.JobUpdateInput = { status };
  if (status === "SENDT" && !job.appliedAt) {
    const now = new Date();
    data.appliedAt = now;
    // laeringspunkter.md: follow up by phone 1.5–2 weeks after sending.
    if (!job.nextStepDate) {
      data.nextStep = "Ring for oppfølging";
      data.nextStepDate = new Date(now.getTime() + FOLLOW_UP_DAYS * 864e5);
    }
  }

  const [updated] = await db.$transaction([
    db.job.update({ where: { id: jobId }, data }),
    db.event.create({
      data: {
        jobId,
        type: "STATUS",
        text: `${STATUS_LABEL[job.status]} → ${STATUS_LABEL[status]}${note ? ` (${note})` : ""}`,
      },
    }),
  ]);
  return updated;
}
