/**
 * Zod schemas for Azure DevOps REST API responses.
 */
import { z } from 'zod/mini';

/** A single work item ID reference from a WIQL query result. */
const wiqlWorkItemRefSchema = z.object({
  id: z.number(),
  url: z.optional(z.string()),
});

/** Response from POST /_apis/wit/wiql — returns work item IDs only. */
export const azdoWiqlResponseSchema = z.object({
  workItems: z.array(wiqlWorkItemRefSchema),
});

/** A relation on a work item (parent, child, blocker, etc.). */
const workItemRelationSchema = z.object({
  rel: z.string(),
  url: z.string(),
  attributes: z.optional(
    z.object({
      name: z.optional(z.string()),
    }),
  ),
});

/** Work item fields returned by the work items endpoint. */
const workItemFieldsSchema = z.object({
  'System.Title': z.optional(z.string()),
  'System.Description': z.optional(z.nullable(z.string())),
  'System.State': z.optional(z.string()),
  'System.Tags': z.optional(z.nullable(z.string())),
  'System.AssignedTo': z.optional(
    z.nullable(
      z.object({
        displayName: z.optional(z.string()),
        uniqueName: z.optional(z.string()),
      }),
    ),
  ),
  'System.WorkItemType': z.optional(z.string()),
});

/** A single work item from the work items endpoint. */
export const azdoWorkItemSchema = z.object({
  id: z.number(),
  fields: workItemFieldsSchema,
  relations: z.optional(z.nullable(z.array(workItemRelationSchema))),
});

/** Response from GET /_apis/wit/workitems?ids=... — batch fetch. */
export const azdoWorkItemsBatchResponseSchema = z.object({
  value: z.array(azdoWorkItemSchema),
  count: z.optional(z.number()),
});

/** Response from GET /_apis/projects/{project} — ping. */
export const azdoProjectResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.optional(z.string()),
});

/** WIQL link query result — used for parent/child link queries. */
const wiqlLinkRefSchema = z.object({
  source: z.optional(z.nullable(wiqlWorkItemRefSchema)),
  target: z.optional(z.nullable(wiqlWorkItemRefSchema)),
});

/** Response from POST /_apis/wit/wiql for link queries. */
export const azdoWiqlLinkResponseSchema = z.object({
  workItemRelations: z.optional(z.array(wiqlLinkRefSchema)),
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type AzdoWiqlResponse = z.infer<typeof azdoWiqlResponseSchema>;
export type AzdoWorkItem = z.infer<typeof azdoWorkItemSchema>;
export type AzdoWorkItemsBatchResponse = z.infer<
  typeof azdoWorkItemsBatchResponseSchema
>;
export type AzdoProjectResponse = z.infer<typeof azdoProjectResponseSchema>;
export type AzdoWiqlLinkResponse = z.infer<typeof azdoWiqlLinkResponseSchema>;
