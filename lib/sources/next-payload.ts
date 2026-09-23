/**
 * Reads data out of a Next.js App Router page: the server streams its props as
 * `self.__next_f.push([1,"…"])` chunks, which concatenate into one "flight"
 * payload. arbeidsplassen.nav.no ships whole ads this way.
 */
export function flightPayload(html: string): string {
  let payload = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      payload += JSON.parse(m[1]);
    } catch {
      // a malformed chunk; the rest is still usable
    }
  }
  return payload;
}

/** The JSON object that starts right after `"key":` (first occurrence). */
export function objectAfterKey<T = Record<string, unknown>>(payload: string, key: string): T | null {
  const at = payload.indexOf(`"${key}":`);
  if (at < 0) return null;
  const start = payload.indexOf("{", at);
  return start < 0 ? null : balancedJson<T>(payload, start);
}

/** The innermost JSON object that contains the first occurrence of `"key":`. */
export function objectContainingKey<T = Record<string, unknown>>(payload: string, key: string): T | null {
  const at = payload.indexOf(`"${key}":`);
  if (at < 0) return null;
  let depth = 0;
  let start = at;
  for (; start >= 0; start--) {
    const c = payload[start];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) break;
      depth--;
    }
  }
  return start < 0 ? null : balancedJson<T>(payload, start);
}

function balancedJson<T>(s: string, start: number): T | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1)) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Large strings are sent as separate rows ("2b:T<hex byte length>,<text>") and
 * referenced as "$2b" from the props; this resolves such a reference.
 */
export function resolveTextRef(payload: string, ref: unknown): string | undefined {
  if (typeof ref !== "string") return undefined;
  if (!ref.startsWith("$")) return ref;
  const id = ref.slice(1);
  const marker = payload.indexOf(`${id}:T`);
  if (marker < 0) return undefined;
  const comma = payload.indexOf(",", marker);
  const byteLength = parseInt(payload.slice(marker + id.length + 2, comma), 16);
  if (!Number.isFinite(byteLength)) return undefined;
  return Buffer.from(payload.slice(comma + 1), "utf8").subarray(0, byteLength).toString("utf8");
}
