import type { ToolImplementation } from '../protocol/types.js';
import { compareImages } from '../ingestion/compareImages.js';
import { sniffImageMimeType } from '../ingestion/sniffMime.js';
import { renderScreenshot, RendererApiError } from '../renderer/client.js';
import { downloadObject, ObjectNotFoundError } from '../storage/objectStorage.js';
import { getDocument, getSite, issuePreviewToken, WordPressApiError } from '../wp/client.js';
import { loadWordPressSiteConfig } from '../wp/config.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    regions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          delta_e: { type: 'number' },
        },
        required: ['x', 'y', 'width', 'height', 'delta_e'],
        additionalProperties: false,
      },
    },
  },
  required: ['score', 'regions'],
  additionalProperties: false,
} as const;

/**
 * EMCP-066 — Blueprints.md §7.4's frozen signature. Returns **numbers**,
 * never pictures: an overall similarity `score` (1.0 = perceptually
 * identical, 0.0 = maximally different) and the worst-mismatched regions
 * ranked by perceptual colour distance, each as a bounding box — enough
 * for a caller to zoom in with `render_preview`'s own `element_id`-scoped
 * capture if it needs to actually *look*.
 *
 * Reuses `render_preview`'s exact capture pipeline (document lookup, host
 * rewrite around the `WP_HOME`/renderer-reachability gotcha, preview
 * token) rather than a second implementation, and `extract_design_tokens`'
 * perceptual-distance machinery (CIE76 delta-E in Lab space,
 * `colorDistance.ts`) rather than raw pixel-difference counting, which
 * would conflate "shifted by a pixel" with "genuinely different content."
 *
 * `breakpoint`, present in the frozen signature but never wired into
 * `render_preview` itself, is resolved here against the connected site's
 * *real* breakpoints (`get_site_info`'s own introspected values — CLAUDE.md:
 * "introspect Elementor, never hardcode breakpoints") into a real viewport
 * width for the renderer (a new `viewportWidth`/`viewportHeight` capability
 * added to the renderer for this task). Omitted, the renderer's own default
 * viewport applies, identical to every `render_preview` capture today.
 */
export const compareToReferenceTool: ToolImplementation = {
  name: 'compare_to_reference',
  description:
    "Compares a live page's rendered appearance against a previously " +
    'uploaded reference design (from upload_reference_design), returning a ' +
    'similarity score and the worst-mismatched regions as bounding boxes — ' +
    'numbers, not an image. Pass breakpoint (e.g. "mobile", "tablet") to ' +
    "render at that breakpoint's real viewport width instead of desktop " +
    'default. Use render_preview afterward, scoped to a specific ' +
    'element_id, to actually look at a mismatched region.',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      reference_id: { type: 'string', description: 'The reference_id from upload_reference_design.' },
      breakpoint: { type: 'string', description: 'Optional breakpoint name from get_site_info\'s breakpoints (e.g. "mobile", "tablet").' },
    },
    required: ['post_id', 'reference_id'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },

  async handler(args) {
    const postId = args?.['post_id'];
    const referenceId = args?.['reference_id'];
    const breakpoint = args?.['breakpoint'];

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return errorResult('compare_to_reference requires an integer "post_id".');
    }

    if (typeof referenceId !== 'string' || referenceId.trim() === '') {
      return errorResult('compare_to_reference requires a non-empty string "reference_id".');
    }

    if (breakpoint !== undefined && (typeof breakpoint !== 'string' || breakpoint.trim() === '')) {
      return errorResult('compare_to_reference\'s "breakpoint", if given, must be a non-empty string.');
    }

    try {
      const referenceBytes = await downloadObject(referenceId);

      if (!sniffImageMimeType(referenceBytes)) {
        return errorResult(
          `The object at "${referenceId}" is not a recognized image format (PNG, JPEG, GIF, or WEBP) — content-derived, not based on any stored metadata.`,
        );
      }

      const document = await getDocument(postId);
      const link = typeof document['link'] === 'string' ? document['link'] : undefined;

      if (!link) {
        return errorResult(`Post ${postId} has no public link to render.`);
      }

      // Same WP_HOME/renderer-reachability rewrite render_preview already
      // established (EMCP-034) — never trust the permalink's own host:port.
      const config = loadWordPressSiteConfig();
      const base = new URL(config.baseUrl);
      const permalink = new URL(link);
      const targetUrl = new URL(permalink.pathname + permalink.search, base).toString();
      const allowedHost = base.hostname;

      let viewport: { viewportWidth: number; viewportHeight: number } | undefined;
      if (typeof breakpoint === 'string') {
        const site = await getSite();
        const breakpoints = site['breakpoints'];
        const entry = isRecord(breakpoints) ? breakpoints[breakpoint] : undefined;
        const width = isRecord(entry) && typeof entry['value'] === 'number' ? entry['value'] : undefined;

        if (width === undefined) {
          const names = isRecord(breakpoints) ? Object.keys(breakpoints) : [];
          return errorResult(`Unknown breakpoint "${breakpoint}". Known breakpoints on this site: ${names.join(', ')}.`);
        }

        viewport = { viewportWidth: width, viewportHeight: 900 };
      }

      const { token } = await issuePreviewToken(postId);

      // See renderPreview.ts's own comment: WordPress emits every CSS/JS/
      // font asset URL using the permalink's original origin, unreachable
      // from inside the renderer's Docker network — rewrite every matching
      // request, not just the top-level navigation, or the capture is of
      // unstyled HTML.
      const screenshotBytes = await renderScreenshot({
        url: targetUrl,
        selector: `.elementor-${postId}`,
        allowedHost,
        extraHeaders: { 'X-EMCP-Preview-Token': token },
        assetOriginRewrite: { from: permalink.origin, to: base.origin },
        ...viewport,
      });

      const { score, regions } = await compareImages(screenshotBytes, referenceBytes);

      const result = {
        score,
        regions: regions.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height, delta_e: r.deltaE })),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorResult(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function describeError(error: unknown, postId: number): string {
  if (error instanceof ObjectNotFoundError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  if (error instanceof RendererApiError) {
    return `Renderer returned ${error.status}: ${error.message}`;
  }

  return `compare_to_reference failed for post ${postId}: ${error instanceof Error ? error.message : String(error)}`;
}
