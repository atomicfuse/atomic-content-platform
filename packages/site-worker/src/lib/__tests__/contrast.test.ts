import { describe, it, expect } from 'vitest';
import { readableTextColor, themeForegroundVars } from '../contrast';

describe('readableTextColor', () => {
  it('returns dark text on a light/white background', () => {
    expect(readableTextColor('#ffffff')).toBe('#111111');
    expect(readableTextColor('#f8f9fa')).toBe('#111111');
    expect(readableTextColor('#e9e4ff')).toBe('#111111');
  });

  it('returns white text on a dark background', () => {
    expect(readableTextColor('#000000')).toBe('#ffffff');
    expect(readableTextColor('#1a1a2e')).toBe('#ffffff');
    expect(readableTextColor('#0a0e27')).toBe('#ffffff');
    expect(readableTextColor('#7c3aed')).toBe('#ffffff');
  });

  it('supports shorthand 3-digit hex', () => {
    expect(readableTextColor('#fff')).toBe('#111111');
    expect(readableTextColor('#000')).toBe('#ffffff');
  });

  it('tolerates a leading-hash-less value', () => {
    expect(readableTextColor('ffffff')).toBe('#111111');
  });

  it('defaults to white text for invalid/empty input (matches prior behavior)', () => {
    expect(readableTextColor('')).toBe('#ffffff');
    expect(readableTextColor('not-a-color')).toBe('#ffffff');
    expect(readableTextColor(undefined as unknown as string)).toBe('#ffffff');
  });
});

describe('themeForegroundVars', () => {
  const vars = (colors: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
      themeForegroundVars(colors).map((decl) => {
        const [k, v] = decl.replace(/;$/, '').split(': ');
        return [k, v];
      }),
    );

  it('keeps the existing secondary / accent / primary foregrounds', () => {
    const v = vars({ secondary: '#fafafa', accent: '#be185d', primary: '#18181b' });
    expect(v['--color-secondary-fg']).toBe('#111111');
    expect(v['--color-accent-fg']).toBe('#ffffff');
    expect(v['--color-primary-fg']).toBe('#ffffff');
  });

  it('gives Must Reads text that is readable on its own background', () => {
    expect(vars({ must_reads_bg: '#18181b' })['--color-must_reads_bg-fg']).toBe('#ffffff');
    expect(vars({ must_reads_bg: '#fafafa' })['--color-must_reads_bg-fg']).toBe('#111111');
    // Falls back to secondary, like the section background itself.
    expect(vars({ secondary: '#fafafa' })['--color-must_reads_bg-fg']).toBe('#111111');
  });

  it('keeps today\'s footer defaults exactly on a dark footer', () => {
    const v = vars({ footer_bg: '#18181b' });
    expect(v['--footer-auto-heading']).toBe('#fff');
    expect(v['--footer-auto-text']).toBe('#d1d5db');
    expect(v['--footer-auto-muted']).toBe('#9ca3af');
    expect(v['--footer-auto-link-hover']).toBe('#fff');
  });

  it('switches footer defaults to dark text on a light footer', () => {
    const v = vars({ footer_bg: '#fafafa' });
    expect(v['--footer-auto-heading']).toBe('#111111');
    expect(v['--footer-auto-text']).toBe('#374151');
    expect(v['--footer-auto-muted']).toBe('#4b5563');
    expect(v['--footer-auto-link-hover']).toBe('#111111');
  });

  it('uses secondary for the footer when no footer color is set', () => {
    expect(vars({ secondary: '#ffffff' })['--footer-auto-heading']).toBe('#111111');
  });
});
