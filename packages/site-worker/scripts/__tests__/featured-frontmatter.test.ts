import { describe, expect, it } from 'vitest';
import { parseFeatured } from '../lib/parse-featured';

describe('parseFeatured', () => {
  it('returns undefined when missing', () => {
    expect(parseFeatured(undefined)).toBeUndefined();
  });

  it('accepts a single string', () => {
    expect(parseFeatured('hero')).toEqual(['hero']);
    expect(parseFeatured('must-read')).toEqual(['must-read']);
  });

  it('accepts an array', () => {
    expect(parseFeatured(['hero', 'must-read'])).toEqual(['hero', 'must-read']);
  });

  it('strips unknown values silently', () => {
    expect(parseFeatured(['hero', 'banana'])).toEqual(['hero']);
    expect(parseFeatured('garbage')).toEqual([]);
  });

  it('returns undefined for empty array (treat as not-featured)', () => {
    expect(parseFeatured([])).toBeUndefined();
  });
});
