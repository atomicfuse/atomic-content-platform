import { describe, expect, it } from 'vitest';
import { loadCustomDomains } from '../../scripts/lib/load-routes';

describe('loadCustomDomains', () => {
  it('always returns empty array (custom domains are on the manager worker)', async () => {
    // loadCustomDomains is a no-op stub — custom domains are registered on
    // atl-sites-workers-manager, not atomic-site-worker. Kept for API
    // compatibility with emit-env-configs.ts.
    expect(await loadCustomDomains('/nonexistent')).toEqual([]);
  });
});
