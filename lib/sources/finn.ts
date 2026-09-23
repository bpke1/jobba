import { fetchText, visibleTextTokens } from "../html";
import { findEmail, parseJobPosting, type JobListing } from "../jobposting";

export interface FinnConfig {
  query: string;
  /** finn location code, e.g. "1.20001.20061" for Oslo; omitted searches all of Norway */
  location?: string;
  pages?: number;
}

export function finnSearchUrl(config: FinnConfig, page: number, newestFirst = false): string {
  const params = new URLSearchParams({ q: config.query });
  if (config.location) params.set("location", config.location);
  if (newestFirst) params.set("sort", "PUBLISHED_DESC");
  if (page > 1) params.set("page", String(page));
  return `https://www.finn.no/job/search?${params}`;
}

export function extractFinnAdUrls(searchHtml: string): string[] {
  const ids = new Set<string>();
  for (const m of searchHtml.matchAll(/\/job\/ad\/(\d+)/g)) ids.add(m[1]);
  return [...ids].map((id) => `https://www.finn.no/job/ad/${id}`);
}

/** `quick` (the frequent snipe runs) reads only the newest page, sorted by publish date. */
export async function listFinnAds(config: FinnConfig, quick = false): Promise<string[]> {
  const urls: string[] = [];
  for (let page = 1; page <= (quick ? 1 : (config.pages ?? 2)); page++) {
    const found = extractFinnAdUrls(await fetchText(finnSearchUrl(config, page, quick)));
    const fresh = found.filter((u) => !urls.includes(u));
    urls.push(...fresh);
    // A short page is the last one.
    if (found.length < 50 || fresh.length === 0) break;
  }
  return urls;
}

function valueAfter(tokens: string[], label: string): string | undefined {
  const i = tokens.indexOf(label);
  if (i < 0) return undefined;
  for (const t of tokens.slice(i + 1, i + 4)) if (t !== ":") return t;
  return undefined;
}

/** "14.9.2026, 11:35" in Norwegian local time */
export function parseNorwegianDateTime(s: string | undefined): Date | undefined {
  const m = s?.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,?\s*(\d{1,2}):(\d{2}))?/);
  if (!m) return undefined;
  const [, d, mo, y, h = "12", mi = "00"] = m;
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:00`;
  // Oslo is UTC+1 in winter and UTC+2 in summer; pick the offset that round-trips.
  for (const off of ["+02:00", "+01:00"]) {
    const date = new Date(iso + off);
    const back = date.toLocaleString("sv-SE", { timeZone: "Europe/Oslo" }).replace(" ", "T");
    if (back.startsWith(iso.slice(0, 16))) return date;
  }
  return new Date(iso + "+01:00");
}

const PHONE_RE = /^[+\d\s().-]{8,}$/;

/**
 * finn's contact box repeats the person as "initials, name, (title), phone";
 * JSON-LD doesn't carry it, so we read it from the visible text.
 */
function parseFinnContact(tokens: string[]) {
  const start = tokens.indexOf("Spørsmål om stillingen");
  if (start < 0) return {};
  const endAt = tokens.indexOf("Firmaets beliggenhet", start);
  const block = tokens
    .slice(start + 1, endAt > start ? endAt : start + 16)
    .filter((t) => !/^[A-ZÆØÅ]{1,3}$/.test(t) && !t.startsWith("Kopier"));

  const name = block.find((t) => !PHONE_RE.test(t));
  const phone = block.find((t) => PHONE_RE.test(t));
  const title = block.find((t) => t !== name && !PHONE_RE.test(t));
  return { contactName: name, contactTitle: title, contactPhone: phone };
}

export function parseFinnAd(html: string, url: string): JobListing | null {
  const listing = parseJobPosting(html, url);
  if (!listing) return null;

  const tokens = visibleTextTokens(html);
  const deadlineText = valueAfter(tokens, "Søknadsfrist") ?? valueAfter(tokens, "Frist");
  // "Snarest"/"Fortløpende" ads still carry a placeholder validThrough in
  // JSON-LD; only trust it when the visible deadline is an actual date.
  const hasRealDeadline = !!deadlineText && /\d/.test(deadlineText);

  return {
    ...listing,
    deadline: hasRealDeadline ? listing.deadline : undefined,
    deadlineText: hasRealDeadline ? undefined : deadlineText,
    remote: valueAfter(tokens, "Hjemmekontor") ?? listing.remote,
    postedAt: parseNorwegianDateTime(valueAfter(tokens, "Sist endret")) ?? listing.datePosted,
    logoUrl: html.match(/<img[^>]*alt="[^"]*logo"[^>]*src="(https:\/\/images\.finncdn\.no[^"]+)"/i)?.[1],
    contactEmail: findEmail(listing.description),
    ...parseFinnContact(tokens),
  };
}

export async function fetchFinnAd(url: string): Promise<JobListing | null> {
  return parseFinnAd(await fetchText(url), url);
}
