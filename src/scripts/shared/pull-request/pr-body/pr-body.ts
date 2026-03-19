/**
 * PR/MR body builder.
 *
 * Constructs the pull request description with a link back to the
 * board ticket and a Clancy footer.
 */
import type { ProgressEntry } from '~/scripts/shared/progress/progress.js';
import type { BoardConfig, Ticket } from '~/types/index.js';

/**
 * Check whether a target branch is an epic or milestone branch.
 *
 * @param targetBranch - The branch the PR targets.
 * @returns `true` if it's an epic (`epic/`) or milestone (`milestone/`) branch.
 */
export function isEpicBranch(targetBranch: string): boolean {
  return (
    targetBranch.startsWith('epic/') || targetBranch.startsWith('milestone/')
  );
}

/**
 * Build the PR/MR body for a ticket.
 *
 * Includes a link back to the board ticket (auto-close for GitHub Issues
 * when targeting the base branch, or "Part of" when targeting an epic branch)
 * and a Clancy attribution footer.
 *
 * @param config - The board configuration.
 * @param ticket - The ticket being implemented.
 * @param targetBranch - The branch the PR targets (used to determine `Closes` vs `Part of`).
 * @param verificationWarning - Optional warning text when verification checks failed after max retries. Included as a `## Verification Warning` section before the footer.
 * @returns The PR body as a markdown string.
 */
export function buildPrBody(
  config: BoardConfig,
  ticket: Ticket,
  targetBranch?: string,
  verificationWarning?: string,
): string {
  const lines: string[] = [];
  const isEpic = targetBranch ? isEpicBranch(targetBranch) : false;

  switch (config.provider) {
    case 'github':
      lines.push(isEpic ? `Part of ${ticket.key}` : `Closes ${ticket.key}`);
      break;
    case 'jira':
      lines.push(
        `**Jira:** [${ticket.key}](${config.env.JIRA_BASE_URL}/browse/${ticket.key})`,
      );
      break;
    case 'linear':
      lines.push(`**Linear:** ${ticket.key}`);
      break;
  }

  lines.push('');

  if (ticket.description) {
    lines.push('## Description');
    lines.push('');
    lines.push(ticket.description);
    lines.push('');
  }

  if (verificationWarning) {
    lines.push('## ⚠ Verification Warning');
    lines.push('');
    lines.push(verificationWarning);
    lines.push('');
    lines.push('This PR may need manual fixes before merging.');
    lines.push('');
  }

  lines.push('---');
  lines.push('*Created by [Clancy](https://github.com/Pushedskydiver/clancy)*');
  lines.push('');
  lines.push('---');
  lines.push('<details>');
  lines.push(
    '<summary><strong>Rework instructions</strong> (click to expand)</summary>',
  );
  lines.push('');
  lines.push('To request changes:');
  lines.push(
    '- **Code comments** — leave inline comments on specific lines. These are always picked up automatically.',
  );
  lines.push(
    '- **General feedback** — reply with a comment starting with `Rework:` followed by what needs fixing. Comments without the `Rework:` prefix are treated as discussion.',
  );
  lines.push('');
  lines.push(
    "Example: `Rework: The form validation doesn't handle empty passwords`",
  );
  lines.push('');
  lines.push('</details>');

  return lines.join('\n');
}

/**
 * Build the PR body for the final epic PR (epic branch → base branch).
 *
 * Lists all child tickets with their PR numbers for traceability.
 *
 * @param epicKey - The epic ticket key (e.g., `'PROJ-100'`).
 * @param epicTitle - The epic ticket title.
 * @param childEntries - Progress entries for child tickets (with `prNumber`).
 * @returns The epic PR body as a markdown string.
 */
export function buildEpicPrBody(
  epicKey: string,
  epicTitle: string,
  childEntries: ProgressEntry[],
): string {
  const lines: string[] = [];

  lines.push(`## ${epicKey} — ${epicTitle}`);
  lines.push('');
  lines.push('### Children');
  lines.push('');

  for (const entry of childEntries) {
    const prRef = entry.prNumber ? ` (#${entry.prNumber})` : '';
    lines.push(`- ${entry.key} — ${entry.summary}${prRef}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('*Created by [Clancy](https://github.com/Pushedskydiver/clancy)*');

  return lines.join('\n');
}
