/**
 * Zod schemas for Linear GraphQL API responses.
 */
import { z } from 'zod/mini';

/** A single Linear issue node from the assignedIssues query. */
const linearIssueNodeSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.optional(z.nullable(z.string())),
  parent: z.optional(
    z.nullable(
      z.object({
        identifier: z.string(),
        title: z.optional(z.string()),
      }),
    ),
  ),
});

/** Response from the `viewer.assignedIssues` GraphQL query. */
export const linearIssuesResponseSchema = z.object({
  data: z.optional(
    z.object({
      viewer: z.optional(
        z.object({
          assignedIssues: z.optional(
            z.object({
              nodes: z.array(linearIssueNodeSchema),
            }),
          ),
        }),
      ),
    }),
  ),
});

/** Response from the `viewer` ping query. */
export const linearViewerResponseSchema = z.object({
  data: z.optional(
    z.object({
      viewer: z.optional(
        z.object({
          id: z.optional(z.string()),
        }),
      ),
    }),
  ),
});

/** Response from the `workflowStates` query. */
export const linearWorkflowStatesResponseSchema = z.object({
  data: z.optional(
    z.object({
      workflowStates: z.optional(
        z.object({
          nodes: z.array(z.object({ id: z.string() })),
        }),
      ),
    }),
  ),
});

/** Response from the `issueUpdate` mutation. */
export const linearIssueUpdateResponseSchema = z.object({
  data: z.optional(
    z.object({
      issueUpdate: z.optional(
        z.object({
          success: z.optional(z.boolean()),
        }),
      ),
    }),
  ),
});

/** A single comment node from an issue comments query. */
const linearCommentNodeSchema = z.object({
  body: z.string(),
  createdAt: z.string(),
});

/** Response from the `issue.comments` GraphQL query. */
export const linearCommentsResponseSchema = z.object({
  data: z.optional(
    z.object({
      issue: z.optional(
        z.object({
          comments: z.optional(
            z.object({
              nodes: z.array(linearCommentNodeSchema),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type LinearIssueNode = z.infer<typeof linearIssueNodeSchema>;
export type LinearIssuesResponse = z.infer<typeof linearIssuesResponseSchema>;
export type LinearViewerResponse = z.infer<typeof linearViewerResponseSchema>;
export type LinearWorkflowStatesResponse = z.infer<
  typeof linearWorkflowStatesResponseSchema
>;
export type LinearIssueUpdateResponse = z.infer<
  typeof linearIssueUpdateResponseSchema
>;
export type LinearCommentNode = z.infer<typeof linearCommentNodeSchema>;
export type LinearCommentsResponse = z.infer<
  typeof linearCommentsResponseSchema
>;
