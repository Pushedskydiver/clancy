/**
 * Rework comment detection and extraction utilities.
 *
 * Comments starting with "Rework:" (case-insensitive) are treated as
 * rework requests. All other comments are treated as discussion and ignored.
 */

/**
 * Check if a comment is a rework request (starts with "Rework:" case-insensitive).
 *
 * @param body - The comment body to check.
 * @returns `true` if the comment starts with "Rework:".
 */
export function isReworkComment(body: string): boolean {
  return body.trim().toLowerCase().startsWith('rework:');
}

/**
 * Extract the rework description from a "Rework: ..." comment.
 *
 * Strips the "Rework:" prefix and returns the remaining content trimmed.
 *
 * @param body - The full comment body starting with "Rework:".
 * @returns The description after the prefix.
 */
export function extractReworkContent(body: string): string {
  return body
    .trim()
    .replace(/^rework:\s*/i, '')
    .trim();
}
