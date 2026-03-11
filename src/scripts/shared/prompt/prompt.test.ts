import { describe, expect, it } from 'vitest';

import { buildPrompt } from './prompt.js';

describe('buildPrompt', () => {
  it('builds a Jira prompt with correct labels', () => {
    const prompt = buildPrompt({
      provider: 'jira',
      key: 'PROJ-123',
      title: 'Add login page',
      description: 'Create a login page.',
      parentInfo: 'PROJ-100',
      blockers: 'None',
    });

    expect(prompt).toContain('You are implementing Jira ticket PROJ-123');
    expect(prompt).toContain('Summary: Add login page');
    expect(prompt).toContain('Epic: PROJ-100');
    expect(prompt).toContain('Blockers: None');
    expect(prompt).toContain('Create a login page.');
    expect(prompt).toContain('ticket summary and description');
  });

  it('builds a GitHub prompt with correct labels', () => {
    const prompt = buildPrompt({
      provider: 'github',
      key: '#42',
      title: 'Fix bug',
      description: 'There is a bug.',
      parentInfo: 'none',
    });

    expect(prompt).toContain('You are implementing GitHub Issue #42');
    expect(prompt).toContain('Title: Fix bug');
    expect(prompt).toContain('Milestone: none');
    expect(prompt).not.toContain('Blockers:');
    expect(prompt).toContain('issue title and description');
    expect(prompt).toContain('SKIP this issue');
  });

  it('builds a Linear prompt with correct labels', () => {
    const prompt = buildPrompt({
      provider: 'linear',
      key: 'ENG-123',
      title: 'Add feature',
      description: 'New feature needed.',
      parentInfo: 'ENG-50 — Parent epic',
      blockers: 'None',
    });

    expect(prompt).toContain('You are implementing Linear issue ENG-123');
    expect(prompt).toContain('Epic: ENG-50 — Parent epic');
    expect(prompt).toContain('ticket summary and description');
  });

  it('includes blockers for Jira', () => {
    const prompt = buildPrompt({
      provider: 'jira',
      key: 'PROJ-123',
      title: 'Add login',
      description: 'Login page.',
      parentInfo: 'PROJ-100',
      blockers: 'Blocked by: PROJ-99, PROJ-98',
    });

    expect(prompt).toContain('Blockers: Blocked by: PROJ-99, PROJ-98');
  });

  it('omits blockers for GitHub', () => {
    const prompt = buildPrompt({
      provider: 'github',
      key: '#10',
      title: 'Fix',
      description: 'Fix it.',
      parentInfo: 'none',
      blockers: 'Some blocker',
    });

    expect(prompt).not.toContain('Blockers:');
  });

  it('includes skip instructions with correct ticket key', () => {
    const prompt = buildPrompt({
      provider: 'jira',
      key: 'PROJ-123',
      title: 'Test',
      description: 'Test.',
      parentInfo: 'none',
    });

    expect(prompt).toContain('⚠ Skipping [PROJ-123]');
    expect(prompt).toContain('YYYY-MM-DD HH:MM | PROJ-123 | SKIPPED');
  });

  it('includes doc reading instructions', () => {
    const prompt = buildPrompt({
      provider: 'linear',
      key: 'ENG-1',
      title: 'T',
      description: 'D',
      parentInfo: 'none',
    });

    expect(prompt).toContain('STACK.md, ARCHITECTURE.md, CONVENTIONS.md');
    expect(prompt).toContain('Follow the conventions in GIT.md exactly');
  });
});
