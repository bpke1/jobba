import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classify } from "@/lib/classify";
import { parseNorwegianDateTime, parseFinnAd } from "@/lib/sources/finn";
import { isLinkedInJobAlert, parseLinkedInAlert } from "@/lib/sources/linkedin";
import { navAdUrl, parseNavAd, parseNavSearch } from "@/lib/sources/nav";
import { parsePhenomSearch } from "@/lib/sources/phenom";
import { mapWebcruiterAdvert, webcruiterTenant } from "@/lib/sources/webcruiter";

const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("NAV (arbeidsplassen.nav.no)", () => {
  it("maps search hits copied from finn to their finn URL so they dedupe", () => {
    const urls = parseNavSearch(fixture("nav-search.html"));
    expect(urls).toHaveLength(8);
    expect(urls[0]).toBe("https://www.finn.no/job/ad/476342160");
    expect(navAdUrl({ uuid: "abc", source: "IMPORTAPI", reference: "x_1" })).toBe(
      "https://arbeidsplassen.nav.no/stillinger/stilling/abc",
    );
  });

  it("reads a native NAV ad from the embedded Next.js payload", () => {
    const ad = parseNavAd(fixture("nav-ad.html"), "https://arbeidsplassen.nav.no/stillinger/stilling/x")!;
    expect(ad.title).toBe("Supply Chain Planning Analyst");
    expect(ad.company).toMatch(/^Kongsberg Gruppen/);
    expect(ad.streetAddress).toBe("Kirkegårdsveien 45");
    expect(ad.city).toBe("Kongsberg");
    expect(ad.deadline?.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(ad.postedAt?.toISOString()).toBe("2026-09-22T12:29:47.007Z");
    expect(ad.contactName).toBe("Christine Myrbråten");
    // the ad text is a separate "$2b"-style row in the payload
    expect(ad.description.length).toBeGreaterThan(1000);
    expect(ad.description).toMatch(/^Har du et analytisk hode/);
  });
});

describe("finn extras", () => {
  it("uses 'Sist endret' as the posted time", () => {
    const ad = parseFinnAd(fixture("finn-ad.html"), "https://www.finn.no/job/ad/476382378")!;
    expect(ad.postedAt?.toISOString()).toBe("2026-09-14T09:35:00.000Z");
  });

  it("parses Norwegian date-times in Oslo time, summer and winter", () => {
    expect(parseNorwegianDateTime("14.9.2026, 11:35")?.toISOString()).toBe("2026-09-14T09:35:00.000Z");
    expect(parseNorwegianDateTime("3.1.2027, 08:00")?.toISOString()).toBe("2027-01-03T07:00:00.000Z");
  });
});

describe("Webcruiter", () => {
  it("finds the tenant in any Webcruiter URL", () => {
    expect(webcruiterTenant("https://398280.webcruiter.no/main/recruit/public/5182267510")).toBe("398280");
    expect(webcruiterTenant("https://candidate.webcruiter.com/nb-no/home/companyadverts?companylock=398280")).toBe("398280");
    expect(webcruiterTenant("https://example.com")).toBeNull();
  });

  it("maps a company-search advert", () => {
    const job = mapWebcruiterAdvert(JSON.parse(fixture("webcruiter.json")).Data[0]);
    expect(job.company).toBe("Norges Bank Investment Management");
    expect(job.title).toBe("Trader / Senior Trader, Fixed Income");
    expect(job.city).toBe("New York");
    expect(job.url).toBe("https://398280.webcruiter.no/Main/Recruit/Public/5182267510?language=en");
    expect(job.deadline?.toISOString()).toBe("2026-10-11T21:59:59.000Z");
  });
});

describe("Phenom (BCG)", () => {
  it("builds job page URLs from the embedded search results", () => {
    const urls = parsePhenomSearch(fixture("phenom-search.html"), "https://careers.bcg.com/global/en/search-results?keywords=oslo");
    expect(urls).toHaveLength(10);
    expect(urls[0]).toMatch(/^https:\/\/careers\.bcg\.com\/global\/en\/job\/\d+\/[A-Za-z0-9-]+$/);
  });
});

describe("LinkedIn job alerts", () => {
  const text = `Your job alert for analyst in Oslo
3 new jobs match your preferences.

Investment Analyst
Example Capital
Oslo, Oslo, Norway
View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc

---------------------------------------------------------

Summer Intern 2027
Nordic Ventures · Actively recruiting
Oslo, Norway (Hybrid)
Easy Apply
View job: https://www.linkedin.com/comm/jobs/view/4012345679/?trackingId=def
`;

  it("recognises alert senders", () => {
    expect(isLinkedInJobAlert("LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", "analyst in Oslo")).toBe(true);
    expect(isLinkedInJobAlert("LinkedIn <messages-noreply@linkedin.com>", "Kari sent you a message")).toBe(false);
  });

  it("turns each job in the alert into a listing", () => {
    const jobs = parseLinkedInAlert(text);
    expect(jobs.map((j) => [j.url, j.title, j.company, j.city])).toEqual([
      ["https://www.linkedin.com/jobs/view/4012345678", "Investment Analyst", "Example Capital", "Oslo"],
      ["https://www.linkedin.com/jobs/view/4012345679", "Summer Intern 2027", "Nordic Ventures", "Oslo"],
    ]);
    expect(jobs[1].remote).toBe("Hybrid");
  });
});

describe("rule-based classification", () => {
  it("ranks target sectors and job types", () => {
    const vcIntern = classify({ title: "Summer Internship 2027", company: "Northzone", city: "Oslo" });
    expect(vcIntern).toMatchObject({ category: "INVESTERINGSSELSKAP", jobType: "INTERNSHIP" });
    expect(vcIntern.score).toBeGreaterThanOrEqual(80);

    const pe = classify({ title: "Financial Associate til nordisk private equity-miljø", company: "Viking Growth", city: "Oslo", employmentType: "Heltid" });
    expect(pe.category).toBe("INVESTERINGSSELSKAP");

    const ceo = classify({ title: "Daglig leder", company: "Liten Startup AS", city: "Oslo", employmentType: "Fast, Heltid" });
    expect(ceo).toMatchObject({ category: "LEDER", jobType: "FAST" });
    expect(ceo.score).toBeGreaterThanOrEqual(55);

    const off = classify({ title: "Sykepleier", company: "Oslo kommune", city: "Oslo" });
    expect(off.category).toBe("ANNET");
    expect(off.score).toBeLessThan(35);
  });

  it("doesn't take the sector from company names or ad text for non-analytical roles", () => {
    expect(classify({ title: "Operations Manager", company: "Norrøna Adventure AS", city: "Oslo" }).category).toBe("ANNET");
    const engineer = classify({ title: "Software Engineer", company: "Duett", city: "Oslo", description: "Duett er eid av et private equity-fond." });
    expect(engineer.category).toBe("ANNET");
    const receptionist = classify({ title: "Part-time - Receptionist", company: "Pareto Securities", city: "Oslo" });
    expect(receptionist.score).toBeLessThan(60);
    const jv = classify({ title: "Financial Analyst", company: "X", city: "Oslo", description: "A joint venture between A and B." });
    expect(jv.category).not.toBe("VC");
  });

  it("gives strategy consultancies a boost for analyst roles only", () => {
    const associate = classify({ title: "Associate, Norway", company: "Boston Consulting Group", city: "Oslo" });
    const engineer = classify({ title: "Forward Deployed AI Engineer, Internship", company: "Boston Consulting Group", city: "Oslo" });
    expect(associate.category).toBe("CORP_FIN");
    expect(associate.score).toBeGreaterThan(engineer.score);
  });

  it("penalises other Norwegian cities but not Oslo or remote", () => {
    const bergen = classify({ title: "Analytiker", company: "X", city: "Bergen", country: "NO" });
    const oslo = classify({ title: "Analytiker", company: "X", city: "Oslo", country: "NO" });
    const remote = classify({ title: "Analytiker", company: "X", city: "Bergen", remote: "Fjernarbeid" });
    expect(oslo.score - bergen.score).toBe(20);
    expect(remote.score).toBe(oslo.score);
  });
});
