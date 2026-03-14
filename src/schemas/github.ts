/**
 * Zod schemas for GitHub Issues REST API responses.
 */
import { z } from 'zod/mini';

/** A single GitHub issue from the list endpoint. */
export const githubIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.optional(z.nullable(z.string())),
  pull_request: z.optional(z.unknown()),
  milestone: z.optional(
    z.nullable(
      z.object({
        title: z.string(),
      }),
    ),
  ),
});

/** Response from `GET /repos/{owner}/{repo}/issues` (array of issues). */
export const githubIssuesResponseSchema = z.array(githubIssueSchema);

/** A single GitHub issue comment from the comments endpoint. */
export const githubCommentSchema = z.object({
  id: z.number(),
  body: z.optional(z.nullable(z.string())),
  created_at: z.string(),
});

/** Response from `GET /repos/{owner}/{repo}/issues/{number}/comments` (array of comments). */
export const githubCommentsResponseSchema = z.array(githubCommentSchema);

export type GitHubIssue = z.infer<typeof githubIssueSchema>;
export type GitHubIssuesResponse = z.infer<typeof githubIssuesResponseSchema>;
export type GitHubComment = z.infer<typeof githubCommentSchema>;
export type GitHubCommentsResponse = z.infer<
  typeof githubCommentsResponseSchema
>;
