import { execFileSync } from 'node:child_process';
import type { SiteConfigSummary } from './grid-directory';

/** Reads a site's resolved config (only the fields the directory needs). */
export type ConfigReader = (siteId: string) => Promise<SiteConfigSummary | null>;

/** CI: Cloudflare REST API against prod KV. 404 → null; other failures throw (the job must fail loudly). */
export function restConfigReader(accountId: string, token: string, namespaceId: string): ConfigReader {
  return async (siteId) => {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(`site-config:${siteId}`)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`[seed-grid] KV read site-config:${siteId} failed: ${res.status}`);
    return (await res.json()) as SiteConfigSummary;
  };
}

/** Wrangler's local `kv key get` prints the literal `Value not found` (exit 0, not JSON) when
 *  the key doesn't exist — that's the only "missing key" signal it gives us in local mode, so
 *  it must be checked before attempting to parse. Exposed for testing the JSON-parse-failure
 *  path without spawning wrangler. */
export function parseConfigOutput(out: string): SiteConfigSummary | null {
  const trimmed = out.trim();
  if (!trimmed || trimmed === 'Value not found') return null;
  return JSON.parse(trimmed) as SiteConfigSummary;
}

/** Local fixture runs: wrangler --local. Missing key → null (quiet). Anything else that goes
 *  wrong (bad namespace id, wrangler missing, malformed stored value) is a real failure — warn
 *  instead of silently returning null, so a broken local run doesn't look like an empty config. */
export function localConfigReader(namespaceId: string): ConfigReader {
  return async (siteId) => {
    try {
      const out = execFileSync('wrangler', ['kv', 'key', 'get', `site-config:${siteId}`, `--namespace-id=${namespaceId}`, '--local'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return parseConfigOutput(out);
    } catch (err) {
      console.warn(`[seed-grid] local read site-config:${siteId} failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };
}
