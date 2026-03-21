/**
 * Vitest global setup for integration tests.
 *
 * Creates a shared scaffold template with real node_modules (one-time npm install).
 * Individual tests symlink node_modules from this template for fast per-test setup.
 *
 * Template path is persisted to a temp file (not process.env) because globalSetup
 * runs in a separate process from test workers.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SCAFFOLD_FILES } from './helpers/scaffold-content.js';

/** Well-known path for the template dir pointer file. */
export const TEMPLATE_POINTER_PATH = join(
  tmpdir(),
  'clancy-test-scaffold-pointer.txt',
);

let templateDir: string;

export async function setup(): Promise<void> {
  templateDir = mkdtempSync(join(tmpdir(), 'clancy-test-scaffold-'));

  // Write scaffold files
  for (const [relativePath, content] of Object.entries(SCAFFOLD_FILES)) {
    const fullPath = join(templateDir, relativePath);
    const dir = join(fullPath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content as string);
  }

  // One-time npm install — the expensive operation
  execSync('npm install --ignore-scripts', {
    cwd: templateDir,
    stdio: 'pipe',
    timeout: 120_000,
  });

  // Persist template path to a file that test workers can read
  writeFileSync(TEMPLATE_POINTER_PATH, templateDir);
}

export async function teardown(): Promise<void> {
  if (templateDir) {
    rmSync(templateDir, { recursive: true, force: true });
  }
  rmSync(TEMPLATE_POINTER_PATH, { force: true });
}
