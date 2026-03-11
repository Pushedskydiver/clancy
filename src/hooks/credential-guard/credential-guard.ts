/**
 * Clancy Credential Guard — PreToolUse hook.
 *
 * Scans file content being written or edited for credential patterns
 * (API keys, tokens, passwords, private keys) and blocks the operation
 * if a match is found. Best-effort — never fails the tool call on error.
 */

import type { HookResponse, HookToolInput } from '~/types/index.js';

import { parseJson } from '~/utils/parse-json/parse-json.js';

type CredentialPattern = {
  name: string;
  pattern: RegExp;
};

const CREDENTIAL_PATTERNS: CredentialPattern[] = [
  // Generic API keys and tokens
  {
    name: 'Generic API key',
    pattern:
      /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{20,}["']?/i,
  },
  {
    name: 'Generic secret',
    pattern:
      /(?:secret|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{20,}["']?/i,
  },
  {
    name: 'Generic token',
    pattern:
      /(?:auth[_-]?token|access[_-]?token|bearer)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{20,}["']?/i,
  },
  {
    name: 'Generic password',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}["']?/i,
  },

  // AWS
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'AWS Secret Key',
    pattern:
      /(?:aws_secret_access_key|aws_secret)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}["']?/i,
  },

  // GitHub
  { name: 'GitHub PAT (classic)', pattern: /ghp_[A-Za-z0-9]{36}/ },
  {
    name: 'GitHub PAT (fine-grained)',
    pattern: /github_pat_[A-Za-z0-9_]{82}/,
  },
  { name: 'GitHub OAuth token', pattern: /gho_[A-Za-z0-9]{36}/ },

  // Slack
  { name: 'Slack token', pattern: /xox[bpors]-[0-9]{10,}-[A-Za-z0-9-]+/ },

  // Stripe
  { name: 'Stripe key', pattern: /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}/ },

  // Private keys
  {
    name: 'Private key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },

  // Jira/Atlassian API tokens
  {
    name: 'Atlassian API token',
    pattern:
      /(?:jira_api_token|atlassian[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9+/=]{24,}["']?/i,
  },

  // Linear API key
  { name: 'Linear API key', pattern: /lin_api_[A-Za-z0-9]{40,}/ },

  // Generic connection strings
  {
    name: 'Database connection string',
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+:[^\s"']+@/i,
  },
];

/** Files that are expected to contain credentials — skip scanning. */
const ALLOWED_PATHS = [
  '.clancy/.env',
  '.env.local',
  '.env.example',
  '.env.development',
  '.env.test',
];

/**
 * Check whether a file path is in the allowlist.
 *
 * @param filePath - The file path to check against allowed credential paths.
 * @returns `true` if the path is allowlisted, `false` otherwise.
 *
 * @example
 * ```ts
 * isAllowedPath('/project/.clancy/.env');    // true
 * isAllowedPath('/project/.env.local');      // true
 * isAllowedPath('src/config.ts');            // false
 * ```
 */
export function isAllowedPath(filePath: string | undefined): boolean {
  if (!filePath) return false;
  return ALLOWED_PATHS.some((allowed) => filePath.endsWith(allowed));
}

/**
 * Scan content for credential patterns and return matched names.
 *
 * @param content - The string content to scan for credentials.
 * @returns An array of matched credential pattern names (empty if none found).
 *
 * @example
 * ```ts
 * scanForCredentials('const key = AKIAIOSFODNN7EXAMPLE;');
 * // ['AWS Access Key']
 *
 * scanForCredentials('const x = 42;');
 * // []
 * ```
 */
export function scanForCredentials(content: string | undefined): string[] {
  if (!content || typeof content !== 'string') return [];

  const matches: string[] = [];

  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    if (pattern.test(content)) {
      matches.push(name);
    }
  }

  return matches;
}

/**
 * Extract the content to scan from a tool input based on tool type.
 *
 * @param toolName - The Claude Code tool name (Write, Edit, or MultiEdit).
 * @param toolInput - The tool's input parameters containing file content.
 * @returns The concatenated content string to scan.
 */
function extractContent(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Write') {
    return (toolInput.content as string) ?? '';
  }

  if (toolName === 'Edit') {
    return (toolInput.new_string as string) ?? '';
  }

  if (toolName === 'MultiEdit') {
    const edits = (toolInput.edits as Array<{ new_string?: string }>) ?? [];
    return edits.map((e) => e.new_string ?? '').join('\n');
  }

  return '';
}

/**
 * Run the credential guard check and return a hook response.
 *
 * @param raw - Raw JSON string from `process.argv[2]` containing tool name and input.
 * @returns A hook response with `approve` or `block` decision.
 *
 * @example
 * ```ts
 * const result = runCredentialGuard(JSON.stringify({
 *   tool_name: 'Write',
 *   tool_input: { file_path: 'src/config.ts', content: 'const x = 42;' },
 * }));
 * // { decision: 'approve' }
 * ```
 */
export function runCredentialGuard(raw: string): HookResponse {
  const input = parseJson<HookToolInput>(raw);

  if (!input) return { decision: 'approve' };

  const toolName = input.tool_name ?? '';
  const toolInput = input.tool_input ?? {};

  // Only check file-writing tools
  if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
    return { decision: 'approve' };
  }

  const filePath = toolInput.file_path as string | undefined;

  // Skip files that are expected to contain credentials
  if (isAllowedPath(filePath)) {
    return { decision: 'approve' };
  }

  const contentToScan = extractContent(toolName, toolInput);
  const found = scanForCredentials(contentToScan);

  if (found.length > 0) {
    return {
      decision: 'block',
      reason: `Credential guard: blocked writing to ${filePath}. Detected: ${found.join(', ')}. Move credentials to .clancy/.env instead.`,
    };
  }

  return { decision: 'approve' };
}

// ── CLI entry point ──────────────────────────────────────────────────────────
// When run directly: node credential-guard.js '<json>'

const isDirectRun = process.argv[1]?.includes('credential-guard');

if (isDirectRun) {
  try {
    const result = runCredentialGuard(process.argv[2] ?? '{}');
    console.log(JSON.stringify(result));
  } catch {
    // Best-effort — never block on error
    console.log(JSON.stringify({ decision: 'approve' }));
  }
}
