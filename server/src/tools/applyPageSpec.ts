import { randomUUID } from 'node:crypto';
import '../dsl/v3.js';
import '../dsl/v4.js';
import { compile } from '../dsl/compile.js';
import { parseSpec } from '../dsl/validate.js';
import type { ToolImplementation } from '../protocol/types.js';
import { getDb } from '../db/connection.js';
import { resolveCurrentSite } from '../registry/currentSite.js';
import type { SiteRecord } from '../registry/reader.js';
import { writeLedgerEntry } from '../ledger/writer.js';
import { redactArgs } from '../ledger/redact.js';
import { LEDGER_ARGS_ALLOWLIST } from '../ledger/allowlists.js';
import { findIdempotentResult, recordIdempotentResult } from '../idempotency/store.js';
import {
  captureSnapshot,
  getDocument,
  invalidateCache,
  replaceDocumentTree,
  DocumentHashMismatchError,
  DocumentLockedError,
  InvalidOperationsError,
  WordPressApiError,
} from '../wp/client.js';
import { buildSiteProfile, UnsupportedGenerationError } from './siteProfile.js';

// Same placeholder as edit_elements/publish_draft (server/src/tools/editElements.ts)
// — no OAuth subject exists yet (solution.md's decision table, EMCP-056+).
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
    document_hash: { type: 'string' },
    diagnostics: { type: 'array', items: DIAGNOSTIC_SCHEMA },
    nativeness: { type: 'number' },
    raw_ratio: { type: 'number' },
    applied: { type: 'boolean' },
    path: { type: 'string', enum: ['draft', 'autosave'] },
  },
  required: ['document_hash', 'diagnostics', 'nativeness', 'raw_ratio', 'applied', 'path'],
  additionalProperties: false,
} as const;

/**
 * EMCP-055 — Blueprints.md §7.1. Compiles a DSL spec (`server/src/dsl/
 * compile.ts`) into a full native element tree and **replaces** the whole
 * document with it — contrast with `edit_elements`, which patches specific
 * existing elements' settings. Reuses every safety-ring piece
 * `edit_elements` (EMCP-040–044) already established: document-hash CAS,
 * post-lock refusal, autosave branching for a published post (EMCP-045),
 * a pre-write snapshot, cache invalidation, and a ledger entry — all via
 * the same `PUT /documents/{id}` route, through the new `op: "replace_tree"`
 * shape (`server/src/wp/client.ts`'s `replaceDocumentTree()`), not a
 * parallel write path.
 *
 * `dry_run` is a **structurally separate code path incapable of writing**
 * (Blueprints.md §7.1) — it returns before `captureSnapshot`/
 * `replaceDocumentTree`/`invalidateCache` are ever called, not a late
 * branch inside the write path.
 */
export const applyPageSpecTool: ToolImplementation = {
  name: 'apply_page_spec',
  description:
    'Compiles a page spec (the DSL Blueprints.md §2 documents) and replaces ' +
    "an existing page's entire content with the result, in one document " +
    'save. Unlike edit_elements, which patches specific elements\' settings, ' +
    'this replaces the whole tree — use edit_elements instead when you only ' +
    'need to change settings on elements that already exist. Requires the ' +
    'document_hash from get_page_structure/get_element (or a prior ' +
    'apply_page_spec/edit_elements response) as a compare-and-swap — a ' +
    'stale hash is refused, not silently overwritten. Pass dry_run: true to ' +
    'validate against this specific page\'s site without writing anything ' +
    '(use validate_page_spec instead if there is no target page yet). ' +
    'Pass idempotency_key to make a retry safe after a timeout or dropped ' +
    'response.',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      document_hash: {
        type: 'string',
        description: 'The document_hash from a prior read of this post — enforced as a compare-and-swap.',
      },
      spec: { type: 'object', description: 'A page spec per Blueprints.md §2.' },
      dry_run: {
        type: 'boolean',
        description: 'Validate and compile without writing anything. Default false.',
      },
      idempotency_key: {
        type: 'string',
        description: 'A caller-chosen key making a retried call safe — see the tool description.',
      },
    },
    required: ['post_id', 'document_hash', 'spec'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },

  async handler(args, correlationId) {
    const postId = args?.['post_id'];
    const expectedHash = args?.['document_hash'];
    const dryRun = args?.['dry_run'] === true;

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return errorResult('apply_page_spec requires an integer "post_id".');
    }

    if (typeof expectedHash !== 'string' || expectedHash === '') {
      return errorResult('apply_page_spec requires a non-empty string "document_hash".');
    }

    const { spec, diagnostics: parseDiagnostics } = parseSpec(args?.['spec']);

    if (!spec) {
      const result = { document_hash: '', diagnostics: parseDiagnostics, nativeness: 0, raw_ratio: 0, applied: false, path: 'draft' as const };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true,
      };
    }

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

      if (!dryRun && idempotencyKey && site) {
        const cached = await findIdempotentResult(db, site.id, LOCAL_SUBJECT, idempotencyKey);
        if (cached) {
          return {
            content: [{ type: 'text', text: JSON.stringify(cached) }],
            structuredContent: cached,
            isError: false,
          };
        }
      }

      // Same source-resolution rule edit_elements uses (EMCP-045): a
      // published post's write lands on its live autosave, never the
      // parent directly.
      const parentDocument = await getDocument(postId);
      const isPublished = parentDocument['status'] === 'publish';

      let document = parentDocument;
      let source: 'parent' | 'autosave' = 'parent';

      if (isPublished) {
        try {
          document = await getDocument(postId, { source: 'autosave' });
          source = 'autosave';
        } catch (error) {
          if (!(error instanceof WordPressApiError) || error.status !== 404) {
            throw error;
          }
        }
      }

      const currentHash = typeof document['document_hash'] === 'string' ? document['document_hash'] : '';
      const path: 'draft' | 'autosave' = source === 'autosave' ? 'autosave' : 'draft';

      const siteProfile = await buildSiteProfile();
      const compiled = compile(spec, siteProfile);
      const hasErrors = compiled.diagnostics.some((d) => d.severity === 'error');

      if (hasErrors) {
        const result = {
          document_hash: currentHash,
          diagnostics: compiled.diagnostics,
          nativeness: compiled.nativeness,
          raw_ratio: compiled.rawRatio,
          applied: false,
          path,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: true,
        };
      }

      if (dryRun) {
        const result = {
          document_hash: currentHash,
          diagnostics: compiled.diagnostics,
          nativeness: compiled.nativeness,
          raw_ratio: compiled.rawRatio,
          applied: false,
          path,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        };
      }

      const snapshot = await captureSnapshot(postId, source);
      const written = await replaceDocumentTree(postId, compiled.elements, expectedHash);
      await invalidateCache(postId);

      const result = {
        document_hash: written.documentHash,
        diagnostics: compiled.diagnostics,
        nativeness: compiled.nativeness,
        raw_ratio: compiled.rawRatio,
        applied: true,
        path: written.source === 'autosave' ? ('autosave' as const) : ('draft' as const),
      };

      // A ledger-write or idempotency-record failure never retroactively
      // fails a write that already succeeded — same reasoning as
      // edit_elements (server/src/tools/editElements.ts).
      if (site) {
        try {
          await writeLedgerEntry(db, {
            siteId: site.id,
            subject: LOCAL_SUBJECT,
            tool: 'apply_page_spec',
            redactedArgs: redactArgs({ post_id: postId }, LEDGER_ARGS_ALLOWLIST['apply_page_spec'] ?? []),
            correlationId: correlationId ?? randomUUID(),
            snapshotPointer: String(snapshot.id),
          });
        } catch {
          // Intentionally swallowed — see comment above.
        }

        if (idempotencyKey) {
          try {
            await recordIdempotentResult(db, site.id, LOCAL_SUBJECT, idempotencyKey, result);
          } catch {
            // Intentionally swallowed — see comment above.
          }
        }
      }

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

function errorResult(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function describeError(error: unknown, postId: number): string {
  if (error instanceof UnsupportedGenerationError) {
    return error.message;
  }

  if (error instanceof DocumentLockedError) {
    return `Refusing: post ${postId} is locked — ${error.lockedByName ?? `user ${error.lockedByUserId}`} is editing it.`;
  }

  if (error instanceof DocumentHashMismatchError) {
    return `The document has changed since your document_hash was read. Current hash: "${error.currentHash}". Re-fetch and retry.`;
  }

  if (error instanceof InvalidOperationsError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `apply_page_spec failed: ${error instanceof Error ? error.message : String(error)}`;
}
