import { describe, it, expect, vi } from 'vitest';
import { createFaviconStore, faviconKey, faviconPath, type FaviconDeps, type FaviconManifest } from '../lib/grid-favicons';

const NOW = new Date('2026-10-07T00:00:00Z');
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const PNG = { body: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' };

function deps(manifest: FaviconManifest = {}, icons: Record<string, typeof PNG | null> = {}): FaviconDeps & {
  fetchIcon: ReturnType<typeof vi.fn>; putIcon: ReturnType<typeof vi.fn>; writeManifest: ReturnType<typeof vi.fn>;
} {
  return {
    readManifest: vi.fn(async () => manifest),
    writeManifest: vi.fn(async () => undefined),
    fetchIcon: vi.fn(async (d: string) => (d in icons ? icons[d]! : PNG)),
    putIcon: vi.fn(async () => undefined),
    now: () => NOW,
  };
}

describe('faviconKey / faviconPath', () => {
  it('stores icons under the reserved aggregator id so the existing asset route serves them', () => {
    expect(faviconKey('cnn.com')).toBe('aggregator/assets/favicons/cnn.com.png');
    expect(faviconPath('cnn.com')).toBe('/aggregator/assets/favicons/cnn.com.png');
  });
});

describe('createFaviconStore', () => {
  it('fetches and stores an icon once for a new domain', async () => {
    const d = deps();
    const store = createFaviconStore(d);
    expect(await store.resolve(['cnn.com', 'cnn.com'])).toEqual(new Map([['cnn.com', '/aggregator/assets/favicons/cnn.com.png']]));
    expect(d.fetchIcon).toHaveBeenCalledTimes(1);
    expect(d.putIcon).toHaveBeenCalledWith('aggregator/assets/favicons/cnn.com.png', PNG.body, 'image/png');
    await store.save();
    expect(d.writeManifest).toHaveBeenCalledWith({ 'cnn.com': { ok: true, checkedAt: NOW.toISOString() } });
  });

  it('skips a domain already in R2 (checked within 30 days) — no fetch, no upload, no manifest write', async () => {
    const d = deps({ 'cnn.com': { ok: true, checkedAt: daysAgo(10) } });
    const store = createFaviconStore(d);
    expect(await store.resolve(['cnn.com'])).toEqual(new Map([['cnn.com', '/aggregator/assets/favicons/cnn.com.png']]));
    expect(d.fetchIcon).not.toHaveBeenCalled();
    expect(d.putIcon).not.toHaveBeenCalled();
    await store.save();
    expect(d.writeManifest).not.toHaveBeenCalled();
  });

  it('refreshes an icon older than 30 days', async () => {
    const d = deps({ 'cnn.com': { ok: true, checkedAt: daysAgo(31) } });
    await createFaviconStore(d).resolve(['cnn.com']);
    expect(d.putIcon).toHaveBeenCalledTimes(1);
  });

  it('keeps serving an existing icon when its refresh fails', async () => {
    const d = deps({ 'cnn.com': { ok: true, checkedAt: daysAgo(31) } });
    d.fetchIcon.mockRejectedValueOnce(new Error('timeout'));
    expect((await createFaviconStore(d).resolve(['cnn.com'])).get('cnn.com')).toBe('/aggregator/assets/favicons/cnn.com.png');
  });

  it('remembers a domain with no icon and retries it only after 7 days', async () => {
    const d = deps({}, { 'nothing.com': null });
    const store = createFaviconStore(d);
    expect(await store.resolve(['nothing.com'])).toEqual(new Map());
    await store.save();
    expect(d.writeManifest).toHaveBeenCalledWith({ 'nothing.com': { ok: false, checkedAt: NOW.toISOString() } });

    const recent = deps({ 'nothing.com': { ok: false, checkedAt: daysAgo(3) } });
    await createFaviconStore(recent).resolve(['nothing.com']);
    expect(recent.fetchIcon).not.toHaveBeenCalled();
    const stale = deps({ 'nothing.com': { ok: false, checkedAt: daysAgo(8) } });
    await createFaviconStore(stale).resolve(['nothing.com']);
    expect(stale.fetchIcon).toHaveBeenCalledTimes(1);
  });

  it('does not record a network error, so the next run retries', async () => {
    const d = deps();
    d.fetchIcon.mockRejectedValueOnce(new Error('ECONNRESET'));
    const store = createFaviconStore(d);
    expect(await store.resolve(['cnn.com'])).toEqual(new Map());
    await store.save();
    expect(d.writeManifest).not.toHaveBeenCalled();
  });

  it('ignores names that are not plain domains', async () => {
    const d = deps();
    expect(await createFaviconStore(d).resolve(['Source', '../etc', 'a b.com', 'x.com/evil', ''])).toEqual(new Map());
    expect(d.fetchIcon).not.toHaveBeenCalled();
  });

  it('caps new fetches per run', async () => {
    const d = deps();
    const domains = Array.from({ length: 5 }, (_, i) => `s${i}.com`);
    const out = await createFaviconStore(d, { maxFetchesPerRun: 2 }).resolve(domains);
    expect(d.fetchIcon).toHaveBeenCalledTimes(2);
    expect(out.size).toBe(2);
  });

  it('reads the manifest once across several resolve calls', async () => {
    const d = deps();
    const store = createFaviconStore(d);
    await store.resolve(['a.com']);
    await store.resolve(['a.com', 'b.com']);
    expect(d.readManifest).toHaveBeenCalledTimes(1);
    expect(d.fetchIcon).toHaveBeenCalledTimes(2);
  });

  it('treats an unreadable manifest as empty', async () => {
    const d = deps();
    (d.readManifest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('403'));
    expect((await createFaviconStore(d).resolve(['cnn.com'])).size).toBe(1);
  });
});
