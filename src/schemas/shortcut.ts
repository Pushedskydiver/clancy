/**
 * Zod schemas for Shortcut REST API responses.
 */
import { z } from 'zod/mini';

/** A single story link (used for blocker detection). */
const storyLinkSchema = z.object({
  verb: z.string(),
  subject_id: z.number(),
  object_id: z.number(),
});

/** A single story from story search or epic stories. */
const shortcutStoryNodeSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.optional(z.nullable(z.string())),
  story_type: z.optional(z.string()),
  blocked: z.optional(z.boolean()),
  story_links: z.optional(z.array(storyLinkSchema)),
  label_ids: z.optional(z.array(z.number())),
  labels: z.optional(
    z.array(
      z.object({
        id: z.number(),
        name: z.string(),
      }),
    ),
  ),
  epic_id: z.optional(z.nullable(z.number())),
  workflow_state_id: z.optional(z.number()),
  owner_ids: z.optional(z.array(z.string())),
});

/** Response from POST /stories/search — paginated object with data array. */
export const shortcutStorySearchResponseSchema = z.object({
  data: z.array(shortcutStoryNodeSchema),
  next: z.optional(z.nullable(z.string())),
  total: z.optional(z.number()),
});

/** Response from GET /stories/{id} — single story detail. */
export const shortcutStoryDetailResponseSchema = shortcutStoryNodeSchema;

/** A single workflow state. */
const workflowStateSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
});

/** A single workflow. */
const workflowSchema = z.object({
  id: z.number(),
  name: z.string(),
  states: z.array(workflowStateSchema),
});

/** Response from GET /workflows — array of workflows. */
export const shortcutWorkflowsResponseSchema = z.array(workflowSchema);

/** A single label. */
const labelSchema = z.object({
  id: z.number(),
  name: z.string(),
});

/** Response from GET /labels — array of labels. */
export const shortcutLabelsResponseSchema = z.array(labelSchema);

/** Response from POST /labels — a single created label. */
export const shortcutLabelCreateResponseSchema = labelSchema;

/** Response from GET /epics/{id}/stories — array of stories. */
export const shortcutEpicStoriesResponseSchema = z.array(
  shortcutStoryNodeSchema,
);

/** Response from GET /member-info — authenticated member. */
export const shortcutMemberInfoResponseSchema = z.object({
  id: z.string(),
  mention_name: z.optional(z.string()),
});

/** Response from PUT /stories/{id} — updated story. */
export const shortcutStoryUpdateResponseSchema = shortcutStoryNodeSchema;

// ─── Inferred types ──────────────────────────────────────────────────────────

export type ShortcutStoryNode = z.infer<typeof shortcutStoryNodeSchema>;
export type ShortcutStorySearchResponse = z.infer<
  typeof shortcutStorySearchResponseSchema
>;
export type ShortcutStoryDetailResponse = z.infer<
  typeof shortcutStoryDetailResponseSchema
>;
export type ShortcutWorkflowsResponse = z.infer<
  typeof shortcutWorkflowsResponseSchema
>;
export type ShortcutLabelsResponse = z.infer<
  typeof shortcutLabelsResponseSchema
>;
export type ShortcutLabelCreateResponse = z.infer<
  typeof shortcutLabelCreateResponseSchema
>;
export type ShortcutEpicStoriesResponse = z.infer<
  typeof shortcutEpicStoriesResponseSchema
>;
export type ShortcutMemberInfoResponse = z.infer<
  typeof shortcutMemberInfoResponseSchema
>;
