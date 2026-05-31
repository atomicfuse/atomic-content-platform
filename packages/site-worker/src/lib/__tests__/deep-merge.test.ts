import { describe, expect, it } from 'vitest';
import { deepMerge } from '../deep-merge';

describe('deepMerge (runtime)', () => {
  it('merges nested objects', () => {
    expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
  });

  it('arrays in b replace arrays in a', () => {
    expect(deepMerge({ x: [1, 2] }, { x: [3] })).toEqual({ x: [3] });
  });

  it('null/undefined in b do not erase a', () => {
    expect(deepMerge({ x: 1 }, { x: null })).toEqual({ x: 1 });
    expect(deepMerge({ x: 1 }, { x: undefined })).toEqual({ x: 1 });
  });

  it('later scalar wins', () => {
    expect(deepMerge({ x: 1 }, { x: 2 })).toEqual({ x: 2 });
  });
});
