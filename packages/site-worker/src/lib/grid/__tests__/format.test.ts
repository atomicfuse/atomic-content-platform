import { describe, expect, it } from 'vitest';
import { buildOutboundUrl, escapeHtml, formatAge } from '../format';

const NOW = new Date('2026-09-27T12:00:00Z');
describe('formatAge', () => {
  it.each([
    ['2026-09-27T11:59:50Z', '1m'], ['2026-09-27T11:15:00Z', '45m'], ['2026-09-27T07:00:00Z', '5h'],
    ['2026-09-22T12:00:00Z', '5d'], ['2026-09-06T12:00:00Z', '3w'], ['2026-05-27T12:00:00Z', '4mo'],
    ['2024-09-27T12:00:00Z', '2y'], ['2026-09-28T12:00:00Z', '1m'], ['garbage', ''],
  ])('%s → %s', (iso, out) => expect(formatAge(iso, NOW)).toBe(out));
});
describe('buildOutboundUrl', () => {
  it('adds UTM when enabled', () => {
    expect(buildOutboundUrl('scienceworld.com', 'best-telescopes', 'grid.example.com', true))
      .toBe('https://scienceworld.com/best-telescopes?utm_source=grid.example.com&utm_medium=grid');
  });
  it('plain URL when disabled', () => {
    expect(buildOutboundUrl('scienceworld.com', 'a', 'g', false)).toBe('https://scienceworld.com/a');
  });
});
describe('escapeHtml', () => {
  it('escapes the five specials', () => expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'));
});
