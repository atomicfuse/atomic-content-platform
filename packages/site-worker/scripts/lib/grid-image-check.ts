/**
 * Does a publisher image actually load? Some publishers block other sites from showing their images
 * (e.g. kansasreflector.com → 403), and the story page would show a placeholder instead. Only the first
 * bytes are requested. Any failure — status, non-image body, network error, timeout — counts as "no".
 */
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function imageLoads(url: string, fetchFn: typeof fetch = fetch, timeoutMs = 8_000): Promise<boolean> {
  try {
    const res = await fetchFn(url, {
      headers: { range: 'bytes=0-2047', 'user-agent': BROWSER_UA, accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel().catch(() => undefined);
    return res.ok && (res.headers.get('content-type') ?? '').toLowerCase().startsWith('image/');
  } catch {
    return false;
  }
}

/** Ids whose image does not load, checked a few at a time. */
export async function brokenImageIds(
  candidates: ReadonlyArray<{ id: string; imageUrl: string }>,
  check: (url: string) => Promise<boolean>,
  concurrency = 8,
): Promise<Set<string>> {
  const broken = new Set<string>();
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((c) => check(c.imageUrl)));
    batch.forEach((c, j) => { if (!results[j]) broken.add(c.id); });
  }
  return broken;
}
