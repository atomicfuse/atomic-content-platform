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
  it('never tags a publisher link with UTM (not a network site), keeping its other query params', () => {
    expect(buildExternalOutboundUrl('https://www.instyle.com/x?a=1')).toBe('https://www.instyle.com/x?a=1');
  });
  it('strips utm_* params the feed URL already carries', () => {
    expect(buildExternalOutboundUrl('https://www.instyle.com/x?utm_source=feed&a=1&UTM_Medium=rss&utm_campaign=c'))
      .toBe('https://www.instyle.com/x?a=1');
    expect(buildExternalOutboundUrl('https://www.instyle.com/x?utm_source=feed')).toBe('https://www.instyle.com/x');
  });
});

describe('buildExternalOutboundUrl — unsafe input', () => {
  it.each(['javascript:alert(1)', '/relative', '', 'not a url'])('returns null for %s', (u) => {
    expect(buildExternalOutboundUrl(u)).toBeNull();
  });
});

describe('resolveExternalRequest — blocked categories', () => {
  it('404s a story in any category the site blocks (case-insensitive)', () => {
    const r = { id: ID, slug: 'batman-paused', categories: ['Entertainment', 'War and Conflicts'] } as ExternalStoryRecord;
    expect(resolveExternalRequest(`batman-paused-${ID}`, r, ['war and conflicts']).kind).toBe('not_found');
    expect(resolveExternalRequest(`batman-paused-${ID}`, r, ['Politics']).kind).toBe('ok');
  });
});

describe('resolveExternalRequest — redirect keeps the query string', () => {
  it('carries ?_atl_site (staging preview) and UTM tags through the 301', () => {
    expect(resolveExternalRequest(`old-title-${ID}`, record, [], '?_atl_site=danatest&utm_source=x')).toEqual({
      kind: 'redirect', location: `/story/aggregator/batman-paused-${ID}?_atl_site=danatest&utm_source=x`,
    });
  });
});

describe('resolveExternalRequest — hidden stories and blocked domains', () => {
  const rec = { id: ID, slug: 'batman-paused', sourceName: 'thetruthseeker.co.uk' } as ExternalStoryRecord;
  it('404s a story from a blocked publisher domain', () => {
    expect(resolveExternalRequest(`batman-paused-${ID}`, rec, [], '', { blockedDomains: ['thetruthseeker.co.uk'] }).kind).toBe('not_found');
  });
  it('404s a hidden story (matched by item id)', () => {
    expect(resolveExternalRequest(`batman-paused-${ID}`, rec, [], '', { hidden: [{ site: 'aggregator', slug: `anything-${ID}` }] }).kind).toBe('not_found');
  });
  it('serves it otherwise', () => {
    expect(resolveExternalRequest(`batman-paused-${ID}`, rec, [], '', { blockedDomains: ['cnn.com'], hidden: [] }).kind).toBe('ok');
  });
});
