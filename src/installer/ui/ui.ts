/**
 * Installer UI — banner and success message.
 */
import { blue, bold, cyan, dim, green } from '~/utils/ansi/ansi.js';

/**
 * Print the Clancy ASCII banner and version info.
 */
export function printBanner(version: string): void {
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
      bold(`v${version}`) +
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
export function printSuccess(enabledRoles: Set<string> | null): void {
  console.log('');
  console.log(green('  ✓ Clancy installed successfully.'));
  console.log('');
  console.log('  Next steps:');
  console.log(dim('    1. Open a project in Claude Code'));
  console.log(`    2. Run: ${cyan('/clancy:init')}`);
  console.log('');
  console.log('  Commands available:');

  const OPTIONAL_GROUPS = new Set(['planner', 'strategist']);

  const groups: [string, [string, string][]][] = [
    [
      'Strategist',
      [
        ['/clancy:brief', 'Generate a strategic brief for a feature'],
        ['/clancy:approve-brief', 'Convert brief into board tickets'],
      ],
    ],
    [
      'Planner',
      [
        ['/clancy:plan', 'Refine backlog tickets into plans'],
        ['/clancy:approve-plan', 'Promote plan to ticket description'],
      ],
    ],
    [
      'Implementer',
      [
        ['/clancy:once', 'Pick up one ticket and stop'],
        ['/clancy:run', 'Run Clancy in loop mode'],
        ['/clancy:dry-run', 'Preview next ticket without changes'],
      ],
    ],
    [
      'Reviewer',
      [
        ['/clancy:review', 'Score next ticket and get recommendations'],
        ['/clancy:status', 'Show next tickets without running'],
        ['/clancy:logs', 'Display progress log'],
      ],
    ],
    [
      'Setup & Maintenance',
      [
        ['/clancy:init', 'Set up Clancy in your project'],
        ['/clancy:map-codebase', 'Scan codebase with 5 parallel agents'],
        ['/clancy:settings', 'View and change configuration'],
        ['/clancy:doctor', 'Diagnose your setup'],
        ['/clancy:update-docs', 'Refresh codebase documentation'],
        ['/clancy:update', 'Update Clancy to latest version'],
        ['/clancy:uninstall', 'Remove Clancy from your project'],
        ['/clancy:help', 'Show all commands'],
      ],
    ],
  ];

  for (const [group, cmds] of groups) {
    const key = group.toLowerCase();
    if (
      OPTIONAL_GROUPS.has(key) &&
      enabledRoles !== null &&
      !enabledRoles.has(key)
    )
      continue;

    console.log('');
    console.log(`    ${bold(group)}`);
    for (const [cmd, desc] of cmds) {
      console.log(`      ${cyan(cmd.padEnd(22))}  ${dim(desc)}`);
    }
  }

  console.log('');
}
