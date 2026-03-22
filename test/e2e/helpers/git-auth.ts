/**
 * Git authentication helper for E2E tests.
 *
 * Configures GIT_ASKPASS so that `git push` can authenticate using
 * the GitHub PAT from E2E credentials. The token is stored in a
 * separate file (not interpolated into shell) to avoid injection.
 * Cleanup is registered on process exit.
 */
import { chmodSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let askpassPath: string | undefined;
let tokenPath: string | undefined;
let cleanupRegistered = false;

/**
 * Create a GIT_ASKPASS helper script that returns the given token.
 *
 * The token is written to a separate file and the askpass script reads
 * it via `cat`. This avoids shell injection if the token contains
 * special characters ($, ", `, \).
 *
 * The script inspects the prompt argument to distinguish between
 * username and password prompts — git calls GIT_ASKPASS for both.
 *
 * @returns The path to the askpass script.
 */
export function createGitAskpass(token: string): string {
  // Always recreate — token may differ between calls
  cleanupGitAuth();

  const timestamp = Date.now();
  tokenPath = join(tmpdir(), `clancy-e2e-token-${timestamp}`);
  askpassPath = join(tmpdir(), `clancy-e2e-askpass-${timestamp}.sh`);

  // Write token to a separate file (owner-read only)
  writeFileSync(tokenPath, token);
  chmodSync(tokenPath, 0o600);

  // Askpass script inspects the prompt to return the correct value.
  // Git calls GIT_ASKPASS with a prompt string like "Username for ..."
  // or "Password for ...". For GitHub HTTPS, the username is
  // "x-access-token" and the password is the PAT.
  const script = [
    '#!/bin/sh',
    'prompt="$1"',
    'if echo "$prompt" | grep -qi "username"; then',
    '  printf "%s\\n" "x-access-token"',
    'else',
    `  cat "${tokenPath}"`,
    'fi',
    '',
  ].join('\n');

  writeFileSync(askpassPath, script);
  chmodSync(askpassPath, 0o500);

  // Register cleanup on process exit
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    process.on('exit', cleanupGitAuth);
  }

  return askpassPath;
}

/**
 * Remove the askpass script and token file from disk.
 */
export function cleanupGitAuth(): void {
  if (tokenPath) {
    rmSync(tokenPath, { force: true });
    tokenPath = undefined;
  }
  if (askpassPath) {
    rmSync(askpassPath, { force: true });
    askpassPath = undefined;
  }
}

/**
 * Configure process.env for git push authentication.
 *
 * Sets GIT_ASKPASS to a helper script that returns the token,
 * and GIT_TERMINAL_PROMPT=0 to prevent interactive prompts.
 */
export function configureGitAuth(token: string): void {
  const scriptPath = createGitAskpass(token);
  process.env.GIT_ASKPASS = scriptPath;
  process.env.GIT_TERMINAL_PROMPT = '0';
}
