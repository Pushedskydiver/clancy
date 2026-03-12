/**
 * Lightweight feasibility check — evaluates whether a ticket can be
 * implemented as pure code changes before creating branches or
 * transitioning board status.
 *
 * Uses `claude -p` (print mode) for a fast, single-prompt evaluation.
 * Fails open: if Claude is unavailable or output is malformed the
 * ticket is assumed feasible so work is never silently blocked.
 */
import { invokeClaudePrint } from '~/scripts/shared/claude-cli/claude-cli.js';

export type FeasibilityResult = {
  feasible: boolean;
  reason?: string;
};

/**
 * Build the feasibility evaluation prompt.
 */
export function buildFeasibilityPrompt(ticket: {
  key: string;
  title: string;
  description: string;
}): string {
  return [
    'You are evaluating whether a ticket can be implemented as pure code changes in a repository.',
    '',
    `Ticket: [${ticket.key}] ${ticket.title}`,
    'Description:',
    ticket.description,
    '',
    'Can this ticket be completed entirely through code changes committed to a git repository?',
    '',
    'Answer INFEASIBLE if the ticket requires ANY of:',
    '- Manual testing or configuration in external tools or admin panels',
    '- Access to external services, APIs, or platforms not available in the codebase',
    '- Physical, hardware, or infrastructure changes',
    '- Design assets that do not yet exist',
    '- Deployment or infrastructure changes outside the repository',
    '- Human judgment calls that require stakeholder input',
    '',
    'Answer with exactly one line in this format:',
    'FEASIBLE',
    'or',
    'INFEASIBLE: one-line reason',
    '',
    'Do not include any other text.',
  ].join('\n');
}

/**
 * Parse the raw Claude output into a feasibility result.
 *
 * Fails open — malformed or empty output is treated as feasible.
 */
export function parseFeasibilityResponse(stdout: string): FeasibilityResult {
  const line = stdout.trim().split('\n').pop()?.trim() ?? '';

  if (/^INFEASIBLE/i.test(line)) {
    const reason = line.replace(/^INFEASIBLE:?\s*/i, '').trim() || undefined;
    return { feasible: false, reason };
  }

  // Fail open — FEASIBLE, empty, or malformed output all pass
  return { feasible: true };
}

/**
 * Run a feasibility check for a ticket.
 *
 * @returns A result indicating whether the ticket is feasible and an
 *   optional reason if not.
 */
export function checkFeasibility(
  ticket: { key: string; title: string; description: string },
  model?: string,
): FeasibilityResult {
  const prompt = buildFeasibilityPrompt(ticket);
  const { stdout, ok } = invokeClaudePrint(prompt, model);

  // Fail open — if Claude failed to run, assume feasible
  if (!ok) return { feasible: true };

  return parseFeasibilityResponse(stdout);
}
