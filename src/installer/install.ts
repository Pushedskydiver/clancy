#!/usr/bin/env node

/**
 * Clancy installer — interactive CLI entry point.
 *
 * Prompts the user to choose global (~/.claude) or local (./.claude) install,
 * copies commands and workflows, inlines workflow references for global installs,
 * detects and backs up user-modified files, and registers hooks in Claude settings.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyDir } from '~/installer/file-ops/file-ops.js';
import { installHooks } from '~/installer/hook-installer/hook-installer.js';
import {
  backupModifiedFiles,
  buildManifest,
  detectModifiedFiles,
} from '~/installer/manifest/manifest.js';
import { ask, choose, closePrompts } from '~/installer/prompts/prompts.js';
import { blue, bold, cyan, dim, green, red } from '~/utils/ansi/ansi.js';

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
const BUNDLE_SRC = join(__dirname, '..', 'bundle');

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
// Banner
// ---------------------------------------------------------------------------

/**
 * Print the Clancy ASCII banner and version info.
 */
function printBanner(): void {
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
}

/**
 * Print the post-install success message with available commands.
 */
function printSuccess(): void {
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
}

// ---------------------------------------------------------------------------
// Workflow inlining
// ---------------------------------------------------------------------------

/** Regex matching an @-file workflow reference in a command file. */
const WORKFLOW_REF = /^@\.claude\/clancy\/workflows\/(.+\.md)$/m;

/**
 * Inline workflow file content into global command files.
 *
 * For global installs, @-file references resolve relative to the project root
 * (not ~/.claude), so the workflow files won't be found at runtime. This
 * replaces the @-file reference with the actual workflow content.
 *
 * @param commandsDir - The installed commands directory.
 * @param workflowsDir - The installed workflows directory.
 */
function inlineWorkflows(commandsDir: string, workflowsDir: string): void {
  for (const file of readdirSync(commandsDir)) {
    if (!file.endsWith('.md')) continue;

    const cmdPath = join(commandsDir, file);
    const content = readFileSync(cmdPath, 'utf8');
    const match = content.match(WORKFLOW_REF);

    if (!match) continue;

    const workflowFile = join(workflowsDir, match[1]);
    if (!existsSync(workflowFile)) continue;

    const workflowContent = readFileSync(workflowFile, 'utf8');
    writeFileSync(cmdPath, content.replace(match[0], workflowContent));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  printBanner();

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
    closePrompts();
    process.exit(1);
  }

  // Validate source directories — guards against corrupted npm package
  for (const [label, src] of [
    ['Commands', COMMANDS_SRC],
    ['Workflows', WORKFLOWS_SRC],
    ['Runtime bundles', BUNDLE_SRC],
  ] as const) {
    if (!existsSync(src)) {
      console.error(red(`\n  Error: ${label} source not found: ${src}`));
      console.error(
        red('  The npm package may be corrupted. Try: npm cache clean --force'),
      );
      closePrompts();
      process.exit(1);
    }
  }

  // Validate individual bundle files exist
  for (const script of ['clancy-once.js', 'clancy-afk.js']) {
    if (!existsSync(join(BUNDLE_SRC, script))) {
      console.error(red(`\n  Error: Bundled script not found: ${script}`));
      console.error(
        red('  The npm package may be corrupted. Try: npm cache clean --force'),
      );
      closePrompts();
      process.exit(1);
    }
  }

  console.log('');
  console.log(dim(`  Installing to: ${dest}`));

  try {
    const claudeDir = dirname(dirname(dest)); // .claude/
    const manifestPath = join(claudeDir, 'clancy', 'manifest.json');
    const workflowsManifestPath = join(
      claudeDir,
      'clancy',
      'workflows-manifest.json',
    );
    const patchesDir = join(claudeDir, 'clancy', 'local-patches');

    // Handle existing installation
    if (existsSync(dest) || existsSync(workflowsDest)) {
      console.log('');

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
        closePrompts();
        process.exit(0);
      }

      if (allModified.length > 0) {
        backupModifiedFiles(allModified, patchesDir);
        console.log(
          green(
            `\n  ✓ ${allModified.length} modified file(s) backed up to local-patches/`,
          ),
        );
      }
    }

    // Copy commands and workflows
    copyDir(COMMANDS_SRC, dest);
    copyDir(WORKFLOWS_SRC, workflowsDest);

    // Inline workflows for global installs
    if (dest === GLOBAL_DEST) {
      inlineWorkflows(dest, workflowsDest);
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

    // Copy bundled runtime scripts to .clancy/ in the current project.
    // Always use cwd — workflows run `node .clancy/clancy-once.js` relative
    // to the project root, regardless of global vs local install.
    const clancyProjectDir = join(process.cwd(), '.clancy');

    mkdirSync(clancyProjectDir, { recursive: true });

    for (const script of ['clancy-once.js', 'clancy-afk.js']) {
      copyFileSync(join(BUNDLE_SRC, script), join(clancyProjectDir, script));
    }

    // Ensure .clancy is treated as an ESM package so Node runs clancy-*.js as ESM
    writeFileSync(
      join(clancyProjectDir, 'package.json'),
      JSON.stringify({ type: 'module' }, null, 2) + '\n',
    );

    // Install hooks
    const claudeConfigDir =
      dest === GLOBAL_DEST
        ? join(homeDir, '.claude')
        : join(process.cwd(), '.claude');

    installHooks({
      claudeConfigDir,
      hooksSourceDir: HOOKS_SRC,
    });

    printSuccess();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(red(`\n  Install failed: ${message}`));
    closePrompts();
    process.exit(1);
  }

  closePrompts();
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(red(`\n  Install failed: ${message}`));
  process.exit(1);
});
