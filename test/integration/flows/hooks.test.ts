/**
 * QA-002b-4: Credential guard and branch guard hook integration tests.
 *
 * Tests hooks via their stdin/stdout JSON contract — pipes JSON payloads to
 * the hook process and asserts on stdout JSON. Expanded coverage beyond
 * co-located unit tests: every credential pattern category, all allowed
 * paths, edge cases, and all branch guard protected operations.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
