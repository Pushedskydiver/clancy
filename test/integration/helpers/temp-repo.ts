/**
 * Temp git repo helper for integration tests.
 *
 * Creates temporary git repositories with a real TypeScript project scaffold.
 * node_modules is symlinked from the shared template created in global-setup.ts.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type BoardProvider, boardEnvMap } from './env-fixtures.js';
import { TEMPLATE_POINTER_PATH } from '../global-setup.js';
import { SCAFFOLD_FILES } from './scaffold-content.js';

/** Read the shared scaffold template directory from the pointer file. */
function getTemplatePath(): string | undefined {
  try {
    return readFileSync(TEMPLATE_POINTER_PATH, 'utf8').trim();
  } catch {
    return undefined;
  }
}

export interface TempRepoOptions {
  /** Override the default base branch name (defaults to 'main'). */
  baseBranch?: string;
}

export interface TempRepoResult {
  /** Absolute path to the temp repo directory. */
  repoPath: string;
  /** Cleanup function — removes the temp directory. */
  cleanup: () => void;
}

/**
 * Create a temporary git repository with a real TypeScript project scaffold.
 *
 * The scaffold includes package.json (with lint/test/typecheck scripts),
 * tsconfig.json, eslint config, and a trivial src/index.ts. node_modules
 * is symlinked from the shared template for fast setup.
 */
export function createTempRepo(options: TempRepoOptions = {}): TempRepoResult {
  const baseBranch = options.baseBranch ?? 'main';
  const repoPath = mkdtempSync(join(tmpdir(), 'clancy-test-repo-'));

  // Init git with repo-local config
  execFileSync('git', ['init', '-b', baseBranch], {
    cwd: repoPath,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Clancy Test'], {
    cwd: repoPath,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.email', 'test@clancy.dev'], {
    cwd: repoPath,
    stdio: 'pipe',
  });

  // Write shared scaffold files
  for (const [relativePath, content] of Object.entries(SCAFFOLD_FILES)) {
    const fullPath = join(repoPath, relativePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }

  // Symlink node_modules from the shared template.
  // Falls back gracefully if symlinks aren't available (e.g. Windows without
  // Developer Mode) — tests still pass, they just skip tsc/eslint assertions.
  const templateDir = getTemplatePath();
  if (templateDir && existsSync(join(templateDir, 'node_modules'))) {
    try {
      symlinkSync(
        join(templateDir, 'node_modules'),
        join(repoPath, 'node_modules'),
      );
    } catch {
      // Best-effort — symlink may fail on Windows without elevated privileges
    }
  }

  // Initial commit
  execFileSync('git', ['add', '-A'], { cwd: repoPath, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: initial scaffold'], {
    cwd: repoPath,
    stdio: 'pipe',
  });

  return {
    repoPath,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true }),
  };
}

/**
 * Create and checkout an epic branch from the current base.
 */
export function createEpicBranch(repoPath: string, epicKey: string): void {
  const branchName = `epic/${epicKey.toLowerCase()}`;
  execFileSync('git', ['checkout', '-b', branchName], {
    cwd: repoPath,
    stdio: 'pipe',
  });
}

/**
 * Create the .clancy/ scaffold inside a temp repo.
 *
 * Does NOT commit — tests may want to commit selectively.
 */
export function createClancyScaffold(
  repoPath: string,
  board: BoardProvider,
  envOverrides: Record<string, string> = {},
): void {
  const clancyDir = join(repoPath, '.clancy');
  const docsDir = join(clancyDir, 'docs');
  mkdirSync(docsDir, { recursive: true });

  // .clancy/.env — merge board defaults with overrides
  const boardDefaults = boardEnvMap[board];
  const merged = { ...boardDefaults, ...envOverrides };
  const envContent = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  writeFileSync(join(clancyDir, '.env'), envContent + '\n');
  writeFileSync(join(clancyDir, '.env.example'), '# Example env vars\n');

  // Doc files matching what the installer creates
  const docFiles = [
    'STACK.md',
    'CONVENTIONS.md',
    'ARCHITECTURE.md',
    'API.md',
    'TESTING.md',
    'DEPENDENCIES.md',
    'BUILD.md',
    'DEPLOYMENT.md',
    'SECURITY.md',
    'TROUBLESHOOTING.md',
  ];
  for (const file of docFiles) {
    writeFileSync(join(docsDir, file), `# ${file.replace('.md', '')}\n`);
  }

  // Empty progress file
  writeFileSync(join(clancyDir, 'progress.txt'), '');
}

/**
 * Helper to run a function with a temporary working directory.
 *
 * Changes process.cwd() to the given path, runs the function, then restores.
 * Needed because the once orchestrator reads cwd via process.cwd().
 */
export async function withCwd<T>(
  dir: string,
  fn: () => T | Promise<T>,
): Promise<T> {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(original);
  }
}
