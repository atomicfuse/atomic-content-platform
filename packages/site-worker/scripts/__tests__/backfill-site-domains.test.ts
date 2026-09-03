import { describe, expect, it } from 'vitest';
import { planDomainBackfill, type BackfillSite } from '../lib/backfill-site-domains';

function site(overrides: Partial<BackfillSite> = {}): BackfillSite {
  return {
    siteId: 'buzzsoaps',
    siteDomain: 'buzzsoaps',
    indexDomain: 'buzzsoaps.com',
    ...overrides,
  };
}

describe('planDomainBackfill', () => {
  it('plans a fix for a site whose site.yaml domain has no TLD', () => {
    expect(planDomainBackfill([site()])).toEqual([
      { siteId: 'buzzsoaps', from: 'buzzsoaps', to: 'buzzsoaps.com' },
    ]);
  });

  it('skips a site that already has a real domain', () => {
    expect(planDomainBackfill([site({ siteDomain: 'buzzsoaps.com' })])).toEqual([]);
  });

  it('skips a site with no authoritative domain to copy from', () => {
    expect(planDomainBackfill([site({ indexDomain: undefined })])).toEqual([]);
  });

  it('skips a site whose index entry is also TLD-less', () => {
    expect(planDomainBackfill([site({ indexDomain: 'buzzsoaps' })])).toEqual([]);
  });

  it('uses the index custom_domain rather than guessing siteId + .com', () => {
    expect(
      planDomainBackfill([
        site({ siteId: 'muvizzcom', siteDomain: 'muvizzcom', indexDomain: 'muvizz.com' }),
      ]),
    ).toEqual([{ siteId: 'muvizzcom', from: 'muvizzcom', to: 'muvizz.com' }]);
  });

  it('reports a missing site.yaml domain as an empty "from"', () => {
    expect(planDomainBackfill([site({ siteDomain: undefined })])).toEqual([
      { siteId: 'buzzsoaps', from: '', to: 'buzzsoaps.com' },
    ]);
  });

  it('normalises the target domain', () => {
    expect(planDomainBackfill([site({ indexDomain: ' BuzzSoaps.COM ' })])).toEqual([
      { siteId: 'buzzsoaps', from: 'buzzsoaps', to: 'buzzsoaps.com' },
    ]);
  });

  it('is a no-op when the normalised values already match', () => {
    expect(
      planDomainBackfill([site({ siteDomain: 'BuzzSoaps.com', indexDomain: 'buzzsoaps.com' })]),
    ).toEqual([]);
  });

  it('handles a mixed batch, preserving input order', () => {
    const plan = planDomainBackfill([
      site({ siteId: 'a', siteDomain: 'a', indexDomain: 'a.com' }),
      site({ siteId: 'b', siteDomain: 'b.com', indexDomain: 'b.com' }),
      site({ siteId: 'c', siteDomain: 'c', indexDomain: undefined }),
      site({ siteId: 'd', siteDomain: 'd', indexDomain: 'd.co.uk' }),
    ]);
    expect(plan).toEqual([
      { siteId: 'a', from: 'a', to: 'a.com' },
      { siteId: 'd', from: 'd', to: 'd.co.uk' },
    ]);
  });

  it('returns an empty plan for an empty input', () => {
    expect(planDomainBackfill([])).toEqual([]);
  });
});
