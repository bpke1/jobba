/**
 * One-off import of applications you already sent before using Jobba.
 * Re-running updates the same rows (matched on URL) instead of duplicating them.
 *
 *   npm run importer                      # reads data/applications.local.json
 *   npm run importer -- path/to/file.json
 *
 * The file is gitignored (it holds recruiter names and your own statuses);
 * data/applications.example.json shows the format. `folder` is the
 * application's folder under SOKNADER_DIR; `adFile` a saved copy of the ad in
 * it, used when the ad is no longer online.
 */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Category, JobStatus, JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { dedupKey, listingToData } from "@/lib/jobs";
import type { JobListing } from "@/lib/jobposting";
import { fetchAnyAd } from "@/lib/sources/career-page";

const SOKNADER = process.env.SOKNADER_DIR ?? "";
const FILE = process.argv[2] ?? path.join(process.cwd(), "data", "applications.local.json");

interface Entry {
  folder: string;
  company: string;
  title: string;
  url?: string;
  adFile?: string;
  status: JobStatus;
  jobType: JobType;
  category: Category;
  appliedAt?: string;
  deadline?: string;
  deadlineText?: string;
  channel?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  nextStep?: string;
  nextStepDate?: string;
  notes?: string;
}

if (!existsSync(FILE)) {
  console.error(`Fant ikke ${FILE}. Kopier data/applications.example.json dit og fyll inn.`);
  process.exit(1);
}
const ENTRIES = JSON.parse(readFileSync(FILE, "utf8")) as Entry[];

function readAdFile(folder: string, file?: string): string {
  if (!file || !SOKNADER) return "";
  const p = path.join(SOKNADER, folder, file);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8")
    .replace(/^---[\s\S]*?\n---\n/, "")
    .trim();
}

async function onlineAd(url?: string): Promise<JobListing | null> {
  if (!url || !/finn\.no|teamtailor\.com/.test(url)) return null;
  try {
    return await fetchAnyAd(url);
  } catch {
    return null; // expired ads 404; fall back to the local clipping
  }
}

const date = (s?: string) => (s ? new Date(`${s}T12:00:00+02:00`) : undefined);

for (const e of ENTRIES) {
  const url = e.url ?? `local:soknader/${e.folder}#${encodeURIComponent(e.title)}`;
  const online = await onlineAd(e.url);
  const listing: JobListing = {
    ...(online ?? { description: "" }),
    url,
    company: e.company,
    title: e.title,
    description: online?.description || readAdFile(e.folder, e.adFile),
  };

  const data = {
    ...listingToData(listing),
    dedupKey: dedupKey(e.company, e.title),
    status: e.status,
    jobType: e.jobType,
    category: e.category,
    scoredAt: new Date(), // already decided on; don't spend a scoring call
    appliedAt: date(e.appliedAt),
    deadline: date(e.deadline) ?? listing.deadline,
    deadlineText: e.deadlineText ?? listing.deadlineText,
    channel: e.channel,
    contactName: e.contactName ?? listing.contactName,
    contactPhone: e.contactPhone ?? listing.contactPhone,
    contactEmail: e.contactEmail ?? listing.contactEmail,
    nextStep: e.nextStep,
    nextStepDate: date(e.nextStepDate),
    notes: e.notes,
    localFolder: `soknader/${e.folder}`,
  };

  const existing = await db.job.findUnique({ where: { url } });
  if (existing) {
    // Keep anything changed in the app since the first import (status, notes, next steps).
    await db.job.update({
      where: { url },
      data: { description: data.description, streetAddress: data.streetAddress, postalCode: data.postalCode, city: data.city, localFolder: data.localFolder },
    });
    console.log(`updated  ${e.company}: ${e.title}`);
  } else {
    const job = await db.job.create({ data });
    await db.event.create({
      data: {
        jobId: job.id,
        type: "STATUS",
        text: `Importert fra søknadsmappen som ${e.status}`,
        at: data.appliedAt ?? new Date(),
      },
    });
    console.log(`imported ${e.company}: ${e.title} (${online ? "annonse hentet" : data.description ? "lokal fil" : "uten tekst"})`);
  }
}

await db.$disconnect();
