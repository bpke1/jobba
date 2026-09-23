// Runs `prisma migrate deploy`, except on Vercel preview deployments.
//
// Previews are built from unmerged branches but share the production database
// credentials, so letting them migrate would apply a PR's schema changes to
// production before anyone has reviewed the PR. They also have no DIRECT_URL
// set, which Prisma requires for migrations (see prisma/schema.prisma), so the
// build failed outright there.
//
// Plain `if [ ... ]` in the npm script isn't an option: on Windows npm runs
// scripts through cmd.exe, which can't parse POSIX shell syntax.
import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV === "preview") {
  console.log("Preview deployment — skipping `prisma migrate deploy`.");
  process.exit(0);
}

// Prisma's own error for this ("Environment variable not found: DIRECT_URL")
// doesn't say where to fix it; a fresh Vercel project hits it on the first deploy.
const missing = ["DATABASE_URL", "DIRECT_URL"].filter((name) => !process.env[name]);
if (missing.length) {
  console.error(
    `\nMissing ${missing.join(" and ")}.\n` +
      "Set them to your Postgres (Supabase) connection strings: in Vercel under\n" +
      "Project → Settings → Environment Variables, locally in .env. See README → Deploying.\n",
  );
  process.exit(1);
}

// Via npx, not a bare `prisma`: node_modules/.bin is only on PATH when npm
// itself invokes the script, so a bare binary name breaks if this is ever run
// directly. shell: true so the .cmd shim resolves on Windows too.
const { status } = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", shell: true });
process.exit(status ?? 1);
