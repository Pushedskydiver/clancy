import { describe, expect, it } from 'vitest';

import type { BoardConfig, Ticket } from '~/types/index.js';

import { buildEpicPrBody, buildPrBody, isEpicBranch } from './pr-body.js';

const baseTicket: Ticket = {
  key: 'PROJ-123',
  title: 'Add login page',
  description: 'Implement the login page with form validation',
  provider: 'jira',
};

describe('buildPrBody', () => {
  it('includes Jira link for Jira boards', () => {
    const config: BoardConfig = {
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://acme.atlassian.net',
        JIRA_USER: 'user@test.com',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
      },
    };

    const body = buildPrBody(config, baseTicket);
    expect(body).toContain(
      '[PROJ-123](https://acme.atlassian.net/browse/PROJ-123)',
    );
    expect(body).toContain('## Description');
    expect(body).toContain('Clancy');
  });

  it('includes Closes #N for GitHub boards targeting base branch', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, key: '#42', provider: 'github' };

    const body = buildPrBody(config, ticket, 'main');
    expect(body).toContain('Closes #42');
    expect(body).not.toContain('Part of');
  });

  it('uses Part of for GitHub boards targeting epic branch', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, key: '#42', provider: 'github' };

    const body = buildPrBody(config, ticket, 'epic/proj-100');
    expect(body).toContain('Part of #42');
    expect(body).not.toContain('Closes');
  });

  it('uses Part of for GitHub boards targeting milestone branch', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, key: '#42', provider: 'github' };

    const body = buildPrBody(config, ticket, 'milestone/sprint-3');
    expect(body).toContain('Part of #42');
  });

  it('defaults to Closes when targetBranch is not provided', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, key: '#42', provider: 'github' };

    const body = buildPrBody(config, ticket);
    expect(body).toContain('Closes #42');
  });

  it('includes Linear key for Linear boards', () => {
    const config: BoardConfig = {
      provider: 'linear',
      env: { LINEAR_API_KEY: 'lin_test', LINEAR_TEAM_ID: 'team-id' },
    };
    const ticket: Ticket = {
      ...baseTicket,
      key: 'ENG-42',
      provider: 'linear',
    };

    const body = buildPrBody(config, ticket);
    expect(body).toContain('**Linear:** ENG-42');
  });

  it('omits description section when empty', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, description: '', key: '#1' };

    const body = buildPrBody(config, ticket);
    expect(body).not.toContain('## Description');
  });

  it('always includes Clancy footer', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, key: '#1' };

    const body = buildPrBody(config, ticket);
    expect(body).toContain('Clancy');
    expect(body).toContain('github.com/Pushedskydiver/clancy');
  });

  it('includes rework instructions in a collapsible details block', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, key: '#1' };

    const body = buildPrBody(config, ticket);
    expect(body).toContain('<details>');
    expect(body).toContain(
      '<summary><strong>Rework instructions</strong> (click to expand)</summary>',
    );
    expect(body).toContain('</details>');
    expect(body).toContain('**Code comments**');
    expect(body).toContain('always picked up automatically');
    expect(body).toContain('**General feedback**');
    expect(body).toContain('`Rework:`');
    expect(body).toContain("doesn't handle empty passwords");
  });
});

describe('isEpicBranch', () => {
  it('returns true for epic/ branches', () => {
    expect(isEpicBranch('epic/proj-100')).toBe(true);
  });

  it('returns true for milestone/ branches', () => {
    expect(isEpicBranch('milestone/sprint-3')).toBe(true);
  });

  it('returns false for main', () => {
    expect(isEpicBranch('main')).toBe(false);
  });

  it('returns false for feature branches', () => {
    expect(isEpicBranch('feature/proj-101')).toBe(false);
  });

  it('returns false for branches that contain but do not start with epic/', () => {
    expect(isEpicBranch('feature/epic/thing')).toBe(false);
  });
});

describe('buildEpicPrBody', () => {
  it('lists child tickets with PR references', () => {
    const body = buildEpicPrBody('PROJ-100', 'Add customer portal', [
      {
        timestamp: '2024-01-15 14:30',
        key: 'PROJ-101',
        summary: 'Portal route setup',
        status: 'PR_CREATED',
        prNumber: 42,
        parent: 'PROJ-100',
      },
      {
        timestamp: '2024-01-15 15:00',
        key: 'PROJ-102',
        summary: 'SSO integration',
        status: 'PR_CREATED',
        prNumber: 43,
        parent: 'PROJ-100',
      },
    ]);

    expect(body).toContain('## PROJ-100 — Add customer portal');
    expect(body).toContain('PROJ-101 — Portal route setup (#42)');
    expect(body).toContain('PROJ-102 — SSO integration (#43)');
    expect(body).toContain('Clancy');
  });

  it('handles child entries without PR numbers', () => {
    const body = buildEpicPrBody('PROJ-100', 'Portal', [
      {
        timestamp: '2024-01-15 14:30',
        key: 'PROJ-101',
        summary: 'Setup',
        status: 'DONE',
      },
    ]);

    expect(body).toContain('PROJ-101 — Setup');
    expect(body).not.toContain('(#');
  });
});
