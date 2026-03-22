import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, '../../src'),
    },
  },
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    globals: true,
    restoreMocks: true,
    globalSetup: './test/integration/global-setup.ts',
    // Sequential: E2E tests use process.chdir and real git/filesystem ops.
    fileParallelism: false,
    // No retry — E2E tests create real external resources (issues, PRs,
    // branches). Retries would leak earlier-attempt resources. The GC
    // script handles orphan cleanup instead.
  },
});
