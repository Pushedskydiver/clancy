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
  /** When true, enforce test-driven development (red-green-refactor). */
  tdd?: boolean;
};

const tddBlock = `
## Test-Driven Development

You MUST follow the red-green-refactor cycle for every behaviour change:

1. **Red** — Write a failing test that describes the desired behaviour.
   Run the test suite and confirm the new test fails.
2. **Green** — Write the minimum code to make the failing test pass.
   Do not add behaviour beyond what the test requires.
3. **Refactor** — Clean up the implementation while keeping all tests green.
   Look for duplication, unclear names, or unnecessary complexity.

Repeat for each behaviour. Do not write implementation code without a failing test first.
Design interfaces for testability — prefer pure functions and thin boundaries
so modules are easy to test in isolation.`;

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
export type ReworkPromptInput = {
  key: string;
  title: string;
  description: string;
  provider: BoardProvider;
  feedbackComments: string[];
  /** Git diff or git log output from the previous implementation. */
  previousContext?: string;
  /** When true, enforce test-driven development (red-green-refactor). */
  tdd?: boolean;
};

/**
 * Build the Claude prompt for reworking a ticket based on reviewer feedback.
 *
 * @param input - The rework ticket data and feedback.
 * @returns The complete rework prompt string.
 *
 * @example
 * ```ts
 * const prompt = buildReworkPrompt({
 *   key: 'PROJ-123',
 *   title: 'Add login page',
 *   description: 'Create a login page with email/password fields.',
 *   provider: 'jira',
 *   feedbackComments: ['Button colour is wrong', 'Missing validation'],
 * });
 * ```
 */
export function buildReworkPrompt(input: ReworkPromptInput): string {
  const feedbackSection =
    input.feedbackComments.length > 0
      ? input.feedbackComments.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : 'No reviewer comments found. Review the existing implementation and fix any issues.';

  const previousSection = input.previousContext
    ? `\n\n## Previous Implementation\n\n\`\`\`\n${input.previousContext}\n\`\`\``
    : '';

  return `You are fixing review feedback on [${input.key}] ${input.title}.

Description:
${input.description}

## Reviewer Feedback

${feedbackSection}${previousSection}

Address the specific feedback above. Don't re-implement unrelated areas. Focus only on what was flagged.${input.tdd ? tddBlock : ''}

Steps:
1. Read core docs in .clancy/docs/: STACK.md, ARCHITECTURE.md, CONVENTIONS.md, GIT.md, DEFINITION-OF-DONE.md, CONCERNS.md
   Also read if relevant to this ticket: INTEGRATIONS.md (external APIs/services/auth), TESTING.md (tests/specs/coverage), DESIGN-SYSTEM.md (UI/components/styles), ACCESSIBILITY.md (accessibility/ARIA/WCAG)
2. Follow the conventions in GIT.md exactly
3. Fix the issues identified in the reviewer feedback
4. Commit your work following the conventions in GIT.md
5. When done, confirm you are finished.`;
}

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
3. Append to .clancy/progress.txt: YYYY-MM-DD HH:MM | ${input.key} | {reason} | SKIPPED
4. Stop — no branches, no file changes, no git operations.

If the ${input.provider === 'github' ? 'issue' : 'ticket'} IS implementable, continue:${input.tdd ? tddBlock : ''}
1. Read core docs in .clancy/docs/: STACK.md, ARCHITECTURE.md, CONVENTIONS.md, GIT.md, DEFINITION-OF-DONE.md, CONCERNS.md
   Also read if relevant to this ticket: INTEGRATIONS.md (external APIs/services/auth), TESTING.md (tests/specs/coverage), DESIGN-SYSTEM.md (UI/components/styles), ACCESSIBILITY.md (accessibility/ARIA/WCAG)
2. Follow the conventions in GIT.md exactly
3. Implement the ${input.provider === 'github' ? 'issue' : 'ticket'} fully
4. Commit your work following the conventions in GIT.md
5. When done, confirm you are finished.`;
}
