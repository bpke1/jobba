import { extractJob } from "../ai";
import { fetchText, visibleTextTokens } from "../html";
import { parseDate, parseJobPosting, type JobListing } from "../jobposting";
import { fetchFinnAd } from "./finn";
import { fetchNavAd } from "./nav";

export interface CareerPageConfig {
  url: string;
  /** regex that ad links must match, e.g. "/jobs/\\d+" or "/karriere/stillinger/" */
  linkPattern: string;
}

export function extractLinks(html: string, baseUrl: string, pattern: string): string[] {
  const re = new RegExp(pattern);
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const abs = new URL(m[1].replace(/&amp;/g, "&"), baseUrl).href;
      if (re.test(abs) && abs !== baseUrl) out.add(abs);
    } catch {
      // unparsable href
    }
  }
  return [...out];
}

export async function listCareerPageLinks(config: CareerPageConfig): Promise<string[]> {
  return extractLinks(await fetchText(config.url), config.url, config.linkPattern);
}

/**
 * Any single ad page: JSON-LD when the site publishes it (most ATSes do),
 * otherwise Claude reads the ad out of the page text.
 */
export async function fetchAnyAd(url: string): Promise<JobListing | null> {
  if (/finn\.no\/job\//.test(url)) {
    const id = url.match(/(?:finnkode=|\/ad\/)(\d+)/)?.[1];
    return fetchFinnAd(id ? `https://www.finn.no/job/ad/${id}` : url);
  }

  if (url.startsWith("https://arbeidsplassen.nav.no/stillinger/stilling/")) return fetchNavAd(url);

  const html = await fetchText(url);
  const fromLd = parseJobPosting(html, url);
  if (fromLd && fromLd.description.length > 200) return fromLd;

  const text = visibleTextTokens(html).join("\n");
  const ai = await extractJob(text, url);
  if (!ai) return fromLd;
  return {
    ...fromLd,
    url,
    title: ai.title,
    company: ai.company || fromLd?.company || "",
    description: ai.description,
    streetAddress: ai.streetAddress ?? fromLd?.streetAddress,
    city: ai.city ?? fromLd?.city,
    country: ai.country ?? fromLd?.country,
    employmentType: ai.employmentType ?? fromLd?.employmentType,
    deadline: parseDate(ai.deadline) ?? fromLd?.deadline,
    deadlineText: ai.deadlineText,
    contactName: ai.contactName,
    contactTitle: ai.contactTitle,
    contactPhone: ai.contactPhone,
    contactEmail: ai.contactEmail,
  };
}
