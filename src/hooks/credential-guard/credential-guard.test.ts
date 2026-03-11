import { describe, expect, it } from 'vitest';

import {
  isAllowedPath,
  runCredentialGuard,
  scanForCredentials,
} from './credential-guard.js';

// Build fake credential values at runtime to avoid triggering
// GitHub push protection's secret scanner on the test file itself.
const fakeCred = (prefix: string, suffix: string): string =>
  `${prefix}${suffix}`;

const ghp = fakeCred('ghp_', 'AAAAABBBBBCCCCCDDDDDEEEEEFFFFF123456');
const skLive = fakeCred('sk_live', '_AAAAABBBBBCCCCCDDDDDEEEEE');
const pkTest = fakeCred('pk_test', '_AAAAABBBBBCCCCCDDDDDEEEEE');
const slack = fakeCred('xoxb-0000000000', '-AAAAABBBBBCCCCC');
const linApi = fakeCred(
  'lin_api_',
  'AAAAABBBBBCCCCCDDDDDEEEEEFFFFF0123456789',
);

describe('credential-guard', () => {
  describe('isAllowedPath', () => {
    it('allows .clancy/.env', () => {
      expect(isAllowedPath('/project/.clancy/.env')).toBe(true);
    });

    it('allows .env.example', () => {
      expect(isAllowedPath('/project/.env.example')).toBe(true);
    });

    it('allows .env.local', () => {
      expect(isAllowedPath('/project/.env.local')).toBe(true);
    });

    it('allows .env.development', () => {
      expect(isAllowedPath('/project/.env.development')).toBe(true);
    });

    it('allows .env.test', () => {
      expect(isAllowedPath('/project/.env.test')).toBe(true);
    });

    it('rejects regular source files', () => {
      expect(isAllowedPath('src/config.js')).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isAllowedPath(undefined)).toBe(false);
    });
  });

  describe('scanForCredentials', () => {
    it('returns empty array for clean content', () => {
      expect(scanForCredentials('const x = 42;')).toEqual([]);
    });

    it('returns empty array for undefined', () => {
      expect(scanForCredentials(undefined)).toEqual([]);
    });

    it('detects GitHub PAT (classic)', () => {
      const result = scanForCredentials(`const token = ${ghp};`);
      expect(result).toContain('GitHub PAT (classic)');
    });

    it('detects AWS Access Key', () => {
      const result = scanForCredentials(
        'const key = AKIAIOSFODNN7EXAMPLE;',
      );
      expect(result).toContain('AWS Access Key');
    });

    it('detects AWS Secret Key', () => {
      const result = scanForCredentials(
        'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY1234',
      );
      expect(result).toContain('AWS Secret Key');
    });

    it('detects Stripe secret key', () => {
      const result = scanForCredentials(`const key = ${skLive};`);
      expect(result).toContain('Stripe key');
    });

    it('detects Stripe publishable key', () => {
      const result = scanForCredentials(`const key = ${pkTest};`);
      expect(result).toContain('Stripe key');
    });

    it('detects Slack token', () => {
      const result = scanForCredentials(`const token = ${slack};`);
      expect(result).toContain('Slack token');
    });

    it('detects RSA private key', () => {
      const result = scanForCredentials(
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...',
      );
      expect(result).toContain('Private key');
    });

    it('detects generic private key', () => {
      const result = scanForCredentials(
        '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADA...',
      );
      expect(result).toContain('Private key');
    });

    it('detects MongoDB connection string', () => {
      const result = scanForCredentials(
        'const url = "mongodb://admin:secretpassword@localhost:27017/mydb";',
      );
      expect(result).toContain('Database connection string');
    });

    it('detects Postgres connection string', () => {
      const result = scanForCredentials(
        'const url = "postgres://user:pass1234@db.example.com:5432/prod";',
      );
      expect(result).toContain('Database connection string');
    });

    it('detects generic API key', () => {
      const result = scanForCredentials(
        'api_key = "sk-proj-abcdefghijklmnopqrst"',
      );
      expect(result).toContain('Generic API key');
    });

    it('detects generic auth token', () => {
      const result = scanForCredentials(
        'auth_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abcdef"',
      );
      expect(result).toContain('Generic token');
    });

    it('detects Linear API key', () => {
      const result = scanForCredentials(`const key = ${linApi};`);
      expect(result).toContain('Linear API key');
    });
  });

  describe('runCredentialGuard', () => {
    // Non-file-writing tools
    it('approves Read tool', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Read',
          tool_input: { file_path: 'src/config.js' },
        }),
      );
      expect(result.decision).toBe('approve');
    });

    it('approves Bash tool', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
        }),
      );
      expect(result.decision).toBe('approve');
    });

    it('approves Glob tool', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Glob',
          tool_input: { pattern: '**/*.js' },
        }),
      );
      expect(result.decision).toBe('approve');
    });

    // Allowed paths
    it('approves credential in .clancy/.env', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Write',
          tool_input: {
            file_path: '/project/.clancy/.env',
            content: `GITHUB_TOKEN=${ghp}`,
          },
        }),
      );
      expect(result.decision).toBe('approve');
    });

    it('approves credential in .env.example', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Write',
          tool_input: {
            file_path: '/project/.env.example',
            content: `GITHUB_TOKEN=${ghp}`,
          },
        }),
      );
      expect(result.decision).toBe('approve');
    });

    // Clean content
    it('approves clean Write', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Write',
          tool_input: {
            file_path: 'src/app.js',
            content: 'const x = 42;\nconsole.log(x);',
          },
        }),
      );
      expect(result.decision).toBe('approve');
    });

    it('approves clean Edit', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Edit',
          tool_input: {
            file_path: 'src/app.js',
            new_string: 'function hello() { return true; }',
          },
        }),
      );
      expect(result.decision).toBe('approve');
    });

    // Credential detection — Write
    it('blocks Write with GitHub PAT', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Write',
          tool_input: {
            file_path: 'src/config.js',
            content: `const token = ${ghp};`,
          },
        }),
      );
      expect(result.decision).toBe('block');
    });

    it('blocks Write with AWS Access Key', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Write',
          tool_input: {
            file_path: 'src/config.js',
            content: 'const key = AKIAIOSFODNN7EXAMPLE;',
          },
        }),
      );
      expect(result.decision).toBe('block');
    });

    // Credential detection — Edit
    it('blocks Edit with GitHub PAT', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Edit',
          tool_input: {
            file_path: 'src/config.js',
            new_string: `const token = ${ghp};`,
          },
        }),
      );
      expect(result.decision).toBe('block');
    });

    // Credential detection — MultiEdit
    it('blocks MultiEdit with AWS key', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'MultiEdit',
          tool_input: {
            file_path: 'src/config.js',
            edits: [
              { new_string: 'const x = 1;' },
              { new_string: 'const key = AKIAIOSFODNN7EXAMPLE;' },
            ],
          },
        }),
      );
      expect(result.decision).toBe('block');
    });

    // Block reason content
    it('includes file path in block reason', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Write',
          tool_input: {
            file_path: 'src/config.js',
            content: `const token = ${ghp};`,
          },
        }),
      );
      expect(result.reason).toContain('src/config.js');
    });

    it('includes credential type in block reason', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Write',
          tool_input: {
            file_path: 'src/config.js',
            content: `const token = ${ghp};`,
          },
        }),
      );
      expect(result.reason).toContain('GitHub PAT');
    });

    // Error resilience
    it('approves empty input', () => {
      expect(runCredentialGuard('{}')).toEqual({ decision: 'approve' });
    });

    it('approves empty string', () => {
      expect(runCredentialGuard('')).toEqual({ decision: 'approve' });
    });

    it('approves invalid JSON', () => {
      expect(runCredentialGuard('not json')).toEqual({ decision: 'approve' });
    });

    it('approves missing file_path', () => {
      const result = runCredentialGuard(
        JSON.stringify({ tool_name: 'Write', tool_input: {} }),
      );
      expect(result.decision).toBe('approve');
    });

    it('approves missing content', () => {
      const result = runCredentialGuard(
        JSON.stringify({
          tool_name: 'Write',
          tool_input: { file_path: 'src/app.js' },
        }),
      );
      expect(result.decision).toBe('approve');
    });
  });
});
