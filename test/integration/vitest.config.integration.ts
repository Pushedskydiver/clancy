import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(__dirname, '../../src'),
    },
  },
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,
    globals: true,
    restoreMocks: true,
    globalSetup: './test/integration/global-setup.ts',
  },
});
