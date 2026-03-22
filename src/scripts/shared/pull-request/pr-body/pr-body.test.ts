import { describe, expect, it } from 'vitest';

import type { BoardConfig, Ticket } from '~/types/index.js';

import type { EpicContext } from './pr-body.js';
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

  it('does not include verification warning when not provided', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, key: '#1' };

    const body = buildPrBody(config, ticket, 'main');
    expect(body).not.toContain('Verification Warning');
    expect(body).not.toContain('manual fixes before merging');
  });

  it('includes verification warning section when provided', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, key: '#1' };
    const warning =
      'Verification checks did not pass after 3 fix attempt(s). Review carefully.';

    const body = buildPrBody(config, ticket, 'main', warning);
    expect(body).toContain('## ⚠ Verification Warning');
    expect(body).toContain(warning);
    expect(body).toContain('This PR may need manual fixes before merging.');
  });

  it('places verification warning before rework instructions', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    };
    const ticket: Ticket = { ...baseTicket, key: '#1' };
    const warning = 'Verification failed after 2 fix attempt(s).';

    const body = buildPrBody(config, ticket, 'main', warning);
    const warningIndex = body.indexOf('## ⚠ Verification Warning');
    const reworkIndex = body.indexOf('Rework instructions');
    expect(warningIndex).toBeGreaterThan(-1);
    expect(reworkIndex).toBeGreaterThan(-1);
    expect(warningIndex).toBeLessThan(reworkIndex);
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

describe('singleChildParent', () => {
  it('includes Closes for parent when single-child skip is active (GitHub)', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    } as BoardConfig;
    const ticket: Ticket = {
      ...baseTicket,
      key: '#13',
      provider: 'github',
    };
    const body = buildPrBody(config, ticket, 'main', undefined, '#7');
    expect(body).toContain('Closes #13');
    expect(body).toContain('Closes #7');
  });

  it('does not include parent Closes when targeting epic branch', () => {
    const config: BoardConfig = {
      provider: 'github',
      env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
    } as BoardConfig;
    const ticket: Ticket = {
      ...baseTicket,
      key: '#13',
      provider: 'github',
    };
    const body = buildPrBody(config, ticket, 'epic/7', undefined, '#7');
    expect(body).toContain('Part of #13');
    expect(body).not.toContain('Closes #7');
  });

  it('does not include parent Closes for non-GitHub boards', () => {
    const config: BoardConfig = {
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
      },
    } as BoardConfig;
    const body = buildPrBody(config, baseTicket, 'main', undefined, 'PROJ-100');
    expect(body).not.toContain('Closes PROJ-100');
  });
});

describe('epicContext', () => {
  const githubConfig: BoardConfig = {
    provider: 'github',
    env: { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' },
  };
  const githubTicket: Ticket = {
    ...baseTicket,
    key: '#50',
    provider: 'github',
  };

  it('includes epic banner when targeting epic branch with context', () => {
    const epic: EpicContext = {
      parentKey: '#49',
      siblingsDelivered: 3,
      epicBranch: 'milestone/49',
    };
    const body = buildPrBody(
      githubConfig,
      githubTicket,
      'milestone/49',
      undefined,
      undefined,
      epic,
    );
    expect(body).toContain('## Part of epic #49');
    expect(body).toContain('3 siblings previously delivered to `milestone/49`');
    expect(body).toContain('This PR targets `milestone/49`');
    expect(body).toContain('final epic PR');
  });

  it('shows singular sibling text when one sibling merged', () => {
    const epic: EpicContext = {
      parentKey: '#49',
      siblingsDelivered: 1,
      epicBranch: 'milestone/49',
    };
    const body = buildPrBody(
      githubConfig,
      githubTicket,
      'milestone/49',
      undefined,
      undefined,
      epic,
    );
    expect(body).toContain('1 sibling previously delivered');
    expect(body).not.toContain('siblings');
  });

  it('shows no siblings text when first child', () => {
    const epic: EpicContext = {
      parentKey: '#49',
      siblingsDelivered: 0,
      epicBranch: 'milestone/49',
    };
    const body = buildPrBody(
      githubConfig,
      githubTicket,
      'milestone/49',
      undefined,
      undefined,
      epic,
    );
    expect(body).toContain('No siblings delivered yet');
  });

  it('does not include epic banner when not targeting epic branch', () => {
    const epic: EpicContext = {
      parentKey: '#49',
      siblingsDelivered: 3,
      epicBranch: 'milestone/49',
    };
    const body = buildPrBody(
      githubConfig,
      githubTicket,
      'main',
      undefined,
      undefined,
      epic,
    );
    expect(body).not.toContain('Part of epic');
    expect(body).not.toContain('siblings');
  });

  it('does not include epic banner when epicContext is undefined', () => {
    const body = buildPrBody(githubConfig, githubTicket, 'milestone/49');
    expect(body).not.toContain('Part of epic');
  });

  it('places epic banner before ticket reference', () => {
    const epic: EpicContext = {
      parentKey: '#49',
      siblingsDelivered: 2,
      epicBranch: 'milestone/49',
    };
    const body = buildPrBody(
      githubConfig,
      githubTicket,
      'milestone/49',
      undefined,
      undefined,
      epic,
    );
    const bannerIndex = body.indexOf('## Part of epic #49');
    const ticketRefIndex = body.indexOf('Part of #50');
    expect(bannerIndex).toBeLessThan(ticketRefIndex);
  });

  it('works with Jira boards targeting epic branch', () => {
    const jiraConfig: BoardConfig = {
      provider: 'jira',
      env: {
        JIRA_BASE_URL: 'https://example.atlassian.net',
        JIRA_USER: 'user',
        JIRA_API_TOKEN: 'token',
        JIRA_PROJECT_KEY: 'PROJ',
      },
    };
    const epic: EpicContext = {
      parentKey: 'PROJ-100',
      siblingsDelivered: 5,
      epicBranch: 'epic/proj-100',
    };
    const body = buildPrBody(
      jiraConfig,
      baseTicket,
      'epic/proj-100',
      undefined,
      undefined,
      epic,
    );
    expect(body).toContain('## Part of epic PROJ-100');
    expect(body).toContain(
      '5 siblings previously delivered to `epic/proj-100`',
    );
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

  it('includes Closes keywords for GitHub provider', () => {
    const body = buildEpicPrBody(
      '#42',
      'Add customer portal',
      [
        {
          timestamp: '2024-01-15 14:30',
          key: '#43',
          summary: 'Portal route setup',
          status: 'PR_CREATED',
          prNumber: 50,
          parent: '#42',
        },
        {
          timestamp: '2024-01-15 15:00',
          key: '#44',
          summary: 'SSO integration',
          status: 'PR_CREATED',
          prNumber: 51,
          parent: '#42',
        },
      ],
      'github',
    );

    expect(body).toContain('### Closes');
    expect(body).toContain('Closes #42');
    expect(body).toContain('Closes #43');
    expect(body).toContain('Closes #44');
  });

  it('does not include Closes keywords for Jira provider', () => {
    const body = buildEpicPrBody(
      'PROJ-100',
      'Add customer portal',
      [
        {
          timestamp: '2024-01-15 14:30',
          key: 'PROJ-101',
          summary: 'Portal route setup',
          status: 'PR_CREATED',
          prNumber: 42,
          parent: 'PROJ-100',
        },
      ],
      'jira',
    );

    expect(body).not.toContain('Closes');
  });

  it('does not include Closes keywords when provider is not specified', () => {
    const body = buildEpicPrBody('PROJ-100', 'Portal', [
      {
        timestamp: '2024-01-15 14:30',
        key: 'PROJ-101',
        summary: 'Setup',
        status: 'DONE',
      },
    ]);

    expect(body).not.toContain('Closes');
  });
});
