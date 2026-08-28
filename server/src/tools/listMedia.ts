import type { ToolImplementation } from '../protocol/types.js';
import { listMedia, WordPressApiError } from '../wp/client.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    media: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          url: { type: 'string' },
          filename: { type: 'string' },
          mime_type: { type: 'string' },
          created_at: { type: 'string' },
        },
        required: ['id', 'url', 'filename', 'mime_type', 'created_at'],
        additionalProperties: false,
      },
    },
  },
  required: ['media'],
  additionalProperties: false,
} as const;

/**
 * EMCP-063 — Blueprints.md §6, `GET /media`. Also the model's window onto
 * an **out-of-band** upload (D1) — a human can upload a reference design
 * or asset directly against `POST /media` (a multipart `file`, which no
 * MCP tool input can carry) without the model ever seeing the bytes; this
 * is how the model discovers the result afterward.
 */
export const listMediaTool: ToolImplementation = {
  name: 'list_media',
  description:
    'Lists media (images and other uploaded files) on the connected site — ' +
    'id, URL, filename, MIME type, and when it was added. Includes media ' +
    'uploaded via upload_media as well as anything a human uploaded directly ' +
    "through WordPress (out-of-band), so this is also how to find a " +
    'reference design a human uploaded outside this conversation.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler() {
    try {
      const result = await listMedia();

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
    return `WordPress returned ${error.status} for GET /media: ${error.message}`;
  }

  return `Could not reach WordPress: ${error instanceof Error ? error.message : String(error)}`;
}
