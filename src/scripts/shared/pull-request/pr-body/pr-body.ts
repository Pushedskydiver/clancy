/**
 * PR/MR body builder.
 *
 * Constructs the pull request description with a link back to the
 * board ticket and a Clancy footer.
 */
import type { BoardConfig, Ticket } from '~/types/index.js';

/**
 * Build the PR/MR body for a ticket.
 *
 * Includes a link back to the board ticket (auto-close for GitHub Issues)
 * and a Clancy attribution footer.
 *
 * @param config - The board configuration.
 * @param ticket - The ticket being implemented.
 * @returns The PR body as a markdown string.
 */
export function buildPrBody(config: BoardConfig, ticket: Ticket): string {
  const lines: string[] = [];

  switch (config.provider) {
    case 'github':
      lines.push(`Closes ${ticket.key}`);
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

  lines.push('---');
  lines.push('*Created by [Clancy](https://github.com/Pushedskydiver/clancy)*');

  return lines.join('\n');
}
