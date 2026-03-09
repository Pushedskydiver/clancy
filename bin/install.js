#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PKG = require('../package.json');
const COMMANDS_SRC = path.join(__dirname, '..', 'src', 'commands');
const WORKFLOWS_SRC = path.join(__dirname, '..', 'src', 'workflows');
const HOOKS_SRC = path.join(__dirname, '..', 'hooks');

const homeDir = process.env.HOME || process.env.USERPROFILE;
if (!homeDir) {
  process.stderr.write('\x1b[31m\n  Error: HOME or USERPROFILE environment variable is not set.\x1b[0m\n');
  process.exit(1);
}

const GLOBAL_DEST = path.join(homeDir, '.claude', 'commands', 'clancy');
const LOCAL_DEST = path.join(process.cwd(), '.claude', 'commands', 'clancy');

// Workflows live outside commands/ so Claude Code doesn't expose them as slash commands
const GLOBAL_WORKFLOWS_DEST = path.join(homeDir, '.claude', 'clancy', 'workflows');
const LOCAL_WORKFLOWS_DEST = path.join(process.cwd(), '.claude', 'clancy', 'workflows');

// ANSI helpers
const dim    = s => `\x1b[2m${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const blue   = s => `\x1b[1;34m${s}\x1b[0m`;
const cyan   = s => `\x1b[36m${s}\x1b[0m`;
const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// Ensure readline is always closed — process.exit() doesn't trigger finally blocks
process.on('exit', () => rl.close());

function ask(label) {
  return new Promise(resolve => rl.question(label, resolve));
}

async function choose(question, options, defaultChoice = 1) {
  console.log('');
  console.log(blue(question));
  console.log('');
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));
  console.log('');
  const raw = await ask(cyan(`Choice [${defaultChoice}]: `));
  return raw.trim() || String(defaultChoice);
}

const crypto = require('crypto');

function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').digest('hex', content);
}

function copyDir(src, dest) {
  // Use lstatSync (not statSync) to detect symlinks — statSync follows them and misreports
  if (fs.existsSync(dest)) {
    const stat = fs.lstatSync(dest);
    if (stat.isSymbolicLink()) {
      throw new Error(`${dest} is a symlink. Remove it first before installing.`);
    }
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

/**
 * Build a manifest of installed files with SHA-256 hashes.
 * Format: { "relative/path.md": "<sha256>", ... }
 */
function buildManifest(baseDir) {
  const manifest = {};
  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        const content = fs.readFileSync(full);
        manifest[rel] = crypto.createHash('sha256').update(content).digest('hex');
      }
    }
  }
  walk(baseDir, '');
  return manifest;
}

/**
 * Detect files modified by the user since last install by comparing
 * current file hashes against the stored manifest. Returns array of
 * { rel, absPath } for modified files.
 */
function detectModifiedFiles(baseDir, manifestPath) {
  if (!fs.existsSync(manifestPath)) return [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch { return []; }

  const modified = [];
  for (const [rel, hash] of Object.entries(manifest)) {
    const absPath = path.join(baseDir, rel);
    if (!fs.existsSync(absPath)) continue;
    const content = fs.readFileSync(absPath);
    const currentHash = crypto.createHash('sha256').update(content).digest('hex');
    if (currentHash !== hash) {
      modified.push({ rel, absPath });
    }
  }
  return modified;
}

/**
 * Back up modified files to a patches directory alongside the install.
 * Returns the backup directory path if any files were backed up.
 */
function backupModifiedFiles(modified, patchesDir) {
  if (modified.length === 0) return null;
  fs.mkdirSync(patchesDir, { recursive: true });
  for (const { rel, absPath } of modified) {
    const backupPath = path.join(patchesDir, rel);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(absPath, backupPath);
  }
  // Write metadata so /clancy:update workflow knows what was backed up
  fs.writeFileSync(
    path.join(patchesDir, 'backup-meta.json'),
    JSON.stringify({ backed_up: modified.map(m => m.rel), date: new Date().toISOString() }, null, 2)
  );
  return patchesDir;
}

async function main() {
  console.log('');
  console.log(blue('  ██████╗██╗      █████╗ ███╗   ██╗ ██████╗██╗   ██╗'));
  console.log(blue(' ██╔════╝██║     ██╔══██╗████╗  ██║██╔════╝╚██╗ ██╔╝'));
  console.log(blue(' ██║     ██║     ███████║██╔██╗ ██║██║      ╚████╔╝ '));
  console.log(blue(' ██║     ██║     ██╔══██║██║╚██╗██║██║       ╚██╔╝  '));
  console.log(blue(' ╚██████╗███████╗██║  ██║██║ ╚████║╚██████╗   ██║   '));
  console.log(blue('  ╚═════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝   ╚═╝  '));
  console.log('');
  console.log('  ' + bold(`v${PKG.version}`) + dim('  Autonomous, board-driven development for Claude Code.'));
  console.log(dim('  Named after Chief Clancy Wiggum. Built on the Ralph technique by Geoffrey Huntley.'));

  const installChoice = await choose(
    'Where would you like to install?',
    [
      `Global  ${dim('(~/.claude)')}   — available in all projects`,
      `Local   ${dim('(./.claude)')}  — this project only`,
    ]
  );

  let dest, workflowsDest;
  if (installChoice === '1' || installChoice.toLowerCase() === 'global') {
    dest = GLOBAL_DEST;
    workflowsDest = GLOBAL_WORKFLOWS_DEST;
  } else if (installChoice === '2' || installChoice.toLowerCase() === 'local') {
    dest = LOCAL_DEST;
    workflowsDest = LOCAL_WORKFLOWS_DEST;
  } else {
    console.log(red('\n  Invalid choice. Run npx chief-clancy again and enter 1 or 2.'));
    rl.close();
    process.exit(1);
  }

  // Validate source directories — guards against corrupted npm package
  if (!fs.existsSync(COMMANDS_SRC)) {
    console.error(red(`\n  Error: Source not found: ${COMMANDS_SRC}`));
    console.error(red('  The npm package may be corrupted. Try: npm cache clean --force'));
    rl.close();
    process.exit(1);
  }
  if (!fs.existsSync(WORKFLOWS_SRC)) {
    console.error(red(`\n  Error: Source not found: ${WORKFLOWS_SRC}`));
    console.error(red('  The npm package may be corrupted. Try: npm cache clean --force'));
    rl.close();
    process.exit(1);
  }

  console.log('');
  console.log(dim(`  Installing to: ${dest}`));

  try {
    // Determine manifest and patches paths (sibling to commands dir)
    const claudeDir = path.dirname(path.dirname(dest)); // .claude/ (parent of commands/)
    const manifestPath = path.join(claudeDir, 'clancy', 'manifest.json');
    const patchesDir = path.join(claudeDir, 'clancy', 'local-patches');

    if (fs.existsSync(dest) || fs.existsSync(workflowsDest)) {
      console.log('');

      // Detect user-modified files before overwriting
      const modified = detectModifiedFiles(dest, manifestPath);
      const modifiedWorkflows = detectModifiedFiles(workflowsDest, manifestPath.replace('manifest.json', 'workflows-manifest.json'));
      const allModified = [...modified, ...modifiedWorkflows];

      if (allModified.length > 0) {
        console.log(blue('  Modified files detected:'));
        for (const { rel } of allModified) {
          console.log(`    ${dim('•')} ${rel}`);
        }
        console.log('');
        console.log(dim('  These will be backed up to .claude/clancy/local-patches/'));
        console.log(dim('  before overwriting. You can reapply them after the update.'));
        console.log('');
      }

      const overwrite = await ask(blue(`  Commands already exist at ${dest}. Overwrite? [y/N] `));
      if (!overwrite.trim().toLowerCase().startsWith('y')) {
        console.log('\n  Aborted. No files changed.');
        rl.close();
        process.exit(0);
      }

      // Back up modified files before overwriting
      if (allModified.length > 0) {
        backupModifiedFiles(allModified, patchesDir);
        console.log(green(`\n  ✓ ${allModified.length} modified file(s) backed up to local-patches/`));
      }
    }

    copyDir(COMMANDS_SRC, dest);
    copyDir(WORKFLOWS_SRC, workflowsDest);

    // For global installs, @-file references in command files resolve relative to the
    // project root — not ~/.claude/ — so the workflow files won't be found at runtime.
    // Fix: inline the workflow content directly into the installed command files.
    if (dest === GLOBAL_DEST) {
      const WORKFLOW_REF = /^@\.claude\/clancy\/workflows\/(.+\.md)$/m;
      for (const file of fs.readdirSync(dest)) {
        if (!file.endsWith('.md')) continue;
        const cmdPath = path.join(dest, file);
        const content = fs.readFileSync(cmdPath, 'utf8');
        const match = content.match(WORKFLOW_REF);
        if (!match) continue;
        const workflowFile = path.join(workflowsDest, match[1]);
        if (!fs.existsSync(workflowFile)) continue;
        const workflowContent = fs.readFileSync(workflowFile, 'utf8');
        fs.writeFileSync(cmdPath, content.replace(match[0], workflowContent));
      }
    }

    // Write VERSION file so /clancy:doctor and /clancy:update can read the installed version
    fs.writeFileSync(path.join(dest, 'VERSION'), PKG.version);

    // Write manifests so future updates can detect user-modified files
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(buildManifest(dest), null, 2));
    fs.writeFileSync(
      manifestPath.replace('manifest.json', 'workflows-manifest.json'),
      JSON.stringify(buildManifest(workflowsDest), null, 2)
    );

    // Install hooks and register them in Claude settings.json
    const claudeConfigDir = dest === GLOBAL_DEST
      ? path.join(homeDir, '.claude')
      : path.join(process.cwd(), '.claude');
    const hooksInstallDir = path.join(claudeConfigDir, 'hooks');
    const settingsFile = path.join(claudeConfigDir, 'settings.json');

    const hookFiles = [
      'clancy-check-update.js',
      'clancy-statusline.js',
      'clancy-context-monitor.js',
    ];

    try {
      fs.mkdirSync(hooksInstallDir, { recursive: true });
      for (const f of hookFiles) {
        fs.copyFileSync(path.join(HOOKS_SRC, f), path.join(hooksInstallDir, f));
      }

      // Merge hooks into settings.json without clobbering existing config
      let settings = {};
      if (fs.existsSync(settingsFile)) {
        try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch {}
      }
      if (!settings.hooks) settings.hooks = {};

      // Helper: add a hook command to an event array if not already present
      function registerHook(event, command) {
        if (!settings.hooks[event]) settings.hooks[event] = [];
        const already = settings.hooks[event].some(
          h => h.hooks && h.hooks.some(hh => hh.command === command)
        );
        if (!already) {
          settings.hooks[event].push({ hooks: [{ type: 'command', command }] });
        }
      }

      const updateScript    = path.join(hooksInstallDir, 'clancy-check-update.js');
      const statuslineScript = path.join(hooksInstallDir, 'clancy-statusline.js');
      const monitorScript   = path.join(hooksInstallDir, 'clancy-context-monitor.js');

      registerHook('SessionStart', `node ${updateScript}`);
      registerHook('PostToolUse',  `node ${monitorScript}`);

      // Statusline: registered as top-level key, not inside hooks
      if (!settings.statusline) {
        settings.statusline = `node ${statuslineScript}`;
      }

      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    } catch {
      // Hook registration is best-effort — don't fail the install over it
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
    const cmds = [
      ['/clancy:init',         'Set up Clancy in your project'],
      ['/clancy:map-codebase', 'Scan codebase with 5 parallel agents'],
      ['/clancy:run',          'Run Clancy in loop mode'],
      ['/clancy:once',         'Pick up one ticket and stop'],
      ['/clancy:status',       'Show next tickets without running'],
      ['/clancy:review',       'Score next ticket and get recommendations'],
      ['/clancy:logs',         'Display progress log'],
      ['/clancy:settings',     'View and change configuration'],
      ['/clancy:doctor',       'Diagnose your setup'],
      ['/clancy:update',       'Update Clancy to latest version'],
      ['/clancy:help',         'Show all commands'],
    ];
    for (const [cmd, desc] of cmds) {
      console.log(`    ${cyan(cmd.padEnd(22))}  ${dim(desc)}`);
    }
    console.log('');
  } catch (err) {
    console.error(red(`\n  Install failed: ${err.message}`));
    rl.close();
    process.exit(1);
  }

  rl.close();
}

main();
