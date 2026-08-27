import type { ToolImplementation } from '../protocol/types.js';
import { getGlobalStyles, WordPressApiError } from '../wp/client.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    colors: {
      type: 'object',
      properties: {
        system: { type: 'array', items: { type: 'object' } },
        custom: { type: 'array', items: { type: 'object' } },
      },
      required: ['system', 'custom'],
    },
    typography: {
      type: 'object',
      properties: {
        system: { type: 'array', items: { type: 'object' } },
        custom: { type: 'array', items: { type: 'object' } },
      },
      required: ['system', 'custom'],
    },
    default_generic_fonts: { type: 'string' },
    generation_default: { type: 'string', enum: ['v4', 'v3', 'legacy'] },
    global_classes: { type: 'object' },
    variables: { type: 'object' },
  },
  required: ['colors', 'typography', 'default_generic_fonts', 'generation_default'],
  additionalProperties: false,
} as const;

/**
 * EMCP-029: the site's kit-level design system — colours, typography
 * presets, and default generic fonts, always; on a V4 (`e_atomic_elements`
 * active) site, also global classes and variables (Blueprints.md §6's
 * `GET /kit` + `GET /global-classes`, merged into one read here since the
 * plugin route already combines them behind a single generation check).
 * Read-only — there is no corresponding write tool yet
 * (`set_global_styles` is future work per solution.md's growth path).
 */
export const getGlobalStylesTool: ToolImplementation = {
  name: 'get_global_styles',
  description:
    "Reports the connected site's kit-level design system: built-in and " +
    'custom colours, built-in and custom typography presets, and default ' +
    'generic fonts. On a site that defaults to V4 (atomic elements), also ' +
    'reports global classes (shared CSS classes) and variables (design ' +
    "tokens). Use this to resolve DSL tokens like @primary/@accent or a " +
    'widget\'s @font/<id> reference against the site\'s real design ' +
    'system, not the DSL grammar\'s built-in names alone. Read-only.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 5 * 60_000, // kit-derived, changes rarely (matches list_widgets/get_site_info)
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler() {
    try {
      const result = await getGlobalStyles();

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
    return `WordPress returned ${error.status} for GET /kit: ${error.message}`;
  }

  return `Could not reach WordPress: ${error instanceof Error ? error.message : String(error)}`;
}
