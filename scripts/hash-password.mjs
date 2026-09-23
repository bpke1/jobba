// Usage: npm run hash-passord -- "mitt passord"  -> paste the output into APP_PASSWORD_HASH
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-passord -- "passord"');
  process.exit(1);
}
const salt = randomBytes(16);
console.log(`scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 32).toString("hex")}`);
