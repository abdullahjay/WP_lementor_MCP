import type { ToolImplementation } from '../protocol/types.js';
import { uploadMediaFromUrl, WordPressApiError } from '../wp/client.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    url: { type: 'string' },
    filename: { type: 'string' },
    mime_type: { type: 'string' },
    width: { type: ['integer', 'null'] },
    height: { type: ['integer', 'null'] },
  },
  required: ['id', 'url', 'filename', 'mime_type', 'width', 'height'],
  additionalProperties: false,
} as const;

/**
 * EMCP-063 — Blueprints.md §6, `POST /media` (URL path). D1's resolution:
 * MCP tool inputs are JSON, so a URL is the only ingestion shape this tool
 * can offer — the server fetches it directly, egress-filtered against
 * SSRF (RFC1918/loopback/link-local blocked, re-validated after every
 * redirect, `http(s)` only — solution.md §9.5). A mockup pasted into chat
 * with no URL needs the out-of-band path instead: a human uploads it
 * directly via `POST /media`'s multipart `file` field, and the model finds
 * it afterward with list_media.
 *
 * Every real validation (content-derived MIME, category denial, decoded
 * pixel cap, EXIF strip, unique filename — solution.md §9.7) runs
 * plugin-side (`MediaService`) identically for both ingestion paths; this
 * tool only surfaces the URL half.
 */
export const uploadMediaTool: ToolImplementation = {
  name: 'upload_media',
  description:
    'Uploads media (an image or other file) to the connected site by URL — ' +
    'the server fetches it directly. Use this when you have a real, ' +
    'fetchable URL for an asset (e.g. a hosted image or design mockup). If ' +
    'the asset was only shown to you in this conversation with no URL, this ' +
    "tool cannot ingest it — ask the human to upload it directly to " +
    "WordPress instead, then find it with list_media.",
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'A fetchable http(s) URL for the file. Required, non-empty.' },
      filename: {
        type: 'string',
        description: 'Optional filename override. Defaults to the URL\'s own path segment.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },

  async handler(args) {
    const url = args?.['url'];

    if (typeof url !== 'string' || url.trim() === '') {
      return errorResult('upload_media requires a non-empty string "url".');
    }

    const filename = typeof args?.['filename'] === 'string' && args['filename'] !== '' ? args['filename'] : undefined;

    try {
      const uploaded = await uploadMediaFromUrl(url, filename);

      const result = {
        id: uploaded.id,
        url: uploaded.url,
        filename: uploaded.filename,
        mime_type: uploaded.mimeType,
        width: uploaded.width,
        height: uploaded.height,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      };
    } catch (error) {
      return { content: [{ type: 'text', text: describeError(error) }], isError: true };
    }
  },
};

function errorResult(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function describeError(error: unknown): string {
  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `upload_media failed: ${error instanceof Error ? error.message : String(error)}`;
}
