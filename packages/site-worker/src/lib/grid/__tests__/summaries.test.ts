import { describe, expect, it, vi } from 'vitest';
import type { GridPoolItem, GridSummaryRecord } from '@atomic-platform/shared-types';
import { lookupSummaryStatuses, SUMMARY_LOOKUP_LIMIT, summaryStatusOf } from '../summaries';

function item(n: number): GridPoolItem {
  return { site: 'src', slug: `s${n}`, title: `S${n}`, publishDate: '2026-09-26T00:00:00Z', pills: [], pinned: false };
}
const rec = (over: Partial<GridSummaryRecord> = {}): GridSummaryRecord => ({ html: '<p>x</p>', bodyHash: 'h', generatedAt: 'g', model: 'm', edited: false, sourceChanged: false, ...over });

describe('summaryStatusOf', () => {
  it('maps records to statuses', () => {
    expect(summaryStatusOf(null)).toBe('none');
    expect(summaryStatusOf(rec())).toBe('generated');
    expect(summaryStatusOf(rec({ edited: true }))).toBe('edited');
    expect(summaryStatusOf(rec({ edited: true, sourceChanged: true }))).toBe('stale');
  });
});

describe('lookupSummaryStatuses', () => {
  it('the default cap is 300', () => {
    expect(SUMMARY_LOOKUP_LIMIT).toBe(300);
  });
  it('looks up only the first `limit` items; the rest get no summary field', async () => {
    const get = vi.fn(async (): Promise<GridSummaryRecord | null> => rec());
    const out = await lookupSummaryStatuses([item(1), item(2), item(3)], get, 2);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith('grid-summary:src:s1');
    expect(out[0]?.summary).toEqual({ status: 'generated', generatedAt: 'g' });
    expect(out[1]?.summary).toEqual({ status: 'generated', generatedAt: 'g' });
    expect(out[2]).not.toHaveProperty('summary');
  });
  it('caps at SUMMARY_LOOKUP_LIMIT by default', async () => {
    const get = vi.fn(async (): Promise<GridSummaryRecord | null> => null);
    const items = Array.from({ length: SUMMARY_LOOKUP_LIMIT + 5 }, (_, i) => item(i));
    const out = await lookupSummaryStatuses(items, get);
    expect(get).toHaveBeenCalledTimes(SUMMARY_LOOKUP_LIMIT);
    expect(out[SUMMARY_LOOKUP_LIMIT - 1]?.summary).toEqual({ status: 'none' });
    expect(out[SUMMARY_LOOKUP_LIMIT]).not.toHaveProperty('summary');
  });
  it('a failing lookup omits that item\'s summary and never fails the others', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const get = vi.fn(async (key: string): Promise<GridSummaryRecord | null> => {
        if (key === 'grid-summary:src:s2') throw new Error('kv down');
        return null;
      });
      const out = await lookupSummaryStatuses([item(1), item(2), item(3)], get);
      expect(out.map((i) => i.summary)).toEqual([{ status: 'none' }, undefined, { status: 'none' }]);
      expect(out[1]).not.toHaveProperty('summary');
      expect(errorSpy).toHaveBeenCalledOnce();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('lookupSummaryStatuses — pinned', () => {
  it('reports pinned only when the record is pinned', async () => {
    const [pinned] = await lookupSummaryStatuses([item(1)], async () => rec({ pinned: true }));
    expect(pinned!.summary).toEqual({ status: 'generated', generatedAt: 'g', pinned: true });
    const [plain] = await lookupSummaryStatuses([item(1)], async () => rec());
    expect(plain!.summary).toEqual({ status: 'generated', generatedAt: 'g' });
  });
});

describe('lookupSummaryStatuses — external stories', () => {
  it('looks external summaries up by item id, not the pool slug', async () => {
    const id = '6ac4931364df7692b392bfcb';
    const ext: GridPoolItem = { site: 'aggregator', slug: `batman-${id}`, title: 'B', publishDate: '2026-09-26T00:00:00Z', pills: [], pinned: false, kind: 'external', sourceName: 'X' };
    const keys: string[] = [];
    const [out] = await lookupSummaryStatuses([ext], async (k) => { keys.push(k); return rec({ pinned: true }); });
    expect(keys).toEqual([`grid-summary:aggregator:${id}`]);
    expect(out!.summary).toMatchObject({ status: 'generated', pinned: true });
  });
});
