import type { ToolImplementation } from '../protocol/types.js';
import { PluginVersionMismatchError } from '../wp/contract.js';
import { getSite, WordPressApiError } from '../wp/client.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    elementor_version: { type: ['string', 'null'] },
    generation_default: { type: 'string', enum: ['v4', 'v3', 'legacy'] },
    pro_tier: { type: 'string' },
    breakpoints: { type: 'object' },
    experiments: { type: 'object' },
    css_print_method: { type: 'string' },
    plugin_version: { type: 'string' },
  },
  required: [
    'elementor_version',
    'generation_default',
    'pro_tier',
    'breakpoints',
    'experiments',
    'css_print_method',
    'plugin_version',
  ],
  additionalProperties: false,
} as const;

/**
 * EMCP-007: the first real tool, and the first end-to-end proof of the
 * hybrid path — this handler is the first line of Node code that actually
 * calls the WordPress plugin (Blueprints.md §6's GET /site, implemented
 * live in EMCP-004).
 */
export const getSiteInfoTool: ToolImplementation = {
  name: 'get_site_info',
  description:
    "Reports the connected Elementor site's capabilities: Elementor version, " +
    'whether it defaults to V4 (atomic) or V3 (container) generation, Pro ' +
    'tier, configured breakpoints, active performance experiments, CSS print ' +
    'method, and the emcp plugin version. Call this first, before building or ' +
    'editing anything on a site you have not just called it against — later ' +
    'tools assume the model already knows what the target site supports. Do ' +
    'not use this to read page content (use get_page_structure) or to check ' +
    'whether a specific widget is available (use describe_widget).',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 5 * 60_000,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler() {
    try {
      const site = await getSite();

      return {
        content: [{ type: 'text', text: JSON.stringify(site) }],
        structuredContent: site,
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
  if (error instanceof PluginVersionMismatchError) {
    // Blueprints.md §6: "fails loudly on mismatch" — actionable, not just
    // "something went wrong".
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status} for GET /site: ${error.message}`;
  }

  return `Could not reach WordPress: ${error instanceof Error ? error.message : String(error)}`;
}
