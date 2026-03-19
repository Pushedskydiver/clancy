/**
 * RunContext — shared state threaded through all orchestrator phases.
 *
 * Each phase reads from and mutates this context. Fields are populated
 * progressively — phases that depend on prior state assert required
 * fields at the top (a missing field means a pipeline ordering bug).
 */
import type { BoardConfig } from '~/schemas/env.js';
import type { FetchedTicket } from '~/scripts/once/types/types.js';

// Phase function: mutates context, returns true to continue or false to exit.
export type Phase = (ctx: RunContext) => Promise<boolean> | boolean;

export type RunContext = {
  // Fixed at creation
  argv: string[];
  dryRun: boolean;
  skipFeasibility: boolean;
  startTime: number;
  cwd: string;
  isAfk: boolean;

  // Populated by preflight phase
  config?: BoardConfig;

  // Populated by rework/ticket-fetch phases
  ticket?: FetchedTicket;
  isRework?: boolean;
  prFeedback?: string[];
  reworkPrNumber?: number;
  reworkDiscussionIds?: string[];
  reworkReviewers?: string[];

  // Populated by branch-setup phase
  ticketBranch?: string;
  targetBranch?: string;
  effectiveTarget?: string;
  baseBranch?: string;
  originalBranch?: string;
  skipEpicBranch?: boolean;
  hasParent?: boolean;

  // Populated by lock-write phase
  lockOwner?: boolean;
};

/** Create the initial RunContext from process arguments. */
export function createContext(argv: string[]): RunContext {
  return {
    argv,
    dryRun: argv.includes('--dry-run'),
    skipFeasibility: argv.includes('--skip-feasibility'),
    startTime: Date.now(),
    cwd: process.cwd(),
    isAfk: process.env.CLANCY_AFK_MODE === '1',
  };
}
