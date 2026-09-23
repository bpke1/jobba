import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Mirrors tsconfig's "@/*" -> "./*" path alias (see tsconfig.json) so tests
// can import app modules the same way application code does, instead of the
// relative-import-only convention every existing *.test.ts file was forced
// into before this config existed.
export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    environment: "node",
  },
});
