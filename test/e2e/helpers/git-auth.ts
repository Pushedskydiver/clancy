/**
 * Git authentication helper for E2E tests.
 *
 * Configures GIT_ASKPASS so that `git push` can authenticate using
 * the GitHub PAT from E2E credentials. The token is stored in a
 * private temp directory (created via mkdtempSync) to avoid symlink
 * attacks. Cleanup is registered on process exit.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let authDir: string | undefined;
let askpassPath: string | undefined;
let tokenPath: string | undefined;
let cleanupRegistered = false;

/**
 * Create a GIT_ASKPASS helper script that returns the given token.
 *
 * Both the token file and askpass script are placed inside a private
 * temp directory (0o700) created via mkdtempSync. The askpass script
 * inspects the prompt argument to distinguish between username and
 * password prompts — git calls GIT_ASKPASS for both.
 *
 * @returns The path to the askpass script.
 */
export function createGitAskpass(token: string): string {
  // Always recreate — token may differ between calls
  cleanupGitAuth();

  // Create a private temp directory (owner-only access)
  authDir = mkdtempSync(join(tmpdir(), 'clancy-e2e-auth-'));
  chmodSync(authDir, 0o700);

  tokenPath = join(authDir, 'token');
  askpassPath = join(authDir, 'askpass.sh');

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
 * Remove the auth directory containing the askpass script and token file.
 */
export function cleanupGitAuth(): void {
  if (authDir) {
    rmSync(authDir, { recursive: true, force: true });
    authDir = undefined;
    askpassPath = undefined;
    tokenPath = undefined;
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
