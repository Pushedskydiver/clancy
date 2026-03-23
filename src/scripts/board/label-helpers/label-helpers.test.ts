import { describe, expect, it, vi } from 'vitest';

import { modifyLabelList, safeLabel } from './label-helpers.js';

describe('safeLabel', () => {
  it('calls the operation and returns normally on success', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    await safeLabel(fn, 'addLabel');
    expect(fn).toHaveBeenCalled();
  });

  it('catches errors and warns without throwing', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await safeLabel(fn, 'addLabel');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('addLabel'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('network'));
    warn.mockRestore();
  });

  it('handles non-Error throws', async () => {
    const fn = vi.fn().mockRejectedValue('string error');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await safeLabel(fn, 'removeLabel');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('string error'));
    warn.mockRestore();
  });
});

describe('modifyLabelList', () => {
  it('adds a label when not present', async () => {
    const write = vi.fn().mockResolvedValue(undefined);

    await modifyLabelList(async () => ['a', 'b'], write, 'c', 'add');

    expect(write).toHaveBeenCalledWith(['a', 'b', 'c']);
  });

  it('skips add when label already present', async () => {
    const write = vi.fn();

    await modifyLabelList(async () => ['a', 'b'], write, 'b', 'add');

    expect(write).not.toHaveBeenCalled();
  });

  it('removes a label when present', async () => {
    const write = vi.fn().mockResolvedValue(undefined);

    await modifyLabelList(async () => ['a', 'b', 'c'], write, 'b', 'remove');

    expect(write).toHaveBeenCalledWith(['a', 'c']);
  });

  it('skips remove when label not present', async () => {
    const write = vi.fn();

    await modifyLabelList(async () => ['a', 'b'], write, 'z', 'remove');

    expect(write).not.toHaveBeenCalled();
  });

  it('returns early when fetchCurrent returns undefined', async () => {
    const write = vi.fn();

    await modifyLabelList(async () => undefined, write, 'x', 'add');

    expect(write).not.toHaveBeenCalled();
  });

  it('works with number arrays', async () => {
    const write = vi.fn().mockResolvedValue(undefined);

    await modifyLabelList(async () => [1, 2, 3], write, 4, 'add');

    expect(write).toHaveBeenCalledWith([1, 2, 3, 4]);
  });

  it('removes from number arrays', async () => {
    const write = vi.fn().mockResolvedValue(undefined);

    await modifyLabelList(async () => [1, 2, 3], write, 2, 'remove');

    expect(write).toHaveBeenCalledWith([1, 3]);
  });

  it('adds to empty array', async () => {
    const write = vi.fn().mockResolvedValue(undefined);

    await modifyLabelList(async () => [], write, 'first', 'add');

    expect(write).toHaveBeenCalledWith(['first']);
  });

  it('skips remove from empty array', async () => {
    const write = vi.fn();

    await modifyLabelList(async () => [], write, 'x', 'remove');

    expect(write).not.toHaveBeenCalled();
  });

  it('propagates writeUpdated errors to caller', async () => {
    const write = vi.fn().mockRejectedValue(new Error('write failed'));

    await expect(
      modifyLabelList(async () => ['a'], write, 'b', 'add'),
    ).rejects.toThrow('write failed');
  });
});
