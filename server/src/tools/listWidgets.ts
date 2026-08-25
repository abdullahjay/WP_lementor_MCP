import type { ToolImplementation } from '../protocol/types.js';
import { listWidgets, WordPressApiError } from '../wp/client.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    widget_count: { type: 'integer' },
    widgets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
          keywords: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'title', 'categories', 'keywords'],
        additionalProperties: false,
      },
    },
  },
  required: ['widget_count', 'widgets'],
  additionalProperties: false,
} as const;

/**
 * EMCP-027: the registry's lightweight vocabulary listing — every
 * registered widget's `name`/`title`/`categories`/`keywords`, deliberately
 * without `controls`. Contrast with `describe_widget` (EMCP-028), which
 * returns one widget's curated settings schema. Use this to discover what
 * widgets exist on a site before calling `describe_widget` on a specific
 * one, not to inspect any single widget's settings.
 */
export const listWidgetsTool: ToolImplementation = {
  name: 'list_widgets',
  description:
    'Lists every widget registered on the connected site — Free, Pro, and ' +
    'third-party alike — with name, title, categories, and keywords only. ' +
    'Use this to discover what widgets are available before building or ' +
    'editing content, or to check whether a specific widget type exists on ' +
    'this site before referencing it. Does not return settings schemas ' +
    '(use describe_widget for one widget\'s full controls).',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 5 * 60_000, // registry-derived, changes rarely (Blueprints.md §7's convention, matching get_site_info)
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler() {
    try {
      const result = await listWidgets();

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
    return `WordPress returned ${error.status} for GET /widgets: ${error.message}`;
  }

  return `Could not reach WordPress: ${error instanceof Error ? error.message : String(error)}`;
}
