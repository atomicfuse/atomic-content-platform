import { describe, expect, it } from 'vitest';
import type { ExternalStoryRecord } from '@atomic-platform/shared-types';
import { externalStoryPath, parseExternalSlug, resolveExternalRequest } from '../external';
import { buildExternalOutboundUrl } from '../format';

const ID = '6ac4931364df7692b392bfcb';
const record = { id: ID, slug: 'batman-paused' } as ExternalStoryRecord;

describe('parseExternalSlug', () => {
  it('splits the title slug and the 24-hex item id', () => {
    expect(parseExternalSlug(`batman-paused-${ID}`)).toEqual({ itemId: ID, slugPart: 'batman-paused' });
  });
  it.each(['', 'batman', `x-${ID}zz`, '../../etc', `Batman-${ID}`])('rejects %s', (p) => {
    expect(parseExternalSlug(p)).toBeNull();
  });
});

describe('resolveExternalRequest', () => {
  it('serves the canonical slug', () => {
    expect(resolveExternalRequest(`batman-paused-${ID}`, record)).toEqual({ kind: 'ok', record });
  });
  it('301s an old slug (title changed) to the current one', () => {
    expect(resolveExternalRequest(`old-title-${ID}`, record)).toEqual({ kind: 'redirect', location: `/story/aggregator/batman-paused-${ID}` });
  });
  it('404s a missing record, a junk slug, or an id mismatch', () => {
    expect(resolveExternalRequest(`batman-paused-${ID}`, null).kind).toBe('not_found');
    expect(resolveExternalRequest('nope', record).kind).toBe('not_found');
    expect(resolveExternalRequest(`batman-paused-${'f'.repeat(24)}`, record).kind).toBe('not_found');
  });
  it('builds the canonical path', () => {
    expect(externalStoryPath(record)).toBe(`/story/aggregator/batman-paused-${ID}`);
  });
});

describe('buildExternalOutboundUrl', () => {
  it('adds UTM to the publisher URL only when enabled, keeping its query', () => {
    expect(buildExternalOutboundUrl('https://www.instyle.com/x?a=1', 'grid.example', true))
      .toBe('https://www.instyle.com/x?a=1&utm_source=grid.example&utm_medium=grid');
    expect(buildExternalOutboundUrl('https://www.instyle.com/x', 'grid.example', false)).toBe('https://www.instyle.com/x');
  });
});
