/**
 * Re-runs the rule-based classifier on inbox jobs Claude hasn't scored yet,
 * after the rules in lib/classify.ts change.
 *
 *   npm run reklassifiser
 */
import "dotenv/config";
import { db } from "@/lib/db";

const { count } = await db.job.updateMany({
  where: { scoredAt: null, status: { in: ["NY", "FILTRERT"] } },
  data: { jobType: null, category: null, score: null, scoreReason: null, status: "NY" },
});
const { classifyUnclassified } = await import("@/lib/jobs");
await classifyUnclassified();
console.log(`Reclassified ${count} jobs.`);
await db.$disconnect();
