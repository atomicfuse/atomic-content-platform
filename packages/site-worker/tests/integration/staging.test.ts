import { describe, expect, it } from 'vitest';

/**
 * Live HTTP integration against the deployed staging Worker.
 *
 * These tests hit a real URL across the public internet — they're slow,
 * eventually-consistent (KV propagation), and should NOT run on every PR.
 *
 * Run via `pnpm test:live` locally, or via the
 * `.github/workflows/site-worker-live.yml` cron.
 *
 * Override base URL via env:
 *   WORKER_URL=https://… pnpm test:live
 */
const WORKER_URL = process.env.WORKER_URL ?? 'https://atomic-site-worker-staging.dev1-953.workers.dev';

/** A slug that exists in `article-index:coolnews-atl` per the seeded KV.
 *  If the staging KV is wiped, update this constant. */
const KNOWN_ARTICLE_SLUG = 'lobsters-feel-pain-new-research-challenges-culinary-ethics';

async function fetchHead(path: string): Promise<Response> {
  const res = await fetch(WORKER_URL + path, { method: 'HEAD' });
  return res;
}

async function fetchGet(path: string): Promise<{ status: number; headers: Headers; body: string }> {
  const res = await fetch(WORKER_URL + path);
  const body = await res.text();
  return { status: res.status, headers: res.headers, body };
}

describe('staging Worker — health + caching', () => {
  it('GET /_ping → 200 + no-store + body "ok"', async () => {
    const r = await fetchGet('/_ping');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.body).toBe('ok');
  });

  it('GET / → 200 + homepage cache headers + has <title>', async () => {
    const r = await fetchGet('/');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe(
      'public, max-age=30, s-maxage=60, stale-while-revalidate=600',
    );
    expect(r.body).toMatch(/<title>[^<]+<\/title>/);
  });

  it('GET /<article-slug> → 200 + article cache headers', async () => {
    const r = await fetchGet(`/${KNOWN_ARTICLE_SLUG}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe(
      'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    );
  });

  it('GET /about → 200 + same shell cache + page title', async () => {
    const r = await fetchGet('/about');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe(
      'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    );
    expect(r.body).toMatch(/About/i);
  });

  it('GET /a-slug-that-doesnt-exist → 404 + private no-store', async () => {
    const r = await fetchGet('/a-slug-that-doesnt-exist-' + Date.now());
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('staging Worker — Server Islands', () => {
  it('island URLs in the homepage HTML', async () => {
    const r = await fetchGet('/');
    expect(r.body).toMatch(/href="\/_server-islands\/PixelLoader\?[^"]+"/);
    expect(r.body).toMatch(/href="\/_server-islands\/AdSlot\?[^"]+"/);
    expect(r.body).toMatch(/href="\/_server-islands\/MockAdFill\?[^"]+"/);
  });

  it('GET /_server-islands/PixelLoader?... → 200 + private no-store + emits GA4 from KV', async () => {
    const home = await fetchGet('/');
    const m = /href="(\/_server-islands\/PixelLoader\?[^"]+)"/.exec(home.body);
    expect(m, 'island URL must be in homepage HTML').toBeTruthy();
    const islandPath = m![1]!;

    const r = await fetchGet(islandPath);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    // KV holds tracking.ga4 = "G-COOLNEWS-XXX" for coolnews-atl. The
    // island reads it and emits the gtag config script.
    expect(r.body).toMatch(/G-COOLNEWS-XXX/);
  });
});

describe('staging Worker — assets bundle', () => {
  it('static placeholder.svg reachable', async () => {
    const r = await fetchHead('/placeholder.svg');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^image\/svg/);
  });

  it('mock-ad-fill.js bundled and reachable', async () => {
    const r = await fetchHead('/mock-ad-fill.js');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/javascript|application\/javascript/);
  });

  it('per-site asset reachable under /<siteId>/assets/...', async () => {
    const r = await fetchHead(
      '/coolnews-atl/assets/images/lobsters-feel-pain-new-research-challenges-culinary-ethics.png',
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^image\//);
  });
});

describe('staging Worker — content correctness', () => {
  it('homepage contains rewritten asset URLs (per-site prefix)', async () => {
    const r = await fetchGet('/');
    expect(r.body).toMatch(/\/coolnews-atl\/assets\/images\/[^"]+\.png/);
    // No bare /assets/ URLs should leak into the rendered page — those
    // would 404 in the per-site-asset-bundle model.
    expect(r.body).not.toMatch(/src="\/assets\//);
  });

  it('article body contains rewritten asset URLs', async () => {
    const r = await fetchGet(`/${KNOWN_ARTICLE_SLUG}`);
    if (/<img/.test(r.body)) {
      expect(r.body).toMatch(/\/coolnews-atl\/assets\//);
    }
  });
});
