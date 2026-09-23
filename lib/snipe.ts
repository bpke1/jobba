import { sendSnipeAlert } from "./digest";
import { checkMail } from "./mail";
import { runScrape, scorePending } from "./scrape";

/**
 * The frequent run (every 15–20 minutes in the daytime): newest results only,
 * inbox check (replies + LinkedIn alerts), scoring, then an instant e-mail for
 * strong matches.
 */
export async function runSnipe() {
  const started = Date.now();
  const scrape = await runScrape({ quick: true, deadlineMs: 150_000 });
  const mail = await checkMail().catch((e: Error) => ({ error: e.message }));
  // LinkedIn alert jobs arrive after the scrape's own scoring pass.
  const scored = scrape.scored + (await scorePending(started + 240_000));
  const alert = await sendSnipeAlert();
  return { newJobs: scrape.newIds.length, scored, deferred: scrape.deferred, mail, alert, ms: Date.now() - started };
}
