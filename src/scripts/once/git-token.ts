import type { BoardConfig } from '~/scripts/shared/env-schema/env-schema.js';
import type { RemoteInfo } from '~/types/index.js';

import { sharedEnv } from './board-ops.js';

/**
 * Resolve a git host token from the board config's env.
 *
 * For GitHub boards, `GITHUB_TOKEN` is always present.
 * For Jira/Linear boards, check the shared optional vars.
 */
export function resolveGitToken(
  config: BoardConfig,
  remote: RemoteInfo,
): { token: string; username?: string } | undefined {
  const env = sharedEnv(config);

  switch (remote.host) {
    case 'github':
      if (env.GITHUB_TOKEN) return { token: env.GITHUB_TOKEN };
      break;
    case 'gitlab':
      if (env.GITLAB_TOKEN) return { token: env.GITLAB_TOKEN };
      break;
    case 'bitbucket':
      if (env.BITBUCKET_USER && env.BITBUCKET_TOKEN)
        return { token: env.BITBUCKET_TOKEN, username: env.BITBUCKET_USER };
      break;
    case 'bitbucket-server':
      if (env.BITBUCKET_TOKEN) return { token: env.BITBUCKET_TOKEN };
      break;
  }
  return undefined;
}
