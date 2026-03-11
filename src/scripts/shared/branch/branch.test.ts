import { describe, expect, it } from 'vitest';

import { computeTargetBranch, computeTicketBranch } from './branch.js';

describe('computeTicketBranch', () => {
  it('returns feature/{key-lowercase} for Jira', () => {
    expect(computeTicketBranch('jira', 'PROJ-123')).toBe('feature/proj-123');
  });

  it('returns feature/issue-{number} for GitHub', () => {
    expect(computeTicketBranch('github', '#42')).toBe('feature/issue-42');
  });

  it('returns feature/{key-lowercase} for Linear', () => {
    expect(computeTicketBranch('linear', 'ENG-123')).toBe('feature/eng-123');
  });
});

describe('computeTargetBranch', () => {
  it('returns baseBranch when no parent', () => {
    expect(computeTargetBranch('jira', 'main')).toBe('main');
    expect(computeTargetBranch('github', 'develop')).toBe('develop');
    expect(computeTargetBranch('linear', 'main')).toBe('main');
  });

  it('returns epic/{key} for Jira with epic', () => {
    expect(computeTargetBranch('jira', 'main', 'PROJ-100')).toBe(
      'epic/proj-100',
    );
  });

  it('returns milestone/{slug} for GitHub with milestone', () => {
    expect(computeTargetBranch('github', 'main', 'Sprint 3')).toBe(
      'milestone/sprint-3',
    );
  });

  it('strips non-alphanumeric chars from GitHub milestone slug', () => {
    expect(computeTargetBranch('github', 'main', 'v1.0 Release!')).toBe(
      'milestone/v10-release',
    );
  });

  it('returns epic/{id} for Linear with parent', () => {
    expect(computeTargetBranch('linear', 'main', 'ENG-50')).toBe('epic/eng-50');
  });

  it('returns baseBranch when parent is undefined', () => {
    expect(computeTargetBranch('jira', 'develop', undefined)).toBe('develop');
  });
});
