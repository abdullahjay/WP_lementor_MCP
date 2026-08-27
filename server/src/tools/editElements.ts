import { randomUUID } from 'node:crypto';
import type { ToolImplementation } from '../protocol/types.js';
import { getDb } from '../db/connection.js';
import { resolveCurrentSite } from '../registry/currentSite.js';
import type { SiteRecord } from '../registry/reader.js';
import { writeLedgerEntry } from '../ledger/writer.js';
import { redactArgs } from '../ledger/redact.js';
import { LEDGER_ARGS_ALLOWLIST } from '../ledger/allowlists.js';
import { findIdempotentResult, recordIdempotentResult } from '../idempotency/store.js';
import { validateWidgetSettings, type Diagnostic as ValidationDiagnostic } from '../domain/validate.js';
import type { RawWidget } from '../domain/curation.js';
import { findElementById } from '../domain/find.js';
import type { ElementorNode } from '../domain/detect.js';
import {
  captureSnapshot,
  editElements as editElementsRemote,
  ElementsNotFoundError,
  getDocument,
  getWidgetDetail,
  invalidateCache,
  InvalidOperationsError,
  DocumentHashMismatchError,
  DocumentLockedError,
  WordPressApiError,
  type EditOperation,
} from '../wp/client.js';

const MAX_OPERATIONS = 20;

// No OAuth yet (solution.md's decision table) — this server's local dev
// auth is one shared header token, with no per-caller identity to record.
// A real subject arrives with EMCP-056+; documented placeholder until then.
const LOCAL_SUBJECT = 'local-header-auth';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    document_hash: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { element_id: { type: 'string' }, applied: { type: 'boolean' } },
        required: ['element_id', 'applied'],
      },
    },
    diagnostics: {
      type: 'array',
      items: {
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
      },
    },
  },
  required: ['document_hash', 'results', 'diagnostics'],
  additionalProperties: false,
} as const;

/**
 * EMCP-043 — Blueprints.md §7.2, `edit_elements`. The first real mutating
 * MCP tool registered by this server: everything since EMCP-036 (structural
 * validation, snapshot capture, cache invalidation, post-lock refusal,
 * document-hash CAS, ledger, rollback) exists to make this call safe.
 *
 * **Validate-all-then-apply, exactly as Blueprints.md §7.2 requires:**
 * structural validation (EMCP-036, against the real live widget registry)
 * runs for *every* operation before any snapshot, write, or ledger entry —
 * a single invalid operation in a batch means nothing is applied, not a
 * partial apply. `PUT /documents/{id}` (EMCP-040–043) re-validates element
 * existence independently as defense in depth, but is not the structural
 * validation boundary — that is entirely this handler's job, same as every
 * prior write-path task established.
 */
export const editElementsTool: ToolImplementation = {
  name: 'edit_elements',
  description:
    'Applies a batch of settings edits to existing elements on a page, in ' +
    'one document save. Each operation is { op: "set_settings", ' +
    'element_id, settings }. All operations are validated — against the ' +
    "real widget registry and the document's current structure — before " +
    'any of them are applied; if any operation is invalid, nothing is ' +
    'written and the diagnostics explain exactly which operation and why. ' +
    'Requires the document_hash from get_page_structure/get_element (or a ' +
    "prior edit_elements call's response) — a stale hash is refused, not " +
    'silently overwritten, so re-fetch and retry with the current hash on ' +
    'a 409-style refusal. Example: operations: [{ op: "set_settings", ' +
    'element_id: "186bf22", settings: { title: "New heading" } }, ' +
    '{ op: "set_settings", element_id: "e41d5bc", settings: { text: "New button text" } }]. ' +
    'Pass idempotency_key to make a retry safe after a timeout or dropped ' +
    'response: a repeated call with the same key returns the original ' +
    "successful result without writing again, rather than duplicating it. " +
    'Only successful writes are cached this way — a validation failure or ' +
    'a lock/hash refusal is always re-attempted fresh.',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      document_hash: {
        type: 'string',
        description: 'The document_hash from a prior read of this post — enforced as a compare-and-swap.',
      },
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_OPERATIONS,
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['set_settings'] },
            element_id: { type: 'string' },
            settings: { type: 'object' },
          },
          required: ['op', 'element_id', 'settings'],
          additionalProperties: false,
        },
      },
      override_lock: {
        type: 'boolean',
        description: 'Write even if another user currently has this post open in the editor. Default false.',
      },
      idempotency_key: {
        type: 'string',
        description: 'A caller-chosen key making a retried call safe — see the tool description.',
      },
    },
    required: ['post_id', 'document_hash', 'operations'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },

  async handler(args, correlationId) {
    const postId = args?.['post_id'];
    const expectedHash = args?.['document_hash'];
    const rawOperations = args?.['operations'];
    const overrideLock = args?.['override_lock'] === true;

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return errorResult('edit_elements requires an integer "post_id".');
    }

    if (typeof expectedHash !== 'string' || expectedHash === '') {
      return errorResult('edit_elements requires a non-empty string "document_hash".');
    }

    if (!Array.isArray(rawOperations) || rawOperations.length === 0 || rawOperations.length > MAX_OPERATIONS) {
      return errorResult(
        `edit_elements requires a non-empty "operations" array of at most ${MAX_OPERATIONS} items.`,
      );
    }

    const operations: EditOperation[] = [];
    const rawOperationsList: unknown[] = rawOperations;
    for (let i = 0; i < rawOperationsList.length; i += 1) {
      const raw: unknown = rawOperationsList[i];
      if (
        !isRecord(raw) ||
        raw['op'] !== 'set_settings' ||
        typeof raw['element_id'] !== 'string' ||
        raw['element_id'] === '' ||
        !isRecord(raw['settings']) ||
        Object.keys(raw['settings']).length === 0
      ) {
        return errorResult(
          `operations[${i}] is malformed — each operation needs "op": "set_settings", a non-empty ` +
            '"element_id", and a non-empty "settings" object.',
        );
      }
      operations.push({
        op: 'set_settings',
        elementId: raw['element_id'],
        settings: raw['settings'],
      });
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
        // Idempotency and the ledger are both site-scoped and both
        // best-effort here — an unresolved site (this connector's
        // WP_BASE_URL was never registered) shouldn't block the actual
        // write, which doesn't need a site row at all.
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

      const document = await getDocument(postId);
      const elements = Array.isArray(document['elements']) ? (document['elements'] as ElementorNode[]) : [];
      const currentHash = typeof document['document_hash'] === 'string' ? document['document_hash'] : '';

      const diagnostics: ValidationDiagnostic[] = [];
      const widgetCache = new Map<string, RawWidget>();

      for (let i = 0; i < operations.length; i += 1) {
        const op = operations[i]!;
        const element = findElementById(elements, op.elementId);

        if (!element) {
          diagnostics.push({
            path: `operations[${i}]`,
            severity: 'error',
            code: 'ELEMENT_NOT_FOUND',
            message: `No element with id "${op.elementId}" was found on post ${postId}.`,
          });
          continue;
        }

        const widgetType = typeof element['widgetType'] === 'string' ? element['widgetType'] : undefined;

        if (!widgetType) {
          diagnostics.push({
            path: `operations[${i}]`,
            severity: 'error',
            code: 'WIDGET_NOT_AVAILABLE',
            message: `Element "${op.elementId}" (elType "${element.elType}") is not a widget and has no settings to edit.`,
          });
          continue;
        }

        let widget = widgetCache.get(widgetType);
        if (!widget) {
          widget = (await getWidgetDetail(widgetType)) as unknown as RawWidget;
          widgetCache.set(widgetType, widget);
        }

        diagnostics.push(
          ...validateWidgetSettings(widgetType, op.settings, [widget], {
            basePath: `operations[${i}].settings`,
          }),
        );
      }

      if (diagnostics.length > 0) {
        const result = { document_hash: currentHash, results: [], diagnostics };
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: true,
        };
      }

      const snapshot = await captureSnapshot(postId, 'parent');
      const written = await editElementsRemote(postId, operations, expectedHash, { overrideLock });
      await invalidateCache(postId);

      const results = written.results.map((r) => ({ element_id: r.elementId, applied: r.applied }));
      const result = { document_hash: written.documentHash, results, diagnostics: [] };

      // A ledger-write or idempotency-record failure never retroactively
      // fails a write that already succeeded — content is already changed
      // on WordPress, and reporting isError:true here would tell a caller
      // to retry a write that landed, duplicating it.
      if (site) {
        try {
          await writeLedgerEntry(db, {
            siteId: site.id,
            subject: LOCAL_SUBJECT,
            tool: 'edit_elements',
            redactedArgs: redactArgs({ post_id: postId }, LEDGER_ARGS_ALLOWLIST['edit_elements'] ?? []),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown, postId: number): string {
  if (error instanceof DocumentLockedError) {
    return `Refusing: post ${postId} is locked — ${error.lockedByName ?? `user ${error.lockedByUserId}`} is editing it. Pass override_lock: true to write anyway.`;
  }

  if (error instanceof DocumentHashMismatchError) {
    return `The document has changed since your document_hash was read. Current hash: "${error.currentHash}". Re-fetch and retry.`;
  }

  if (error instanceof InvalidOperationsError || error instanceof ElementsNotFoundError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `edit_elements failed: ${error instanceof Error ? error.message : String(error)}`;
}
