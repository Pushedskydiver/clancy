import { describe, expect, it } from 'vitest';

import { parseEnvContent } from './env-parser.js';

describe('parseEnvContent', () => {
  it('parses simple key=value pairs', () => {
    const result = parseEnvContent('FOO=bar\nBAZ=qux');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('strips double quotes from values', () => {
    const result = parseEnvContent('KEY="value"');
    expect(result).toEqual({ KEY: 'value' });
  });

  it('strips single quotes from values', () => {
    const result = parseEnvContent("KEY='value'");
    expect(result).toEqual({ KEY: 'value' });
  });

  it('ignores blank lines', () => {
    const result = parseEnvContent('FOO=bar\n\nBAZ=qux\n');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('ignores comment lines', () => {
    const result = parseEnvContent('# comment\nFOO=bar\n# another');
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('ignores lines without =', () => {
    const result = parseEnvContent('FOO=bar\nINVALID_LINE\nBAZ=qux');
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('handles values with = in them', () => {
    const result = parseEnvContent('URL=https://example.com?foo=bar&baz=1');
    expect(result).toEqual({ URL: 'https://example.com?foo=bar&baz=1' });
  });

  it('handles empty values', () => {
    const result = parseEnvContent('KEY=');
    expect(result).toEqual({ KEY: '' });
  });

  it('trims whitespace around keys and values', () => {
    const result = parseEnvContent('  KEY  =  value  ');
    expect(result).toEqual({ KEY: 'value' });
  });

  it('handles a realistic .env file', () => {
    const content = [
      '# Jira configuration',
      'JIRA_BASE_URL=https://example.atlassian.net',
      'JIRA_USER=user@example.com',
      'JIRA_API_TOKEN="my-secret-token"',
      'JIRA_PROJECT_KEY=PROJ',
      '',
      '# Optional',
      "CLANCY_STATUS_IN_PROGRESS='In Progress'",
      'CLANCY_STATUS_DONE=Done',
    ].join('\n');

    const result = parseEnvContent(content);

    expect(result).toEqual({
      JIRA_BASE_URL: 'https://example.atlassian.net',
      JIRA_USER: 'user@example.com',
      JIRA_API_TOKEN: 'my-secret-token',
      JIRA_PROJECT_KEY: 'PROJ',
      CLANCY_STATUS_IN_PROGRESS: 'In Progress',
      CLANCY_STATUS_DONE: 'Done',
    });
  });

  it('returns empty object for empty string', () => {
    expect(parseEnvContent('')).toEqual({});
  });
});
