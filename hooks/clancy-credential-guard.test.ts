import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOOK_PATH = resolve(__dirname, 'clancy-credential-guard.js');

/** Run the hook script with a JSON payload, return parsed output. */
function runHook(payload: Record<string, unknown>): {
  decision: string;
  reason?: string;
} {
  const result = execFileSync('node', [HOOK_PATH, JSON.stringify(payload)], {
    encoding: 'utf8',
  });
  return JSON.parse(result.trim());
}

/** Build a Write tool payload. */
function writePayload(filePath: string, content: string) {
  return { tool_name: 'Write', tool_input: { file_path: filePath, content } };
}

describe('clancy-credential-guard', () => {
  // ── Non-file-writing tool calls ──────────────────────────────

  describe('non-file-writing tools', () => {
    it('approves Bash tool calls', () => {
      const result = runHook({
        tool_name: 'Bash',
        tool_input: { command: 'echo hello' },
      });
      expect(result.decision).toBe('approve');
    });

    it('approves Read tool calls', () => {
      const result = runHook({
        tool_name: 'Read',
        tool_input: { file_path: '/tmp/secrets.txt' },
      });
      expect(result.decision).toBe('approve');
    });

    it('approves Grep tool calls', () => {
      const result = runHook({
        tool_name: 'Grep',
        tool_input: { pattern: 'token' },
      });
      expect(result.decision).toBe('approve');
    });
  });

  // ── Write blocks ─────────────────────────────────────────────

  describe('Write with credentials', () => {
    it('blocks Write with AWS access key pattern', () => {
      const fakeKey = 'AKIA' + 'IOSFODNN7EXAMPLE';
      const result = runHook(writePayload('src/config.ts', 'const k = "' + fakeKey + '";'));
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('AWS Access Key');
    });

    it('blocks Write with GitHub PAT (ghp_)', () => {
      const fakePat = 'ghp_' + 'a'.repeat(36);
      const result = runHook(writePayload('src/auth.ts', 'const t = "' + fakePat + '";'));
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('GitHub PAT');
    });

    it('blocks Write with generic API key pattern', () => {
      // Construct the pattern "api_key = <value>" at runtime
      const line = 'api' + '_key = "' + 'x'.repeat(32) + '"';
      const result = runHook(writePayload('src/config.ts', line));
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('Generic API key');
    });

    it('blocks Write with private key (BEGIN PRIVATE KEY)', () => {
      const header = '-----BEGIN ' + 'PRIVATE KEY-----';
      const result = runHook(writePayload('src/certs/key.pem', header + '\nMIIEvg...\n-----END PRIVATE KEY-----'));
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('Private key');
    });

    it('blocks Write with database connection string', () => {
      const connStr = 'postgres://' + 'user:p4ss@localhost:5432/mydb';
      const result = runHook(writePayload('src/db.ts', 'const url = "' + connStr + '";'));
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('Database connection string');
    });

    it('blocks Write with Stripe live key', () => {
      const stripeKey = 'sk_live_' + 'a'.repeat(24);
      const result = runHook(writePayload('src/billing.ts', 'const s = "' + stripeKey + '";'));
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('Stripe key');
    });

    it('blocks Write with Slack token', () => {
      const slackToken = 'xoxb-' + '1234567890' + '-AbCdEfGhIjKlMnOp';
      const result = runHook(writePayload('src/slack.ts', 'const t = "' + slackToken + '";'));
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('Slack token');
    });

    it('blocks Write with Linear API key', () => {
      const linearKey = 'lin_api_' + 'a'.repeat(40);
      const result = runHook(writePayload('src/linear.ts', 'const k = "' + linearKey + '";'));
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('Linear API key');
    });

    it('blocks Write with generic password pattern', () => {
      // Construct "password = <value>" at runtime to avoid triggering the guard
      const line = 'pass' + 'word = "sup3r_s3cret!"';
      const result = runHook(writePayload('src/config.ts', line));
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('Generic password');
    });
  });

  // ── Edit blocks ──────────────────────────────────────────────

  describe('Edit with credentials', () => {
    it('blocks Edit with credential in new_string', () => {
      const fakePat = 'ghp_' + 'b'.repeat(36);
      const result = runHook({
        tool_name: 'Edit',
        tool_input: {
          file_path: 'src/auth.ts',
          old_string: 'const token = "";',
          new_string: 'const token = "' + fakePat + '";',
        },
      });
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('GitHub PAT');
    });

    it('approves Edit with safe content', () => {
      const result = runHook({
        tool_name: 'Edit',
        tool_input: {
          file_path: 'src/utils.ts',
          old_string: 'const x = 1;',
          new_string: 'const x = 2;',
        },
      });
      expect(result.decision).toBe('approve');
    });
  });

  // ── MultiEdit blocks ────────────────────────────────────────

  describe('MultiEdit with credentials', () => {
    it('blocks MultiEdit with credential in any edit', () => {
      const fakeKey = 'AKIA' + 'IOSFODNN7EXAMPL2';
      const result = runHook({
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: 'src/config.ts',
          edits: [
            { old_string: 'const a = 1;', new_string: 'const a = 2;' },
            { old_string: 'const k = "";', new_string: 'const k = "' + fakeKey + '";' },
          ],
        },
      });
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('AWS Access Key');
    });

    it('approves MultiEdit with safe content', () => {
      const result = runHook({
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: 'src/utils.ts',
          edits: [
            { old_string: 'const a = 1;', new_string: 'const a = 2;' },
            { old_string: 'const b = 3;', new_string: 'const b = 4;' },
          ],
        },
      });
      expect(result.decision).toBe('approve');
    });
  });

  // ── Allowed paths ────────────────────────────────────────────

  describe('allowed paths', () => {
    it('approves Write to .clancy/.env', () => {
      const fakePat = 'ghp_' + 'c'.repeat(36);
      const result = runHook(writePayload('/project/.clancy/.env', 'TOKEN=' + fakePat));
      expect(result.decision).toBe('approve');
    });

    it('approves Write to .env.local', () => {
      const fakeKey = 'AKIA' + 'IOSFODNN7EXAMPL3';
      const result = runHook(writePayload('/project/.env.local', 'AWS=' + fakeKey));
      expect(result.decision).toBe('approve');
    });

    it('approves Write to .env.example', () => {
      const line = 'api' + '_key = "placeholder_value_1234567890ab"';
      const result = runHook(writePayload('/project/.env.example', line));
      expect(result.decision).toBe('approve');
    });

    it('approves Write to .env.development', () => {
      const connStr = 'postgres://' + 'dev:devpass@localhost:5432/devdb';
      const result = runHook(writePayload('/project/.env.development', 'DB=' + connStr));
      expect(result.decision).toBe('approve');
    });

    it('approves Write to .env.test', () => {
      const connStr = 'redis://' + 'user:testpass@localhost:6379';
      const result = runHook(writePayload('/project/.env.test', 'REDIS=' + connStr));
      expect(result.decision).toBe('approve');
    });
  });

  // ── Clean content ────────────────────────────────────────────

  describe('no credential patterns', () => {
    it('approves Write with safe content', () => {
      const result = runHook(writePayload('src/index.ts', 'export function hello() { return "world"; }'));
      expect(result.decision).toBe('approve');
    });

    it('approves Write with short values that look like keys but are not', () => {
      const result = runHook(writePayload('src/config.ts', 'const KEY_NAME = "my-key";'));
      expect(result.decision).toBe('approve');
    });
  });

  // ── Fail-open (malformed / empty input) ──────────────────────

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

    it('approves when tool_input is missing', () => {
      const result = runHook({ tool_name: 'Write' });
      expect(result.decision).toBe('approve');
    });
  });
});
