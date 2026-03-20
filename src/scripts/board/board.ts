/**
 * Board type abstraction.
 *
 * Defines the standardised interface that all board implementations must
 * conform to. Each board is a plain object (no classes) returned by a
 * factory function.
 */
import type { FetchedTicket } from '~/types/board.js';

/** Options for ticket fetching behaviour. */
export type FetchTicketOpts = {
  /** If `true`, excludes tickets with the `clancy:hitl` label. */
  excludeHitl?: boolean;
};

/** Standardised board abstraction. */
export type Board = {
  ping(): Promise<{ ok: boolean; error?: string }>;
  validateInputs(): string | undefined;
  fetchTicket(opts: FetchTicketOpts): Promise<FetchedTicket | undefined>;
  fetchTickets(opts: FetchTicketOpts): Promise<FetchedTicket[]>;
  fetchBlockerStatus(ticket: FetchedTicket): Promise<boolean>;
  fetchChildrenStatus(
    parentKey: string,
    parentId?: string,
  ): Promise<{ total: number; incomplete: number } | undefined>;
  transitionTicket(ticket: FetchedTicket, status: string): Promise<boolean>;
  ensureLabel(label: string): Promise<void>;
  addLabel(issueKey: string, label: string): Promise<void>;
  removeLabel(issueKey: string, label: string): Promise<void>;
  sharedEnv(): Record<string, string | undefined>;
};
