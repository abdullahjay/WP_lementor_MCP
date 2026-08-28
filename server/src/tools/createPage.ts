import type { ToolImplementation } from '../protocol/types.js';
import { getDb } from '../db/connection.js';
import { resolveCurrentSite } from '../registry/currentSite.js';
import type { SiteRecord } from '../registry/reader.js';
import { findIdempotentResult, recordIdempotentResult } from '../idempotency/store.js';
import {
  createDocument,
  InvalidPageTemplateError,
  InvalidPostTypeError,
  WordPressApiError,
} from '../wp/client.js';

// No OAuth yet (solution.md's decision table) — matches edit_elements's own
// placeholder subject until a real per-caller identity exists (D2).
const LOCAL_SUBJECT = 'local-header-auth';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    status: { type: 'string' },
    type: { type: 'string' },
    link: { type: 'string' },
    edit_url: { type: 'string' },
    page_template: { type: 'string' },
    document_hash: { type: 'string' },
  },
  required: ['id', 'status', 'type', 'link', 'edit_url', 'page_template', 'document_hash'],
  additionalProperties: false,
} as const;

/**
 * EMCP-046 — Blueprints.md §6.9/§7.7. Always creates a `draft` — solution.md
 * §5.4's write posture table ("New page → post with `draft` status"), no
 * `status` input exists to override that; publishing is `publish_draft`'s
 * job (EMCP-047, not built yet).
 *
 * Unlike `edit_elements`, a repeat call under the same arguments is a real
 * duplicate (two separate pages), not a no-op — so `idempotency_key`
 * matters more here, not less, and is checked the same way EMCP-044
 * established for `edit_elements`.
 */
export const createPageTool: ToolImplementation = {
  name: 'create_page',
  description:
    'Creates a new Elementor page as a draft (never published directly — ' +
    'use publish_draft for that once a page is ready). Sets all the meta ' +
    'Elementor requires to treat it as a real document immediately ' +
    '(_elementor_edit_mode, template type, version) and an explicit page ' +
    'template, so the returned post_id and document_hash can be passed ' +
    "straight into edit_elements. post_type defaults to \"page\" and must " +
    'support Elementor (checked against the real post-type registry, not ' +
    'guessed). page_template defaults to "default" (the theme\'s own ' +
    'template); other valid values include Elementor\'s own ' +
    '"elementor_canvas" (blank canvas, no theme header/footer) and ' +
    '"elementor_header_footer" (Elementor content, theme header/footer) — ' +
    'the exact set of valid values is site-specific and enforced server-side. ' +
    'Pass idempotency_key to make a retry after a timeout safe: a repeated ' +
    'call with the same key returns the original page instead of creating a ' +
    'second one.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The new page\'s title. Required, non-empty.' },
      post_type: {
        type: 'string',
        description: 'Post type slug; must support Elementor. Defaults to "page".',
      },
      page_template: {
        type: 'string',
        description: 'Explicit page template slug. Defaults to "default" (the theme\'s own template).',
      },
      idempotency_key: {
        type: 'string',
        description: 'A caller-chosen key making a retried call safe — see the tool description.',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },

  async handler(args) {
    const title = args?.['title'];

    if (typeof title !== 'string' || title.trim() === '') {
      return errorResult('create_page requires a non-empty string "title".');
    }

    const postType = typeof args?.['post_type'] === 'string' && args['post_type'] !== '' ? args['post_type'] : undefined;
    const pageTemplate =
      typeof args?.['page_template'] === 'string' && args['page_template'] !== '' ? args['page_template'] : undefined;
    const idempotencyKey =
      typeof args?.['idempotency_key'] === 'string' && args['idempotency_key'] !== ''
        ? args['idempotency_key']
        : undefined;

    try {
      const db = getDb();
      let site: SiteRecord | undefined;
      try {
        site = await resolveCurrentSite(db);
      } catch {
        // Idempotency is best-effort, same as edit_elements — an unresolved
        // site shouldn't block the actual creation.
        site = undefined;
      }

      if (idempotencyKey && site) {
        const cached = await findIdempotentResult(db, site.id, LOCAL_SUBJECT, idempotencyKey);
        if (cached) {
          return {
            content: [{ type: 'text', text: JSON.stringify(cached) }],
            structuredContent: cached,
            isError: false,
          };
        }
      }

      const created = await createDocument(title, { postType, pageTemplate });

      const result = {
        id: created.id,
        status: created.status,
        type: created.type,
        link: created.link,
        edit_url: created.editUrl,
        page_template: created.pageTemplate,
        document_hash: created.documentHash,
      };

      if (site && idempotencyKey) {
        try {
          await recordIdempotentResult(db, site.id, LOCAL_SUBJECT, idempotencyKey, result);
        } catch {
          // A record-failure never fails a call whose WordPress write
          // already succeeded — same reasoning as edit_elements's ledger
          // write.
        }
      }

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
  if (error instanceof InvalidPostTypeError || error instanceof InvalidPageTemplateError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    if (error.status === 403) {
      return 'The authenticated user is not permitted to create posts of this type.';
    }
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `create_page failed: ${error instanceof Error ? error.message : String(error)}`;
}
