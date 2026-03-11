/**
 * Hook input/output types for Claude Code hook system.
 *
 * @see https://docs.anthropic.com/en/docs/claude-code/hooks
 */

/** Tool input provided to PreToolUse hooks. */
export type HookToolInput = {
  tool_name: string;
  tool_input: Record<string, unknown>;
};

/** Decision a hook can return. */
export type HookDecision = 'approve' | 'block' | 'ignore';

/** Standard hook response written to stdout. */
export type HookResponse = {
  decision: HookDecision;
  reason?: string;
};
