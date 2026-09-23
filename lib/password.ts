import { scryptSync, timingSafeEqual } from "node:crypto";

/** APP_PASSWORD_HASH is "scrypt:<salt hex>:<hash hex>" (not "$": Next's .env loader expands it), made by `npm run hash-passord`. */
export function verifyPassword(password: string, stored = process.env.APP_PASSWORD_HASH): boolean {
  const [scheme, salt, hash] = (stored ?? "").split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  // Malformed hex decodes to an empty buffer, and two empty buffers compare equal.
  if (expected.length < 16) return false;
  const actual = scryptSync(password, Buffer.from(salt, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}
