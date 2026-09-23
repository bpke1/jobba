import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { db } from "./db";

/**
 * The scoring prompt lives in the "profileCriteria" setting (editable on
 * /profil). `npm run seed` fills it from profile.local.md, which is
 * gitignored because it describes a real person; profile.example.md is the
 * template in the repo.
 */
export function readProfileFile(): string {
  for (const name of ["profile.local.md", "profile.example.md"]) {
    const p = path.join(process.cwd(), name);
    if (existsSync(p)) return readFileSync(p, "utf8").trim();
  }
  return "";
}

export async function getCriteria(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: "profileCriteria" } });
  return row?.value ?? readProfileFile();
}
