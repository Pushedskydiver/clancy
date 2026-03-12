import { describe, expect, it } from 'vitest';

import { parseJson } from './parse-json.js';

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseJson('not json')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseJson('')).toBeUndefined();
  });

  it('handles arrays', () => {
    expect(parseJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('handles primitive values', () => {
    expect(parseJson('"hello"')).toBe('hello');
    expect(parseJson('42')).toBe(42);
    expect(parseJson('true')).toBe(true);
    expect(parseJson('null')).toBeNull();
  });
});
