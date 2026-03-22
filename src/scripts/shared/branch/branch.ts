/**
 * Branch name computation for ticket workflows.
 *
 * Pure functions that compute feature and target branch names
 * based on the board provider and ticket metadata.
 */
import type { BoardProvider } from '~/types/index.js';

/**
 * Compute the feature branch name for a ticket.
 *
 * - Jira/Linear: `feature/{key-lowercase}` (e.g., `feature/proj-123`)
 * - GitHub: `feature/issue-{number}` (e.g., `feature/issue-42`)
 *
 * @param provider - The board provider.
 * @param key - The ticket key (e.g., `'PROJ-123'`, `'#42'`, `'ENG-123'`).
 * @returns The feature branch name.
 *
 * @example
 * ```ts
 * computeTicketBranch('jira', 'PROJ-123');   // 'feature/proj-123'
 * computeTicketBranch('github', '#42');       // 'feature/issue-42'
 * computeTicketBranch('linear', 'ENG-123');   // 'feature/eng-123'
 * ```
 */
export function computeTicketBranch(
  provider: BoardProvider,
  key: string,
): string {
  if (provider === 'github') {
    const number = key.replace('#', '');
    return `feature/issue-${number}`;
  }

  return `feature/${key.toLowerCase()}`;
}

/**
 * Compute the target branch for merging.
 *
 * If the ticket has a parent (epic/milestone), branches from that parent's
 * branch. Otherwise falls back to the base branch.
 *
 * - Jira: epic key → `epic/{key-lowercase}`
 * - GitHub issue ref (`#N`): `epic/{number}` (parent issue, not a milestone)
 * - GitHub milestone title: `milestone/{slug}`
 * - Linear: parent identifier → `epic/{id-lowercase}`
 *
 * @param provider - The board provider.
 * @param baseBranch - The default base branch (e.g., `'main'`).
 * @param parent - Optional parent identifier (epic key, milestone title, parent ID).
 * @returns The target branch name.
 *
 * @example
 * ```ts
 * computeTargetBranch('jira', 'main', 'PROJ-100');       // 'epic/proj-100'
 * computeTargetBranch('github', 'main', '#44');           // 'epic/44'
 * computeTargetBranch('github', 'main', 'Sprint 3');     // 'milestone/sprint-3'
 * computeTargetBranch('linear', 'main', 'ENG-50');       // 'epic/eng-50'
 * computeTargetBranch('jira', 'main');                   // 'main'
 * ```
 */
export function computeTargetBranch(
  provider: BoardProvider,
  baseBranch: string,
  parent?: string,
): string {
  if (!parent) return baseBranch;

  if (provider === 'github') {
    // Issue refs (#N) from Epic:/Parent: conventions use epic/ prefix.
    // Milestone titles (e.g. "Sprint 3") use milestone/ prefix.
    const issueRefMatch = parent.match(/^#(\d+)$/);
    if (issueRefMatch) {
      return `epic/${issueRefMatch[1]}`;
    }
    const slug = parent
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    return `milestone/${slug}`;
  }

  // Jira and Linear both use epic/ prefix
  return `epic/${parent.toLowerCase()}`;
}
