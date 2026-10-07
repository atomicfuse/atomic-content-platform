import { describe, expect, it, vi } from 'vitest';
import { parseConfigOutput } from '../lib/grid-config-readers';

describe('parseConfigOutput', () => {
  it('treats a missing key (wrangler\'s literal "Value not found") as null, quietly', () => {
    expect(parseConfigOutput('Value not found\n')).toBeNull();
  });
  it('treats empty/whitespace output as null', () => {
    expect(parseConfigOutput('')).toBeNull();
    expect(parseConfigOutput('   \n')).toBeNull();
  });
  it('parses valid JSON output', () => {
    expect(parseConfigOutput('{"site_name":"X","domain":"x.com"}')).toEqual({ site_name: 'X', domain: 'x.com' });
  });
  it('throws on malformed JSON — caller treats this as a real failure, not a missing key', () => {
    expect(() => parseConfigOutput('{not valid json')).toThrow();
  });
});

describe('restIndexReader', () => {
  it('reads grid-ext-index:<bundleId> from prod KV, null on 404, throws on other errors', async () => {
    const { restIndexReader } = await import('../lib/grid-config-readers');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ bundleId: 'b1', name: 'n', updatedAt: 'x', items: [] })))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const read = restIndexReader('acct', 'tok', 'ns');
    expect((await read('b1'))?.bundleId).toBe('b1');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/values/grid-ext-index%3Ab1');
    expect(await read('b2')).toBeNull();
    await expect(read('b3')).rejects.toThrow(/500/);
    vi.unstubAllGlobals();
  });
});
