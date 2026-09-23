import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { sendDigest } from "@/lib/digest";
import { checkMail } from "@/lib/mail";
import { runScrape } from "@/lib/scrape";
import { runSnipe } from "@/lib/snipe";

export const maxDuration = 300;

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET"; the same header works for manual curl runs.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const TASKS: Record<string, () => Promise<unknown>> = {
  scrape: () => runScrape({ deadlineMs: 270_000 }),
  mail: () => checkMail(),
  digest: () => sendDigest(),
  snipe: () => runSnipe(),
  // One daily run for the Hobby plan's cron limits: jobs, then mail, then the summary of both.
  daily: async () => ({
    scrape: await runScrape({ deadlineMs: 200_000 }),
    mail: await checkMail().catch((e: Error) => ({ error: e.message })),
    digest: await sendDigest(),
  }),
};

export async function GET(req: Request, ctx: RouteContext<"/api/cron/[task]">) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const { task } = await ctx.params;
  const run = TASKS[task];
  if (!run) return new Response("Unknown task", { status: 404 });

  // ?async=1 answers at once and keeps working after the response (Vercel keeps the
  // function alive up to maxDuration). Schedulers with short HTTP timeouts, like
  // Supabase pg_net, use this.
  if (new URL(req.url).searchParams.get("async") === "1") {
    after(async () => console.log(`cron ${task}`, JSON.stringify(await run())));
    return Response.json({ accepted: task }, { status: 202 });
  }

  const result = await run();
  console.log(`cron ${task}`, JSON.stringify(result));
  return Response.json(result);
}
