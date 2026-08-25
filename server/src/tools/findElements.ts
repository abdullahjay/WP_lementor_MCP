import type { ToolImplementation } from '../protocol/types.js';
import { getDocument, WordPressApiError } from '../wp/client.js';
import { containsText, findElements, type ElementPredicate } from '../domain/find.js';
import { describeNode } from '../domain/digest.js';
import type { ElementorNode } from '../domain/detect.js';

const DEFAULT_MAX_RESULTS = 50;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    post_id: { type: 'integer' },
    source: { type: 'string', enum: ['parent', 'autosave'] },
    document_hash: { type: 'string' },
    count: { type: 'integer' },
    truncated: { type: 'integer' },
    matches: {
      type: 'array',
      items: { type: 'object' },
    },
  },
  required: ['post_id', 'source', 'document_hash', 'count', 'truncated', 'matches'],
  additionalProperties: false,
} as const;

/**
 * EMCP-026: search rather than lookup-by-id. "Returns enough per match to
 * skip a follow-up get_element in the common case" (Blueprints.md §7.3) —
 * each match is `digest.ts`'s `describeNode()` shape (id, kind, type,
 * generation, native, label, childCount), the same per-node summary
 * `get_page_structure` uses, not the full native settings tree
 * `get_element` returns. A model that just needs "which elements say
 * 'Sign up'" shouldn't have to pay a round trip per match to find out.
 */
export const findElementsTool: ToolImplementation = {
  name: 'find_elements',
  description:
    'Searches one page for elements matching a widget type and/or text ' +
    'content, returning enough per match (id, type, generation, label) to ' +
    'skip a follow-up get_element call in the common case. At least one ' +
    'of widget_type or text is required; when both are given, a match ' +
    'must satisfy both. Text search checks every text-bearing setting on ' +
    'each element, not just its resolved label. Use get_element on a ' +
    'match\'s id for its full native settings. Do not use this to browse ' +
    'a whole page (use get_page_structure).',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      widget_type: {
        type: 'string',
        description: 'Native widget type to match exactly, e.g. "heading" or "e-heading".',
      },
      text: {
        type: 'string',
        description: 'Case-insensitive text to search for in any text-bearing setting.',
      },
      max_results: {
        type: 'integer',
        minimum: 1,
        description: `Maximum matches to return. Defaults to ${DEFAULT_MAX_RESULTS}.`,
      },
      source: {
        type: 'string',
        enum: ['parent', 'autosave'],
        description:
          'Which copy of the page to search. "parent" (default) is the published/saved ' +
          'content; "autosave" is the draft revision on top of a published page.',
      },
    },
    required: ['post_id'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0, // page-derived (Blueprints.md §7's convention) — content changes on every save
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler(args) {
    const postId = args?.['post_id'];

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return {
        content: [{ type: 'text', text: 'find_elements requires an integer "post_id".' }],
        isError: true,
      };
    }

    const widgetType = typeof args?.['widget_type'] === 'string' ? args['widget_type'] : undefined;
    const text = typeof args?.['text'] === 'string' ? args['text'] : undefined;

    if (!widgetType && !text) {
      return {
        content: [{ type: 'text', text: 'find_elements requires at least one of "widget_type" or "text".' }],
        isError: true,
      };
    }

    const maxResults =
      typeof args?.['max_results'] === 'number' && args['max_results'] > 0
        ? args['max_results']
        : DEFAULT_MAX_RESULTS;
    const source = args?.['source'] === 'autosave' ? 'autosave' : 'parent';

    const predicate: ElementPredicate = (node) => {
      if (widgetType && node.widgetType !== widgetType) {
        return false;
      }
      if (text && !containsText(node.settings, text)) {
        return false;
      }
      return true;
    };

    try {
      const document = await getDocument(postId, { source });
      const elements = Array.isArray(document['elements']) ? (document['elements'] as ElementorNode[]) : [];
      const allMatches = findElements(elements, predicate);
      const matches = allMatches
        .slice(0, maxResults)
        .map(({ node, generation }) => describeNode(node, generation));

      const result = {
        post_id: postId,
        source,
        document_hash: typeof document['document_hash'] === 'string' ? document['document_hash'] : '',
        count: matches.length,
        truncated: Math.max(0, allMatches.length - matches.length),
        matches,
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
