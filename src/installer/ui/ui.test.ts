import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { printBanner, printSuccess } from './ui.js';

describe('printBanner', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints the ASCII banner', () => {
    printBanner('1.2.3');

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('██████╗');
  });

  it('includes the version number', () => {
    printBanner('4.5.6');

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('v4.5.6');
  });

  it('includes the tagline', () => {
    printBanner('0.0.1');

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain(
      'Autonomous, board-driven development for Claude Code.',
    );
  });

  it('includes the attribution', () => {
    printBanner('0.0.1');

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('Geoffrey Huntley');
  });
});

describe('printSuccess', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints the success message', () => {
    printSuccess(null);

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('Clancy installed successfully');
  });

  it('shows next steps with /clancy:init', () => {
    printSuccess(null);

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('/clancy:init');
  });

  it('shows all command groups when enabledRoles is null', () => {
    printSuccess(null);

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('Strategist');
    expect(output).toContain('Planner');
    expect(output).toContain('Implementer');
    expect(output).toContain('Reviewer');
    expect(output).toContain('Setup & Maintenance');
  });

  it('shows all command groups when all roles are enabled', () => {
    printSuccess(new Set(['strategist', 'planner', 'implementer', 'reviewer']));

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('Strategist');
    expect(output).toContain('Planner');
    expect(output).toContain('Implementer');
  });

  it('hides Planner group when planner role is not enabled', () => {
    printSuccess(new Set(['implementer']));

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).not.toContain('/clancy:plan');
    expect(output).not.toContain('/clancy:approve-plan');
    expect(output).toContain('Implementer');
  });

  it('hides Strategist group when strategist role is not enabled', () => {
    printSuccess(new Set(['implementer']));

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).not.toContain('/clancy:brief');
    expect(output).not.toContain('/clancy:approve-brief');
  });

  it('always shows non-optional groups regardless of enabledRoles', () => {
    printSuccess(new Set([]));

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('Implementer');
    expect(output).toContain('Reviewer');
    expect(output).toContain('Setup & Maintenance');
  });

  it('lists core implementer commands', () => {
    printSuccess(null);

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('/clancy:once');
    expect(output).toContain('/clancy:run');
    expect(output).toContain('/clancy:dry-run');
  });

  it('lists setup commands', () => {
    printSuccess(null);

    const output = logSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n');
    expect(output).toContain('/clancy:doctor');
    expect(output).toContain('/clancy:settings');
    expect(output).toContain('/clancy:update');
    expect(output).toContain('/clancy:uninstall');
    expect(output).toContain('/clancy:help');
  });
});
