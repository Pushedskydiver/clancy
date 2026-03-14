import { describe, expect, it } from 'vitest';

import { extractReworkContent, isReworkComment } from './rework-comment.js';

describe('isReworkComment', () => {
  it('returns true for comment starting with "Rework:"', () => {
    expect(isReworkComment('Rework: fix the validation')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isReworkComment('rework: fix it')).toBe(true);
    expect(isReworkComment('REWORK: fix it')).toBe(true);
    expect(isReworkComment('ReWoRk: fix it')).toBe(true);
  });

  it('trims leading/trailing whitespace before checking', () => {
    expect(isReworkComment('  Rework: fix it  ')).toBe(true);
    expect(isReworkComment('\n  rework: fix it')).toBe(true);
  });

  it('returns false for regular comments', () => {
    expect(isReworkComment('Looks good to me')).toBe(false);
    expect(isReworkComment('Please rework this')).toBe(false);
    expect(isReworkComment('This needs rework: badly')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isReworkComment('')).toBe(false);
  });
});

describe('extractReworkContent', () => {
  it('strips the Rework: prefix and trims', () => {
    expect(extractReworkContent('Rework: fix the validation')).toBe(
      'fix the validation',
    );
  });

  it('is case-insensitive when stripping prefix', () => {
    expect(extractReworkContent('rework: fix it')).toBe('fix it');
    expect(extractReworkContent('REWORK: fix it')).toBe('fix it');
  });

  it('handles extra whitespace after prefix', () => {
    expect(extractReworkContent('Rework:   lots of space')).toBe(
      'lots of space',
    );
  });

  it('handles no space after colon', () => {
    expect(extractReworkContent('Rework:fix it')).toBe('fix it');
  });

  it('preserves multiline content after prefix', () => {
    expect(extractReworkContent('Rework: line 1\nline 2')).toBe(
      'line 1\nline 2',
    );
  });
});
