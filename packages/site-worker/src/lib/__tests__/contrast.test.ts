import { describe, it, expect } from 'vitest';
import { readableTextColor } from '../contrast';

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
