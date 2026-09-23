import { fetchText } from "../html";

export interface PhenomConfig {
  /** a Phenom "search-results" URL, e.g. https://careers.bcg.com/global/en/search-results?keywords=oslo */
  url: string;
}

interface PhenomJob {
  jobId?: string;
  title?: string;
}

/** Phenom career sites (BCG and many large firms) embed the first result page as `phApp.ddo = {…}`. */
export function parsePhenomSearch(html: string, searchUrl: string): string[] {
  const at = html.indexOf("phApp.ddo = ");
  if (at < 0) return [];
  const start = html.indexOf("{", at);
  let depth = 0;
  let end = start;
  for (; end < html.length; end++) {
    const c = html[end];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) break;
  }
  let ddo: { eagerLoadRefineSearch?: { data?: { jobs?: PhenomJob[] } } };
  try {
    ddo = JSON.parse(html.slice(start, end + 1));
  } catch {
    return [];
  }
  // Job pages live next to search-results: /global/en/search-results -> /global/en/job/<id>/<slug>
  const base = new URL(searchUrl);
  const prefix = base.pathname.replace(/\/search-results.*$/, "");
  return (ddo.eagerLoadRefineSearch?.data?.jobs ?? [])
    .filter((j) => j.jobId)
    .map((j) => {
      const slug = (j.title ?? "job").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
      return `${base.origin}${prefix}/job/${j.jobId}/${slug}`;
    });
}

/** First two result pages (10 jobs each); each job page carries JobPosting JSON-LD. */
export async function listPhenomJobs(config: PhenomConfig, quick = false): Promise<string[]> {
  const urls: string[] = [];
  for (let page = 0; page < (quick ? 1 : 2); page++) {
    const u = new URL(config.url);
    if (page > 0) u.searchParams.set("from", String(page * 10));
    const found = parsePhenomSearch(await fetchText(u.href), config.url);
    urls.push(...found.filter((f) => !urls.includes(f)));
    if (found.length < 10) break;
  }
  return urls;
}
