#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PKG = require('../package.json');
const COMMANDS_SRC = path.join(__dirname, '..', 'src', 'commands');

// Destination directories for global vs local install
const GLOBAL_DEST = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'commands', 'clancy');
const LOCAL_DEST = path.join(process.cwd(), '.claude', 'commands', 'clancy');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  console.log('');
  console.log(`Clancy v${PKG.version} — autonomous, board-driven development for Claude Code`);
  console.log('Named after Chief Clancy Wiggum. Built on the Ralph technique by Geoffrey Huntley.');
  console.log('');

  const answer = await ask('Install Clancy commands: [1] Global (~/.claude) or [2] Local (./.claude)? ');
  const choice = answer.trim();

  let dest;
  if (choice === '1' || choice.toLowerCase() === 'global') {
    dest = GLOBAL_DEST;
    console.log(`\nInstalling globally to: ${dest}`);
  } else if (choice === '2' || choice.toLowerCase() === 'local') {
    dest = LOCAL_DEST;
    console.log(`\nInstalling locally to: ${dest}`);
  } else {
    console.log('\nInvalid choice. Run npx clancy again and enter 1 or 2.');
    rl.close();
    process.exit(1);
  }

  try {
    // Check if commands already exist
    if (fs.existsSync(dest)) {
      const overwrite = await ask(`Commands already exist at ${dest}. Overwrite? [y/N] `);
      if (!overwrite.trim().toLowerCase().startsWith('y')) {
        console.log('Aborted. No files changed.');
        rl.close();
        process.exit(0);
      }
    }

    copyDir(COMMANDS_SRC, dest);

    console.log('');
    console.log('Clancy installed successfully.');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Open a project in Claude Code');
    console.log('  2. Run: /clancy:init');
    console.log('');
    console.log('Commands available:');
    console.log('  /clancy:init          Set up Clancy in your project');
    console.log('  /clancy:map-codebase  Scan codebase with 5 parallel agents');
    console.log('  /clancy:run           Run Clancy in loop mode');
    console.log('  /clancy:once          Pick up one ticket and stop');
    console.log('  /clancy:status        Show next tickets without running');
    console.log('  /clancy:review        Score next ticket and get recommendations');
    console.log('  /clancy:logs          Display progress log');
    console.log('  /clancy:update        Update Clancy to latest version');
    console.log('  /clancy:help          Show all commands');
    console.log('');
  } catch (err) {
    console.error(`\nInstall failed: ${err.message}`);
    rl.close();
    process.exit(1);
  }

  rl.close();
}

main();
