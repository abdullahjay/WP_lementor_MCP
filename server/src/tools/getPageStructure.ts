import type { ToolImplementation } from '../protocol/types.js';
import { getDocument, WordPressApiError } from '../wp/client.js';
import { buildDigest, DEFAULT_MAX_DEPTH } from '../domain/digest.js';
import type { ElementorNode } from '../domain/detect.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    post_id: { type: 'integer' },
    source: { type: 'string', enum: ['parent', 'autosave'] },
    document_hash: { type: 'string' },
    meta: { type: 'object' },
    elements: {
      type: 'array',
      items: { type: 'object' },
    },
  },
  required: ['post_id', 'source', 'document_hash', 'meta', 'elements'],
  additionalProperties: false,
} as const;

/**
 * EMCP-024: the first tool to combine a live document fetch
 * (`GET /documents/{id}`, Blueprints.md §6) with the domain layer built up
 * in EMCP-019 through EMCP-022 (`detect.ts` → `digest.ts`) — this is where
 * the digest budget (§5: "≤ 4,000 tokens at depth 3 across the fixture
 * set") stops being an internal contract and becomes what a real model
 * call actually receives. `document_hash` and every element `id` in the
 * response are exactly what `edit_elements` (a later, write-capable tool)
 * will require and consume — Blueprints.md §7.3.
 */
export const getPageStructureTool: ToolImplementation = {
  name: 'get_page_structure',
  description:
    'Returns the normalized element tree for one page/post, depth-limited ' +
    'by default to keep the response small. Every node carries a stable ' +
    'element id and a "generation" (legacy/v3/v4) — the same id ' +
    'edit_elements consumes. Also returns document_hash, required for any ' +
    'future write to this page (compare-and-swap). A node at the depth ' +
    'limit is replaced by { id, type, truncated } instead of its real ' +
    'children — call again with a higher max_depth, or get_element with ' +
    'that id, to see further. Use list_pages first to find a post_id. Do ' +
    'not use this for full native widget settings (use get_element) or to ' +
    'search across a page by content (use find_elements).',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      max_depth: {
        type: 'integer',
        minimum: 0,
        description: `How many levels deep to expand before truncating. Defaults to ${DEFAULT_MAX_DEPTH}.`,
      },
      source: {
        type: 'string',
        enum: ['parent', 'autosave'],
        description:
          'Which copy of the page to read. "parent" (default) is the published/saved ' +
          'content; "autosave" is the draft revision on top of a published page — use ' +
          'it when checking work in progress that has not been published yet.',
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
        content: [{ type: 'text', text: 'get_page_structure requires an integer "post_id".' }],
        isError: true,
      };
    }

    const maxDepth = typeof args?.['max_depth'] === 'number' ? args['max_depth'] : DEFAULT_MAX_DEPTH;
    const source = args?.['source'] === 'autosave' ? 'autosave' : 'parent';

    try {
      const document = await getDocument(postId, { source });
      const elements = Array.isArray(document['elements']) ? (document['elements'] as ElementorNode[]) : [];
      const digest = buildDigest(elements, { maxDepth });

      const result = {
        post_id: postId,
        source,
        document_hash: typeof document['document_hash'] === 'string' ? document['document_hash'] : '',
        meta: document['meta'] ?? {},
        elements: digest,
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
