/**
 * Hook installer for Claude Code settings.
 *
 * Copies compiled hook scripts into the Claude config directory and
 * registers them in `settings.json` without clobbering existing config.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** A single hook entry in Claude's settings.json. */
type HookEntry = { hooks: { type: string; command: string }[] };

/** Options for the hook installer. */
type HookInstallerOptions = {
  /** The Claude config directory (e.g., `~/.claude` or `./.claude`). */
  claudeConfigDir: string;
  /** Path to the directory containing compiled hook JS files. */
  hooksSourceDir: string;
};

/**
 * Add a hook command to a settings event array if not already registered.
 *
 * @param hooks - The hooks record from settings.json.
 * @param event - The hook event name (e.g., `'SessionStart'`).
 * @param command - The shell command to register.
 */
function registerHook(
  hooks: Record<string, HookEntry[]>,
  event: string,
  command: string,
): void {
  if (!hooks[event]) hooks[event] = [];

  const already = hooks[event].some(
    (h) => h.hooks && h.hooks.some((hh) => hh.command === command),
  );

  if (!already) {
    hooks[event].push({ hooks: [{ type: 'command', command }] });
  }
}

/**
 * Install Clancy hooks into the Claude config directory.
 *
 * Copies hook scripts, writes a CommonJS `package.json` to the hooks dir,
 * and merges hook registrations into `settings.json`.
 *
 * Best-effort — never throws. Returns `false` if installation fails.
 *
 * @param options - The hook installer options.
 * @returns `true` if hooks were installed successfully.
 *
 * @example
 * ```ts
 * installHooks({
 *   claudeConfigDir: '/home/user/.claude',
 *   hooksSourceDir: '/path/to/clancy/hooks',
 * });
 * ```
 */
export function installHooks(options: HookInstallerOptions): boolean {
  const { claudeConfigDir, hooksSourceDir } = options;
  const hooksInstallDir = join(claudeConfigDir, 'hooks');
  const settingsFile = join(claudeConfigDir, 'settings.json');

  const hookFiles = [
    'clancy-check-update.js',
    'clancy-statusline.js',
    'clancy-context-monitor.js',
    'clancy-credential-guard.js',
  ];

  try {
    mkdirSync(hooksInstallDir, { recursive: true });

    for (const f of hookFiles) {
      copyFileSync(join(hooksSourceDir, f), join(hooksInstallDir, f));
    }

    // Force CommonJS resolution for hook files — projects with "type":"module"
    // in their package.json would otherwise treat .js files as ESM.
    writeFileSync(
      join(hooksInstallDir, 'package.json'),
      JSON.stringify({ type: 'commonjs' }, null, 2) + '\n',
    );

    // Merge hooks into settings.json without clobbering existing config
    let settings: Record<string, unknown> = {};

    if (existsSync(settingsFile)) {
      try {
        settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        // Ignore parse errors — start fresh
      }
    }

    if (!settings.hooks) settings.hooks = {};
    const hooks = settings.hooks as Record<string, HookEntry[]>;

    const updateScript = join(hooksInstallDir, 'clancy-check-update.js');
    const statuslineScript = join(hooksInstallDir, 'clancy-statusline.js');
    const monitorScript = join(hooksInstallDir, 'clancy-context-monitor.js');
    const guardScript = join(hooksInstallDir, 'clancy-credential-guard.js');

    registerHook(hooks, 'SessionStart', `node ${JSON.stringify(updateScript)}`);
    registerHook(hooks, 'PostToolUse', `node ${JSON.stringify(monitorScript)}`);
    registerHook(hooks, 'PreToolUse', `node ${JSON.stringify(guardScript)}`);

    // Statusline: registered as top-level key, not inside hooks
    if (!settings.statusLine) {
      settings.statusLine = {
        type: 'command',
        command: `node ${JSON.stringify(statuslineScript)}`,
      };
    }

    writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

    return true;
  } catch {
    // Hook registration is best-effort — don't fail the install
    return false;
  }
}
