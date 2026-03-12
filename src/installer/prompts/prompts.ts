/**
 * Interactive CLI prompt helpers for the installer.
 *
 * Manages a shared readline interface and provides `ask()` and `choose()`
 * helpers for user interaction.
 */
import { createInterface } from 'node:readline';

import { blue, cyan } from '~/utils/ansi/ansi.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
process.on('exit', () => rl.close());

/**
 * Prompt the user for text input.
 *
 * @param label - The prompt text to display.
 * @returns The user's response string.
 *
 * @example
 * ```ts
 * const name = await ask('Enter your name: ');
 * ```
 */
export function ask(label: string): Promise<string> {
  return new Promise((resolve) => rl.question(label, resolve));
}

/**
 * Present a numbered list of options and return the user's choice.
 *
 * @param question - The question to display above the options.
 * @param options - Array of option labels.
 * @param defaultChoice - The default option number (1-based).
 * @returns The user's choice as a string (e.g., `'1'` or `'2'`).
 *
 * @example
 * ```ts
 * const choice = await choose('Pick a colour:', ['Red', 'Blue'], 1);
 * ```
 */
export async function choose(
  question: string,
  options: string[],
  defaultChoice = 1,
): Promise<string> {
  console.log('');
  console.log(blue(question));
  console.log('');
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));
  console.log('');
  const raw = await ask(cyan(`Choice [${defaultChoice}]: `));
  return raw.trim() || String(defaultChoice);
}

/**
 * Close the readline interface.
 *
 * Call this before exiting the process to release stdin.
 */
export function closePrompts(): void {
  rl.close();
}
