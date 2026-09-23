import { extractJsonLdBlocks, htmlToText } from "./html";

/** A scraped ad, before it is stored. Every source adapter produces these. */
export interface JobListing {
  url: string;
  externalId?: string;
  title: string;
  company: string;
  description: string;
  streetAddress?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  remote?: string;
  employmentType?: string;
  deadline?: Date;
  deadlineText?: string;
  datePosted?: Date;
  /** published or last changed at the source, when it says so (finn "Sist endret", NAV "updated") */
  postedAt?: Date;
  contactName?: string;
  contactTitle?: string;
  contactPhone?: string;
  contactEmail?: string;
  logoUrl?: string;
  raw?: unknown;
}

type Obj = Record<string, unknown>;

const EMPLOYMENT_TYPES: Record<string, string> = {
  FULL_TIME: "Heltid",
  PART_TIME: "Deltid",
  CONTRACTOR: "Kontrakt",
  TEMPORARY: "Midlertidig",
  INTERN: "Internship",
  VOLUNTEER: "Frivillig",
  OTHER: "Annet",
};

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasType(o: Obj, type: string): boolean {
  const t = o["@type"];
  return t === type || (Array.isArray(t) && t.includes(type));
}

/** Walks finn's {"script:ld+json": …} wrapper, @graph arrays and plain arrays. */
function findJobPosting(node: unknown): Obj | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findJobPosting(item);
      if (hit) return hit;
    }
    return null;
  }
  if (!isObj(node)) return null;
  if (hasType(node, "JobPosting")) return node;
  for (const key of ["script:ld+json", "@graph", "mainEntity"]) {
    if (key in node) {
      const hit = findJobPosting(node[key]);
      if (hit) return hit;
    }
  }
  return null;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

export function parseDate(v: unknown): Date | undefined {
  const s = str(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseJobPosting(html: string, url: string): JobListing | null {
  let posting: Obj | null = null;
  for (const block of extractJsonLdBlocks(html)) {
    posting = findJobPosting(block);
    if (posting) break;
  }
  if (!posting) return null;

  const org = isObj(posting.hiringOrganization) ? posting.hiringOrganization : {};
  const locations = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
  const place = locations.find(isObj);
  const address = place && isObj(place.address) ? place.address : {};

  const identifier = isObj(posting.identifier) ? posting.identifier.value : posting.identifier;
  const types = Array.isArray(posting.employmentType) ? posting.employmentType : [posting.employmentType];
  const employmentType = types
    .map((t) => str(t))
    .filter((t): t is string => !!t)
    .map((t) => EMPLOYMENT_TYPES[t] ?? t)
    .join(", ");

  const logo = isObj(org.logo) ? org.logo.url : org.logo;

  return {
    url,
    externalId: str(identifier),
    title: str(posting.title) ?? "",
    company: str(org.name) ?? "",
    description: htmlToText(str(posting.description) ?? ""),
    streetAddress: str(address.streetAddress),
    postalCode: str(address.postalCode),
    city: str(address.addressLocality),
    country: str(address.addressCountry),
    remote: posting.jobLocationType === "TELECOMMUTE" ? "Fjernarbeid" : undefined,
    employmentType: employmentType || undefined,
    deadline: parseDate(posting.validThrough),
    datePosted: parseDate(posting.datePosted),
    logoUrl: str(logo),
    raw: posting,
  };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** First e-mail address mentioned in the text, for ads that only name a contact in prose. */
export function findEmail(text: string): string | undefined {
  return text.match(EMAIL_RE)?.[0];
}
