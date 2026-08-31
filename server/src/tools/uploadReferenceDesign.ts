import type { ToolImplementation } from '../protocol/types.js';
import { FetchFailedError, fetchUrlSafely, InvalidUrlSchemeError, SsrfBlockedError, TooManyRedirectsError } from '../ingestion/safeFetch.js';
import { sniffImageMimeType } from '../ingestion/sniffMime.js';
import { presignReferenceDesignUpload, uploadReferenceDesign } from '../storage/objectStorage.js';

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // 20 MB, matching upload_media's cap.

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    reference_id: { type: 'string' },
    resource_link: { type: 'string' },
    upload_url: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['reference_id'],
  additionalProperties: false,
} as const;

/**
 * EMCP-064 — Blueprints.md §12.2/solution.md §5.4's D1: "reference-design
 * ingestion — URL vs out-of-band upload," resolved as **both**. Unlike
 * `upload_media` (EMCP-063), which stores into WordPress's own media
 * library, a reference design is a comparison artifact for
 * `extract_design_tokens`/`compare_to_reference` (not yet built) — it
 * lives in the same object storage `render_preview` already uses
 * (Blueprints.md §11.2), never touching WordPress at all.
 *
 * **Two modes in one tool, mirroring `publish_draft`'s own established
 * shape** (call without a token, get instructions for the out-of-band
 * path instead): pass `url` and the server fetches it directly
 * (SSRF-hardened — `server/src/ingestion/safeFetch.ts`, the same policy
 * as `upload_media`'s URL path, reimplemented Node-side since this bypasses
 * WordPress); omit `url` and get back a presigned upload URL a human uses
 * directly against object storage — the S3-world equivalent of
 * `upload_media`'s direct-multipart-to-WordPress path, since MCP tool
 * inputs are JSON and a model cannot re-emit an image it was shown.
 */
export const uploadReferenceDesignTool: ToolImplementation = {
  name: 'upload_reference_design',
  description:
    'Ingests a reference design image (a mockup or screenshot to compare a ' +
    'page against later with compare_to_reference) into object storage, ' +
    'separate from the WordPress media library. Pass url to have the server ' +
    'fetch it directly. Omit url when the image was only shown to you in ' +
    'this conversation with no fetchable URL — this returns an upload_url ' +
    'instead: a human uploads the file directly to that URL (outside this ' +
    'conversation), and the returned reference_id already identifies it for ' +
    'a later compare_to_reference call, once the upload completes.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'A fetchable http(s) URL for the reference design. Omit for an out-of-band upload instead.' },
    },
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },

  async handler(args) {
    const url = args?.['url'];

    if (url !== undefined && (typeof url !== 'string' || url.trim() === '')) {
      return errorResult('upload_reference_design\'s "url", when given, must be a non-empty string.');
    }

    try {
      if (typeof url === 'string') {
        const fetched = await fetchUrlSafely(url, MAX_DOWNLOAD_BYTES);
        const mimeType = sniffImageMimeType(fetched.body);

        if (!mimeType) {
          return errorResult(
            'The fetched content is not a recognized image format (PNG, JPEG, GIF, or WEBP) — content-derived, not based on the URL or any declared Content-Type.',
          );
        }

        const uploaded = await uploadReferenceDesign(fetched.body, mimeType);
        const result = { reference_id: uploaded.referenceId, resource_link: uploaded.resourceLink };

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        };
      }

      const presigned = await presignReferenceDesignUpload();
      const result = {
        reference_id: presigned.referenceId,
        upload_url: presigned.uploadUrl,
        message:
          'No url was given. Have a human PUT the image bytes directly to ' +
          'upload_url (outside this conversation) — once that completes, ' +
          'this reference_id identifies it for compare_to_reference.',
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
  if (
    error instanceof SsrfBlockedError ||
    error instanceof InvalidUrlSchemeError ||
    error instanceof TooManyRedirectsError ||
    error instanceof FetchFailedError
  ) {
    return error.message;
  }

  return `upload_reference_design failed: ${error instanceof Error ? error.message : String(error)}`;
}
