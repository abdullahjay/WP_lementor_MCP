import type { ToolImplementation } from '../protocol/types.js';
import { InvalidPageTemplateError, updateDocumentAttributes, WordPressApiError } from '../wp/client.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    title: { type: 'string' },
    page_template: { type: 'string' },
    status: { type: 'string' },
    link: { type: 'string' },
  },
  required: ['id', 'title', 'page_template', 'status', 'link'],
  additionalProperties: false,
} as const;

/**
 * EMCP-046 — Blueprints.md §6.9/§7.7. Updates a page's **attributes**
 * (title, Elementor page template) — not its content. Deliberately not the
 * same tool as `edit_elements`: `_wp_page_template` is a real WordPress post
 * attribute that controls which PHP template renders the post on *every*
 * request regardless of publish state, so unlike `edit_elements` (EMCP-045)
 * this never branches to an autosave — it always writes the real post
 * directly, the same way a title change always takes effect immediately
 * rather than being staged. No `document_hash` argument either, for the
 * same reason: the compare-and-swap protects the element tree from a
 * concurrent editor session; title/template aren't part of that tree.
 */
export const updatePageTool: ToolImplementation = {
  name: 'update_page',
  description:
    'Updates a page\'s title and/or Elementor page template. Always writes ' +
    'the real post directly and takes effect immediately, even on a ' +
    'published page — this is not "document content" the way ' +
    'edit_elements\'s element edits are, so there is no draft/autosave ' +
    'staging and no document_hash to pass. At least one of title or ' +
    'page_template is required. Use edit_elements to change what\'s on the ' +
    'page; use this only for the page\'s own title or template.',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      title: { type: 'string', description: 'New title for the page.' },
      page_template: { type: 'string', description: 'New Elementor page template slug.' },
    },
    required: ['post_id'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },

  async handler(args) {
    const postId = args?.['post_id'];

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return errorResult('update_page requires an integer "post_id".');
    }

    const title = typeof args?.['title'] === 'string' && args['title'].trim() !== '' ? args['title'] : undefined;
    const pageTemplate =
      typeof args?.['page_template'] === 'string' && args['page_template'] !== '' ? args['page_template'] : undefined;

    if (title === undefined && pageTemplate === undefined) {
      return errorResult('update_page requires at least one of "title" or "page_template".');
    }

    try {
      const updated = await updateDocumentAttributes(postId, { title, pageTemplate });

      const result = {
        id: updated.id,
        title: updated.title,
        page_template: updated.pageTemplate,
        status: updated.status,
        link: updated.link,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      };
    } catch (error) {
      return { content: [{ type: 'text', text: describeError(error, postId) }], isError: true };
    }
  },
};

function errorResult(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function describeError(error: unknown, postId: number): string {
  if (error instanceof InvalidPageTemplateError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    if (error.status === 404) {
      return `No Elementor document exists with post_id ${postId}.`;
    }
    if (error.status === 403) {
      return `The authenticated user is not permitted to edit post ${postId}.`;
    }
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `update_page failed: ${error instanceof Error ? error.message : String(error)}`;
}
