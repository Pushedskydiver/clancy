/**
 * Claude CLI invocation for ticket implementation.
 *
 * Spawns `claude --dangerously-skip-permissions` with the prompt piped
 * to stdin. Output streams live to the user's terminal.
 */
import { spawnSync } from 'node:child_process';

/**
 * Invoke a Claude Code session with the given prompt.
 *
 * Pipes the prompt to stdin and streams stdout/stderr live.
 * Uses `--dangerously-skip-permissions` for autonomous operation.
 *
 * @param prompt - The full implementation prompt.
 * @param model - Optional model override (e.g., `'opus'`, `'sonnet'`).
 * @returns `true` if Claude exited successfully (code 0), `false` otherwise.
 *
 * @example
 * ```ts
 * invokeClaudeSession('You are implementing PROJ-123...', 'opus');
 * ```
 */
export function invokeClaudeSession(prompt: string, model?: string): boolean {
  const args = ['--dangerously-skip-permissions'];

  if (model) {
    args.push('--model', model);
  }

  const result = spawnSync('claude', args, {
    input: prompt,
    stdio: ['pipe', 'inherit', 'inherit'],
    encoding: 'utf8',
  });

  return result.status === 0 && !result.error;
}
