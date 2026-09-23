/**
 * Copies a job from Jobba into $SOKNADER_DIR/<Selskap>/utlysning.md, a local
 * folder per application with YAML frontmatter, so cover-letter tooling that
 * works on those folders (e.g. Claude Code skills) can take over.
 *
 *   npm run hent -- <jobId> [--force]
 */
import "dotenv/config";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { setStatus } from "@/lib/jobs";

const SOKNADER = process.env.SOKNADER_DIR;
if (!SOKNADER) {
  console.error("Sett SOKNADER_DIR i .env til mappen søknadene dine ligger i.");
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const jobId = args.find((a) => !a.startsWith("--"));
if (!jobId) {
  console.error("Bruk: npm run hent -- <jobId> [--force]");
  process.exit(1);
}

const job = await db.job.findUnique({ where: { id: jobId } });
if (!job) {
  console.error(`Fant ingen jobb med id ${jobId}`);
  process.exit(1);
}

// Windows-safe folder name; existing folders are just the company name, so
// only add the role when that name is already taken by another application.
const clean = (s: string) => s.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
let folder = job.localFolder?.replace(/^soknader\//, "") ?? clean(job.company);
if (!job.localFolder && existsSync(path.join(SOKNADER, folder))) folder = `${clean(job.company)} - ${clean(job.title)}`;

const dir = path.join(SOKNADER, folder);
const file = path.join(dir, "utlysning.md");
if (existsSync(file) && !force) {
  console.error(`${file} finnes allerede. Bruk --force for å overskrive.`);
  process.exit(1);
}

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");
const yaml = (s: string) => JSON.stringify(s);
const today = new Date().toISOString().slice(0, 10);
const where = [job.streetAddress, job.postalCode, job.city].filter(Boolean).join(", ");
const facts = [job.employmentType, where, job.remote].filter(Boolean);

const md = `---
title: ${yaml(`${job.title} · ${job.city ?? ""} · ${job.company}`)}
source: ${yaml(job.url)}
selskap: ${yaml(job.company)}
rolle: ${yaml(job.title)}
frist: ${yaml(job.deadline ? d(job.deadline) : (job.deadlineText ?? "ukjent"))}
created: ${today}
status: utkast
jobba: ${yaml(job.id)}
---

# ${job.title} — ${job.company}

${facts.join(" · ")}
**Søknadsfrist:** ${job.deadline ? d(job.deadline) : (job.deadlineText ?? "ikke oppgitt")}
${job.contactName || job.contactPhone || job.contactEmail ? `**Kontakt:** ${[job.contactName, job.contactTitle, job.contactEmail, job.contactPhone].filter(Boolean).join(", ")}\n` : ""}**Annonse:** ${job.url}

## Annonsetekst

${job.description}
`;

mkdirSync(dir, { recursive: true });
writeFileSync(file, md, "utf8");

await db.job.update({ where: { id: job.id }, data: { localFolder: `soknader/${folder}` } });
if (["NY", "FILTRERT", "INTERESSANT"].includes(job.status)) await setStatus(job.id, "UNDER_ARBEID", "søknadsmappe opprettet");

console.log(`Skrev ${file}`);
console.log(`Neste: skriv søknaden i mappen "${folder}".`)
await db.$disconnect();
