import type { Job, SourceType } from "@prisma/client";
import Link from "next/link";
import { CATEGORY_LABEL, JOB_TYPE_LABEL } from "@/lib/jobs";

const TZ = "Europe/Oslo";

export function fmtDate(d: Date | null | undefined, withYear = false): string {
  if (!d) return "";
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: TZ });
}

export function toInputDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** "for 3 t siden", "i går", "for 5 d siden" */
export function relativeTime(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "nå";
  if (mins < 60) return `for ${mins} min siden`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `for ${hours} t siden`;
  const days = Math.round(hours / 24);
  if (days === 1) return "i går";
  if (days < 30) return `for ${days} d siden`;
  return fmtDate(d, true);
}

export const SOURCE_LABEL: Record<SourceType, string> = {
  FINN_SEARCH: "finn",
  NAV_SEARCH: "NAV",
  TEAMTAILOR: "karriereside",
  WEBCRUITER: "karriereside",
  PHENOM: "karriereside",
  CAREER_PAGE: "karriereside",
  EMAIL_ALERT: "LinkedIn",
  MANUAL: "manuell",
};

export function daysUntil(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / 864e5);
}

export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "accent" | "warn" | "good" | "bad" }) {
  const tones = {
    neutral: "bg-stone-100 text-stone-700",
    accent: "bg-indigo-50 text-indigo-700",
    warn: "bg-amber-50 text-amber-800",
    good: "bg-emerald-50 text-emerald-700",
    bad: "bg-rose-50 text-rose-700",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-stone-400">–</span>;
  const tone =
    score >= 75 ? "bg-emerald-600 text-white" : score >= 55 ? "bg-emerald-100 text-emerald-800" : score >= 35 ? "bg-stone-200 text-stone-700" : "bg-stone-100 text-stone-400";
  return (
    <span title="Match-score" className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${tone}`}>
      {score}
    </span>
  );
}

export function Deadline({ job }: { job: Pick<Job, "deadline" | "deadlineText"> }) {
  if (job.deadline) {
    const days = daysUntil(job.deadline);
    const tone = days < 0 ? "text-stone-400 line-through" : days <= 3 ? "text-rose-600 font-medium" : days <= 7 ? "text-amber-700" : "text-stone-600";
    return (
      <span className={tone}>
        Frist {fmtDate(job.deadline)}
        {days >= 0 && days <= 14 ? ` (${days === 0 ? "i dag" : `${days} d`})` : ""}
      </span>
    );
  }
  if (job.deadlineText) return <span className="text-amber-700">Frist: {job.deadlineText}</span>;
  return null;
}

export function location(job: Pick<Job, "streetAddress" | "city" | "country" | "remote">): string {
  const parts = [job.streetAddress, job.city].filter(Boolean);
  if (job.country && !["NO", "Norge", "Norway"].includes(job.country)) parts.push(job.country);
  return [parts.join(", "), job.remote].filter(Boolean).join(" · ");
}

export function JobChips({ job }: { job: Pick<Job, "jobType" | "category" | "employmentType"> }) {
  return (
    <>
      {job.jobType && <Chip tone="accent">{JOB_TYPE_LABEL[job.jobType]}</Chip>}
      {job.category && job.category !== "ANNET" && <Chip>{CATEGORY_LABEL[job.category]}</Chip>}
      {!job.jobType && job.employmentType && <Chip>{job.employmentType}</Chip>}
    </>
  );
}

export function CompanyLogo({ job }: { job: Pick<Job, "logoUrl" | "company"> }) {
  if (job.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- remote logos from many hosts; not worth configuring next/image
    return <img src={job.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-md border border-stone-200 bg-white object-contain p-1" />;
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-stone-100 text-sm font-semibold text-stone-500">
      {job.company.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function PageTitle({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-stone-500">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function FilterLink({ href, active, title, children }: { href: string; active: boolean; title?: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      title={title}
      scroll={false}
      className={`rounded-full border px-3 py-1 text-xs ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-600 hover:border-stone-400"}`}
    >
      {children}
    </Link>
  );
}
