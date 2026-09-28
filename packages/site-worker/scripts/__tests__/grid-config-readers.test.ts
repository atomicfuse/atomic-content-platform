import { describe, expect, it } from 'vitest';
import { parseConfigOutput } from '../lib/grid-config-readers';

describe('parseConfigOutput', () => {
  it('treats a missing key (wrangler\'s literal "Value not found") as null, quietly', () => {
    expect(parseConfigOutput('Value not found\n')).toBeNull();
  });
  it('treats empty/whitespace output as null', () => {
    expect(parseConfigOutput('')).toBeNull();
    expect(parseConfigOutput('   \n')).toBeNull();
  });
  it('parses valid JSON output', () => {
    expect(parseConfigOutput('{"site_name":"X","domain":"x.com"}')).toEqual({ site_name: 'X', domain: 'x.com' });
  });
  it('throws on malformed JSON — caller treats this as a real failure, not a missing key', () => {
    expect(() => parseConfigOutput('{not valid json')).toThrow();
  });
});
