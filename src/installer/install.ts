#!/usr/bin/env node

/**
 * Clancy installer — interactive CLI for installing slash commands, workflows, and hooks.
 *
 * Prompts the user to choose global (~/.claude) or local (./.claude) install,
 * copies commands and workflows, inlines workflow references for global installs,
 * detects and backs up user-modified files, and registers hooks in Claude settings.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const PKG = require('../../package.json') as { version: string };

const COMMANDS_SRC = join(__dirname, '..', '..', 'src', 'commands');
const WORKFLOWS_SRC = join(__dirname, '..', '..', 'src', 'workflows');
const HOOKS_SRC = join(__dirname, '..', '..', 'hooks');

const _homeDir = process.env.HOME ?? process.env.USERPROFILE;

if (!_homeDir) {
  process.stderr.write(
    '\x1b[31m\n  Error: HOME or USERPROFILE environment variable is not set.\x1b[0m\n',
  );
  process.exit(1);
}

const homeDir: string = _homeDir;

const GLOBAL_DEST = join(homeDir, '.claude', 'commands', 'clancy');
const LOCAL_DEST = join(process.cwd(), '.claude', 'commands', 'clancy');

const GLOBAL_WORKFLOWS_DEST = join(homeDir, '.claude', 'clancy', 'workflows');
const LOCAL_WORKFLOWS_DEST = join(
  process.cwd(),
  '.claude',
  'clancy',
  'workflows',
);

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const dim = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`;
const blue = (s: string): string => `\x1b[1;34m${s}\x1b[0m`;
const cyan = (s: string): string => `\x1b[36m${s}\x1b[0m`;
const green = (s: string): string => `\x1b[32m${s}\x1b[0m`;
const red = (s: string): string => `\x1b[31m${s}\x1b[0m`;

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin, output: process.stdout });
process.on('exit', () => rl.close());

/**
 * Prompt the user for text input.
 *
 * @param label - The prompt text to display.
 * @returns The user's response string.
 */
function ask(label: string): Promise<string> {
  return new Promise((resolve) => rl.question(label, resolve));
}

/**
 * Present a numbered list of options and return the user's choice.
 *
 * @param question - The question to display above the options.
 * @param options - Array of option labels.
 * @param defaultChoice - The default option number (1-based).
 * @returns The user's choice as a string (e.g., `'1'` or `'2'`).
 */
async function choose(
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

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

type DirentLike = { name: string; isDirectory(): boolean };

/**
 * Compute the SHA-256 hash of a file.
 *
 * @param filePath - Absolute path to the file.
 * @returns The hex-encoded SHA-256 hash string.
 */
function fileHash(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Recursively copy a directory, throwing if the destination is a symlink.
 *
 * @param src - Source directory path.
 * @param dest - Destination directory path.
 */
function copyDir(src: string, dest: string): void {
  if (existsSync(dest)) {
    const stat = lstatSync(dest);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `${dest} is a symlink. Remove it first before installing.`,
      );
    }
  }

  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src, {
    withFileTypes: true,
  }) as DirentLike[]) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

/**
 * Build a manifest of installed files with SHA-256 hashes.
 *
 * @param baseDir - Root directory to scan.
 * @returns A record mapping relative paths to their SHA-256 hashes.
 *
 * @example
 * ```ts
 * const manifest = buildManifest('/path/to/.claude/commands/clancy');
 * // { "init.md": "abc123...", "run.md": "def456..." }
 * ```
 */
function buildManifest(baseDir: string): Record<string, string> {
  const manifest: Record<string, string> = {};

  function walk(dir: string, prefix: string): void {
    for (const entry of readdirSync(dir, {
      withFileTypes: true,
    }) as DirentLike[]) {
      const full = join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        manifest[rel] = fileHash(full);
      }
    }
  }

  walk(baseDir, '');
  return manifest;
}

type ModifiedFile = { rel: string; absPath: string };

/**
 * Detect files modified by the user since last install.
 *
 * Compares current file hashes against the stored manifest to find changes.
 *
 * @param baseDir - The installed directory to check.
 * @param manifestPath - Path to the stored manifest JSON.
 * @returns Array of modified file records with relative and absolute paths.
 */
function detectModifiedFiles(
  baseDir: string,
  manifestPath: string,
): ModifiedFile[] {
  if (!existsSync(manifestPath)) return [];

  let manifest: Record<string, string>;

  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      string
    >;
  } catch {
    return [];
  }

  const modified: ModifiedFile[] = [];

  for (const [rel, hash] of Object.entries(manifest)) {
    const absPath = join(baseDir, rel);
    if (!existsSync(absPath)) continue;

    if (fileHash(absPath) !== hash) {
      modified.push({ rel, absPath });
    }
  }

  return modified;
}

/**
 * Back up modified files to a patches directory.
 *
 * Copies each modified file and writes a `backup-meta.json` with metadata.
 *
 * @param modified - Array of modified file records.
 * @param patchesDir - Directory to store backups.
 * @returns The patches directory path, or `null` if no files were backed up.
 */
function backupModifiedFiles(
  modified: ModifiedFile[],
  patchesDir: string,
): string | null {
  if (modified.length === 0) return null;

  mkdirSync(patchesDir, { recursive: true });

  for (const { rel, absPath } of modified) {
    const backupPath = join(patchesDir, rel);
    mkdirSync(dirname(backupPath), { recursive: true });
    copyFileSync(absPath, backupPath);
  }

  writeFileSync(
    join(patchesDir, 'backup-meta.json'),
    JSON.stringify(
      {
        backed_up: modified.map((m) => m.rel),
        date: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  return patchesDir;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('');
  console.log(blue('  ██████╗██╗      █████╗ ███╗   ██╗ ██████╗██╗   ██╗'));
  console.log(blue(' ██╔════╝██║     ██╔══██╗████╗  ██║██╔════╝╚██╗ ██╔╝'));
  console.log(blue(' ██║     ██║     ███████║██╔██╗ ██║██║      ╚████╔╝ '));
  console.log(blue(' ██║     ██║     ██╔══██║██║╚██╗██║██║       ╚██╔╝  '));
  console.log(blue(' ╚██████╗███████╗██║  ██║██║ ╚████║╚██████╗   ██║   '));
  console.log(blue('  ╚═════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝   ╚═╝  '));
  console.log('');
  console.log(
    '  ' +
      bold(`v${PKG.version}`) +
      dim('  Autonomous, board-driven development for Claude Code.'),
  );
  console.log(
    dim(
      '  Named after Chief Clancy Wiggum. Built on the Ralph technique by Geoffrey Huntley.',
    ),
  );

  const installChoice = await choose('Where would you like to install?', [
    `Global  ${dim('(~/.claude)')}   — available in all projects`,
    `Local   ${dim('(./.claude)')}  — this project only`,
  ]);

  let dest: string;
  let workflowsDest: string;

  if (installChoice === '1' || installChoice.toLowerCase() === 'global') {
    dest = GLOBAL_DEST;
    workflowsDest = GLOBAL_WORKFLOWS_DEST;
  } else if (installChoice === '2' || installChoice.toLowerCase() === 'local') {
    dest = LOCAL_DEST;
    workflowsDest = LOCAL_WORKFLOWS_DEST;
  } else {
    console.log(
      red('\n  Invalid choice. Run npx chief-clancy again and enter 1 or 2.'),
    );
    rl.close();
    process.exit(1);
  }

  // Validate source directories — guards against corrupted npm package
  if (!existsSync(COMMANDS_SRC)) {
    console.error(red(`\n  Error: Source not found: ${COMMANDS_SRC}`));
    console.error(
      red('  The npm package may be corrupted. Try: npm cache clean --force'),
    );
    rl.close();
    process.exit(1);
  }

  if (!existsSync(WORKFLOWS_SRC)) {
    console.error(red(`\n  Error: Source not found: ${WORKFLOWS_SRC}`));
    console.error(
      red('  The npm package may be corrupted. Try: npm cache clean --force'),
    );
    rl.close();
    process.exit(1);
  }

  console.log('');
  console.log(dim(`  Installing to: ${dest}`));

  try {
    // Determine manifest and patches paths
    const claudeDir = dirname(dirname(dest)); // .claude/
    const manifestPath = join(claudeDir, 'clancy', 'manifest.json');
    const workflowsManifestPath = join(
      claudeDir,
      'clancy',
      'workflows-manifest.json',
    );
    const patchesDir = join(claudeDir, 'clancy', 'local-patches');

    if (existsSync(dest) || existsSync(workflowsDest)) {
      console.log('');

      // Detect user-modified files before overwriting
      const modified = detectModifiedFiles(dest, manifestPath);
      const modifiedWorkflows = detectModifiedFiles(
        workflowsDest,
        workflowsManifestPath,
      );
      const allModified = [...modified, ...modifiedWorkflows];

      if (allModified.length > 0) {
        console.log(blue('  Modified files detected:'));
        for (const { rel } of allModified) {
          console.log(`    ${dim('•')} ${rel}`);
        }
        console.log('');
        console.log(
          dim('  These will be backed up to .claude/clancy/local-patches/'),
        );
        console.log(
          dim('  before overwriting. You can reapply them after the update.'),
        );
        console.log('');
      }

      const overwrite = await ask(
        blue(`  Commands already exist at ${dest}. Overwrite? [y/N] `),
      );

      if (!overwrite.trim().toLowerCase().startsWith('y')) {
        console.log('\n  Aborted. No files changed.');
        rl.close();
        process.exit(0);
      }

      // Back up modified files before overwriting
      if (allModified.length > 0) {
        backupModifiedFiles(allModified, patchesDir);
        console.log(
          green(
            `\n  ✓ ${allModified.length} modified file(s) backed up to local-patches/`,
          ),
        );
      }
    }

    copyDir(COMMANDS_SRC, dest);
    copyDir(WORKFLOWS_SRC, workflowsDest);

    // For global installs, @-file references in command files resolve relative
    // to the project root — not ~/.claude/ — so inline the workflow content.
    if (dest === GLOBAL_DEST) {
      const WORKFLOW_REF = /^@\.claude\/clancy\/workflows\/(.+\.md)$/m;

      for (const file of readdirSync(dest)) {
        if (!file.endsWith('.md')) continue;

        const cmdPath = join(dest, file);
        const content = readFileSync(cmdPath, 'utf8');
        const match = content.match(WORKFLOW_REF);

        if (!match) continue;

        const workflowFile = join(workflowsDest, match[1]);
        if (!existsSync(workflowFile)) continue;

        const workflowContent = readFileSync(workflowFile, 'utf8');
        writeFileSync(cmdPath, content.replace(match[0], workflowContent));
      }
    }

    // Write VERSION file
    writeFileSync(join(dest, 'VERSION'), PKG.version);

    // Write manifests for future update detection
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(buildManifest(dest), null, 2));
    writeFileSync(
      workflowsManifestPath,
      JSON.stringify(buildManifest(workflowsDest), null, 2),
    );

    // Install hooks and register them in Claude settings.json
    const claudeConfigDir =
      dest === GLOBAL_DEST
        ? join(homeDir, '.claude')
        : join(process.cwd(), '.claude');
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
        copyFileSync(join(HOOKS_SRC, f), join(hooksInstallDir, f));
      }

      // Force CommonJS resolution for hook files
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

      type HookEntry = { hooks: { type: string; command: string }[] };

      if (!settings.hooks) settings.hooks = {};
      const hooks = settings.hooks as Record<string, HookEntry[]>;

      /**
       * Add a hook command to an event array if not already present.
       *
       * @param event - The hook event name (e.g., `'SessionStart'`).
       * @param command - The shell command to register.
       */
      function registerHook(event: string, command: string): void {
        if (!hooks[event]) hooks[event] = [];

        const already = hooks[event].some(
          (h) => h.hooks && h.hooks.some((hh) => hh.command === command),
        );

        if (!already) {
          hooks[event].push({ hooks: [{ type: 'command', command }] });
        }
      }

      const updateScript = join(hooksInstallDir, 'clancy-check-update.js');
      const statuslineScript = join(hooksInstallDir, 'clancy-statusline.js');
      const monitorScript = join(hooksInstallDir, 'clancy-context-monitor.js');
      const guardScript = join(hooksInstallDir, 'clancy-credential-guard.js');

      registerHook('SessionStart', `node ${updateScript}`);
      registerHook('PostToolUse', `node ${monitorScript}`);
      registerHook('PreToolUse', `node ${guardScript}`);

      // Statusline: registered as top-level key, not inside hooks
      if (!settings.statusLine) {
        settings.statusLine = {
          type: 'command',
          command: `node ${statuslineScript}`,
        };
      }

      writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    } catch {
      // Hook registration is best-effort — don't fail the install
    }

    console.log('');
    console.log(green('  ✓ Clancy installed successfully.'));
    console.log('');
    console.log('  Next steps:');
    console.log(dim('    1. Open a project in Claude Code'));
    console.log(`    2. Run: ${cyan('/clancy:init')}`);
    console.log('');
    console.log('  Commands available:');
    console.log('');

    const cmds: [string, string][] = [
      ['/clancy:init', 'Set up Clancy in your project'],
      ['/clancy:map-codebase', 'Scan codebase with 5 parallel agents'],
      ['/clancy:run', 'Run Clancy in loop mode'],
      ['/clancy:once', 'Pick up one ticket and stop'],
      ['/clancy:dry-run', 'Preview next ticket without making changes'],
      ['/clancy:status', 'Show next tickets without running'],
      ['/clancy:review', 'Score next ticket and get recommendations'],
      ['/clancy:logs', 'Display progress log'],
      ['/clancy:settings', 'View and change configuration'],
      ['/clancy:doctor', 'Diagnose your setup'],
      ['/clancy:update', 'Update Clancy to latest version'],
      ['/clancy:help', 'Show all commands'],
    ];

    for (const [cmd, desc] of cmds) {
      console.log(`    ${cyan(cmd.padEnd(22))}  ${dim(desc)}`);
    }

    console.log('');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(red(`\n  Install failed: ${message}`));
    rl.close();
    process.exit(1);
  }

  rl.close();
}

main();
