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

export type LinearIssueNode = z.infer<typeof linearIssueNodeSchema>;
export type LinearIssuesResponse = z.infer<typeof linearIssuesResponseSchema>;
