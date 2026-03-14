/**
 * Zod schemas for GitLab Merge Request API responses.
 */
import * as z from 'zod/mini';

/** A single MR from the list endpoint. */
export const gitlabMrSchema = z.object({
  iid: z.number(),
  web_url: z.string(),
  detailed_merge_status: z.optional(z.string()),
});

/** Response from `GET /projects/:id/merge_requests` (array of MRs). */
export const gitlabMrListSchema = z.array(gitlabMrSchema);

/** A single note within an MR discussion. */
export const gitlabNoteSchema = z.object({
  body: z.string(),
  resolvable: z.boolean(),
  resolved: z.optional(z.boolean()),
  system: z.boolean(),
  type: z.optional(z.nullable(z.string())),
  position: z.optional(
    z.object({
      new_path: z.optional(z.string()),
    }),
  ),
});

/** A single MR discussion (contains one or more notes). */
export const gitlabDiscussionSchema = z.object({
  notes: z.array(gitlabNoteSchema),
});

/** Response from `GET /projects/:id/merge_requests/:iid/discussions` (array). */
export const gitlabDiscussionsSchema = z.array(gitlabDiscussionSchema);

export type GitLabMr = z.infer<typeof gitlabMrSchema>;
export type GitLabMrList = z.infer<typeof gitlabMrListSchema>;
export type GitLabNote = z.infer<typeof gitlabNoteSchema>;
export type GitLabDiscussion = z.infer<typeof gitlabDiscussionSchema>;
export type GitLabDiscussions = z.infer<typeof gitlabDiscussionsSchema>;
