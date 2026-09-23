import { htmlToText, USER_AGENT } from "../html";
import { findEmail, type JobListing } from "../jobposting";

export interface WebcruiterConfig {
  /** the company number in <tenant>.webcruiter.no or "companylock=<tenant>" (NBIM: 398280) */
  tenant: string;
}

interface WebcruiterAdvert {
  Id: string;
  TenantId: string;
  CompanyName?: string;
  Heading?: string;
  JobType?: string;
  Presentation?: string;
  PublishedDate?: string; // dd/mm/yyyy
  ApplicationDeadline?: string;
  WorkPlaceFacet?: string;
  PictureUrl?: string;
  OpenAdvertUrl?: string;
}

/** Accepts a bare tenant number or any Webcruiter URL that contains it. */
export function webcruiterTenant(input: string): string | null {
  return (
    input.match(/^\s*(\d{4,})\s*$/)?.[1] ??
    input.match(/(\d{4,})\.webcruiter\.no/)?.[1] ??
    input.match(/companylock=(\d+)/i)?.[1] ??
    null
  );
}

function ddmmyyyy(s?: string): Date | undefined {
  const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00+02:00`) : undefined;
}

export function mapWebcruiterAdvert(a: WebcruiterAdvert): JobListing {
  const description = htmlToText(a.Presentation ?? "");
  const deadline = a.ApplicationDeadline ? new Date(a.ApplicationDeadline) : undefined;
  return {
    url: (a.OpenAdvertUrl ?? `https://${a.TenantId}.webcruiter.no/Main/Recruit/Public/${a.Id}`).replace(/[?&]link_source_id=\d+/, ""),
    externalId: a.Id,
    title: a.Heading ?? "",
    company: a.CompanyName ?? "",
    description,
    city: a.WorkPlaceFacet ?? undefined,
    employmentType: a.JobType,
    deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : undefined,
    datePosted: ddmmyyyy(a.PublishedDate),
    contactEmail: findEmail(description),
  };
}

/** The same search the company's Webcruiter job list page runs in the browser. */
export async function listWebcruiterJobs(config: WebcruiterConfig): Promise<JobListing[]> {
  const res = await fetch(`https://candidate.webcruiter.com/api/odvert/companysearch/${encodeURIComponent(config.tenant)}`, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ Take: 100, Skip: 0, Page: 1, PageSize: 100 }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Webcruiter ${res.status}`);
  const data = (await res.json()) as { Data?: WebcruiterAdvert[] };
  return (data.Data ?? []).map(mapWebcruiterAdvert);
}
