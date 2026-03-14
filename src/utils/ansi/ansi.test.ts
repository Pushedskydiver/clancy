import { describe, expect, it } from 'vitest';

import { blue, bold, cyan, dim, green, red, yellow } from './ansi.js';

describe('ansi helpers', () => {
  it('wraps text in dim codes', () => {
    expect(dim('hello')).toBe('\x1b[2mhello\x1b[0m');
  });

  it('wraps text in bold codes', () => {
    expect(bold('hello')).toBe('\x1b[1mhello\x1b[0m');
  });

  it('wraps text in blue codes', () => {
    expect(blue('hello')).toBe('\x1b[1;34mhello\x1b[0m');
  });

  it('wraps text in cyan codes', () => {
    expect(cyan('hello')).toBe('\x1b[36mhello\x1b[0m');
  });

  it('wraps text in green codes', () => {
    expect(green('hello')).toBe('\x1b[32mhello\x1b[0m');
  });

  it('wraps text in red codes', () => {
    expect(red('hello')).toBe('\x1b[31mhello\x1b[0m');
  });

  it('wraps text in yellow codes', () => {
    expect(yellow('hello')).toBe('\x1b[33mhello\x1b[0m');
  });

  it('handles empty strings', () => {
    expect(dim('')).toBe('\x1b[2m\x1b[0m');
  });

  it('handles strings with existing ANSI codes', () => {
    const nested = bold(red('error'));
    expect(nested).toBe('\x1b[1m\x1b[31merror\x1b[0m\x1b[0m');
  });
});
