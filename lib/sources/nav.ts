import { fetchText, htmlToText } from "../html";
import { findEmail, parseDate, type JobListing } from "../jobposting";
import { flightPayload, objectAfterKey, objectContainingKey, resolveTextRef } from "./next-payload";

export interface NavConfig {
  query: string;
  /** e.g. "OSLO"; omitted searches all of Norway */
  county?: string;
}

interface NavSearchAd {
  uuid: string;
  source?: string;
  reference?: string;
  published?: string;
  title?: string;
  employer?: { name?: string };
}

type NavLocation = { address?: string; postalCode?: string; city?: string; country?: string };

interface NavAd {
  id: string;
  title?: string;
  jobTitle?: string;
  source?: string;
  reference?: string;
  published?: string;
  updated?: string;
  application?: { applicationDueDate?: string | null; applicationDueLabel?: string | null; applicationEmail?: string | null };
  engagementType?: string;
  extent?: string[];
  remoteOptions?: string | null;
  adTextHtml?: string;
  employer?: { name?: string };
  contactList?: { name?: string; title?: string; phone?: string; email?: string }[] | null;
  locationList?: NavLocation[];
}

const titleCase = (s?: string) => s?.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

export function navSearchUrl(config: NavConfig): string {
  const params = new URLSearchParams({ q: config.query, sort: "published" });
  if (config.county) params.set("county", config.county);
  return `https://arbeidsplassen.nav.no/stillinger?${params}`;
}

/**
 * Ads NAV has copied from finn carry the finn number; those are fetched through
 * the finn parser under their finn URL, so they dedupe against the finn searches.
 */
export function navAdUrl(ad: Pick<NavSearchAd, "uuid" | "source" | "reference">): string {
  if (ad.source?.toUpperCase() === "FINN" && ad.reference && /^\d+$/.test(ad.reference)) {
    return `https://www.finn.no/job/ad/${ad.reference}`;
  }
  return `https://arbeidsplassen.nav.no/stillinger/stilling/${ad.uuid}`;
}

export function parseNavSearch(html: string): string[] {
  const results = objectContainingKey<{ ads?: NavSearchAd[] }>(flightPayload(html), "totalAds");
  return (results?.ads ?? []).filter((a) => a.uuid).map(navAdUrl);
}

export async function listNavAds(config: NavConfig): Promise<string[]> {
  return parseNavSearch(await fetchText(navSearchUrl(config)));
}

export function parseNavAd(html: string, url: string): JobListing | null {
  const payload = flightPayload(html);
  const ad = objectAfterKey<NavAd>(payload, "adData");
  if (!ad?.id) return null;
  const loc = ad.locationList?.[0];
  const contact = ad.contactList?.[0];
  const description = htmlToText(resolveTextRef(payload, ad.adTextHtml) ?? "");
  const deadline = parseDate(ad.application?.applicationDueDate);
  return {
    url,
    externalId: ad.id,
    // "title" is often a marketing headline ("Vil du være med …"); jobTitle is the role
    title: ad.jobTitle || ad.title || "",
    company: ad.employer?.name ?? "",
    description,
    streetAddress: loc?.address,
    postalCode: loc?.postalCode,
    city: titleCase(loc?.city),
    country: loc?.country && loc.country !== "NORGE" ? titleCase(loc.country) : "NO",
    remote: ad.remoteOptions ?? undefined,
    employmentType: [ad.engagementType, ...(ad.extent ?? [])].filter(Boolean).join(", ") || undefined,
    deadline,
    deadlineText: deadline ? undefined : (ad.application?.applicationDueLabel ?? undefined),
    datePosted: parseDate(ad.published),
    postedAt: parseDate(ad.updated) ?? parseDate(ad.published),
    contactName: contact?.name,
    contactTitle: contact?.title,
    contactPhone: contact?.phone,
    contactEmail: contact?.email ?? ad.application?.applicationEmail ?? findEmail(description),
    raw: { source: ad.source, reference: ad.reference },
  };
}

export async function fetchNavAd(url: string): Promise<JobListing | null> {
  return parseNavAd(await fetchText(url), url);
}
