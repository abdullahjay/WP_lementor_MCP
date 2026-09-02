import type { ToolImplementation } from '../protocol/types.js';
import { listPages, WordPressApiError } from '../wp/client.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    documents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
          status: { type: 'string' },
          type: { type: 'string' },
          modified: { type: 'string' },
          edit_url: { type: ['string', 'null'] },
          link: { type: ['string', 'null'] },
        },
        required: ['id', 'title', 'status', 'type', 'modified', 'edit_url', 'link'],
        additionalProperties: false,
      },
    },
    count: { type: 'integer' },
  },
  required: ['documents', 'count'],
  additionalProperties: false,
} as const;

/**
 * EMCP-023: the first read tool over actual page content (as opposed to
 * site capabilities, EMCP-007). Lists posts Elementor has built —
 * `GET /documents` (Blueprints.md §6), implemented alongside this in the
 * plugin (`DocumentsController.php`). Deliberately shallow: no element
 * tree, no generation, no document hash — that's `get_page_structure`
 * (EMCP-024), a separate per-page call.
 */
export const listPagesTool: ToolImplementation = {
  name: 'list_pages',
  description:
    'Lists pages/posts on the connected site that Elementor has actually ' +
    'built (not every post — only ones with real Elementor content). ' +
    'Returns id, title, status, post type, last-modified time, and an edit ' +
    'URL for each. Use this to find a post_id before calling ' +
    'get_page_structure or get_element. Does not return page content or ' +
    'structure itself — call get_page_structure with the post_id for that.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0, // page-derived (Blueprints.md §7's convention) — the list changes whenever a page is created, trashed or its Elementor status changes
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler() {
    try {
      const result = await listPages();

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      };
    } catch (error) {
      const message = describeError(error);

      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  },
};

function describeError(error: unknown): string {
  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status} for GET /documents: ${error.message}`;
  }

  return `Could not reach WordPress: ${error instanceof Error ? error.message : String(error)}`;
}
