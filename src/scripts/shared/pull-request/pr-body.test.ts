import { describe, expect, it } from 'vitest';

import type { BoardConfig, Ticket } from '~/types/index.js';

import { buildPrBody } from './pr-body.js';

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

  it('includes Closes #N for GitHub boards', () => {
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
});
