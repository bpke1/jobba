import Link from "next/link";
import { connection } from "next/server";
import { acceptEmailSuggestion, checkMailNow, dismissEmail, linkEmail } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Chip, PageTitle, fmtDate } from "@/components/ui";
import { db } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/jobs";

const TONE = { BEKREFTELSE: "neutral", INTERVJU: "good", TILBUD: "good", AVSLAG: "bad", FORESPORSEL: "accent", ANNET: "neutral" } as const;

export default async function InboxPage() {
  await connection();
  const [emails, applications, cursor] = await Promise.all([
    db.email.findMany({ orderBy: { receivedAt: "desc" }, take: 100, include: { job: { select: { id: true, company: true, title: true } } } }),
    db.job.findMany({
      where: { status: { in: ["UNDER_ARBEID", "SENDT", "INTERVJU", "TILBUD"] } },
      orderBy: { company: "asc" },
      select: { id: true, company: true, title: true },
    }),
    db.setting.findUnique({ where: { key: "imapCursor" } }),
  ]);
  const configured = !!process.env.IMAP_HOST && !!process.env.IMAP_USER && !!process.env.IMAP_PASSWORD;

  return (
    <>
      <PageTitle
        title="Innboks"
        sub={
          configured
            ? `Svar på søknader fra ${process.env.IMAP_USER}. Leser kun; ingenting merkes som lest eller flyttes.${cursor ? "" : " Ikke sjekket ennå."}`
            : "IMAP er ikke satt opp (IMAP_HOST, IMAP_USER, IMAP_PASSWORD)."
        }
      >
        {configured && (
          <form action={checkMailNow}>
            <SubmitButton variant="secondary" pending="Sjekker…">
              Sjekk e-post nå
            </SubmitButton>
          </form>
        )}
      </PageTitle>

      {emails.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">Ingen e-poster om søknader funnet ennå.</p>
      ) : (
        <ul className="space-y-2">
          {emails.map((e) => (
            <li key={e.id} className={`rounded-lg border border-stone-200 bg-white p-4 text-sm ${e.handled ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={TONE[e.classification]}>{e.classification}</Chip>
                    <span className="font-medium">{e.subject}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-stone-500">
                    {e.from} · {fmtDate(e.receivedAt, true)}
                  </div>
                </div>
                {e.job && (
                  <Link href={`/jobb/${e.job.id}`} className="text-xs text-indigo-700 hover:underline">
                    {e.job.company}: {e.job.title}
                  </Link>
                )}
              </div>
              <p className="mt-2 line-clamp-3 text-stone-600">{e.snippet}</p>
              {!e.handled && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {e.job && e.suggestedStatus && (
                    <form action={acceptEmailSuggestion}>
                      <input type="hidden" name="emailId" value={e.id} />
                      <SubmitButton>Flytt til {STATUS_LABEL[e.suggestedStatus]}</SubmitButton>
                    </form>
                  )}
                  {!e.job && (
                    <form action={linkEmail} className="flex gap-2">
                      <input type="hidden" name="emailId" value={e.id} />
                      <select name="jobId" required className="rounded-md border border-stone-300 px-2 py-1.5 text-xs">
                        <option value="">Koble til søknad…</option>
                        {applications.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.company}: {a.title}
                          </option>
                        ))}
                      </select>
                      <SubmitButton variant="secondary">Koble</SubmitButton>
                    </form>
                  )}
                  <form action={dismissEmail}>
                    <input type="hidden" name="emailId" value={e.id} />
                    <SubmitButton variant="ghost">Ferdig</SubmitButton>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
