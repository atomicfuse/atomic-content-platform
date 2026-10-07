import { describe, expect, it } from 'vitest';
import { articleRedirectTarget } from '../redirects';

const kv = (data: Record<string, unknown>) => ({ get: async <T,>(key: string): Promise<T | null> => (data[key] ?? null) as T | null });

describe('articleRedirectTarget', () => {
  it('returns the new slug for an old one', async () => {
    expect(await articleRedirectTarget(kv({ 'redirect:wk:old-one': { to: 'new-one' } }), 'wk', 'old-one')).toBe('new-one');
  });
  it('returns null when there is no redirect or the target is malformed', async () => {
    expect(await articleRedirectTarget(kv({}), 'wk', 'old-one')).toBeNull();
    expect(await articleRedirectTarget(kv({ 'redirect:wk:old-one': { to: 'https://evil.example' } }), 'wk', 'old-one')).toBeNull();
    expect(await articleRedirectTarget(kv({ 'redirect:wk:old-one': { to: 'old-one' } }), 'wk', 'old-one')).toBeNull();
  });
});
