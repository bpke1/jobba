import type { JobStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { acceptEmailSuggestion, addEvent, changeStatus, dismissEmail, refetchDescription, runMatchAnalysis, saveJobDetails } from "@/app/actions";
import { AutoSubmitSelect, SubmitButton } from "@/components/client";
import { Chip, CompanyLogo, Deadline, JobChips, ScoreBadge, fmtDate, location, relativeTime, toInputDate } from "@/components/ui";
import { db } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/jobs";

const ALL_STATUSES = Object.keys(STATUS_LABEL) as JobStatus[];
const EVENT_ICON = { STATUS: "↦", EMAIL: "✉", NOTE: "✎", CALL: "☎" } as const;

const inputCls = "w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm";

export default async function JobPage({ params }: PageProps<"/jobb/[id]">) {
  await connection();
  const { id } = await params;
  const job = await db.job.findUnique({
    where: { id },
    include: {
      events: { orderBy: { at: "desc" } },
      emails: { where: { handled: false, suggestedStatus: { not: null } }, orderBy: { receivedAt: "desc" } },
      source: { select: { name: true } },
    },
  });
  if (!job) notFound();

  const loc = location(job);
  const mapsUrl = job.streetAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([job.streetAddress, job.postalCode, job.city].filter(Boolean).join(" "))}`
    : null;
  const hentCmd = `npm run hent -- ${job.id}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <article className="min-w-0">
        <div className="flex gap-3">
          <CompanyLogo job={job} />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{job.title}</h1>
            <p className="text-stone-600">{job.company}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <ScoreBadge score={job.score} />
          <JobChips job={job} />
          {job.employmentType && job.jobType && <Chip>{job.employmentType}</Chip>}
          <Deadline job={job} />
        </div>
        {job.scoreReason && <p className="mt-2 text-sm text-stone-500">{job.scoreReason}</p>}

        {job.emails.map((e) => (
          <div key={e.id} className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium">
                ✉ {e.classification}: {e.subject}
              </div>
              <div className="text-xs text-stone-600">
                {e.from} · {fmtDate(e.receivedAt)}
              </div>
            </div>
            <div className="flex gap-2">
              <form action={acceptEmailSuggestion}>
                <input type="hidden" name="emailId" value={e.id} />
                <SubmitButton>Flytt til {STATUS_LABEL[e.suggestedStatus!]}</SubmitButton>
              </form>
              <form action={dismissEmail}>
                <input type="hidden" name="emailId" value={e.id} />
                <SubmitButton variant="ghost">Ignorer</SubmitButton>
              </form>
            </div>
          </div>
        ))}

        <div className="mt-6 text-[15px] leading-relaxed whitespace-pre-line text-stone-800">
          {job.description || (
            <form action={refetchDescription} className="rounded-lg border border-dashed border-stone-300 p-6 text-center">
              <input type="hidden" name="jobId" value={job.id} />
              <p className="mb-3 text-sm text-stone-500">Annonseteksten er ikke hentet (f.eks. fra et LinkedIn-varsel).</p>
              <SubmitButton variant="secondary" pending="Henter…">
                Hent annonsetekst
              </SubmitButton>
            </form>
          )}
        </div>
      </article>

      <aside className="space-y-4 text-sm">
        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <form action={changeStatus} className="flex items-center gap-2">
            <input type="hidden" name="jobId" value={job.id} />
            <label className="text-xs text-stone-500" htmlFor="status">
              Status
            </label>
            <AutoSubmitSelect id="status" name="status" defaultValue={job.status} className={inputCls}>
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </AutoSubmitSelect>
          </form>
          <dl className="mt-4 space-y-2">
            {loc && (
              <div>
                <dt className="text-xs text-stone-500">Sted</dt>
                <dd>{mapsUrl ? <a href={mapsUrl} target="_blank" rel="noreferrer" className="underline decoration-stone-300 hover:decoration-stone-600">{loc}</a> : loc}</dd>
              </div>
            )}
            {(job.contactName || job.contactPhone || job.contactEmail) && (
              <div>
                <dt className="text-xs text-stone-500">Kontakt</dt>
                <dd>
                  {job.contactName}
                  {job.contactTitle && <span className="text-stone-500">, {job.contactTitle}</span>}
                  {job.contactPhone && (
                    <div>
                      <a href={`tel:${job.contactPhone.replace(/[^\d+]/g, "")}`} className="underline decoration-stone-300">
                        {job.contactPhone}
                      </a>
                    </div>
                  )}
                  {job.contactEmail && (
                    <div className="break-all">
                      <a href={`mailto:${job.contactEmail}`} className="underline decoration-stone-300">
                        {job.contactEmail}
                      </a>
                    </div>
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-stone-500">Kilde</dt>
              <dd className="break-all">
                <a href={job.url} target="_blank" rel="noreferrer" className="underline decoration-stone-300">
                  Åpne annonsen ↗
                </a>
                <span className="text-stone-400">
                  {" "}
                  · {job.source?.name ?? "manuell"} · publisert {relativeTime(job.postedAt)} · funnet {fmtDate(job.firstSeenAt, true)}
                </span>
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">Søk på stillingen</h2>
          <p className="text-xs text-stone-500">Lag en lokal søknadsmappe med annonsen (utlysning.md) og skriv søknaden der:</p>
          <code className="mt-1.5 block rounded bg-stone-100 px-2 py-1.5 text-xs break-all select-all">{hentCmd}</code>
          <form action={runMatchAnalysis} className="mt-3">
            <input type="hidden" name="jobId" value={job.id} />
            <SubmitButton variant="secondary" pending="Analyserer…" className="w-full">
              Match-analyse med Claude
            </SubmitButton>
          </form>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">Oppfølging</h2>
          <form action={saveJobDetails} className="space-y-2">
            <input type="hidden" name="jobId" value={job.id} />
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 text-xs text-stone-500">
                Neste steg
                <input name="nextStep" defaultValue={job.nextStep ?? ""} placeholder="Ring kontaktperson" className={inputCls} />
              </label>
              <label className="text-xs text-stone-500">
                Dato
                <input type="date" name="nextStepDate" defaultValue={toInputDate(job.nextStepDate)} className={inputCls} />
              </label>
              <label className="text-xs text-stone-500">
                Søknadsfrist
                <input type="date" name="deadline" defaultValue={toInputDate(job.deadline)} className={inputCls} />
              </label>
              <label className="text-xs text-stone-500">
                Sendt
                <input type="date" name="appliedAt" defaultValue={toInputDate(job.appliedAt)} className={inputCls} />
              </label>
              <label className="text-xs text-stone-500">
                Kanal
                <input name="channel" defaultValue={job.channel ?? ""} placeholder="Finn, e-post…" className={inputCls} />
              </label>
              <label className="col-span-2 text-xs text-stone-500">
                Kontaktperson
                <input name="contactName" defaultValue={job.contactName ?? ""} className={inputCls} />
              </label>
              <label className="text-xs text-stone-500">
                Telefon
                <input name="contactPhone" defaultValue={job.contactPhone ?? ""} className={inputCls} />
              </label>
              <label className="text-xs text-stone-500">
                E-post
                <input name="contactEmail" defaultValue={job.contactEmail ?? ""} className={inputCls} />
              </label>
              <label className="col-span-2 text-xs text-stone-500">
                Notater
                <textarea name="notes" rows={4} defaultValue={job.notes ?? ""} className={inputCls} />
              </label>
            </div>
            {job.localFolder && <p className="text-xs break-all text-stone-500">Mappe: {job.localFolder}</p>}
            <SubmitButton pending="Lagrer…">Lagre</SubmitButton>
          </form>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">Tidslinje</h2>
          <form action={addEvent} className="mb-3 space-y-2">
            <input type="hidden" name="jobId" value={job.id} />
            <textarea name="text" rows={2} placeholder="Notat eller referat fra samtale…" className={inputCls} />
            <div className="flex items-center gap-2">
              <select name="type" className="rounded-md border border-stone-300 px-2 py-1.5 text-xs">
                <option value="NOTE">Notat</option>
                <option value="CALL">Samtale</option>
              </select>
              <SubmitButton variant="secondary">Legg til</SubmitButton>
            </div>
          </form>
          <ol className="space-y-3">
            {job.events.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="w-4 shrink-0 text-stone-400">{EVENT_ICON[e.type]}</span>
                <div className="min-w-0">
                  <div className="text-xs text-stone-400">{fmtDate(e.at, true)}</div>
                  <div className="whitespace-pre-line break-words">{e.text}</div>
                </div>
              </li>
            ))}
            {job.events.length === 0 && <li className="text-xs text-stone-400">Ingen hendelser ennå.</li>}
          </ol>
        </section>
      </aside>
    </div>
  );
}
