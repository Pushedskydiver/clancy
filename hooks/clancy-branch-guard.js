#!/usr/bin/env node
// Clancy Branch Guard — PreToolUse hook.
// Blocks dangerous git operations: force push, push to protected branches,
// hard reset, clean, bulk discard, and force branch deletion.
// Best-effort — never blocks on error (fail-open).

'use strict';

// Protected branch names — pushes to these are blocked.
// CLANCY_BASE_BRANCH is added dynamically if set and not already in the list.
const PROTECTED_BRANCHES = ['main', 'master', 'develop'];
if (process.env.CLANCY_BASE_BRANCH && !PROTECTED_BRANCHES.includes(process.env.CLANCY_BASE_BRANCH)) {
  PROTECTED_BRANCHES.push(process.env.CLANCY_BASE_BRANCH);
}

/**
 * Check whether a command string contains a dangerous git operation.
 * Returns a reason string if blocked, or null if allowed.
 */
function checkCommand(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;

  // --- git push --force / -f (without --force-with-lease) ---
  // Match any occurrence of "git push" with --force or -f flag
  if (/\bgit\s+push\b/.test(cmd)) {
    const hasForceFlag = /\s--force\b/.test(cmd) || /\s-f\b/.test(cmd);
    const hasForceWithLease = /--force-with-lease\b/.test(cmd);
    if (hasForceFlag && !hasForceWithLease) {
      return 'Blocked: git push --force destroys remote history. Use --force-with-lease instead.';
    }

    // --- git push to protected branches ---
    // Pattern: git push <remote> <protected-branch>
    // We look for "git push" followed by any remote name, then a protected branch.
    // The branch must be a standalone token — \b treats hyphens as word boundaries,
    // so we match the branch as a complete whitespace-delimited token instead.
    for (const branch of PROTECTED_BRANCHES) {
      // Matches: git push origin main, git push origin main:main, etc.
      // Does NOT match: git push origin main-feature
      // Escape regex metacharacters in branch name (e.g. release/1.0 → release\/1\.0)
      const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\bgit\\s+push\\s+\\S+\\s+${escaped}(?:\\s|$|:)`);
      if (pattern.test(cmd)) {
        return `Blocked: direct push to protected branch '${branch}'. Create a PR instead.`;
      }
    }
  }

  // --- git reset --hard ---
  if (/\bgit\s+reset\s+--hard\b/.test(cmd)) {
    return 'Blocked: git reset --hard destroys uncommitted work. Use --soft or --mixed instead.';
  }

  // --- git clean -f (any variant with -f but not just -n) ---
  // Block git clean with -f flag (e.g. -f, -fd, -fdx, -xfd, etc.) but allow -n (dry run)
  if (/\bgit\s+clean\b/.test(cmd)) {
    // Check for -f flag in the clean arguments
    // Match short flags like -f, -fd, -fdx, -xf, etc.
    const cleanMatch = cmd.match(/\bgit\s+clean\s+(.*)/);
    if (cleanMatch) {
      const args = cleanMatch[1];
      // Check for -f in combined short flags or standalone
      if (/(?:^|\s)-[a-zA-Z]*f/.test(args) && !/(?:^|\s)-n\b/.test(args)) {
        return 'Blocked: git clean -f deletes untracked files permanently. Use -n for a dry run first.';
      }
    }
  }

  // --- git checkout -- . (discard all changes) ---
  if (/\bgit\s+checkout\s+--\s+\./.test(cmd)) {
    return 'Blocked: git checkout -- . discards all uncommitted changes.';
  }

  // --- git restore . (discard all changes) ---
  // Only block bare "git restore ." (all files), not "git restore ./specific-file"
  if (/\bgit\s+restore\s+\.(?:\s*$|\s*[;&|])/.test(cmd)) {
    return 'Blocked: git restore . discards all uncommitted changes.';
  }

  // --- git branch -D (force delete) ---
  // Block uppercase -D only, not lowercase -d
  if (/\bgit\s+branch\s+.*-D\b/.test(cmd)) {
    return 'Blocked: git branch -D force-deletes a branch irrecoverably. Use -d for safe deletion.';
  }

  return null;
}

// Read hook input — Claude Code passes PreToolUse data as a JSON argument.
// Fall back to stdin for forward compatibility with potential API changes.
function readInput() {
  if (process.argv[2]) return process.argv[2];
  try { return require('fs').readFileSync('/dev/stdin', 'utf8'); } catch { return '{}'; }
}

try {
  // Check if guard is disabled
  if (process.env.CLANCY_BRANCH_GUARD === 'false') {
    console.log(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  const input = JSON.parse(readInput());
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  // Only check Bash tool calls
  if (toolName !== 'Bash') {
    console.log(JSON.stringify({ decision: 'approve' }));
    process.exit(0);
  }

  const cmd = (toolInput.command || '').trim();
  const reason = checkCommand(cmd);

  if (reason) {
    console.log(JSON.stringify({ decision: 'block', reason }));
  } else {
    console.log(JSON.stringify({ decision: 'approve' }));
  }
} catch {
  // Best-effort — never block on error
  console.log(JSON.stringify({ decision: 'approve' }));
}

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = { checkCommand };
}
