import type { Prisma, SourceType } from "@prisma/client";
import { fetchText } from "../html";
import { extractLinks } from "./career-page";
import { webcruiterTenant } from "./webcruiter";

export interface DetectedSource {
  type: SourceType;
  name: string;
  config: Prisma.InputJsonObject;
}

// Used when a career page is added without a link regex; checked against the page before saving.
const DEFAULT_LINK_PATTERN = "/(jobs?|job-listings|stilling(er)?|ledige-stillinger|positions?|vacanc(y|ies)|careers?|karriere)/[^/?#]+";

/**
 * Turns whatever the user pasted on /kilder into one or more sources:
 * plain words become a finn and a NAV search; known job sites are recognised
 * from the URL; anything else is probed (Teamtailor feed, Phenom data,
 * Webcruiter link) before falling back to a generic career page.
 */
export async function detectSources(input: string, extra = ""): Promise<DetectedSource[] | string> {
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    const location = extra.trim() || undefined;
    return [
      { type: "FINN_SEARCH", name: `finn: ${value}`, config: { query: value, pages: 2, ...(location ? { location } : {}) } },
      { type: "NAV_SEARCH", name: `NAV: ${value}`, config: { query: value } },
    ];
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Ugyldig URL.";
  }
  const host = url.hostname;

  if (host.endsWith("finn.no") && url.pathname.startsWith("/job/")) {
    const query = url.searchParams.get("q") ?? "";
    const location = url.searchParams.get("location");
    return [{ type: "FINN_SEARCH", name: `finn: ${query || "søk"}`, config: { query, pages: 2, ...(location ? { location } : {}) } }];
  }
  if (host === "arbeidsplassen.nav.no") {
    const query = url.searchParams.get("q") ?? "";
    const county = url.searchParams.get("county");
    return [{ type: "NAV_SEARCH", name: `NAV: ${query || "søk"}`, config: { query, ...(county ? { county } : {}) } }];
  }
  if (host.endsWith(".teamtailor.com")) {
    const slug = host.replace(".teamtailor.com", "");
    return [{ type: "TEAMTAILOR", name: slug, config: { slug } }];
  }
  const tenant = webcruiterTenant(value);
  if (tenant) return [{ type: "WEBCRUITER", name: `Webcruiter ${tenant}`, config: { tenant } }];

  // Teamtailor on a custom domain?
  try {
    const rss = await fetchText(`${url.origin}/jobs.rss`, 10000);
    if (/<rss/i.test(rss)) {
      const name = rss.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() ?? host;
      return [{ type: "TEAMTAILOR", name, config: { slug: url.origin } }];
    }
  } catch {
    // not Teamtailor
  }

  let html: string;
  try {
    html = await fetchText(value);
  } catch (e) {
    return `Klarte ikke å hente siden: ${e instanceof Error ? e.message : e}`;
  }
  const name = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim().slice(0, 60) ?? host;
  if (html.includes("phApp.ddo") && url.pathname.includes("search-results")) {
    return [{ type: "PHENOM", name, config: { url: value } }];
  }
  const embeddedTenant = html.match(/(\d{4,})\.webcruiter\.no|companylock=(\d+)/i);
  if (embeddedTenant && !extra) {
    const t = embeddedTenant[1] ?? embeddedTenant[2];
    return [{ type: "WEBCRUITER", name, config: { tenant: t } }];
  }

  const linkPattern = extra.trim() || DEFAULT_LINK_PATTERN;
  try {
    new RegExp(linkPattern);
  } catch {
    return "Lenkemønsteret er ikke en gyldig regex.";
  }
  const links = extractLinks(html, value, linkPattern);
  if (links.length === 0) {
    return "Fant ingen annonselenker på siden. Oppgi et lenkemønster (regex) som matcher annonse-URL-ene, f.eks. /stillinger/\\d+/.";
  }
  return [{ type: "CAREER_PAGE", name, config: { url: value, linkPattern } }];
}
