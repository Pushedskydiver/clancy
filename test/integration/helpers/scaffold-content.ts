/**
 * Shared scaffold file content used by both global-setup.ts and temp-repo.ts.
 * Single source of truth — no duplication.
 */

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'clancy-test-project',
    private: true,
    scripts: {
      lint: 'eslint .',
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    },
    devDependencies: {
      typescript: '^5.7.0',
      vitest: '^4.0.0',
      eslint: '^9.0.0',
    },
  },
  null,
  2,
);

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: true,
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      outDir: 'dist',
      skipLibCheck: true,
    },
    include: ['src'],
  },
  null,
  2,
);

const ESLINT_CONFIG = 'export default [{ rules: {} }];\n';

const INDEX_TS =
  "export function placeholder(): string {\n  return 'scaffold';\n}\n";

const TEST_TS =
  "import { expect, test } from 'vitest';\ntest('scaffold passes', () => { expect(true).toBe(true); });\n";

/**
 * Map of relative file paths to content for the TypeScript project scaffold.
 */
export const SCAFFOLD_FILES: Record<string, string> = {
  'package.json': PACKAGE_JSON,
  'tsconfig.json': TSCONFIG,
  'eslint.config.mjs': ESLINT_CONFIG,
  'src/index.ts': INDEX_TS,
  'scaffold.test.ts': TEST_TS,
};
