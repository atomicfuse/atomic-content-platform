/**
 * Publisher favicons for aggregator stories (scripts/seed-grid.ts).
 *
 * Each domain's icon is fetched once and stored in R2 at `aggregator/assets/favicons/<domain>.png`,
 * served by the existing `/<siteId>/assets/<path>` route (the `aggregator` id is reserved, so no site
 * collides). A manifest in R2 records what was checked and when, so an icon already stored is never
 * fetched again until it's 30 days old, and a domain with no icon is retried weekly.
 */

const PREFIX = 'aggregator/assets/favicons/';
const DAY_MS = 86_400_000;
const REFRESH_OK_DAYS = 30;
const RETRY_MISSING_DAYS = 7;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const FAVICON_MANIFEST_KEY = `${PREFIX}manifest.json`;

/** domain → last check. `ok: false` = the domain has no usable icon. */
export type FaviconManifest = Record<string, { ok: boolean; checkedAt: string }>;

export interface FaviconDeps {
  readManifest(): Promise<FaviconManifest>;
  writeManifest(manifest: FaviconManifest): Promise<void>;
  /** The icon, or null when the domain has none. Throws on network errors (not recorded → retried next run). */
  fetchIcon(domain: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  putIcon(key: string, body: Uint8Array, contentType: string): Promise<void>;
  now(): Date;
}

export function faviconKey(domain: string): string {
  return `${PREFIX}${domain}.png`;
}

/** URL path the Worker serves the icon from. */
export function faviconPath(domain: string): string {
  return `/${faviconKey(domain)}`;
}

export interface FaviconStore {
  /** domain → icon path, for domains that have one (fetching and storing new ones as needed). */
  resolve(domains: readonly string[]): Promise<Map<string, string>>;
  /** Writes the manifest if anything changed. */
  save(): Promise<void>;
}

export function createFaviconStore(deps: FaviconDeps, opts: { maxFetchesPerRun?: number } = {}): FaviconStore {
  const maxFetches = opts.maxFetchesPerRun ?? 100;
  let manifest: FaviconManifest | null = null;
  let dirty = false;
  let fetches = 0;

  async function load(): Promise<FaviconManifest> {
    if (manifest) return manifest;
    try {
      manifest = { ...(await deps.readManifest()) };
    } catch (err) {
      console.warn('[seed-grid] favicon manifest unreadable, starting empty:', err instanceof Error ? err.message : err);
      manifest = {};
    }
    return manifest;
  }

  function due(entry: FaviconManifest[string] | undefined, now: number): boolean {
    if (!entry) return true;
    const age = now - new Date(entry.checkedAt).getTime();
    if (!Number.isFinite(age)) return true;
    return age > (entry.ok ? REFRESH_OK_DAYS : RETRY_MISSING_DAYS) * DAY_MS;
  }

  return {
    async resolve(domains) {
      const m = await load();
      const now = deps.now();
      const out = new Map<string, string>();
      for (const domain of new Set(domains)) {
        if (!DOMAIN_RE.test(domain)) continue;
        if (due(m[domain], now.getTime()) && fetches < maxFetches) {
          fetches++;
          try {
            const icon = await deps.fetchIcon(domain);
            if (icon) await deps.putIcon(faviconKey(domain), icon.body, icon.contentType);
            m[domain] = { ok: icon !== null, checkedAt: now.toISOString() };
            dirty = true;
          } catch (err) {
            // Not recorded: a transient failure is retried next run; an existing icon stays in use.
            console.warn(`[seed-grid] favicon ${domain} failed:`, err instanceof Error ? err.message : err);
          }
        }
        if (m[domain]?.ok) out.set(domain, faviconPath(domain));
      }
      return out;
    },
    async save() {
      if (dirty && manifest) await deps.writeManifest(manifest);
    },
  };
}

/** Real I/O: Google's favicon service (server-side, once per domain) + the Cloudflare R2 REST API. */
export function r2FaviconDeps(accountId: string, apiToken: string, bucket: string, fetchFn: typeof fetch = fetch): FaviconDeps {
  const objectUrl = (key: string): string =>
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${key}`;
  const auth = { Authorization: `Bearer ${apiToken}` };
  return {
    async readManifest() {
      const res = await fetchFn(objectUrl(FAVICON_MANIFEST_KEY), { headers: auth, signal: AbortSignal.timeout(20_000) });
      if (res.status === 404) return {};
      if (!res.ok) throw new Error(`manifest read → ${res.status}`);
      return (await res.json()) as FaviconManifest;
    },
    async writeManifest(manifest) {
      const res = await fetchFn(objectUrl(FAVICON_MANIFEST_KEY), {
        method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(manifest),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`manifest write → ${res.status}`);
    },
    async fetchIcon(domain) {
      const res = await fetchFn(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`, {
        redirect: 'follow', signal: AbortSignal.timeout(10_000),
      });
      // Google answers 404 (with a generic globe) when it knows no icon for the domain.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`icon fetch → ${res.status}`);
      const contentType = res.headers.get('content-type') ?? '';
      const body = new Uint8Array(await res.arrayBuffer());
      if (!contentType.startsWith('image/') || body.length === 0 || body.length > 100_000) return null;
      return { body, contentType };
    },
    async putIcon(key, body, contentType) {
      const res = await fetchFn(objectUrl(key), {
        method: 'PUT', headers: { ...auth, 'Content-Type': contentType }, body, signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`icon upload → ${res.status}`);
    },
    now: () => new Date(),
  };
}
