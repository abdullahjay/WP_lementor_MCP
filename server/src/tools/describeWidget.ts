import type { ToolImplementation } from '../protocol/types.js';
import { getSite, getWidgetDetail, WordPressApiError } from '../wp/client.js';
import { curateWidget, type DetailLevel, type RawWidget } from '../domain/curation.js';
import { PluginVersionMismatchError } from '../wp/contract.js';

const DETAIL_PATTERN = /^(common|full|section:[a-z0-9_-]+)$/i;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    title: { type: 'string' },
    categories: { type: 'array', items: { type: 'string' } },
    keywords: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string' },
    controls: { type: 'array', items: { type: 'object' } },
    total: { type: 'integer' },
    truncated: { type: 'integer' },
  },
  required: ['name', 'title', 'categories', 'keywords', 'detail', 'controls', 'total', 'truncated'],
  additionalProperties: false,
} as const;

/**
 * EMCP-028: one widget's curated settings schema — the paired lookup tool
 * for the DSL's `widget` escape rung (Blueprints.md §2.3) and for
 * emitting `raw` (§2.8, which "requires knowing native control names").
 * `detail` controls how much comes back: `common` (default) is the
 * widget's primary content-tab settings; `full` is everything (still with
 * responsive breakpoint variants collapsed into one entry each); `section:
 * <tab>` isolates one tab (e.g. `section:style`, `section:advanced`).
 * Output is capped; `truncated` tells you how many more controls exist —
 * call again with a higher `offset` (or a narrower `detail`) for the rest.
 */
export const describeWidgetTool: ToolImplementation = {
  name: 'describe_widget',
  description:
    'Returns one widget\'s settings schema — control names, types, ' +
    'labels, defaults, and options — curated by "detail" level rather ' +
    'than dumped whole. "common" (default) is the primary content ' +
    'settings most edits need; "full" is everything; "section:<tab>" ' +
    '(e.g. "section:style", "section:advanced") isolates one tab. ' +
    'Responsive breakpoint variants are stated once with "responsive": ' +
    'true, never enumerated per breakpoint. Output is capped — check ' +
    '"truncated" and call again with a higher "offset" for the rest. Use ' +
    'this before writing settings for a widget via edit_elements or the ' +
    '"widget"/"raw" DSL escape rungs. Use list_widgets first to confirm ' +
    'the widget exists on this site.',
  inputSchema: {
    type: 'object',
    properties: {
      widget_type: {
        type: 'string',
        description: 'The native widget type, from list_widgets or an element\'s "native.widgetType".',
      },
      detail: {
        type: 'string',
        description: '"common" (default), "full", or "section:<tab>" (e.g. "section:style").',
      },
      offset: { type: 'integer', minimum: 0, description: 'Skip this many matching controls. Defaults to 0.' },
      limit: { type: 'integer', minimum: 1, description: 'Maximum controls to return. Defaults to 40.' },
    },
    required: ['widget_type'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 5 * 60_000, // registry-derived, changes rarely (matches list_widgets/get_site_info)
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler(args) {
    const widgetType = args?.['widget_type'];

    if (typeof widgetType !== 'string' || widgetType.length === 0) {
      return {
        content: [{ type: 'text', text: 'describe_widget requires a non-empty string "widget_type".' }],
        isError: true,
      };
    }

    const detailArg = args?.['detail'];
    if (detailArg !== undefined && (typeof detailArg !== 'string' || !DETAIL_PATTERN.test(detailArg))) {
      return {
        content: [
          {
            type: 'text',
            text: 'describe_widget\'s "detail" must be "common", "full", or "section:<tab>".',
          },
        ],
        isError: true,
      };
    }
    const detail = (typeof detailArg === 'string' ? detailArg : 'common') as DetailLevel;

    const offset = typeof args?.['offset'] === 'number' ? args['offset'] : undefined;
    const limit = typeof args?.['limit'] === 'number' ? args['limit'] : undefined;

    try {
      const [site, raw] = await Promise.all([getSite(), getWidgetDetail(widgetType)]);
      const breakpoints = site['breakpoints'];
      const breakpointNames = isRecord(breakpoints) ? Object.keys(breakpoints) : [];

      const result = curateWidget(raw as unknown as RawWidget, {
        detail,
        breakpointNames,
        ...(offset !== undefined && { offset }),
        ...(limit !== undefined && { limit }),
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
        isError: false,
      };
    } catch (error) {
      const message = describeError(error, widgetType);

      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown, widgetType: string): string {
  if (error instanceof PluginVersionMismatchError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status} for widget "${widgetType}": ${error.message}`;
  }

  return `Could not reach WordPress: ${error instanceof Error ? error.message : String(error)}`;
}
