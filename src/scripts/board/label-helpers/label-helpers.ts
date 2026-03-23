/**
 * Shared label CRUD helpers for board wrappers.
 *
 * Boards with a read-modify-write pattern for labels (Jira, Shortcut,
 * Notion, Azure DevOps) can use `modifyLabelList` to eliminate the
 * duplicated fetch → check → write boilerplate. All label operations
 * wrap in `safeLabel` for consistent error handling.
 */

/**
 * Wrap a label operation in try-catch with a warning on failure.
 *
 * Label operations are best-effort — they should never crash the run.
 *
 * @param fn - The async label operation to execute.
 * @param operation - Human-readable name for error messages (e.g., `'addLabel'`).
 */
export async function safeLabel(
  fn: () => Promise<void>,
  operation: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn(
      `⚠ ${operation} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Read-modify-write a label list with idempotence checking.
 *
 * Fetches the current labels, checks if the target is already present
 * (add) or absent (remove), and writes the updated list only when a
 * change is needed. Works with string labels (Jira, Notion, AzDO)
 * and numeric IDs (Shortcut).
 *
 * @param fetchCurrent - Board-specific function to fetch current labels.
 * @param writeUpdated - Board-specific function to write the updated list.
 * @param target - The label (or ID) to add or remove.
 * @param mode - Whether to add or remove the target.
 */
export async function modifyLabelList<T>(
  fetchCurrent: () => Promise<T[] | undefined>,
  writeUpdated: (updated: T[]) => Promise<void>,
  target: T,
  mode: 'add' | 'remove',
): Promise<void> {
  const current = await fetchCurrent();
  if (!current) return;

  const has = current.includes(target);
  if (mode === 'add' && has) return;
  if (mode === 'remove' && !has) return;

  const updated =
    mode === 'add'
      ? [...current, target]
      : current.filter((item) => item !== target);
  await writeUpdated(updated);
}
