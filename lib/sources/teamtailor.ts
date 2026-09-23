import { XMLParser } from "fast-xml-parser";
import { fetchText, htmlToText } from "../html";
import { findEmail, parseDate, type JobListing } from "../jobposting";

export interface TeamtailorConfig {
  /** the subdomain in https://<slug>.teamtailor.com, or a full career-site URL on a custom domain */
  slug: string;
}

export function teamtailorFeedUrl(slug: string): string {
  const base = slug.startsWith("http") ? slug.replace(/\/+$/, "") : `https://${slug}.teamtailor.com`;
  return `${base.replace(/\/jobs(\.rss)?$/, "")}/jobs.rss`;
}

const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const REMOTE: Record<string, string> = { hybrid: "Hybrid", fully: "Fjernarbeid", remote: "Fjernarbeid" };

/** Teamtailor's RSS already carries the full description and office address, so no per-ad fetch is needed. */
export function parseTeamtailorRss(xml: string): JobListing[] {
  const parser = new XMLParser({ ignoreAttributes: true, processEntities: false, parseTagValue: false });
  const channel = parser.parse(xml)?.rss?.channel ?? {};
  const company = String(channel.title ?? "").trim();

  return asArray<Record<string, unknown>>(channel.item).map((item) => {
    const loc = asArray<Record<string, unknown>>(
      (item["tt:locations"] as Record<string, unknown> | undefined)?.["tt:location"] as never,
    )[0];
    const description = htmlToText(String(item.description ?? ""));
    const link = String(item.link ?? "");
    return {
      url: link,
      externalId: link.match(/\/jobs\/(\d+)/)?.[1],
      title: htmlToText(String(item.title ?? "")),
      company,
      description,
      streetAddress: loc?.["tt:address"] ? String(loc["tt:address"]) : undefined,
      postalCode: loc?.["tt:zip"] ? String(loc["tt:zip"]) : undefined,
      city: loc?.["tt:city"] ? String(loc["tt:city"]) : undefined,
      country: loc?.["tt:country"] ? String(loc["tt:country"]) : undefined,
      remote: REMOTE[String(item.remoteStatus ?? "")],
      datePosted: parseDate(item.pubDate),
      contactEmail: findEmail(description),
      raw: { department: item["tt:department"], role: item["tt:role"] },
    };
  });
}

export async function listTeamtailorJobs(config: TeamtailorConfig): Promise<JobListing[]> {
  return parseTeamtailorRss(await fetchText(teamtailorFeedUrl(config.slug)));
}
