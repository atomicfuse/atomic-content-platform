import { describe, it, expect } from 'vitest';
import { toAbsoluteImageUrl } from '../url';

describe('toAbsoluteImageUrl', () => {
  const base = 'https://travelswire.com';

  it('prepends base to a relative path', () => {
    expect(toAbsoluteImageUrl('/travelswire/assets/images/hero.webp', base))
      .toBe('https://travelswire.com/travelswire/assets/images/hero.webp');
  });

  it('returns an already-absolute URL unchanged', () => {
    expect(toAbsoluteImageUrl('https://cdn.example.com/img.png', base))
      .toBe('https://cdn.example.com/img.png');
  });

  it('returns undefined for undefined input', () => {
    expect(toAbsoluteImageUrl(undefined, base)).toBeUndefined();
  });

  it('returns undefined for empty string input', () => {
    expect(toAbsoluteImageUrl('', base)).toBeUndefined();
  });

  it('handles base URL with trailing slash', () => {
    expect(toAbsoluteImageUrl('/assets/img.png', 'https://example.com/'))
      .toBe('https://example.com/assets/img.png');
  });

  it('returns protocol-relative URL unchanged', () => {
    expect(toAbsoluteImageUrl('//cdn.example.com/img.png', base))
      .toBe('//cdn.example.com/img.png');
  });
});
