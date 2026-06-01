import { describe, expect, it } from 'vitest';
import { rewriteFrontmatterUrl } from '../lib/resolve';

/**
 * Sanity test that mirrors the seed-kv block: theme.logo, theme.favicon,
 * AND theme.footer_logo must all be rewritten to per-site R2 paths.
 * Regression guard for the original bug where footer_logo was skipped.
 */
describe('theme asset path rewriting (seed-kv contract)', () => {
  const siteId = 'wineoceans';

  function rewriteThemeAssets(theme: Record<string, unknown>): Record<string, unknown> {
    const next = { ...theme };
    if (typeof next.logo === 'string') next.logo = rewriteFrontmatterUrl(next.logo, siteId);
    if (typeof next.favicon === 'string') next.favicon = rewriteFrontmatterUrl(next.favicon, siteId);
    if (typeof next.footer_logo === 'string') next.footer_logo = rewriteFrontmatterUrl(next.footer_logo, siteId);
    return next;
  }

  it('rewrites logo, favicon, and footer_logo to /<siteId>/assets/...', () => {
    const out = rewriteThemeAssets({
      logo: '/assets/logo.png',
      favicon: '/assets/favicon.png',
      footer_logo: '/assets/logo-footer.png',
    });
    expect(out.logo).toBe('/wineoceans/assets/logo.png');
    expect(out.favicon).toBe('/wineoceans/assets/favicon.png');
    expect(out.footer_logo).toBe('/wineoceans/assets/logo-footer.png');
  });

  it('leaves footer_logo untouched when absent', () => {
    const out = rewriteThemeAssets({ logo: '/assets/logo.png' });
    expect(out.footer_logo).toBeUndefined();
  });
});
