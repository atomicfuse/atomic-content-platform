import { describe, expect, it, vi } from 'vitest';
import { imageLoads } from '../lib/grid-image-check';

const res = (status: number, type: string): Response => new Response('x', { status, headers: { 'content-type': type } });

describe('imageLoads', () => {
  it('is true for a 2xx image response, asking for only the first bytes', async () => {
    const fetchFn = vi.fn(async (_u: string, _i?: RequestInit) => res(206, 'image/jpeg'));
    expect(await imageLoads('https://p/img.jpg', fetchFn as unknown as typeof fetch)).toBe(true);
    expect(new Headers(fetchFn.mock.calls[0]![1]!.headers).get('range')).toBe('bytes=0-2047');
  });
  it.each([
    ['a hotlink block (403)', async () => res(403, 'text/html')],
    ['an HTML page with 200', async () => res(200, 'text/html')],
    ['a network error / timeout', async () => { throw new Error('timeout'); }],
  ])('is false for %s', async (_label, impl) => {
    expect(await imageLoads('https://p/img.jpg', vi.fn(impl) as unknown as typeof fetch)).toBe(false);
  });
});
