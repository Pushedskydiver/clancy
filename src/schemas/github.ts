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

/** A single PR from the list endpoint. */
export const githubPrSchema = z.object({
  number: z.number(),
  html_url: z.string(),
  state: z.string(),
});

/** Response from `GET /repos/{owner}/{repo}/pulls` (array of PRs). */
export const githubPrListSchema = z.array(githubPrSchema);

/** A single review on a PR. */
export const githubReviewSchema = z.object({
  state: z.string(),
  user: z.object({ login: z.string() }),
  submitted_at: z.string(),
});

/** Response from `GET /repos/{owner}/{repo}/pulls/{number}/reviews` (array). */
export const githubReviewListSchema = z.array(githubReviewSchema);

/** A single inline (pull request) comment. */
export const githubPrCommentSchema = z.object({
  body: z.optional(z.nullable(z.string())),
  path: z.optional(z.string()),
  created_at: z.optional(z.string()),
});

/** Response from `GET /repos/{owner}/{repo}/pulls/{number}/comments` (array). */
export const githubPrCommentsSchema = z.array(githubPrCommentSchema);

export type GitHubIssue = z.infer<typeof githubIssueSchema>;
export type GitHubIssuesResponse = z.infer<typeof githubIssuesResponseSchema>;
export type GitHubComment = z.infer<typeof githubCommentSchema>;
export type GitHubCommentsResponse = z.infer<
  typeof githubCommentsResponseSchema
>;
export type GitHubPr = z.infer<typeof githubPrSchema>;
export type GitHubPrList = z.infer<typeof githubPrListSchema>;
export type GitHubReview = z.infer<typeof githubReviewSchema>;
export type GitHubReviewList = z.infer<typeof githubReviewListSchema>;
export type GitHubPrComment = z.infer<typeof githubPrCommentSchema>;
export type GitHubPrComments = z.infer<typeof githubPrCommentsSchema>;
