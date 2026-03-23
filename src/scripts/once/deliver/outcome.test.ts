import { describe, expect, it } from 'vitest';

import type { PrCreationResult, RemoteInfo } from '~/types/index.js';

import { computeDeliveryOutcome } from './outcome.js';
import type { DeliveryOutcome } from './outcome.js';

const githubRemote: RemoteInfo = {
  host: 'github',
  owner: 'owner',
  repo: 'repo',
  hostname: 'github.com',
};

const gitlabRemote: RemoteInfo = {
  host: 'gitlab',
  hostname: 'gitlab.com',
  projectPath: 'owner/repo',
};

describe('computeDeliveryOutcome', () => {
  it('returns "created" when PR was successfully created', () => {
    const pr: PrCreationResult = {
      ok: true,
      url: 'https://github.com/o/r/pull/42',
      number: 42,
    };

    const result = computeDeliveryOutcome(
      pr,
      githubRemote,
      'feature/x',
      'main',
    );

    expect(result).toEqual<DeliveryOutcome>({
      type: 'created',
      url: 'https://github.com/o/r/pull/42',
      number: 42,
    });
  });

  it('returns "exists" when PR already exists', () => {
    const pr: PrCreationResult = {
      ok: false,
      error: 'already exists',
      alreadyExists: true,
    };

    const result = computeDeliveryOutcome(
      pr,
      githubRemote,
      'feature/x',
      'main',
    );

    expect(result).toEqual<DeliveryOutcome>({ type: 'exists' });
  });

  it('returns "failed" with error and manual URL when PR creation fails', () => {
    const pr: PrCreationResult = {
      ok: false,
      error: 'Validation Failed',
    };

    const result = computeDeliveryOutcome(
      pr,
      githubRemote,
      'feature/x',
      'main',
    );

    expect(result.type).toBe('failed');
    if (result.type === 'failed') {
      expect(result.error).toBe('Validation Failed');
      expect(result.manualUrl).toBeDefined();
    }
  });

  it('returns "not_attempted" with manual URL when pr is undefined', () => {
    const result = computeDeliveryOutcome(
      undefined,
      githubRemote,
      'feature/x',
      'main',
    );

    expect(result.type).toBe('not_attempted');
    if (result.type === 'not_attempted') {
      expect(result.manualUrl).toBeDefined();
    }
  });

  it('returns "local" when remote host is "none"', () => {
    const noneRemote: RemoteInfo = { host: 'none' };

    const result = computeDeliveryOutcome(
      undefined,
      noneRemote,
      'feature/x',
      'main',
    );

    expect(result).toEqual<DeliveryOutcome>({ type: 'local' });
  });

  it('returns "unsupported" when remote host is "unknown"', () => {
    const unknownRemote: RemoteInfo = {
      host: 'unknown',
      url: 'https://example.invalid',
    };

    const result = computeDeliveryOutcome(
      undefined,
      unknownRemote,
      'feature/x',
      'main',
    );

    expect(result).toEqual<DeliveryOutcome>({ type: 'unsupported' });
  });

  it('returns "unsupported" when remote host is "azure"', () => {
    const azureRemote: RemoteInfo = {
      host: 'azure',
      url: 'https://dev.azure.com/org/project/_git/repo',
    };

    const result = computeDeliveryOutcome(
      undefined,
      azureRemote,
      'feature/x',
      'main',
    );

    expect(result).toEqual<DeliveryOutcome>({ type: 'unsupported' });
  });

  it('includes manual URL for GitLab remotes', () => {
    const pr: PrCreationResult = {
      ok: false,
      error: 'forbidden',
    };

    const result = computeDeliveryOutcome(
      pr,
      gitlabRemote,
      'feature/x',
      'main',
    );

    expect(result.type).toBe('failed');
    if (result.type === 'failed') {
      expect(result.manualUrl).toBeDefined();
    }
  });
});
