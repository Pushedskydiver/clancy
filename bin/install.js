#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PKG = require('../package.json');
const COMMANDS_SRC = path.join(__dirname, '..', 'src', 'commands');
const WORKFLOWS_SRC = path.join(__dirname, '..', 'src', 'workflows');

const GLOBAL_DEST = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'commands', 'clancy');
const LOCAL_DEST = path.join(process.cwd(), '.claude', 'commands', 'clancy');

// Workflows live outside commands/ so Claude Code doesn't expose them as slash commands
const GLOBAL_WORKFLOWS_DEST = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'clancy', 'workflows');
const LOCAL_WORKFLOWS_DEST = path.join(process.cwd(), '.claude', 'clancy', 'workflows');

// ANSI helpers
const dim    = s => `\x1b[2m${s}\x1b[0m`;
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const blue   = s => `\x1b[1;34m${s}\x1b[0m`;
const cyan   = s => `\x1b[36m${s}\x1b[0m`;
const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

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

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
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

  console.log('');
  console.log(dim(`  Installing to: ${dest}`));

  try {
    if (fs.existsSync(dest)) {
      console.log('');
      const overwrite = await ask(blue(`  Commands already exist at ${dest}. Overwrite? [y/N] `));
      if (!overwrite.trim().toLowerCase().startsWith('y')) {
        console.log('\n  Aborted. No files changed.');
        rl.close();
        process.exit(0);
      }
    }

    copyDir(COMMANDS_SRC, dest);
    copyDir(WORKFLOWS_SRC, workflowsDest);

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
