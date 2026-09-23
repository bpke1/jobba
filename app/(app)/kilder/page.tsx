import { connection } from "next/server";
import { deleteSource, runSourceNow, toggleSource } from "@/app/actions";
import { AddSourceForm, SubmitButton } from "@/components/client";
import { Chip, PageTitle, fmtDate } from "@/components/ui";
import { db } from "@/lib/db";
import type { SourceType } from "@prisma/client";
import { finnSearchUrl, type FinnConfig } from "@/lib/sources/finn";
import { navSearchUrl, type NavConfig } from "@/lib/sources/nav";
import { teamtailorFeedUrl } from "@/lib/sources/teamtailor";

const TYPE_LABEL: Record<SourceType, string> = {
  FINN_SEARCH: "finn.no",
  NAV_SEARCH: "NAV",
  TEAMTAILOR: "Teamtailor",
  WEBCRUITER: "Webcruiter",
  PHENOM: "Phenom",
  CAREER_PAGE: "Karriereside",
  EMAIL_ALERT: "E-postvarsel",
  MANUAL: "Manuell",
};

function sourceUrl(type: SourceType, config: Record<string, unknown>): string | null {
  switch (type) {
    case "FINN_SEARCH":
      return finnSearchUrl(config as unknown as FinnConfig, 1);
    case "NAV_SEARCH":
      return navSearchUrl(config as unknown as NavConfig);
    case "TEAMTAILOR":
      return teamtailorFeedUrl(String(config.slug)).replace(/\.rss$/, "");
    case "WEBCRUITER":
      return `https://candidate.webcruiter.com/nb-no/home/companyadverts?companylock=${config.tenant}`;
    case "PHENOM":
    case "CAREER_PAGE":
      return String(config.url);
    default:
      return null;
  }
}

export default async function SourcesPage() {
  await connection();
  const sources = await db.source.findMany({
    where: { type: { not: "MANUAL" } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: { _count: { select: { jobs: true } } },
  });

  return (
    <>
      <PageTitle title="Kilder" sub="Sjekkes hvert kvarter på dagtid (nyeste treff) og grundig hver natt. Nye annonser havner i Nye utlysninger, scoret mot profilen din." />
      <AddSourceForm />
      <ul className="mt-4 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white text-sm">
        {sources.map((s) => {
          const url = sourceUrl(s.type, s.config as Record<string, unknown>);
          return (
            <li key={s.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${s.enabled ? "" : "opacity-50"}`}>
              <Chip>{TYPE_LABEL[s.type]}</Chip>
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="hover:underline">
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                </div>
                <div className="text-xs text-stone-500">
                  {s._count.jobs} lagret
                  {s.lastRunAt && ` · sist kjørt ${fmtDate(s.lastRunAt)} (${s.lastFound ?? 0} treff)`}
                  {s.lastError && <span className="text-rose-600"> · feil: {s.lastError}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <form action={runSourceNow}>
                  <input type="hidden" name="sourceId" value={s.id} />
                  <SubmitButton variant="secondary" pending="Kjører…">
                    Kjør nå
                  </SubmitButton>
                </form>
                <form action={toggleSource}>
                  <input type="hidden" name="sourceId" value={s.id} />
                  <SubmitButton variant="ghost">{s.enabled ? "Pause" : "Aktiver"}</SubmitButton>
                </form>
                <form action={deleteSource}>
                  <input type="hidden" name="sourceId" value={s.id} />
                  <SubmitButton variant="ghost">Slett</SubmitButton>
                </form>
              </div>
            </li>
          );
        })}
        {sources.length === 0 && <li className="px-4 py-6 text-center text-stone-500">Ingen kilder. Kjør `npm run seed` for standardoppsettet.</li>}
      </ul>
    </>
  );
}
