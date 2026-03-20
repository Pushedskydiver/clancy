/**
 * Zod schemas for Jira Cloud REST API responses.
 */
import { z } from 'zod/mini';

/** A single issue link in a Jira issue. */
const jiraIssueLinkSchema = z.object({
  type: z.optional(z.object({ name: z.optional(z.string()) })),
  inwardIssue: z.optional(z.object({ key: z.optional(z.string()) })),
});

/** The fields returned for a single Jira issue. */
const jiraIssueFieldsSchema = z.object({
  summary: z.string(),
  description: z.optional(z.unknown()),
  issuelinks: z.optional(z.array(jiraIssueLinkSchema)),
  parent: z.optional(z.object({ key: z.optional(z.string()) })),
  customfield_10014: z.optional(z.nullable(z.string())),
  labels: z.optional(z.array(z.string())),
});

/** A single Jira issue from the search response. */
const jiraIssueSchema = z.object({
  key: z.string(),
  fields: jiraIssueFieldsSchema,
});

/** Response from `POST /rest/api/3/search/jql`. */
export const jiraSearchResponseSchema = z.object({
  total: z.optional(z.number()),
  isLast: z.optional(z.boolean()),
  issues: z.array(jiraIssueSchema),
});

/** A single transition from `GET /rest/api/3/issue/{key}/transitions`. */
const jiraTransitionSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/** Response from `GET /rest/api/3/issue/{key}/transitions`. */
export const jiraTransitionsResponseSchema = z.object({
  transitions: z.array(jiraTransitionSchema),
});

/** Schema for a single issue link with full status info (used by fetchBlockerStatus). */
const jiraBlockerIssueLinkSchema = z.object({
  type: z.optional(z.object({ name: z.optional(z.string()) })),
  inwardIssue: z.optional(
    z.object({
      key: z.optional(z.string()),
      fields: z.optional(
        z.object({
          status: z.optional(
            z.object({
              statusCategory: z.optional(
                z.object({ key: z.optional(z.string()) }),
              ),
            }),
          ),
        }),
      ),
    }),
  ),
});

/** Response from `GET /rest/api/3/issue/{key}?fields=issuelinks`. */
export const jiraIssueLinksResponseSchema = z.object({
  fields: z.optional(
    z.object({
      issuelinks: z.optional(z.array(jiraBlockerIssueLinkSchema)),
    }),
  ),
});

export type JiraSearchResponse = z.infer<typeof jiraSearchResponseSchema>;
export type JiraTransitionsResponse = z.infer<
  typeof jiraTransitionsResponseSchema
>;
export type JiraIssueLinksResponse = z.infer<
  typeof jiraIssueLinksResponseSchema
>;
