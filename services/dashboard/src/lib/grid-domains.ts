/**
 * Publisher domain input for Grid `blocked_domains` — mirrors toBareDomain in
 * packages/site-worker/src/lib/grid/normalize.ts (the worker re-normalises at seed and runtime).
 */
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "https://www.X.com/path" → "x.com". Null when the input isn't a domain. */
export function toBareDomain(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0]!.replace(/^www\./, "");
  return DOMAIN_RE.test(host) ? host : null;
}
