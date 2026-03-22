/**
 * QA-002b-4 + QA-002b-5: Hook integration tests.
 *
 * Tests hooks via their JSON contract — credential guard and branch guard
 * use argv[2], context monitor and post-compact use stdin. Expanded coverage
 * beyond co-located unit tests: every credential pattern category, all
 * allowed paths, edge cases, all branch guard protected operations, context
 * monitor threshold/debounce/time guard, and post-compact re-injection.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ─── Hook runners ───────────────────────────────────────────────────────────

const CREDENTIAL_GUARD = resolve(
  __dirname,
  '../../../hooks/clancy-credential-guard.js',
);
const BRANCH_GUARD = resolve(
  __dirname,
  '../../../hooks/clancy-branch-guard.js',
);

type HookResult = { decision: string; reason?: string };

function runCredentialGuard(payload: Record<string, unknown>): HookResult {
  const result = execFileSync(
    'node',
    [CREDENTIAL_GUARD, JSON.stringify(payload)],
    { encoding: 'utf8' },
  );
  return JSON.parse(result.trim()) as HookResult;
}

function runBranchGuard(
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): HookResult {
  const result = execFileSync(
    'node',
    [BRANCH_GUARD, JSON.stringify(payload)],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  );
  return JSON.parse(result.trim()) as HookResult;
}

function writePayload(filePath: string, content: string) {
  return { tool_name: 'Write', tool_input: { file_path: filePath, content } };
}

function editPayload(filePath: string, newString: string) {
  return {
    tool_name: 'Edit',
    tool_input: {
      file_path: filePath,
      old_string: 'placeholder',
      new_string: newString,
    },
  };
}

function bashPayload(command: string) {
  return { tool_name: 'Bash', tool_input: { command } };
}

// ─── Credential guard — all pattern categories ─────────────────────────────

describe('credential guard — all pattern categories', () => {
  it('blocks generic API key (api_key = ...)', () => {
    const line = 'api' + '_key = "' + 'x'.repeat(32) + '"';
    const result = runCredentialGuard(writePayload('src/config.ts', line));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Generic API key');
  });

  it('blocks generic secret (secret = ...)', () => {
    const line = 'sec' + 'ret = "' + 'A'.repeat(32) + '"';
    const result = runCredentialGuard(writePayload('src/config.ts', line));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Generic secret');
  });

  it('blocks generic token (auth_token = ...)', () => {
    const line = 'auth' + '_token = "' + 'T'.repeat(32) + '"';
    const result = runCredentialGuard(writePayload('src/config.ts', line));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Generic token');
  });

  it('blocks generic password (password = ...)', () => {
    const line = 'pass' + 'word = "sup3r_s3cret!"';
    const result = runCredentialGuard(writePayload('src/config.ts', line));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Generic password');
  });

  it('blocks AWS access key (AKIA...)', () => {
    const key = 'AKIA' + 'IOSFODNN7EXAMPLE';
    const result = runCredentialGuard(
      writePayload('src/aws.ts', 'const k = "' + key + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('AWS Access Key');
  });

  it('blocks AWS secret key', () => {
    const line =
      'aws_secret' + '_access_key = "' + 'a'.repeat(40) + '"';
    const result = runCredentialGuard(writePayload('src/aws.ts', line));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('AWS Secret Key');
  });

  it('blocks GitHub PAT classic (ghp_)', () => {
    const pat = 'ghp_' + 'a'.repeat(36);
    const result = runCredentialGuard(
      writePayload('src/auth.ts', 'const t = "' + pat + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('GitHub PAT (classic)');
  });

  it('blocks GitHub PAT fine-grained (github_pat_)', () => {
    const pat = 'github_pat_' + 'B'.repeat(82);
    const result = runCredentialGuard(
      writePayload('src/auth.ts', 'const t = "' + pat + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('GitHub PAT (fine-grained)');
  });

  it('blocks GitHub OAuth token (gho_)', () => {
    const token = 'gho_' + 'c'.repeat(36);
    const result = runCredentialGuard(
      writePayload('src/auth.ts', 'const t = "' + token + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('GitHub OAuth');
  });

  it('blocks Slack token (xoxb-)', () => {
    const token = 'xoxb-' + '1234567890' + '-AbCdEfGhIjKlMnOp';
    const result = runCredentialGuard(
      writePayload('src/slack.ts', 'const t = "' + token + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Slack token');
  });

  it('blocks Slack token (xoxp-)', () => {
    const token = 'xoxp-' + '9876543210' + '-XyZaBcDeFgHiJkLm';
    const result = runCredentialGuard(
      writePayload('src/slack.ts', 'const t = "' + token + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Slack token');
  });

  it('blocks Stripe live key (sk_live_)', () => {
    const key = 'sk_live_' + 'a'.repeat(24);
    const result = runCredentialGuard(
      writePayload('src/billing.ts', 'const s = "' + key + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Stripe key');
  });

  it('blocks Stripe test key (pk_test_)', () => {
    const key = 'pk_test_' + 'b'.repeat(24);
    const result = runCredentialGuard(
      writePayload('src/billing.ts', 'const s = "' + key + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Stripe key');
  });

  it('blocks RSA private key', () => {
    const header = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
    const result = runCredentialGuard(
      writePayload('certs/key.pem', header + '\nMIIEvg...'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Private key');
  });

  it('blocks EC private key', () => {
    const header = '-----BEGIN ' + 'EC PRIVATE KEY-----';
    const result = runCredentialGuard(
      writePayload('certs/ec.pem', header + '\nMHQC...'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Private key');
  });

  it('blocks DSA private key', () => {
    const header = '-----BEGIN ' + 'DSA PRIVATE KEY-----';
    const result = runCredentialGuard(
      writePayload('certs/dsa.pem', header + '\nMIIBug...'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Private key');
  });

  it('blocks OPENSSH private key', () => {
    const header = '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----';
    const result = runCredentialGuard(
      writePayload('~/.ssh/id_ed25519', header + '\nb3BlbnN...'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Private key');
  });

  it('blocks generic private key (no prefix)', () => {
    const header = '-----BEGIN ' + 'PRIVATE KEY-----';
    const result = runCredentialGuard(
      writePayload('certs/key.pem', header + '\nMIIEvg...'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Private key');
  });

  it('blocks Atlassian API token', () => {
    const line = 'atlassian' + '_token = "' + 'A'.repeat(24) + '"';
    const result = runCredentialGuard(writePayload('src/jira.ts', line));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Atlassian API token');
  });

  it('blocks Linear API key (lin_api_)', () => {
    const key = 'lin_api_' + 'a'.repeat(40);
    const result = runCredentialGuard(
      writePayload('src/linear.ts', 'const k = "' + key + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Linear API key');
  });

  it('blocks MongoDB connection string', () => {
    const conn = 'mongodb://' + 'user:p4ss@cluster0.example.net:27017/db';
    const result = runCredentialGuard(
      writePayload('src/db.ts', 'const url = "' + conn + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Database connection string');
  });

  it('blocks PostgreSQL connection string', () => {
    const conn = 'postgres://' + 'admin:secret@db.host:5432/prod';
    const result = runCredentialGuard(
      writePayload('src/db.ts', 'const url = "' + conn + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Database connection string');
  });

  it('blocks MySQL connection string', () => {
    const conn = 'mysql://' + 'root:pass@localhost:3306/app';
    const result = runCredentialGuard(
      writePayload('src/db.ts', 'const url = "' + conn + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Database connection string');
  });

  it('blocks Redis connection string', () => {
    const conn = 'redis://' + 'default:pwd@redis.host:6379';
    const result = runCredentialGuard(
      writePayload('src/db.ts', 'const url = "' + conn + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Database connection string');
  });
});

// ─── Credential guard — allowed paths ───────────────────────────────────────

describe('credential guard — allowed paths', () => {
  const fakePat = 'ghp_' + 'z'.repeat(36);

  it.each([
    ['.clancy/.env'],
    ['.env.local'],
    ['.env.example'],
    ['.env.development'],
    ['.env.test'],
  ])('approves credential in %s', (suffix) => {
    const result = runCredentialGuard(
      writePayload(`/project/${suffix}`, 'TOKEN=' + fakePat),
    );
    expect(result.decision).toBe('approve');
  });
});

// ─── Credential guard — edge cases ──────────────────────────────────────────

describe('credential guard — edge cases', () => {
  it('still blocks credential inside a code comment', () => {
    const pat = 'ghp_' + 'd'.repeat(36);
    const content = '// This is a comment with token: ' + pat;
    const result = runCredentialGuard(writePayload('src/utils.ts', content));
    expect(result.decision).toBe('block');
  });

  it('still blocks credential in a test file path', () => {
    const pat = 'ghp_' + 'e'.repeat(36);
    const result = runCredentialGuard(
      writePayload('src/auth.test.ts', 'const t = "' + pat + '";'),
    );
    expect(result.decision).toBe('block');
  });

  it('approves short string that resembles a key but is too short', () => {
    const result = runCredentialGuard(
      writePayload('src/config.ts', 'const KEY_NAME = "my-key";'),
    );
    expect(result.decision).toBe('approve');
  });

  it('approves normal TypeScript code with no credentials', () => {
    const code = [
      'export function greet(name: string): string {',
      '  return `Hello, ${name}!`;',
      '}',
    ].join('\n');
    const result = runCredentialGuard(writePayload('src/index.ts', code));
    expect(result.decision).toBe('approve');
  });

  it('blocks credential in Edit new_string', () => {
    const key = 'sk_live_' + 'f'.repeat(24);
    const result = runCredentialGuard(
      editPayload('src/billing.ts', 'const key = "' + key + '";'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('Stripe key');
  });

  it('blocks credential in MultiEdit edits array', () => {
    const key = 'AKIA' + 'IOSFODNN7EXAMPLX';
    const result = runCredentialGuard({
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: 'src/config.ts',
        edits: [
          { old_string: 'old1', new_string: 'safe content' },
          { old_string: 'old2', new_string: 'const k = "' + key + '";' },
        ],
      },
    });
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('AWS Access Key');
  });

  it('approves non-file-writing tools (Bash)', () => {
    const result = runCredentialGuard({
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
    });
    expect(result.decision).toBe('approve');
  });

  it('approves non-file-writing tools (Read)', () => {
    const result = runCredentialGuard({
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/secrets.txt' },
    });
    expect(result.decision).toBe('approve');
  });

  it('reports multiple credential types when content has several', () => {
    const pat = 'ghp_' + 'g'.repeat(36);
    const conn = 'postgres://' + 'user:pass@host:5432/db';
    const content = 'const t = "' + pat + '";\nconst db = "' + conn + '";';
    const result = runCredentialGuard(writePayload('src/config.ts', content));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('GitHub PAT');
    expect(result.reason).toContain('Database connection string');
  });

  it('approves on malformed JSON input (fail-open)', () => {
    const result = execFileSync('node', [CREDENTIAL_GUARD, 'not-json'], {
      encoding: 'utf8',
    });
    expect(JSON.parse(result.trim()).decision).toBe('approve');
  });
});

// ─── Branch guard — all protected operations ────────────────────────────────

describe('branch guard — force push', () => {
  it('blocks git push --force', () => {
    const result = runBranchGuard(bashPayload('git push --force'));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('--force');
  });

  it('blocks git push -f', () => {
    const result = runBranchGuard(bashPayload('git push -f'));
    expect(result.decision).toBe('block');
  });

  it('allows git push --force-with-lease (safe force push)', () => {
    const result = runBranchGuard(
      bashPayload('git push --force-with-lease'),
    );
    expect(result.decision).toBe('approve');
  });

  it('blocks force push in chained commands', () => {
    const result = runBranchGuard(
      bashPayload('echo done && git push --force'),
    );
    expect(result.decision).toBe('block');
  });
});

describe('branch guard — protected branches', () => {
  it('blocks git push origin main', () => {
    const result = runBranchGuard(bashPayload('git push origin main'));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('main');
  });

  it('blocks git push origin master', () => {
    const result = runBranchGuard(bashPayload('git push origin master'));
    expect(result.decision).toBe('block');
  });

  it('blocks git push origin develop', () => {
    const result = runBranchGuard(bashPayload('git push origin develop'));
    expect(result.decision).toBe('block');
  });

  it('allows git push origin feature/TICKET-123', () => {
    const result = runBranchGuard(
      bashPayload('git push origin feature/TICKET-123'),
    );
    expect(result.decision).toBe('approve');
  });

  it('blocks git push -u origin main (flag before remote)', () => {
    const result = runBranchGuard(bashPayload('git push -u origin main'));
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('main');
  });

  it('blocks git push --set-upstream origin main', () => {
    const result = runBranchGuard(
      bashPayload('git push --set-upstream origin main'),
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('main');
  });

  it('allows git push origin main-feature (partial match, not protected)', () => {
    const result = runBranchGuard(
      bashPayload('git push origin main-feature'),
    );
    expect(result.decision).toBe('approve');
  });

  it('blocks push to custom CLANCY_BASE_BRANCH', () => {
    const result = runBranchGuard(
      bashPayload('git push origin staging'),
      { CLANCY_BASE_BRANCH: 'staging' },
    );
    expect(result.decision).toBe('block');
    expect(result.reason).toContain('staging');
  });
});

describe('branch guard — destructive operations', () => {
  it('blocks git reset --hard', () => {
    const result = runBranchGuard(bashPayload('git reset --hard'));
    expect(result.decision).toBe('block');
  });

  it('blocks git reset --hard HEAD~1', () => {
    const result = runBranchGuard(bashPayload('git reset --hard HEAD~1'));
    expect(result.decision).toBe('block');
  });

  it('blocks git clean -fd', () => {
    const result = runBranchGuard(bashPayload('git clean -fd'));
    expect(result.decision).toBe('block');
  });

  it('blocks git clean -fdx', () => {
    const result = runBranchGuard(bashPayload('git clean -fdx'));
    expect(result.decision).toBe('block');
  });

  it('blocks git checkout -- . (bulk discard)', () => {
    const result = runBranchGuard(bashPayload('git checkout -- .'));
    expect(result.decision).toBe('block');
  });

  it('blocks git restore . (bulk discard)', () => {
    const result = runBranchGuard(bashPayload('git restore .'));
    expect(result.decision).toBe('block');
  });

  it('approves git checkout . without -- (only checkout -- . is blocked)', () => {
    const result = runBranchGuard(bashPayload('git checkout .'));
    expect(result.decision).toBe('approve');
  });

  it('blocks git push origin feature/xyz --force (flag after branch)', () => {
    const result = runBranchGuard(
      bashPayload('git push origin feature/xyz --force'),
    );
    expect(result.decision).toBe('block');
  });

  it('blocks git branch -D feature/something (force delete)', () => {
    const result = runBranchGuard(
      bashPayload('git branch -D feature/something'),
    );
    expect(result.decision).toBe('block');
  });
});

describe('branch guard — allowed operations', () => {
  it('allows git commit -m "feat: something"', () => {
    const result = runBranchGuard(
      bashPayload('git commit -m "feat: something"'),
    );
    expect(result.decision).toBe('approve');
  });

  it('allows git push (no remote/branch)', () => {
    const result = runBranchGuard(bashPayload('git push'));
    expect(result.decision).toBe('approve');
  });

  it('allows git push -u origin feature/branch', () => {
    const result = runBranchGuard(
      bashPayload('git push -u origin feature/branch'),
    );
    expect(result.decision).toBe('approve');
  });

  it('allows git reset --soft', () => {
    const result = runBranchGuard(bashPayload('git reset --soft HEAD~1'));
    expect(result.decision).toBe('approve');
  });

  it('allows git clean -n (dry run)', () => {
    const result = runBranchGuard(bashPayload('git clean -n'));
    expect(result.decision).toBe('approve');
  });

  it('allows git branch -d mybranch (safe delete)', () => {
    const result = runBranchGuard(bashPayload('git branch -d mybranch'));
    expect(result.decision).toBe('approve');
  });

  it('approves non-Bash tools', () => {
    const result = runBranchGuard({
      tool_name: 'Write',
      tool_input: { content: 'git push --force' },
    });
    expect(result.decision).toBe('approve');
  });

  it('approves when CLANCY_BRANCH_GUARD=false', () => {
    const result = runBranchGuard(bashPayload('git push --force'), {
      CLANCY_BRANCH_GUARD: 'false',
    });
    expect(result.decision).toBe('approve');
  });

  it('approves on malformed JSON input (fail-open)', () => {
    const result = execFileSync('node', [BRANCH_GUARD, 'not-json'], {
      encoding: 'utf8',
    });
    expect(JSON.parse(result.trim()).decision).toBe('approve');
  });
});

// ─── Context monitor — threshold + debounce logic ───────────────────────────

const CONTEXT_MONITOR = resolve(
  __dirname,
  '../../../hooks/clancy-context-monitor.js',
);

const CTX_SESSION = `integ-ctx-${process.pid}-${Date.now()}`;
const ctxBridgePath = join(tmpdir(), `clancy-ctx-${CTX_SESSION}.json`);
const ctxWarnPath = join(tmpdir(), `clancy-ctx-${CTX_SESSION}-warned.json`);
const ctxProjectDir = join(
  tmpdir(),
  `clancy-ctx-integ-${process.pid}-${Date.now()}`,
);
const ctxLockDir = join(ctxProjectDir, '.clancy');
const ctxLockPath = join(ctxLockDir, 'lock.json');

function writeBridge(remaining: number, usedPct: number): void {
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(
    ctxBridgePath,
    JSON.stringify({ remaining_percentage: remaining, used_pct: usedPct, timestamp: now }),
  );
}

function writeLock(startedAt: string): void {
  mkdirSync(ctxLockDir, { recursive: true });
  writeFileSync(
    ctxLockPath,
    JSON.stringify({
      pid: process.pid,
      ticketKey: 'TEST-1',
      ticketTitle: 'Test ticket',
      ticketBranch: 'feature/test-1',
      targetBranch: 'main',
      parentKey: '',
      startedAt,
    }),
  );
}

function runContextMonitor(env: Record<string, string> = {}): string {
  const payload = JSON.stringify({ session_id: CTX_SESSION, cwd: ctxProjectDir });
  return execFileSync('node', [CONTEXT_MONITOR], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 5000,
  });
}

function getContextOutput(env: Record<string, string> = {}): string {
  const raw = runContextMonitor(env).trim();
  if (!raw) return '';
  const result = JSON.parse(raw) as {
    hookSpecificOutput?: { additionalContext?: string };
  };
  return result?.hookSpecificOutput?.additionalContext ?? '';
}

describe('context monitor — threshold + debounce logic', () => {
  beforeEach(() => {
    for (const p of [ctxBridgePath, ctxWarnPath, ctxLockPath]) {
      if (existsSync(p)) rmSync(p);
    }
    mkdirSync(ctxLockDir, { recursive: true });
  });

  afterEach(() => {
    for (const p of [ctxBridgePath, ctxWarnPath]) {
      if (existsSync(p)) rmSync(p);
    }
    if (existsSync(ctxProjectDir)) rmSync(ctxProjectDir, { recursive: true });
  });

  it('emits nothing when remaining is 40% (above threshold)', () => {
    writeBridge(40, 60);
    expect(getContextOutput()).toBe('');
  });

  it('emits WARNING when remaining is 35% (at threshold)', () => {
    writeBridge(35, 65);
    const ctx = getContextOutput();
    expect(ctx).toContain('CONTEXT WARNING');
    expect(ctx).toContain('65%');
  });

  it('emits CRITICAL when remaining is 25% (at threshold)', () => {
    writeBridge(25, 75);
    const ctx = getContextOutput();
    expect(ctx).toContain('CONTEXT CRITICAL');
    expect(ctx).toContain('75%');
  });

  it('debounces repeated warnings at same severity', () => {
    writeBridge(30, 70);

    // First call fires
    const ctx1 = getContextOutput();
    expect(ctx1).toContain('CONTEXT WARNING');

    // Calls 2-5 are debounced (need 5 calls to reset)
    for (let i = 0; i < 4; i++) {
      expect(getContextOutput()).toBe('');
    }

    // 6th call fires again (5 calls since last)
    const ctx6 = getContextOutput();
    expect(ctx6).toContain('CONTEXT WARNING');
  });

  it('severity escalation from WARNING to CRITICAL bypasses debounce', () => {
    writeBridge(30, 70);

    // First call — warning fires
    const ctx1 = getContextOutput();
    expect(ctx1).toContain('CONTEXT WARNING');

    // Immediately escalate to critical — should fire despite debounce
    writeBridge(20, 80);
    const ctx2 = getContextOutput();
    expect(ctx2).toContain('CONTEXT CRITICAL');
  });

  it('ignores stale bridge file (timestamp > 60s old)', () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 120; // 2 min ago
    writeFileSync(
      ctxBridgePath,
      JSON.stringify({
        remaining_percentage: 20,
        used_pct: 80,
        timestamp: staleTimestamp,
      }),
    );

    expect(getContextOutput()).toBe('');
  });

  it('exits silently when no bridge file and no lock file exist', () => {
    // Clean state — no bridge, no lock
    if (existsSync(ctxLockPath)) rmSync(ctxLockPath);
    expect(getContextOutput()).toBe('');
  });
});

// ─── Context monitor — time guard ───────────────────────────────────────────

describe('context monitor — time guard', () => {
  beforeEach(() => {
    for (const p of [ctxBridgePath, ctxWarnPath, ctxLockPath]) {
      if (existsSync(p)) rmSync(p);
    }
    mkdirSync(ctxLockDir, { recursive: true });
  });

  afterEach(() => {
    for (const p of [ctxBridgePath, ctxWarnPath]) {
      if (existsSync(p)) rmSync(p);
    }
    if (existsSync(ctxProjectDir)) rmSync(ctxProjectDir, { recursive: true });
  });

  it('emits TIME WARNING at 80% of CLANCY_TIME_LIMIT', () => {
    writeBridge(50, 50); // no context warning
    // 25 min ago with 30 min limit = 83%
    writeLock(new Date(Date.now() - 25 * 60000).toISOString());

    const ctx = getContextOutput();
    expect(ctx).toContain('TIME WARNING');
    expect(ctx).toContain('25min of 30min');
    expect(ctx).not.toContain('CONTEXT');
  });

  it('emits TIME CRITICAL at 100%+ of CLANCY_TIME_LIMIT', () => {
    writeBridge(50, 50);
    // 32 min ago with 30 min limit = 106%
    writeLock(new Date(Date.now() - 32 * 60000).toISOString());

    const ctx = getContextOutput();
    expect(ctx).toContain('TIME CRITICAL');
    expect(ctx).toContain('32min of 30min');
  });

  it('emits nothing below 80% of limit', () => {
    writeBridge(50, 50);
    // 10 min ago with 30 min limit = 33%
    writeLock(new Date(Date.now() - 10 * 60000).toISOString());

    expect(getContextOutput()).toBe('');
  });

  it('time severity escalation bypasses debounce', () => {
    writeBridge(50, 50);

    // First call at ~83% — warning fires
    writeLock(new Date(Date.now() - 25 * 60000).toISOString());
    const ctx1 = getContextOutput();
    expect(ctx1).toContain('TIME WARNING');

    // Escalate to 100%+ — should fire despite debounce
    writeLock(new Date(Date.now() - 35 * 60000).toISOString());
    const ctx2 = getContextOutput();
    expect(ctx2).toContain('TIME CRITICAL');
  });
});

// ─── PostCompact re-injection ───────────────────────────────────────────────

const POST_COMPACT = resolve(
  __dirname,
  '../../../hooks/clancy-post-compact.js',
);

function runPostCompact(payload: Record<string, unknown>): string {
  return execFileSync('node', [POST_COMPACT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
  });
}

describe('post-compact re-injection', () => {
  let pcTmpDir: string;

  beforeEach(() => {
    pcTmpDir = join(
      tmpdir(),
      `clancy-pc-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(pcTmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(pcTmpDir, { recursive: true, force: true });
  });

  it('returns additionalContext with ticket context from lock file', () => {
    const clancyDir = join(pcTmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(
      join(clancyDir, 'lock.json'),
      JSON.stringify({
        pid: process.pid,
        ticketKey: 'ENG-99',
        ticketTitle: 'Implement search feature',
        ticketBranch: 'feature/eng-99',
        targetBranch: 'main',
        parentKey: 'ENG-50',
        description: 'Build full-text search with Elasticsearch.',
        startedAt: new Date().toISOString(),
      }),
    );

    const raw = runPostCompact({ cwd: pcTmpDir });
    const output = JSON.parse(raw) as {
      hookSpecificOutput: {
        hookEventName: string;
        additionalContext: string;
      };
    };

    expect(output.hookSpecificOutput.hookEventName).toBe('PostCompact');
    expect(output.hookSpecificOutput.additionalContext).toContain(
      'CONTEXT RESTORED',
    );
    expect(output.hookSpecificOutput.additionalContext).toContain('ENG-99');
    expect(output.hookSpecificOutput.additionalContext).toContain(
      'Implement search feature',
    );
    expect(output.hookSpecificOutput.additionalContext).toContain(
      'feature/eng-99',
    );
    expect(output.hookSpecificOutput.additionalContext).toContain(
      'targeting main',
    );
    expect(output.hookSpecificOutput.additionalContext).toContain(
      'Parent: ENG-50',
    );
    expect(output.hookSpecificOutput.additionalContext).toContain(
      'Elasticsearch',
    );
    expect(output.hookSpecificOutput.additionalContext).toContain(
      'Continue your implementation',
    );
  });

  it('exits silently when no lock file exists', () => {
    const raw = runPostCompact({ cwd: pcTmpDir });
    expect(raw.trim()).toBe('');
  });

  it('exits silently when lock file is missing required fields', () => {
    const clancyDir = join(pcTmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(
      join(clancyDir, 'lock.json'),
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );

    const raw = runPostCompact({ cwd: pcTmpDir });
    expect(raw.trim()).toBe('');
  });

  it('exits silently on corrupt lock file (fail-open)', () => {
    const clancyDir = join(pcTmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(join(clancyDir, 'lock.json'), 'not valid json!!!');

    const raw = runPostCompact({ cwd: pcTmpDir });
    expect(raw.trim()).toBe('');
  });

  it('omits parent line when parentKey is empty', () => {
    const clancyDir = join(pcTmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(
      join(clancyDir, 'lock.json'),
      JSON.stringify({
        pid: process.pid,
        ticketKey: 'SOLO-1',
        ticketTitle: 'Standalone ticket',
        ticketBranch: 'feature/solo-1',
        targetBranch: 'main',
        parentKey: '',
        description: 'No parent.',
        startedAt: new Date().toISOString(),
      }),
    );

    const raw = runPostCompact({ cwd: pcTmpDir });
    const output = JSON.parse(raw) as {
      hookSpecificOutput: { additionalContext: string };
    };

    expect(output.hookSpecificOutput.additionalContext).not.toContain(
      'Parent:',
    );
    expect(output.hookSpecificOutput.additionalContext).toContain('SOLO-1');
  });

  it('truncates description to 2000 chars', () => {
    const clancyDir = join(pcTmpDir, '.clancy');
    mkdirSync(clancyDir, { recursive: true });
    writeFileSync(
      join(clancyDir, 'lock.json'),
      JSON.stringify({
        pid: process.pid,
        ticketKey: 'LONG-1',
        ticketTitle: 'Long description',
        ticketBranch: 'feature/long-1',
        targetBranch: 'main',
        parentKey: '',
        description: 'X'.repeat(3000),
        startedAt: new Date().toISOString(),
      }),
    );

    const raw = runPostCompact({ cwd: pcTmpDir });
    const output = JSON.parse(raw) as {
      hookSpecificOutput: { additionalContext: string };
    };

    const match = output.hookSpecificOutput.additionalContext.match(
      /Requirements: (X+)/,
    );
    expect(match).not.toBeNull();
    expect(match![1].length).toBe(2000);
  });
});
