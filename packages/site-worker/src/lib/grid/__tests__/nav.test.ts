import { describe, expect, it } from 'vitest';
import { buildPills } from '../nav';

describe('buildPills', () => {
  const topics = [{ label: 'Travel', slug: 'travel', verticals: [] }, { label: 'Health', slug: 'health', verticals: [] }];
  it('prepends All and marks the active pill', () => {
    expect(buildPills(topics, 'health')).toEqual([
      { label: 'All', href: '/', active: false },
      { label: 'Travel', href: '/topic/travel', active: false },
      { label: 'Health', href: '/topic/health', active: true },
    ]);
  });
  it('All is active on the homepage (null topic)', () => {
    expect(buildPills(topics, null)[0]?.active).toBe(true);
  });
});
