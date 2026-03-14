/**
 * Zod schemas for Bitbucket PR API responses (Cloud and Server).
 */
import * as z from 'zod/mini';

// ---------------------------------------------------------------------------
// Bitbucket Cloud
// ---------------------------------------------------------------------------

/** A single PR from the Cloud list endpoint. */
export const bitbucketPrSchema = z.object({
  id: z.number(),
  links: z.object({
    html: z.optional(z.object({ href: z.optional(z.string()) })),
  }),
  participants: z.array(
    z.object({
      state: z.optional(z.string()),
      role: z.string(),
    }),
  ),
});

/** Response from `GET /repositories/{workspace}/{slug}/pullrequests` (paginated). */
export const bitbucketPrListSchema = z.object({
  values: z.array(bitbucketPrSchema),
});

/** A single inline comment on a Cloud PR. */
export const bitbucketCommentSchema = z.object({
  content: z.object({ raw: z.string() }),
  inline: z.optional(
    z.object({
      path: z.optional(z.string()),
    }),
  ),
  created_on: z.string(),
});

/** Response from `GET /repositories/{workspace}/{slug}/pullrequests/{id}/comments` (paginated). */
export const bitbucketCommentsSchema = z.object({
  values: z.array(bitbucketCommentSchema),
});

// ---------------------------------------------------------------------------
// Bitbucket Server (Data Center)
// ---------------------------------------------------------------------------

/** A single PR from the Server list endpoint. */
export const bitbucketServerPrSchema = z.object({
  id: z.number(),
  links: z.object({
    self: z.optional(z.array(z.object({ href: z.optional(z.string()) }))),
  }),
  reviewers: z.array(
    z.object({
      status: z.string(),
    }),
  ),
});

/** Response from `GET /rest/api/latest/projects/{key}/repos/{slug}/pull-requests` (paginated). */
export const bitbucketServerPrListSchema = z.object({
  values: z.array(bitbucketServerPrSchema),
});

/** A single comment/activity on a Server PR. */
export const bitbucketServerCommentSchema = z.object({
  text: z.string(),
  anchor: z.optional(
    z.object({
      path: z.optional(z.string()),
    }),
  ),
  createdDate: z.number(),
});

/** Response from Server PR comments/activities endpoint (paginated). */
export const bitbucketServerCommentsSchema = z.object({
  values: z.array(bitbucketServerCommentSchema),
});

// ---------------------------------------------------------------------------
// Inferred types — Cloud
// ---------------------------------------------------------------------------
export type BitbucketPr = z.infer<typeof bitbucketPrSchema>;
export type BitbucketPrList = z.infer<typeof bitbucketPrListSchema>;
export type BitbucketComment = z.infer<typeof bitbucketCommentSchema>;
export type BitbucketComments = z.infer<typeof bitbucketCommentsSchema>;

// ---------------------------------------------------------------------------
// Inferred types — Server
// ---------------------------------------------------------------------------
export type BitbucketServerPr = z.infer<typeof bitbucketServerPrSchema>;
export type BitbucketServerPrList = z.infer<typeof bitbucketServerPrListSchema>;
export type BitbucketServerComment = z.infer<
  typeof bitbucketServerCommentSchema
>;
export type BitbucketServerComments = z.infer<
  typeof bitbucketServerCommentsSchema
>;
