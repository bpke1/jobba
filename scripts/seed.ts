/**
 * Creates the default sources and the scoring criteria. Safe to re-run:
 * existing sources (same type + config) and an edited criteria text are kept.
 *
 *   npm run seed
 *   npm run seed -- --profil     # also overwrite the criteria with profile.local.md
 */
import "dotenv/config";
import type { Prisma, SourceType } from "@prisma/client";
import { db } from "@/lib/db";
import { readProfileFile } from "@/lib/profile";

const FINN_QUERIES = [
  "private equity",
  "venture",
  "M&A",
  "corporate finance",
  "investeringsselskap",
  "investment analyst",
  "analytiker finans",
  "aksjeanalytiker",
  "equity research",
  "investment banking",
  "internship finans",
  "sommerjobb finans",
  "sommerintern",
  "deltid student økonomi",
  "studentjobb finans",
  "graduate finans",
  "trainee finans",
  "analytiker eiendom",
  "transaksjon eiendom",
];

// Broad searches that return hundreds of ads nationwide, plus the deliberate
// long-shot leadership roles; Oslo only.
const FINN_OSLO_QUERIES = ["business controller", "daglig leder", "CFO", "CEO", "investeringsdirektør", "økonomisjef"];
const OSLO = "1.20001.20061";

// arbeidsplassen.nav.no has a semantic search that also surfaces finn ads the
// keyword searches above miss (those are fetched via finn and deduplicated).
const NAV_QUERIES: { query: string; county?: string }[] = [
  { query: "private equity" },
  { query: "venture capital" },
  { query: "investeringsanalytiker" },
  { query: "M&A corporate finance" },
  { query: "analytiker finans" },
  { query: "internship økonomi finans" },
  { query: "sommerjobb økonomi" },
  { query: "deltid student økonomi" },
  { query: "trainee økonomi" },
  { query: "daglig leder", county: "OSLO" },
  { query: "CFO finansdirektør", county: "OSLO" },
];

const OTHER: { type: SourceType; name: string; config: Prisma.InputJsonObject }[] = [
  { type: "WEBCRUITER", name: "NBIM (Oljefondet)", config: { tenant: "398280" } },
  { type: "PHENOM", name: "BCG Oslo", config: { url: "https://careers.bcg.com/global/en/search-results?keywords=oslo" } },
  { type: "CAREER_PAGE", name: "Finansavisen stillinger", config: { url: "https://www.finansavisen.no/stillinger", linkPattern: "/stillinger/\\d+/" } },
];

// Verified 2026-09-23 to serve /jobs.rss. Other target firms (Kistefos, Summa,
// FSN, Herkules, Verdane, Northzone, Arctic, Fearnley, Carnegie, DNB Markets,
// SB1 Markets, Arkwright …) use other systems; they're covered by the finn
// searches or can be added by URL or as a career page on /kilder.
const TEAMTAILOR: { name: string; slug: string }[] = [
  { name: "Ferd", slug: "ferd" },
  { name: "Pareto Securities", slug: "paretosecurities" },
  { name: "ABG Sundal Collier", slug: "abgsc" },
  { name: "Altor", slug: "https://careers.altor.com" },
];

async function ensureSource(type: SourceType, name: string, config: Prisma.InputJsonObject) {
  const existing = await db.source.findFirst({ where: { type, config: { equals: config } } });
  if (existing) return false;
  await db.source.create({ data: { type, name, config } });
  return true;
}

let created = 0;
for (const query of FINN_QUERIES) {
  if (await ensureSource("FINN_SEARCH", `finn: ${query}`, { query, pages: 2 })) created++;
}
for (const query of FINN_OSLO_QUERIES) {
  if (await ensureSource("FINN_SEARCH", `finn: ${query} (Oslo)`, { query, pages: 2, location: OSLO })) created++;
}
for (const n of NAV_QUERIES) {
  if (await ensureSource("NAV_SEARCH", `NAV: ${n.query}${n.county ? ` (${n.county.toLowerCase()})` : ""}`, { ...n })) created++;
}
for (const t of TEAMTAILOR) {
  if (await ensureSource("TEAMTAILOR", t.name, { slug: t.slug })) created++;
}
for (const o of OTHER) {
  if (await ensureSource(o.type, o.name, o.config)) created++;
}

const overwrite = process.argv.includes("--profil");
const criteria = await db.setting.findUnique({ where: { key: "profileCriteria" } });
if (!criteria || overwrite) {
  const value = readProfileFile();
  await db.setting.upsert({ where: { key: "profileCriteria" }, create: { key: "profileCriteria", value }, update: { value } });
}

console.log(`Sources created: ${created}. Criteria: ${criteria && !overwrite ? "kept existing" : "written from profile file"}.`);
await db.$disconnect();
