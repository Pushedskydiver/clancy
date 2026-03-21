/**
 * Claude output simulator for integration tests.
 *
 * Simulates what Claude does during the invoke phase: creates TypeScript files,
 * stages them, and commits with a conventional commit message. Provides both
 * success (valid code) and failure (broken code) variants.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SimulatorOptions {
  /** Custom files to create instead of defaults. Map of relative path to content. */
  files?: Record<string, string>;
}

/**
 * Simulate a successful Claude implementation.
 *
 * Creates valid TypeScript files, stages, and commits them.
 * Files pass strict TypeScript compilation and ESLint.
 *
 * @returns The commit SHA.
 */
export function simulateClaudeSuccess(
  repoPath: string,
  ticketKey: string,
  options: SimulatorOptions = {},
): string {
  const slug = ticketKey.toLowerCase().replace(/[^a-z0-9]/g, '-');

  const files = options.files ?? {
    [`src/${slug}.ts`]: [
      `/**`,
      ` * Implementation for ${ticketKey}.`,
      ` */`,
      `export function ${slug.replace(/-/g, '')}(): string {`,
      `  return '${ticketKey} implemented';`,
      `}`,
      ``,
    ].join('\n'),
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(repoPath, relativePath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }

  execFileSync('git', ['add', '-A'], { cwd: repoPath, stdio: 'pipe' });
  execFileSync(
    'git',
    ['commit', '-m', `feat(${ticketKey}): implement ticket`],
    { cwd: repoPath, stdio: 'pipe' },
  );

  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf8',
  }).trim();
}

/**
 * Simulate a failed Claude implementation.
 *
 * Creates TypeScript files with deliberate errors (unused variable,
 * type mismatch) that the verification gate would catch.
 *
 * @returns The commit SHA.
 */
export function simulateClaudeFailure(
  repoPath: string,
  ticketKey: string,
): string {
  const slug = ticketKey.toLowerCase().replace(/[^a-z0-9]/g, '-');

  const brokenCode = [
    `// Broken implementation for ${ticketKey}`,
    `const unusedVariable = 42;`, // unused variable — lint error
    `export function ${slug.replace(/-/g, '')}(): number {`,
    `  return 'not a number';`, // type error — returns string, declares number
    `}`,
    ``,
  ].join('\n');

  const fullPath = join(repoPath, `src/${slug}.ts`);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, brokenCode);

  execFileSync('git', ['add', '-A'], { cwd: repoPath, stdio: 'pipe' });
  execFileSync(
    'git',
    ['commit', '-m', `feat(${ticketKey}): implement ticket`],
    { cwd: repoPath, stdio: 'pipe' },
  );

  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf8',
  })
    .trim();
}

export interface SequencedScenario {
  type: 'success' | 'failure';
  repoPath: string;
  ticketKey: string;
  options?: SimulatorOptions;
}

/**
 * Create a sequenced mock for invokeClaudeSession that calls different
 * simulator variants on each invocation.
 *
 * Useful for testing self-healing: first call fails, second succeeds.
 *
 * @returns A function suitable for use as the mock implementation.
 */
export function createSequencedClaudeMock(
  scenarios: SequencedScenario[],
): (_prompt: string, _model?: string) => boolean {
  let callIndex = 0;

  return (_prompt: string, _model?: string) => {
    const scenario = scenarios[callIndex] ?? scenarios[scenarios.length - 1];
    callIndex++;

    if (scenario.type === 'failure') {
      simulateClaudeFailure(scenario.repoPath, scenario.ticketKey);
    } else {
      simulateClaudeSuccess(
        scenario.repoPath,
        scenario.ticketKey,
        scenario.options,
      );
    }

    return true;
  };
}
