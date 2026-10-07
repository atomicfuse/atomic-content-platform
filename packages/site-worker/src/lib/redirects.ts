import { redirectKey, type ArticleRedirect } from './kv-schema';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** New slug for a renamed article's old slug (scripts/lib/article-redirects.ts), or null. */
export async function articleRedirectTarget(
  kv: { get<T>(key: string, type: 'json'): Promise<T | null> }, siteId: string, slug: string,
): Promise<string | null> {
  const r = await kv.get<ArticleRedirect>(redirectKey(siteId, slug), 'json');
  const to = r?.to;
  return typeof to === 'string' && SLUG_RE.test(to) && to !== slug ? to : null;
}
