import type { JobStatus } from "@prisma/client";
import Link from "next/link";
import { connection } from "next/server";
import { changeStatus } from "@/app/actions";
import { AutoSubmitSelect } from "@/components/client";
import { Deadline, JobChips, PageTitle, ScoreBadge, fmtDate } from "@/components/ui";
import { db } from "@/lib/db";
import { PIPELINE, STATUS_LABEL } from "@/lib/jobs";

const MOVE_TO: JobStatus[] = [...PIPELINE, "IKKE_AKTUELL"];

export default async function PipelinePage() {
  await connection();
  const jobs = await db.job.findMany({
    where: { status: { in: PIPELINE } },
    orderBy: [{ nextStepDate: { sort: "asc", nulls: "last" } }, { deadline: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    include: { emails: { where: { handled: false }, select: { id: true } } },
  });
  const closedCount = await db.job.count({ where: { status: "IKKE_AKTUELL" } });

  return (
    <>
      <PageTitle title="Pipeline" sub={`${jobs.length} aktive · ${closedCount} ikke aktuelle`} />
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        <div className="grid min-w-[72rem] grid-cols-6 gap-3">
          {PIPELINE.map((status) => {
            const col = jobs.filter((j) => j.status === status);
            return (
              <section key={status} className="rounded-lg bg-stone-100/70 p-2">
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  {STATUS_LABEL[status]}
                  <span className="font-normal">{col.length}</span>
                </h2>
                <ul className="space-y-2">
                  {col.map((job) => (
                    <li key={job.id} className="rounded-md border border-stone-200 bg-white p-2.5 text-sm shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/jobb/${job.id}`} className="font-medium leading-snug hover:underline">
                          {job.company}
                        </Link>
                        <ScoreBadge score={job.score} />
                      </div>
                      <div className="mt-0.5 text-xs text-stone-600">{job.title}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1 text-xs">
                        <JobChips job={job} />
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-xs">
                        {status !== "SENDT" && <Deadline job={job} />}
                        {job.appliedAt && <div className="text-stone-500">Sendt {fmtDate(job.appliedAt)}</div>}
                        {job.nextStep && (
                          <div className={job.nextStepDate && job.nextStepDate < new Date() ? "font-medium text-rose-600" : "text-stone-600"}>
                            → {job.nextStep}
                            {job.nextStepDate ? ` (${fmtDate(job.nextStepDate)})` : ""}
                          </div>
                        )}
                        {job.emails.length > 0 && <div className="font-medium text-indigo-700">✉ {job.emails.length} ny e-post</div>}
                      </div>
                      <form action={changeStatus} className="mt-2">
                        <input type="hidden" name="jobId" value={job.id} />
                        <AutoSubmitSelect
                          name="status"
                          defaultValue={job.status}
                          aria-label="Flytt til"
                          className="w-full rounded border border-stone-200 bg-stone-50 px-1.5 py-1 text-xs"
                        >
                          {MOVE_TO.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABEL[s]}
                            </option>
                          ))}
                        </AutoSubmitSelect>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
