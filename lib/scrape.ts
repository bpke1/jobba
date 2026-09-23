import type { Source } from "@prisma/client";
import { scoreJobs } from "./ai";
import { db } from "./db";
import { sleep } from "./html";
import type { JobListing } from "./jobposting";
import { classifyUnclassified, dedupKey, MIN_SCORE_SHOWN, saveListings, unseenUrls } from "./jobs";
import { getCriteria } from "./profile";
import { fetchAnyAd, listCareerPageLinks, type CareerPageConfig } from "./sources/career-page";
import { fetchFinnAd, listFinnAds, type FinnConfig } from "./sources/finn";
import { fetchNavAd, listNavAds, type NavConfig } from "./sources/nav";
import { listPhenomJobs, type PhenomConfig } from "./sources/phenom";
import { listTeamtailorJobs, type TeamtailorConfig } from "./sources/teamtailor";
import { listWebcruiterJobs, type WebcruiterConfig } from "./sources/webcruiter";

/**
 * Detail-page fetches per run, shared across sources. About 1 s each, so this
 * leaves room for scoring inside the 300 s function limit; a first run with a
 * big backlog just continues the next day.
 */
const MAX_DETAIL_FETCHES = 120;
const QUICK_DETAIL_FETCHES = 50;
const DETAIL_DELAY_MS = 800;
const SCORE_BATCH = 10;
const MAX_SCORED_PER_RUN = 80;

export interface ScrapeReport {
  sources: { name: string; found: number; inserted: number; error?: string }[];
  scored: number;
  deferred: number;
  newIds: string[];
}

/**
 * `quick` is the frequent "snipe" run: only the newest result page of each
 * search and a smaller budget, so it finishes in well under a minute.
 */
export async function runScrape(
  opts: { sourceId?: string; deadlineMs?: number; quick?: boolean } = {},
): Promise<ScrapeReport> {
  const stopAt = Date.now() + (opts.deadlineMs ?? 240_000);
  await classifyUnclassified();
  const sources = await db.source.findMany({
    where: opts.sourceId ? { id: opts.sourceId } : { enabled: true, type: { notIn: ["MANUAL", "EMAIL_ALERT"] } },
    // Least recently run first, so a run that hits the budget doesn't starve the same sources every day.
    orderBy: { lastRunAt: { sort: "asc", nulls: "first" } },
  });

  const report: ScrapeReport = { sources: [], scored: 0, deferred: 0, newIds: [] };
  let budget = opts.quick ? QUICK_DETAIL_FETCHES : MAX_DETAIL_FETCHES;

  for (const source of sources) {
    if (Date.now() > stopAt) break;
    try {
      const { found, listings, deferred, fetched } = await collect(source, budget, stopAt, !!opts.quick);
      budget -= fetched;
      report.deferred += deferred;
      const inserted = await saveListings(listings, source.id);
      report.newIds.push(...inserted);
      report.sources.push({ name: source.name, found, inserted: inserted.length });
      await db.source.update({
        where: { id: source.id },
        data: { lastRunAt: new Date(), lastError: null, lastFound: found },
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      report.sources.push({ name: source.name, found: 0, inserted: 0, error });
      await db.source.update({ where: { id: source.id }, data: { lastRunAt: new Date(), lastError: error } });
    }
  }

  report.scored = await scorePending(stopAt);
  return report;
}

type Collected = { found: number; listings: JobListing[]; deferred: number; fetched: number };

async function collect(source: Source, budget: number, stopAt: number, quick: boolean): Promise<Collected> {
  const config = source.config as unknown;
  switch (source.type) {
    // Feeds that already carry the full ad: no per-ad fetch needed.
    case "TEAMTAILOR":
    case "WEBCRUITER": {
      const all =
        source.type === "TEAMTAILOR"
          ? await listTeamtailorJobs(config as TeamtailorConfig)
          : await listWebcruiterJobs(config as WebcruiterConfig);
      const fresh = new Set(await unseenUrls(all.map((l) => l.url)));
      return { found: all.length, listings: all.filter((l) => fresh.has(l.url)), deferred: 0, fetched: 0 };
    }
    // Search pages that give links; each new ad is fetched on its own.
    case "FINN_SEARCH":
    case "NAV_SEARCH":
    case "PHENOM":
    case "CAREER_PAGE": {
      const urls =
        source.type === "FINN_SEARCH"
          ? await listFinnAds(config as FinnConfig, quick)
          : source.type === "NAV_SEARCH"
            ? await listNavAds(config as NavConfig)
            : source.type === "PHENOM"
              ? await listPhenomJobs(config as PhenomConfig, quick)
              : await listCareerPageLinks(config as CareerPageConfig);
      const fresh = await unseenUrls(urls);
      const listings: JobListing[] = [];
      let fetched = 0;
      for (const url of fresh.slice(0, Math.max(0, budget))) {
        if (Date.now() > stopAt) break;
        fetched++;
        try {
          const l = await fetchAd(url);
          if (l) listings.push(l);
        } catch {
          // One broken ad shouldn't sink the source; it's retried next run since it isn't stored.
        }
        await sleep(DETAIL_DELAY_MS);
      }
      return { found: urls.length, listings, deferred: fresh.length - fetched, fetched };
    }
    default:
      return { found: 0, listings: [], deferred: 0, fetched: 0 };
  }
}

/** Picks the parser by URL, since NAV searches also return finn ads. */
function fetchAd(url: string): Promise<JobListing | null> {
  if (url.startsWith("https://www.finn.no/job/ad/")) return fetchFinnAd(url);
  if (url.startsWith("https://arbeidsplassen.nav.no/stillinger/stilling/")) return fetchNavAd(url);
  return fetchAnyAd(url);
}

/** Scores every job that hasn't been scored yet; failures leave score null so the job still shows. */
export async function scorePending(stopAt = Date.now() + 120_000): Promise<number> {
  const pending = await db.job.findMany({
    where: { scoredAt: null },
    orderBy: { firstSeenAt: "desc" },
    take: MAX_SCORED_PER_RUN,
  });
  if (pending.length === 0) return 0;
  const criteria = await getCriteria();
  let scored = 0;

  for (let i = 0; i < pending.length; i += SCORE_BATCH) {
    if (Date.now() > stopAt) break;
    const batch = pending.slice(i, i + SCORE_BATCH);
    let ratings;
    try {
      ratings = await scoreJobs(batch, criteria);
    } catch (e) {
      console.error("scoring failed", e);
      ratings = null;
    }
    if (!ratings) break;

    for (const r of ratings) {
      const job = batch.find((j) => j.id === r.id);
      if (!job) continue;
      const deadline = !job.deadline && r.deadline ? new Date(r.deadline) : undefined;
      await db.job.update({
        where: { id: job.id },
        data: {
          score: Math.round(r.score),
          category: r.category,
          jobType: r.jobType,
          scoreReason: r.reason,
          scoredAt: new Date(),
          deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : undefined,
          // Claude's score overrides the rule-based one for inbox ads (in both directions);
          // anything already in the pipeline keeps its status.
          status: job.status === "NY" || job.status === "FILTRERT" ? (r.score < MIN_SCORE_SHOWN ? "FILTRERT" : "NY") : undefined,
        },
      });
      scored++;
    }
  }
  return scored;
}

/** "Legg til fra URL": any job link, stored straight into the pipeline as Interessant. */
export async function addFromUrl(url: string): Promise<string> {
  const existing = await db.job.findUnique({ where: { url }, select: { id: true } });
  if (existing) return existing.id;
  const listing = await fetchAnyAd(url);
  if (!listing) throw new Error("Fant ingen stillingsannonse på siden.");
  // Same ad already scraped under another URL (e.g. finn vs. the company's own site).
  const dupe = await db.job.findFirst({
    where: { dedupKey: dedupKey(listing.company, listing.title) },
    select: { id: true },
  });
  if (dupe) return dupe.id;
  const [id] = await saveListings([{ ...listing, url }], null, "INTERESSANT");
  if (!id) throw new Error("Klarte ikke å lagre annonsen.");
  await db.event.create({ data: { jobId: id, type: "NOTE", text: "Lagt til manuelt fra URL" } });
  await scorePending();
  return id;
}
