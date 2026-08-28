import { decompile } from '../dsl/decompile.js';
import type { ElementorNode } from '../domain/detect.js';
import type { ToolImplementation } from '../protocol/types.js';
import { getDb } from '../db/connection.js';
import { resolveCurrentSite } from '../registry/currentSite.js';
import type { SiteRecord } from '../registry/reader.js';
import { findIdempotentResult, recordIdempotentResult } from '../idempotency/store.js';
import { getDocument, saveTemplate, WordPressApiError } from '../wp/client.js';
import { buildSiteProfile } from './siteProfile.js';

// No OAuth yet (solution.md's decision table) — same placeholder every
// other mutating tool this server has uses until a real subject exists.
const LOCAL_SUBJECT = 'local-header-auth';

const DIAGNOSTIC_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    severity: { type: 'string' },
    code: { type: 'string' },
    message: { type: 'string' },
    allowed: { type: 'array' },
    suggestion: { type: 'string' },
  },
  required: ['path', 'severity', 'code', 'message'],
} as const;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    name: { type: 'string' },
    created_at: { type: 'string' },
    diagnostics: { type: 'array', items: DIAGNOSTIC_SCHEMA },
  },
  required: ['id', 'name', 'created_at', 'diagnostics'],
  additionalProperties: false,
} as const;

/**
 * EMCP-060 — Blueprints.md §4/§6, "`save_as_template` storing specs rather
 * than frozen native JSON." Reads a page's native elements, `decompile()`s
 * them (EMCP-054) into a portable DSL spec, and stores that spec via
 * `POST /templates` — never the frozen native JSON itself, so
 * `apply_template` (a later task) can `compile()` it fresh against
 * whatever site/generation it's applied to (prd.md Task 62's cross-sandbox
 * portability).
 *
 * `decompile()` never hard-fails (every diagnostic is `warning`/`info`) —
 * this tool always succeeds at saving *something*, with diagnostics
 * reporting anything that fell back to `raw`/`widget` rather than a native
 * DSL mapping, the same "lossy by design" posture §4 documents.
 */
export const saveAsTemplateTool: ToolImplementation = {
  name: 'save_as_template',
  description:
    "Saves a page's current content as a reusable template — decompiles its " +
    'native elements into a portable spec (not frozen native JSON), so it ' +
    'can later be applied to any page on any site, including one on a ' +
    'different Elementor generation. Diagnostics report anything that could ' +
    "not be mapped to a native DSL field (preserved via the DSL's own " +
    '"raw"/"widget" escape rungs instead, never dropped). Pass ' +
    'idempotency_key to make a retry safe: a repeated call with the same key ' +
    'returns the original template instead of creating a duplicate.',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      name: { type: 'string', description: "The new template's name. Required, non-empty." },
      source: {
        type: 'string',
        enum: ['parent', 'autosave'],
        description: 'Which copy of the page to save. "parent" (default) is the published/saved content.',
      },
      idempotency_key: {
        type: 'string',
        description: 'A caller-chosen key making a retried call safe — see the tool description.',
      },
    },
    required: ['post_id', 'name'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },

  async handler(args) {
    const postId = args?.['post_id'];
    const name = args?.['name'];

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return errorResult('save_as_template requires an integer "post_id".');
    }

    if (typeof name !== 'string' || name.trim() === '') {
      return errorResult('save_as_template requires a non-empty string "name".');
    }

    const source = args?.['source'] === 'autosave' ? 'autosave' : 'parent';
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

      const document = await getDocument(postId, { source });
      const elements = Array.isArray(document['elements']) ? (document['elements'] as ElementorNode[]) : [];

      const siteProfile = await buildSiteProfile(false);
      const decompiled = decompile(elements, siteProfile);

      const spec = { dslVersion: 1, page: { title: name }, elements: decompiled.elements };
      const saved = await saveTemplate(name, spec, postId);

      const result = {
        id: saved.id,
        name: saved.name,
        created_at: saved.createdAt,
        diagnostics: decompiled.diagnostics,
      };

      if (site && idempotencyKey) {
        try {
          await recordIdempotentResult(db, site.id, LOCAL_SUBJECT, idempotencyKey, result);
        } catch {
          // A record-failure never fails a call whose WordPress write
          // already succeeded — same reasoning as every other mutating
          // tool's idempotency handling.
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
  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `save_as_template failed: ${error instanceof Error ? error.message : String(error)}`;
}
