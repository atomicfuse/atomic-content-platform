import { describe, expect, it } from 'vitest';
import { resolveLayout } from '../lib/resolve-layout';

describe('resolveLayout', () => {
  it('returns defaults when input is undefined', () => {
    const out = resolveLayout(undefined);
    expect(out.hero).toEqual({ enabled: true, count: 4 });
    expect(out.must_reads).toEqual({ enabled: true, count: 5 });
    expect(out.sidebar_topics).toEqual({ auto: true, explicit: [] });
    expect(out.load_more).toEqual({ page_size: 10 });
  });

  it('overrides only the fields supplied; the rest stay default', () => {
    const out = resolveLayout({ hero: { count: 3 } });
    expect(out.hero).toEqual({ enabled: true, count: 3 });
    expect(out.must_reads.enabled).toBe(true);
  });

  it('clamps page_size to a sane minimum', () => {
    const out = resolveLayout({ load_more: { page_size: 0 } });
    expect(out.load_more.page_size).toBe(1);
  });

  it('coerces hero.count to 3 or 4 only', () => {
    expect(resolveLayout({ hero: { count: 7 as 3 } }).hero.count).toBe(4);
  });
});
