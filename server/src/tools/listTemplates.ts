import type { ToolImplementation } from '../protocol/types.js';
import { listTemplates, WordPressApiError } from '../wp/client.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    templates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          source_post_id: { type: ['integer', 'null'] },
          created_at: { type: 'string' },
        },
        required: ['id', 'name', 'source_post_id', 'created_at'],
        additionalProperties: false,
      },
    },
    count: { type: 'integer' },
  },
  required: ['templates', 'count'],
  additionalProperties: false,
} as const;

/**
 * EMCP-060 — Blueprints.md §6, `GET /templates`. Lists templates stored on
 * the connected site — real specs (`save_as_template`), not native content
 * itself. Use `apply_template` (not yet built) to instantiate one onto a
 * page.
 */
export const listTemplatesTool: ToolImplementation = {
  name: 'list_templates',
  description:
    'Lists templates saved on the connected site via save_as_template — id, ' +
    'name, the page it was originally saved from (if any), and when it was ' +
    'created. Does not return the template content itself.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler() {
    try {
      const result = await listTemplates();

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
    return `WordPress returned ${error.status} for GET /templates: ${error.message}`;
  }

  return `Could not reach WordPress: ${error instanceof Error ? error.message : String(error)}`;
}
