/**
 * Claude prompt builder for ticket implementation.
 *
 * Generates the full prompt string piped to `claude --dangerously-skip-permissions`.
 * The prompt structure matches the original shell scripts exactly.
 */
import type { BoardProvider } from '~/types/index.js';

type PromptInput = {
  provider: BoardProvider;
  key: string;
  title: string;
  description: string;
  /** Epic/milestone/parent info string (e.g., `'PROJ-100'`, `'Sprint 3'`, `'none'`). */
  parentInfo: string;
  /** Blocker info string (e.g., `'Blocked by: PROJ-99, PROJ-98'` or `'None'`). */
  blockers?: string;
};

/**
 * Get the board-specific label for the ticket type.
 *
 * @param provider - The board provider.
 * @returns The label used in prompts (e.g., `'Jira ticket'`, `'GitHub Issue'`).
 */
function ticketLabel(provider: BoardProvider): string {
  switch (provider) {
    case 'jira':
      return 'Jira ticket';
    case 'github':
      return 'GitHub Issue';
    case 'linear':
      return 'Linear issue';
  }
}

/**
 * Get the board-specific label for the parent grouping.
 *
 * @param provider - The board provider.
 * @returns The label (e.g., `'Epic'`, `'Milestone'`).
 */
function parentLabel(provider: BoardProvider): string {
  return provider === 'github' ? 'Milestone' : 'Epic';
}

/**
 * Build the full Claude prompt for implementing a ticket.
 *
 * @param input - The ticket data for the prompt.
 * @returns The complete prompt string.
 *
 * @example
 * ```ts
 * const prompt = buildPrompt({
 *   provider: 'jira',
 *   key: 'PROJ-123',
 *   title: 'Add login page',
 *   description: 'Create a login page with email/password fields.',
 *   parentInfo: 'PROJ-100',
 *   blockers: 'None',
 * });
 * ```
 */
export function buildPrompt(input: PromptInput): string {
  const label = ticketLabel(input.provider);
  const pLabel = parentLabel(input.provider);
  const blockerLine =
    input.blockers && input.provider !== 'github'
      ? `\nBlockers: ${input.blockers}`
      : '';

  return `You are implementing ${label} ${input.key}.

${input.provider === 'github' ? 'Title' : 'Summary'}: ${input.title}
${pLabel}: ${input.parentInfo}${blockerLine}

Description:
${input.description}

Step 0 — Executability check (do this before any git or file operation):
Read the ${input.provider === 'github' ? 'issue title and description' : 'ticket summary and description'} above. Can this ${input.provider === 'github' ? 'issue' : 'ticket'} be implemented entirely
as a code change committed to this repo? Consult the 'Executability check' section of
CLAUDE.md for the full list of skip conditions.

If you must SKIP this ${input.provider === 'github' ? 'issue' : 'ticket'}:
1. Output: ⚠ Skipping [${input.key}]: {one-line reason}
2. Output: Ticket skipped — update it to be codebase-only work, then re-run.
3. Append to .clancy/progress.txt: YYYY-MM-DD HH:MM | ${input.key} | SKIPPED | {reason}
4. Stop — no branches, no file changes, no git operations.

If the ${input.provider === 'github' ? 'issue' : 'ticket'} IS implementable, continue:
1. Read core docs in .clancy/docs/: STACK.md, ARCHITECTURE.md, CONVENTIONS.md, GIT.md, DEFINITION-OF-DONE.md, CONCERNS.md
   Also read if relevant to this ticket: INTEGRATIONS.md (external APIs/services/auth), TESTING.md (tests/specs/coverage), DESIGN-SYSTEM.md (UI/components/styles), ACCESSIBILITY.md (accessibility/ARIA/WCAG)
2. Follow the conventions in GIT.md exactly
3. Implement the ${input.provider === 'github' ? 'issue' : 'ticket'} fully
4. Commit your work following the conventions in GIT.md
5. When done, confirm you are finished.`;
}
