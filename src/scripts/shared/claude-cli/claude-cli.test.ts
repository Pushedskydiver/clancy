import * as childProcess from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

import { invokeClaudeSession } from './claude-cli.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

describe('invokeClaudeSession', () => {
  it('spawns claude with --dangerously-skip-permissions', () => {
    invokeClaudeSession('test prompt');

    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      'claude',
      ['--dangerously-skip-permissions'],
      expect.objectContaining({
        input: 'test prompt',
        stdio: ['pipe', 'inherit', 'inherit'],
      }),
    );
  });

  it('includes --model flag when model is specified', () => {
    invokeClaudeSession('test prompt', 'opus');

    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      'claude',
      ['--dangerously-skip-permissions', '--model', 'opus'],
      expect.objectContaining({ input: 'test prompt' }),
    );
  });

  it('omits --model flag when model is undefined', () => {
    invokeClaudeSession('test prompt');

    const call = vi.mocked(childProcess.spawnSync).mock.calls.at(-1);
    const args = call?.[1] as string[];
    expect(args).not.toContain('--model');
  });
});
