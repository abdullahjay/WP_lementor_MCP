import { randomUUID } from 'node:crypto';
import '../dsl/v3.js';
import '../dsl/v4.js';
import { compile } from '../dsl/compile.js';
import type { Spec } from '../dsl/types.js';
import type { ToolCallResult } from '../protocol/types.js';
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

// No OAuth yet (solution.md's decision table) — same placeholder every
// mutating tool this server has uses until a real subject exists.
const LOCAL_SUBJECT = 'local-header-auth';

export interface ApplyCompiledSpecOptions {
  /** Ledger `tool` name and idempotency/error-message prefix — `apply_page_spec` or `apply_template`. */
  toolName: string;
  postId: number;
  expectedHash: string;
  spec: Spec;
  dryRun: boolean;
  idempotencyKey: string | undefined;
  correlationId: string | undefined;
}

/**
 * EMCP-055/061 — the write path shared by `apply_page_spec` and
 * `apply_template` (Blueprints.md §7.1/§7.8): compile a `Spec` and
 * **replace** a page's whole content with the result, through the same
 * safety ring `edit_elements` established (hash CAS, lock check, autosave
 * branching, snapshot, cache invalidation, ledger, idempotency). The only
 * difference between the two callers is *where the spec comes from*
 * (an inline argument vs. a stored template's `spec`) — everything from
 * "fetch the target document" onward is identical, so it lives here once
 * rather than twice.
 *
 * `dry_run` is a **structurally separate code path incapable of writing**
 * — it returns before `captureSnapshot`/`replaceDocumentTree`/
 * `invalidateCache` are ever called, not a late branch in the write path.
 */
export async function applyCompiledSpec(options: ApplyCompiledSpecOptions): Promise<ToolCallResult> {
  const { toolName, postId, expectedHash, spec, dryRun, idempotencyKey, correlationId } = options;

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
        return { content: [{ type: 'text', text: JSON.stringify(cached) }], structuredContent: cached, isError: false };
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
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: true };
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
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
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
    // fails a write that already succeeded — content is already changed
    // on WordPress, and reporting isError:true here would tell a caller
    // to retry a write that landed, duplicating it.
    if (site) {
      try {
        await writeLedgerEntry(db, {
          siteId: site.id,
          subject: LOCAL_SUBJECT,
          tool: toolName,
          redactedArgs: redactArgs({ post_id: postId }, LEDGER_ARGS_ALLOWLIST[toolName] ?? []),
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

    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: false };
  } catch (error) {
    return { content: [{ type: 'text', text: describeApplyError(toolName, error, postId) }], isError: true };
  }
}

export function describeApplyError(toolName: string, error: unknown, postId: number): string {
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

  return `${toolName} failed: ${error instanceof Error ? error.message : String(error)}`;
}
