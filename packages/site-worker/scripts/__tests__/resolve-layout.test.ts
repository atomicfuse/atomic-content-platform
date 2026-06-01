import { describe, expect, it } from 'vitest';
import { resolveLayout } from '../lib/resolve-layout';

describe('resolveLayout', () => {
  it('returns defaults when input is undefined', () => {
    const out = resolveLayout(undefined);
    expect(out.hero).toEqual({ enabled: true, count: 4 });
    expect(out.must_reads).toEqual({ enabled: true, count: 5 });
    expect(out.whats_new).toEqual({ enabled: true, count: 4 });
    expect(out.more_on).toEqual({ enabled: true, page_size: 8 });
    expect(out.sidebar_topics).toEqual({ auto: true, explicit: [] });
    expect(out.load_more).toEqual({ page_size: 4 });
  });

  it('overrides only the fields supplied; the rest stay default', () => {
    const out = resolveLayout({ hero: { count: 3 } });
    expect(out.hero).toEqual({ enabled: true, count: 3 });
    expect(out.must_reads.enabled).toBe(true);
  });

  it('clamps must_reads.count to a sane minimum', () => {
    const out = resolveLayout({ must_reads: { count: 0 } });
    expect(out.must_reads.count).toBe(1);
  });

  it('clamps page_size to a sane minimum', () => {
    const out = resolveLayout({ load_more: { page_size: 0 } });
    expect(out.load_more.page_size).toBe(1);
  });

  it('coerces hero.count to 3 or 4 only', () => {
    expect(resolveLayout({ hero: { count: 7 as 3 } }).hero.count).toBe(4);
  });

  it('returns defaults for whats_new when input is undefined', () => {
    const out = resolveLayout(undefined);
    expect(out.whats_new).toEqual({ enabled: true, count: 4 });
  });

  it('returns defaults for more_on when input is undefined', () => {
    const out = resolveLayout(undefined);
    expect(out.more_on).toEqual({ enabled: true, page_size: 8 });
  });

  it('default load_more.page_size is now 4 (was 10)', () => {
    const out = resolveLayout(undefined);
    expect(out.load_more.page_size).toBe(4);
  });

  it('clamps whats_new.count to a sane minimum', () => {
    const out = resolveLayout({ whats_new: { count: 0 } });
    expect(out.whats_new.count).toBe(1);
  });

  it('clamps more_on.page_size to a sane minimum', () => {
    const out = resolveLayout({ more_on: { page_size: 0 } });
    expect(out.more_on.page_size).toBe(1);
  });

  it('respects explicit whats_new.enabled: false', () => {
    const out = resolveLayout({ whats_new: { enabled: false } });
    expect(out.whats_new.enabled).toBe(false);
  });

  it('respects explicit more_on.enabled: false', () => {
    const out = resolveLayout({ more_on: { enabled: false } });
    expect(out.more_on.enabled).toBe(false);
  });
});
