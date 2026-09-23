/**
 * Module resolution hooks so `node --experimental-strip-types` can run scripts
 * that import the app's TypeScript modules directly.
 *
 * Node's built-in type stripping deliberately does NOT implement TypeScript's
 * resolution rules: it requires fully-specified paths, so `./calendar` inside
 * services/scheduling/engine.ts fails to resolve. Rather than add `.ts`
 * extensions across app source (which exists only for bundlers that don't need
 * them) or pull in another dev dependency, these hooks bridge the gap for
 * scripts only.
 *
 * Registered via `node --import ./scripts/ts-resolve.mjs <script>`.
 */
import { register } from "node:module";

// Already a file: URL, so no pathname round-trip -- on Windows that turned
// "/C:/Users/..." into "file:///C:/C:/Users/..." and broke every "@/" import.
const repoRoot = new URL("..", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  // Mirror the tsconfig "@/*" -> "./*" path alias.
  if (specifier.startsWith("@/")) {
    return resolve(new URL(specifier.slice(2), repoRoot).href, context, nextResolve);
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelative = specifier.startsWith(".") || specifier.startsWith("file:");
    const hasExtension = /\.[a-z]+$/i.test(specifier);
    if (isRelative && !hasExtension) {
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return await nextResolve(candidate, context);
        } catch {
          // Fall through to the original error below.
        }
      }
    }
    throw error;
  }
}

register(import.meta.url, import.meta.url);
