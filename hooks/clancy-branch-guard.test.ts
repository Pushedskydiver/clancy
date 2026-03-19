import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOOK_PATH = resolve(__dirname, 'clancy-branch-guard.js');

/** Run the hook script with a JSON payload, return parsed output. */
function runHook(
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): { decision: string; reason?: string } {
  const result = execFileSync('node', [HOOK_PATH, JSON.stringify(payload)], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return JSON.parse(result.trim());
}

/** Shorthand to run with a Bash command. */
function runBash(command: string, env: Record<string, string> = {}) {
  return runHook({ tool_name: 'Bash', tool_input: { command } }, env);
}

describe('clancy-branch-guard', () => {
  // ── Force push ──────────────────────────────────────────────

  describe('git push --force', () => {
    it('blocks git push --force', () => {
      const result = runBash('git push --force');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('--force');
    });

    it('blocks git push -f', () => {
      const result = runBash('git push -f');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('--force');
    });

    it('blocks git push origin branch --force', () => {
      const result = runBash('git push origin feature/xyz --force');
      expect(result.decision).toBe('block');
    });

    it('allows git push --force-with-lease', () => {
      const result = runBash('git push --force-with-lease');
      expect(result.decision).toBe('approve');
    });

    it('allows git push --force-with-lease origin branch', () => {
      const result = runBash('git push --force-with-lease origin feature/xyz');
      expect(result.decision).toBe('approve');
    });

    it('blocks force push in piped commands', () => {
      const result = runBash('echo foo && git push --force');
      expect(result.decision).toBe('block');
    });
  });

  // ── Protected branches ──────────────────────────────────────

  describe('push to protected branches', () => {
    it('blocks git push origin main', () => {
      const result = runBash('git push origin main');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('main');
    });

    it('blocks git push origin master', () => {
      const result = runBash('git push origin master');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('master');
    });

    it('blocks git push origin develop', () => {
      const result = runBash('git push origin develop');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('develop');
    });

    it('allows git push origin feature/xyz', () => {
      const result = runBash('git push origin feature/xyz');
      expect(result.decision).toBe('approve');
    });

    it('allows git push (without remote and branch)', () => {
      const result = runBash('git push');
      expect(result.decision).toBe('approve');
    });

    it('allows git push origin (without branch)', () => {
      const result = runBash('git push origin');
      expect(result.decision).toBe('approve');
    });

    it('allows git push origin main-feature (not exact branch match)', () => {
      const result = runBash('git push origin main-feature');
      expect(result.decision).toBe('approve');
    });

    it('blocks CLANCY_BASE_BRANCH when set', () => {
      const result = runBash('git push origin staging', { CLANCY_BASE_BRANCH: 'staging' });
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('staging');
    });
  });

  // ── git reset ───────────────────────────────────────────────

  describe('git reset', () => {
    it('blocks git reset --hard', () => {
      const result = runBash('git reset --hard');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('reset --hard');
    });

    it('blocks git reset --hard HEAD~1', () => {
      const result = runBash('git reset --hard HEAD~1');
      expect(result.decision).toBe('block');
    });

    it('allows git reset --soft', () => {
      const result = runBash('git reset --soft HEAD~1');
      expect(result.decision).toBe('approve');
    });

    it('allows git reset --mixed', () => {
      const result = runBash('git reset --mixed');
      expect(result.decision).toBe('approve');
    });

    it('allows plain git reset', () => {
      const result = runBash('git reset');
      expect(result.decision).toBe('approve');
    });
  });

  // ── git clean ───────────────────────────────────────────────

  describe('git clean', () => {
    it('blocks git clean -f', () => {
      const result = runBash('git clean -f');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('clean');
    });

    it('blocks git clean -fd', () => {
      const result = runBash('git clean -fd');
      expect(result.decision).toBe('block');
    });

    it('blocks git clean -fdx', () => {
      const result = runBash('git clean -fdx');
      expect(result.decision).toBe('block');
    });

    it('allows git clean -n (dry run)', () => {
      const result = runBash('git clean -n');
      expect(result.decision).toBe('approve');
    });

    it('allows git clean --dry-run', () => {
      const result = runBash('git clean --dry-run');
      expect(result.decision).toBe('approve');
    });
  });

  // ── git checkout / restore ──────────────────────────────────

  describe('discard all changes', () => {
    it('blocks git checkout -- .', () => {
      const result = runBash('git checkout -- .');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('checkout');
    });

    it('blocks git restore .', () => {
      const result = runBash('git restore .');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('restore');
    });
  });

  // ── git branch -D ──────────────────────────────────────────

  describe('git branch delete', () => {
    it('blocks git branch -D mybranch', () => {
      const result = runBash('git branch -D mybranch');
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('branch -D');
    });

    it('allows git branch -d mybranch (safe delete)', () => {
      const result = runBash('git branch -d mybranch');
      expect(result.decision).toBe('approve');
    });
  });

  // ── Non-Bash tool calls ─────────────────────────────────────

  describe('non-Bash tools', () => {
    it('approves Write tool calls', () => {
      const result = runHook({ tool_name: 'Write', tool_input: { content: 'git push --force' } });
      expect(result.decision).toBe('approve');
    });

    it('approves Edit tool calls', () => {
      const result = runHook({ tool_name: 'Edit', tool_input: {} });
      expect(result.decision).toBe('approve');
    });
  });

  // ── Disabled guard ──────────────────────────────────────────

  describe('disabled via CLANCY_BRANCH_GUARD=false', () => {
    it('approves dangerous commands when disabled', () => {
      const result = runBash('git push --force', { CLANCY_BRANCH_GUARD: 'false' });
      expect(result.decision).toBe('approve');
    });

    it('approves git reset --hard when disabled', () => {
      const result = runBash('git reset --hard', { CLANCY_BRANCH_GUARD: 'false' });
      expect(result.decision).toBe('approve');
    });
  });

  // ── Fail-open (malformed input) ─────────────────────────────

  describe('fail-open on bad input', () => {
    it('approves on malformed JSON', () => {
      const result = execFileSync('node', [HOOK_PATH, 'not-valid-json'], {
        encoding: 'utf8',
      });
      expect(JSON.parse(result.trim()).decision).toBe('approve');
    });

    it('approves on empty input', () => {
      const result = execFileSync('node', [HOOK_PATH, '{}'], {
        encoding: 'utf8',
      });
      expect(JSON.parse(result.trim()).decision).toBe('approve');
    });
  });
});
