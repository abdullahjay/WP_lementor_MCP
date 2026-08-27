import type { ToolImplementation } from '../protocol/types.js';
import { getDb } from '../db/connection.js';
import { CurrentSiteUnregisteredError, resolveCurrentSite } from '../registry/currentSite.js';
import { listChanges } from '../ledger/query.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tool: { type: 'string' },
          subject: { type: 'string' },
          redacted_args: { type: 'object' },
          correlation_id: { type: 'string' },
          timestamp: { type: 'string' },
          snapshot_pointer: { type: ['string', 'null'] },
          raw_ratio: { type: ['number', 'null'] },
          nativeness: { type: ['number', 'null'] },
        },
        required: ['id', 'tool', 'subject', 'redacted_args', 'correlation_id', 'timestamp'],
      },
    },
    count: { type: 'integer' },
  },
  required: ['changes', 'count'],
  additionalProperties: false,
} as const;

/**
 * EMCP-039: the "Safety" tool group's read half — a bounded, single-site
 * view over the ledger (`server/src/ledger/query.ts`), most recent first.
 * `rollback` (the write half) consumes a `change.id` from here.
 */
export const listChangesTool: ToolImplementation = {
  name: 'list_changes',
  description:
    'Lists recent tool activity on this site from the ledger — most recent ' +
    'first, bounded (default 20, max 100). Use this to find a change id to ' +
    'pass to rollback, or to review what has been done recently. ' +
    'Read-only; does not undo anything itself.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        description: 'Maximum rows to return. Default 20, capped at 100.',
      },
    },
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler(args) {
    const limitArg = args?.['limit'];
    const limit = typeof limitArg === 'number' && Number.isInteger(limitArg) ? limitArg : undefined;

    try {
      const db = getDb();
      const site = await resolveCurrentSite(db);
      const rows = await listChanges(db, site.id, limit);

      const changes = rows.map((row) => ({
        id: row.id,
        tool: row.tool,
        subject: row.subject,
        redacted_args: row.redactedArgs,
        correlation_id: row.correlationId,
        timestamp: row.timestamp.toISOString(),
        snapshot_pointer: row.snapshotPointer,
        raw_ratio: row.rawRatio,
        nativeness: row.nativeness,
      }));

      const result = { changes, count: changes.length };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: describeError(error) }],
        isError: true,
      };
    }
  },
};

function describeError(error: unknown): string {
  if (error instanceof CurrentSiteUnregisteredError) {
    return error.message;
  }

  return `list_changes failed: ${error instanceof Error ? error.message : String(error)}`;
}
