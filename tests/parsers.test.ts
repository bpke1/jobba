import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToText } from "@/lib/html";
import { dedupKey } from "@/lib/jobs";
import { parseJobPosting } from "@/lib/jobposting";
import { extractLinks } from "@/lib/sources/career-page";
import { extractFinnAdUrls, finnSearchUrl, parseFinnAd } from "@/lib/sources/finn";
import { parseTeamtailorRss, teamtailorFeedUrl } from "@/lib/sources/teamtailor";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("finn", () => {
  it("collects unique ad URLs from a search page", () => {
    const urls = extractFinnAdUrls(fixture("finn-search.html"));
    expect(urls.length).toBe(50);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls[0]).toMatch(/^https:\/\/www\.finn\.no\/job\/ad\/\d+$/);
  });

  it("builds search URLs with paging", () => {
    expect(finnSearchUrl({ query: "private equity" }, 1)).toBe("https://www.finn.no/job/search?q=private+equity");
    expect(finnSearchUrl({ query: "analytiker", location: "1.20001.20061" }, 2)).toBe(
      "https://www.finn.no/job/search?q=analytiker&location=1.20001.20061&page=2",
    );
  });

  it("parses an ad: JSON-LD fields plus the visible deadline and contact box", () => {
    const ad = parseFinnAd(fixture("finn-ad.html"), "https://www.finn.no/job/ad/476382378")!;
    expect(ad.title).toBe("Investor Relations Manager");
    expect(ad.company).toBe("Elopak ASA");
    expect(ad.streetAddress).toBe("Industriveien 30");
    expect(ad.postalCode).toBe("0279");
    expect(ad.city).toBe("Oslo");
    expect(ad.externalId).toBe("476382378");
    expect(ad.employmentType).toBe("Heltid");
    // "Søknadsfrist: Snarest" on the page overrides the placeholder validThrough.
    expect(ad.deadlineText).toBe("Snarest");
    expect(ad.deadline).toBeUndefined();
    expect(ad.remote).toBe("Delvis hjemmekontor");
    expect(ad.contactName).toBe("Carina Steffens");
    expect(ad.contactTitle).toBe("Senior Talent Acquisition Partner");
    expect(ad.contactEmail).toBe("carina.steffens@elopak.com");
    expect(ad.logoUrl).toMatch(/^https:\/\/images\.finncdn\.no\//);
    expect(ad.description).toContain("Investor & Analyst Engagement");
    expect(ad.description).not.toMatch(/<[a-z]/i);
  });
});

describe("teamtailor", () => {
  it("parses the RSS feed with address and full description", () => {
    const [job] = parseTeamtailorRss(fixture("teamtailor.rss"));
    expect(job.title).toBe("Ferd Digital Internship");
    expect(job.company).toBe("Ferd");
    expect(job.url).toBe("https://ferd.teamtailor.com/jobs/8344301-ferd-digital-internship");
    expect(job.externalId).toBe("8344301");
    expect(job.streetAddress).toBe("Dronning Mauds gate 10");
    expect(job.city).toBe("Oslo");
    expect(job.description).toContain("familieeid norsk investeringsselskap");
    expect(job.description).not.toMatch(/&lt;|<[a-z]/i);
  });

  it("builds feed URLs from a slug or a custom domain", () => {
    expect(teamtailorFeedUrl("ferd")).toBe("https://ferd.teamtailor.com/jobs.rss");
    expect(teamtailorFeedUrl("https://karriere.example.no/jobs")).toBe("https://karriere.example.no/jobs.rss");
  });

  it("reads the same ad's JSON-LD, which has escaped HTML in the description", () => {
    const ad = parseJobPosting(fixture("teamtailor-ad.html"), "https://ferd.teamtailor.com/jobs/8344301")!;
    expect(ad.company).toBe("Ferd");
    expect(ad.streetAddress).toBe("Dronning Mauds gate 10");
    expect(ad.description).toContain("investeringsselskap");
    expect(ad.description).not.toMatch(/&lt;|<[a-z]/i);
  });
});

describe("helpers", () => {
  it("turns HTML into readable text with bullets", () => {
    expect(htmlToText("<p>Hei &amp; velkommen</p><ul><li>En</li><li>To</li></ul>")).toBe("Hei & velkommen\n\n• En\n• To");
    expect(htmlToText("<ul><li><p>2-5 års erfaring</p></li></ul>")).toBe("• 2-5 års erfaring");
  });

  it("dedupKey ignores company suffixes, case and punctuation", () => {
    expect(dedupKey("Elopak ASA", "Investor Relations Manager")).toBe(
      dedupKey("elopak", "Investor relations manager!"),
    );
  });

  it("extracts matching absolute links from a career page", () => {
    const html = `<a href="/jobs/12-analyst">A</a><a href="https://x.no/om-oss">B</a><a href="/jobs/12-analyst">A</a>`;
    expect(extractLinks(html, "https://x.no/karriere", "/jobs/\\d+")).toEqual(["https://x.no/jobs/12-analyst"]);
  });
});
