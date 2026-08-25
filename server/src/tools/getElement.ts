import type { ToolImplementation } from '../protocol/types.js';
import { getDocument, WordPressApiError } from '../wp/client.js';
import { findElementById } from '../domain/find.js';
import type { ElementorNode } from '../domain/detect.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    post_id: { type: 'integer' },
    source: { type: 'string', enum: ['parent', 'autosave'] },
    document_hash: { type: 'string' },
    element: { type: 'object' },
  },
  required: ['post_id', 'source', 'document_hash', 'element'],
  additionalProperties: false,
} as const;

/**
 * EMCP-025: the opposite tradeoff from `get_page_structure` (Blueprints.md
 * §7.3 — "get_element is for full native settings"). Returns one element's
 * exact native JSON — unmodified, un-normalized, un-truncated — rather
 * than the depth-limited digest shape. Reuses `getDocument()`
 * (`GET /documents/{id}`, EMCP-024): no new plugin route needed, since
 * that route already returns the full raw element tree this walks.
 */
export const getElementTool: ToolImplementation = {
  name: 'get_element',
  description:
    'Returns one element\'s full native Elementor settings by id — ' +
    'unnormalized, with everything get_page_structure strips or truncates ' +
    '(styles, interactions, editor_settings, nested children in full). Use ' +
    'this after get_page_structure or find_elements has given you an ' +
    'element id and you need its complete settings, not just a summary. ' +
    'Do not use this to browse a whole page (use get_page_structure) or to ' +
    'search by content or widget type (use find_elements).',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      element_id: {
        type: 'string',
        description: 'The element id, from get_page_structure or find_elements.',
      },
      source: {
        type: 'string',
        enum: ['parent', 'autosave'],
        description:
          'Which copy of the page to read. "parent" (default) is the published/saved ' +
          'content; "autosave" is the draft revision on top of a published page.',
      },
    },
    required: ['post_id', 'element_id'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0, // page-derived (Blueprints.md §7's convention) — content changes on every save
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler(args) {
    const postId = args?.['post_id'];
    const elementId = args?.['element_id'];

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return {
        content: [{ type: 'text', text: 'get_element requires an integer "post_id".' }],
        isError: true,
      };
    }

    if (typeof elementId !== 'string' || elementId.length === 0) {
      return {
        content: [{ type: 'text', text: 'get_element requires a non-empty string "element_id".' }],
        isError: true,
      };
    }

    const source = args?.['source'] === 'autosave' ? 'autosave' : 'parent';

    try {
      const document = await getDocument(postId, { source });
      const elements = Array.isArray(document['elements']) ? (document['elements'] as ElementorNode[]) : [];
      const element = findElementById(elements, elementId);

      if (!element) {
        return {
          content: [
            { type: 'text', text: `No element with id "${elementId}" was found on post ${postId}.` },
          ],
          isError: true,
        };
      }

      const result = {
        post_id: postId,
        source,
        document_hash: typeof document['document_hash'] === 'string' ? document['document_hash'] : '',
        element,
      };

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
    return `WordPress returned ${error.status} for GET /documents/{id}: ${error.message}`;
  }

  return `Could not reach WordPress: ${error instanceof Error ? error.message : String(error)}`;
}
