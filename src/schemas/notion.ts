/**
 * Zod schemas for Notion REST API responses.
 *
 * Notion uses a dynamic property system where each property has a `type`
 * field and a corresponding nested value. These schemas validate the
 * paginated database query responses, page objects, and user responses.
 */
import { z } from 'zod/mini';

// ─── Property value schemas ─────────────────────────────────────────────────

/** A rich text array element. */
const richTextElementSchema = z.object({
  plain_text: z.string(),
});

/** Status property value. */
const statusPropertySchema = z.object({
  type: z.literal('status'),
  status: z.nullable(
    z.object({
      id: z.optional(z.string()),
      name: z.string(),
      color: z.optional(z.string()),
    }),
  ),
});

/** Select property value. */
const selectPropertySchema = z.object({
  type: z.literal('select'),
  select: z.nullable(
    z.object({
      id: z.optional(z.string()),
      name: z.string(),
      color: z.optional(z.string()),
    }),
  ),
});

/** Multi-select option. */
const multiSelectOptionSchema = z.object({
  id: z.optional(z.string()),
  name: z.string(),
  color: z.optional(z.string()),
});

/** Multi-select property value. */
const multiSelectPropertySchema = z.object({
  type: z.literal('multi_select'),
  multi_select: z.array(multiSelectOptionSchema),
});

/** People property value. */
const peoplePropertySchema = z.object({
  type: z.literal('people'),
  people: z.array(
    z.object({
      id: z.string(),
      name: z.optional(z.nullable(z.string())),
    }),
  ),
});

/** Relation property value. */
const relationPropertySchema = z.object({
  type: z.literal('relation'),
  relation: z.array(
    z.object({
      id: z.string(),
    }),
  ),
});

/** Title property value. */
const titlePropertySchema = z.object({
  type: z.literal('title'),
  title: z.array(richTextElementSchema),
});

/** Rich text property value. */
const richTextPropertySchema = z.object({
  type: z.literal('rich_text'),
  rich_text: z.array(richTextElementSchema),
});

/** A dynamic property — one of the known types or a generic fallback. */
const propertyValueSchema = z.union([
  statusPropertySchema,
  selectPropertySchema,
  multiSelectPropertySchema,
  peoplePropertySchema,
  relationPropertySchema,
  titlePropertySchema,
  richTextPropertySchema,
  // Fallback for unknown property types (number, date, checkbox, etc.)
  z.object({ type: z.string() }),
]);

// ─── Page schema ────────────────────────────────────────────────────────────

/** A Notion page object from a database query. */
export const notionPageSchema = z.object({
  id: z.string(),
  url: z.optional(z.string()),
  properties: z.record(z.string(), propertyValueSchema),
});

// ─── Database query response ────────────────────────────────────────────────

/** Response from POST /databases/{id}/query — paginated. */
export const notionDatabaseQueryResponseSchema = z.object({
  results: z.array(notionPageSchema),
  has_more: z.boolean(),
  next_cursor: z.nullable(z.optional(z.string())),
});

// ─── User response ──────────────────────────────────────────────────────────

/** Response from GET /users/me — the authenticated bot user. */
export const notionUserResponseSchema = z.object({
  id: z.string(),
  type: z.optional(z.string()),
  name: z.optional(z.nullable(z.string())),
  avatar_url: z.optional(z.nullable(z.string())),
});

// ─── Inferred types ─────────────────────────────────────────────────────────

export type NotionPage = z.infer<typeof notionPageSchema>;
export type NotionDatabaseQueryResponse = z.infer<
  typeof notionDatabaseQueryResponseSchema
>;
export type NotionUserResponse = z.infer<typeof notionUserResponseSchema>;
export type NotionMultiSelectOption = z.infer<typeof multiSelectOptionSchema>;
