import type { ToolImplementation } from '../protocol/types.js';
import { getDocument, issuePreviewToken, WordPressApiError } from '../wp/client.js';
import { loadWordPressSiteConfig } from '../wp/config.js';
import { renderScreenshot, RendererApiError } from '../renderer/client.js';
import { uploadPreviewImage } from '../storage/objectStorage.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    resource_link: { type: 'string' },
    image: {
      type: 'object',
      properties: { data: { type: 'string' }, mime_type: { type: 'string' } },
      required: ['data', 'mime_type'],
    },
    summary: { type: 'string' },
  },
  required: ['summary'],
  additionalProperties: false,
} as const;

/**
 * EMCP-034: captures a screenshot of a page (or one element, via
 * `element_id`) through the isolated renderer (solution.md §9.5). Defaults
 * to a `resource_link` (a presigned MinIO GET URL) rather than inline
 * `image` bytes, since an inline PNG cheaply overruns context on any but
 * the smallest capture (Blueprints.md §7.4).
 *
 * Scope note: this issues a preview token (EMCP-033) and sends it as
 * `X-EMCP-Preview-Token`, but no WordPress-side hook yet consumes that
 * header to grant anonymous access to a draft/private post or an autosave
 * revision — that's a separate, larger auth-bypass problem, not this
 * task's capture-mechanics scope. Only a **published** post's live content
 * is guaranteed to render correctly end-to-end today.
 */
export const renderPreviewTool: ToolImplementation = {
  name: 'render_preview',
  description:
    'Captures a screenshot of a published page, or one element within it ' +
    '(via element_id), and returns a link to the image (or the image ' +
    'inline, if return_image is true). Use this to visually verify a page ' +
    'after edits. Draft/private/unpublished content is not yet supported ' +
    'end-to-end — only published posts render reliably.',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      element_id: {
        type: 'string',
        description:
          'Optional. Captures just this element (from get_page_structure or ' +
          'find_elements) instead of the whole page.',
      },
      return_image: {
        type: 'boolean',
        description: 'Return the PNG inline instead of a resource_link. Default false.',
      },
    },
    required: ['post_id'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0, // page-derived — content changes on every save
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },

  async handler(args) {
    const postId = args?.['post_id'];
    const elementId = args?.['element_id'];
    const returnImage = args?.['return_image'] === true;

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return {
        content: [{ type: 'text', text: 'render_preview requires an integer "post_id".' }],
        isError: true,
      };
    }

    if (elementId !== undefined && (typeof elementId !== 'string' || elementId.length === 0)) {
      return {
        content: [{ type: 'text', text: 'render_preview\'s "element_id", if given, must be a non-empty string.' }],
        isError: true,
      };
    }

    try {
      const document = await getDocument(postId);
      const link = typeof document['link'] === 'string' ? document['link'] : undefined;

      if (!link) {
        return {
          content: [{ type: 'text', text: `Post ${postId} has no public link to render.` }],
          isError: true,
        };
      }

      // CLAUDE.md's WP_HOME/siteurl gotcha: the plugin's permalink can carry
      // a host:port that's unreachable from the renderer's network segment
      // (it matches the human-facing host-mapped port, not the container-
      // internal one). WP_BASE_URL is what this server already uses to
      // reach the plugin over the docker network, so rebuild the target
      // from that origin plus the permalink's path — never trust the
      // permalink's own host:port for navigation.
      const config = loadWordPressSiteConfig();
      const base = new URL(config.baseUrl);
      const permalink = new URL(link);
      const targetUrl = new URL(permalink.pathname + permalink.search, base).toString();

      const selector = elementId ? `.elementor-element-${elementId}` : `.elementor-${postId}`;
      const allowedHost = base.hostname;

      const { token } = await issuePreviewToken(postId);

      // The top-level navigation above already targets WP_BASE_URL's origin
      // (renderer-reachable), but WordPress still emits every CSS/JS/font
      // asset URL on the page using its own configured siteurl (the
      // permalink's original origin) — unreachable from inside the
      // renderer's Docker network. Confirmed live: without this rewrite,
      // every subresource request fails ERR_CONNECTION_REFUSED and the
      // page renders with zero of its own styles applied. Rewriting every
      // matching request, not just navigation, is what actually fixes it.
      const bytes = await renderScreenshot({
        url: targetUrl,
        selector,
        allowedHost,
        extraHeaders: { 'X-EMCP-Preview-Token': token },
        assetOriginRewrite: { from: permalink.origin, to: base.origin },
      });

      const summary = elementId
        ? `Captured element ${elementId} on post ${postId}.`
        : `Captured post ${postId}.`;

      if (returnImage) {
        return {
          content: [
            { type: 'text', text: summary },
            { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' },
          ],
          structuredContent: { image: { data: bytes.toString('base64'), mime_type: 'image/png' }, summary },
          isError: false,
        };
      }

      const { resourceLink } = await uploadPreviewImage(bytes);

      return {
        content: [{ type: 'text', text: `${summary} ${resourceLink}` }],
        structuredContent: { resource_link: resourceLink, summary },
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
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  if (error instanceof RendererApiError) {
    return `Renderer returned ${error.status}: ${error.message}`;
  }

  return `render_preview failed: ${error instanceof Error ? error.message : String(error)}`;
}
