import type { Category, JobType, Prisma } from "@prisma/client";
import Link from "next/link";
import { connection } from "next/server";
import { CardActions } from "@/components/client";
import { CompanyLogo, Deadline, FilterLink, JobChips, location, PageTitle, ScoreBadge, relativeTime, SOURCE_LABEL } from "@/components/ui";
import { db } from "@/lib/db";
import { CATEGORY_LABEL, JOB_TYPE_LABEL } from "@/lib/jobs";

type Search = { type?: string; kategori?: string; filtrert?: string; sort?: string; min?: string; n?: string };

const SORTS = {
  nyest: { label: "Nyest", help: "publisert eller endret sist" },
  match: { label: "Best match", help: "høyest score" },
  frist: { label: "Frist", help: "kortest frist først" },
  funnet: { label: "Sist funnet", help: "når Jobba fant den" },
} as const;
type Sort = keyof typeof SORTS;

const PAGE = 50;
const DAY = 864e5;

// Request-time clock reads live outside the component body (react-hooks/purity).
const yesterday = () => new Date(Date.now() - DAY);
const isFresh = (posted: Date) => Date.now() - posted.getTime() < DAY;

function href(current: Search, patch: Partial<Search>) {
  const next: Search = { ...current, ...patch };
  if (!("n" in patch)) delete next.n; // a new filter starts from the top
  const params = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
  const s = params.toString();
  return s ? `/?${s}` : "/";
}

function orderBy(sort: Sort): Prisma.JobOrderByWithRelationInput[] {
  switch (sort) {
    case "match":
      return [{ score: { sort: "desc", nulls: "last" } }, { postedAt: "desc" }];
    case "frist":
      return [{ deadline: { sort: "asc", nulls: "last" } }, { score: { sort: "desc", nulls: "last" } }];
    case "funnet":
      return [{ firstSeenAt: "desc" }];
    default:
      return [{ postedAt: "desc" }, { firstSeenAt: "desc" }];
  }
}

export default async function NyeUtlysninger({ searchParams }: PageProps<"/">) {
  await connection();
  const raw = await searchParams;
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
  const current: Search = {
    type: str("type"),
    kategori: str("kategori"),
    filtrert: str("filtrert") === "1" ? "1" : undefined,
    sort: str("sort") && str("sort")! in SORTS ? str("sort") : undefined,
    min: str("min") === "60" ? "60" : undefined,
    n: str("n"),
  };
  const sort = (current.sort ?? "nyest") as Sort;
  const take = Math.min(500, Math.max(PAGE, Number(current.n) || PAGE));

  // Counts on the chips reflect everything except the chip's own dimension.
  const base: Prisma.JobWhereInput = {
    status: current.filtrert ? { in: ["NY", "FILTRERT"] } : "NY",
    ...(current.min ? { score: { gte: 60 } } : {}),
    ...(sort === "frist" ? { OR: [{ deadline: null }, { deadline: { gte: yesterday() } }] } : {}),
  };
  const byType = current.type ? { jobType: current.type as JobType } : {};
  const byCategory = current.kategori ? { category: current.kategori as Category } : {};
  const where: Prisma.JobWhereInput = { ...base, ...byType, ...byCategory };

  const [jobs, total, typeCounts, categoryCounts, hidden] = await Promise.all([
    db.job.findMany({
      where,
      orderBy: orderBy(sort),
      take,
      // Descriptions and raw JSON stay in the DB; the list only needs the card fields.
      select: {
        id: true,
        title: true,
        company: true,
        logoUrl: true,
        streetAddress: true,
        city: true,
        country: true,
        remote: true,
        jobType: true,
        category: true,
        employmentType: true,
        deadline: true,
        deadlineText: true,
        postedAt: true,
        firstSeenAt: true,
        score: true,
        scoreReason: true,
        status: true,
        source: { select: { type: true } },
      },
    }),
    db.job.count({ where }),
    db.job.groupBy({ by: ["jobType"], where: { ...base, ...byCategory }, _count: true }),
    db.job.groupBy({ by: ["category"], where: { ...base, ...byType }, _count: true }),
    db.job.count({ where: { status: "FILTRERT" } }),
  ]);
  const typeCount = new Map(typeCounts.map((t) => [t.jobType, t._count]));
  const categoryCount = new Map(categoryCounts.map((c) => [c.category, c._count]));
  return (
    <>
      <PageTitle
        title="Nye utlysninger"
        sub={`${total} til vurdering${hidden && !current.filtrert ? ` · ${hidden} filtrert bort` : ""}. Flytt til Interessant eller Ikke aktuell.`}
      />

      <div className="mb-5 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-stone-500">Sorter:</span>
          {(Object.keys(SORTS) as Sort[]).map((s) => (
            <FilterLink key={s} href={href(current, { sort: s === "nyest" ? undefined : s })} active={sort === s} title={SORTS[s].help}>
              {SORTS[s].label}
            </FilterLink>
          ))}
          <span className="mx-1 h-4 border-l border-stone-200" />
          <FilterLink href={href(current, { min: current.min ? undefined : "60" })} active={!!current.min}>
            Topp (score ≥ 60)
          </FilterLink>
          <FilterLink href={href(current, { filtrert: current.filtrert ? undefined : "1" })} active={!!current.filtrert}>
            Vis filtrert bort
          </FilterLink>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterLink href={href(current, { type: undefined })} active={!current.type}>
            Alle typer
          </FilterLink>
          {(Object.keys(JOB_TYPE_LABEL) as JobType[])
            .filter((t) => typeCount.get(t) || current.type === t)
            .map((t) => (
              <FilterLink key={t} href={href(current, { type: t })} active={current.type === t}>
                {JOB_TYPE_LABEL[t]} <span className="opacity-60">{typeCount.get(t) ?? 0}</span>
              </FilterLink>
            ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterLink href={href(current, { kategori: undefined })} active={!current.kategori}>
            Alle fagområder
          </FilterLink>
          {(Object.keys(CATEGORY_LABEL) as Category[])
            .filter((c) => categoryCount.get(c) || current.kategori === c)
            .map((c) => (
              <FilterLink key={c} href={href(current, { kategori: c })} active={current.kategori === c}>
                {CATEGORY_LABEL[c]} <span className="opacity-60">{categoryCount.get(c) ?? 0}</span>
              </FilterLink>
            ))}
        </div>
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
          Ingen utlysninger med disse filtrene. Kilder sjekkes automatisk, eller kjør en manuelt under{" "}
          <Link href="/kilder" className="underline">
            Kilder
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => {
            const fresh = isFresh(job.postedAt);
            return (
              <li
                key={job.id}
                className={`flex flex-col gap-3 rounded-lg border bg-white p-4 sm:flex-row sm:items-start ${
                  fresh ? "border-emerald-300" : "border-stone-200"
                } ${job.status === "FILTRERT" ? "opacity-60" : ""}`}
              >
                <div className="flex min-w-0 flex-1 gap-3">
                  <CompanyLogo job={job} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/jobb/${job.id}`} className="font-medium hover:underline">
                      {job.title}
                    </Link>
                    <div className="text-sm text-stone-600">
                      {job.company}
                      {location(job) && <span className="text-stone-400"> · {location(job)}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {fresh && <span className="rounded-full bg-emerald-600 px-2 py-0.5 font-semibold text-white">NY</span>}
                      <JobChips job={job} />
                      <Deadline job={job} />
                      <span className="text-stone-400" title={`Funnet ${job.firstSeenAt.toLocaleString("nb-NO", { timeZone: "Europe/Oslo" })}`}>
                        Publisert {relativeTime(job.postedAt)}
                        {job.source ? ` · ${SOURCE_LABEL[job.source.type]}` : ""}
                      </span>
                    </div>
                    {job.scoreReason && <p className="mt-1.5 text-sm text-stone-500">{job.scoreReason}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                  <ScoreBadge score={job.score} />
                  <CardActions jobId={job.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {total > jobs.length && (
        <div className="mt-4 text-center">
          <Link href={href(current, { n: String(take + PAGE) })} scroll={false} className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm hover:border-stone-500">
            Vis flere ({total - jobs.length} til)
          </Link>
        </div>
      )}
    </>
  );
}
