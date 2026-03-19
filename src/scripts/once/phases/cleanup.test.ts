import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendNotification } from '~/scripts/shared/notify/notify.js';

import { createContext } from '../context/context.js';
import { cleanup } from './cleanup.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('~/scripts/shared/format/format.js', () => ({
  formatDuration: vi.fn(() => '2m 30s'),
}));

vi.mock('~/scripts/shared/notify/notify.js', () => ({
  sendNotification: vi.fn(() => Promise.resolve()),
}));

const mockNotify = vi.mocked(sendNotification);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prints completion message and returns true', async () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'T',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await cleanup(ctx);
    log.mockRestore();

    expect(result).toBe(true);
  });

  it('sends notification when webhook is configured', async () => {
    const ctx = createContext([]);
    ctx.config = {
      provider: 'jira',
      env: { CLANCY_NOTIFY_WEBHOOK: 'https://hook.example.com' },
    } as never;
    ctx.ticket = {
      key: 'PROJ-1',
      title: 'Build feature',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await cleanup(ctx);
    log.mockRestore();

    expect(mockNotify).toHaveBeenCalledWith(
      'https://hook.example.com',
      '✓ Clancy completed [PROJ-1] Build feature',
    );
  });

  it('skips notification when no webhook', async () => {
    const ctx = createContext([]);
    ctx.config = { provider: 'jira', env: {} } as never;
    ctx.ticket = {
      key: 'PROJ-2',
      title: 'T2',
      description: 'd',
      parentInfo: 'none',
      blockers: 'None',
    };

    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await cleanup(ctx);
    log.mockRestore();

    expect(mockNotify).not.toHaveBeenCalled();
  });
});
