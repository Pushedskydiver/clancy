/**
 * ANSI escape code helpers for terminal output.
 *
 * Wraps strings in ANSI sequences for styling in CLI environments.
 */

/**
 * Dim the given string (reduced intensity).
 *
 * @param s - The string to style.
 * @returns The string wrapped in ANSI dim codes.
 */
export const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;

/**
 * Bold the given string.
 *
 * @param s - The string to style.
 * @returns The string wrapped in ANSI bold codes.
 */
export const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;

/**
 * Colour the given string blue (bold).
 *
 * @param s - The string to style.
 * @returns The string wrapped in ANSI blue codes.
 */
export const blue = (s: string): string => `\x1b[1;34m${s}\x1b[0m`;

/**
 * Colour the given string cyan.
 *
 * @param s - The string to style.
 * @returns The string wrapped in ANSI cyan codes.
 */
export const cyan = (s: string): string => `\x1b[36m${s}\x1b[0m`;

/**
 * Colour the given string green.
 *
 * @param s - The string to style.
 * @returns The string wrapped in ANSI green codes.
 */
export const green = (s: string): string => `\x1b[32m${s}\x1b[0m`;

/**
 * Colour the given string red.
 *
 * @param s - The string to style.
 * @returns The string wrapped in ANSI red codes.
 */
export const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;

/**
 * Colour the given string yellow.
 *
 * @param s - The string to style.
 * @returns The string wrapped in ANSI yellow codes.
 */
export const yellow = (s: string): string => `\x1b[33m${s}\x1b[0m`;
