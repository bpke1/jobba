import { decodeEntities } from "../html";
import type { JobListing } from "../jobposting";

/**
 * LinkedIn isn't scraped (its terms forbid it and it blocks bots). Instead the
 * user sets up LinkedIn job alerts ("Instant" delivery) to their inbox, and
 * the mail check turns each alert e-mail into jobs. The alert only carries
 * title, company and place; the full text can be fetched on demand from the
 * job page ("Hent annonsetekst").
 */

export function isLinkedInJobAlert(from: string, subject: string): boolean {
  return /linkedin\.com/i.test(from) && (/jobalerts|jobs-listings|jobs-noreply/i.test(from) || /\bjobs?\b|stilling/i.test(subject));
}

const NOISE =
  /^(view job|se jobb|se stilling|apply|easy apply|enkel søknad|actively recruiting|rekrutterer aktivt|promoted|promotert|new|ny|be an early applicant|\d+ (connections?|forbindelser?|alumni).*|.*(applicants?|søkere)$|this company is actively hiring|\W*)$/i;

export function parseLinkedInAlert(text: string, html = ""): JobListing[] {
  const jobs = new Map<string, JobListing>();

  // The plain-text part lists each job as a few lines followed by its link.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let windowStart = 0;
  lines.forEach((line, i) => {
    const id = line.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/)?.[1];
    if (!id) return;
    const block = lines
      .slice(Math.max(windowStart, i - 6), i)
      .map((l) => l.replace(/^(view job|se jobb):?\s*/i, ""))
      .filter((l) => !NOISE.test(l) && !/^https?:\/\//.test(l) && !/^-{3,}$/.test(l));
    windowStart = i + 1;
    if (!jobs.has(id) && block.length) {
      const [title, company, place] = block.slice(-3).length === 3 ? block.slice(-3) : [block[0], block[1], block[2]];
      jobs.set(id, listing(id, title, company, place));
    }
  });

  // Fallback for HTML-only alerts: the first anchor text pointing at each job is its title.
  if (jobs.size === 0 && html) {
    for (const m of html.matchAll(/<a[^>]+href="[^"]*linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
      if (!text || jobs.has(m[1])) continue;
      const [title, rest = ""] = text.split(/\s{2,}| · /);
      jobs.set(m[1], listing(m[1], title, rest, undefined));
    }
  }
  return [...jobs.values()];
}

function listing(id: string, title?: string, company?: string, place?: string): JobListing {
  const [city, country] = (place ?? "").split(",").map((s) => s.trim());
  return {
    url: `https://www.linkedin.com/jobs/view/${id}`,
    externalId: id,
    title: title ?? "",
    company: (company ?? "").split(" · ")[0],
    description: "",
    city: city || undefined,
    country: country && !/^norway|norge$/i.test(country) ? country : undefined,
    remote: /remote|fjern/i.test(place ?? "") ? "Fjernarbeid" : /hybrid/i.test(place ?? "") ? "Hybrid" : undefined,
    postedAt: new Date(),
  };
}
