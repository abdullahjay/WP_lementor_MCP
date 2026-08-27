import { ledgerIndex } from '../db/schema.js';
import type { Database } from '../registry/reader.js';

/**
 * Blueprints.md §10's ledger index row shape (Node), EMCP-013's already-
 * committed schema. This is the one function that writes to it — same
 * relationship `registry/admin.ts`'s `createSite` has to the `sites` table.
 */
export interface LedgerEntryInput {
  siteId: string;
  subject: string;
  tool: string;
  /** Already run through `redactArgs()` — this function does not redact. */
  redactedArgs: Record<string, unknown>;
  correlationId: string;
  snapshotPointer?: string;
  rawRatio?: number;
  nativeness?: number;
  approvalTokenRef?: string;
}

/**
 * Returns the new row's id — `rollback` (EMCP-039) needs it (`list_changes`
 * would otherwise be the only way to recover it, an extra round trip a
 * caller that just wrote the entry shouldn't need).
 */
export async function writeLedgerEntry(db: Database, input: LedgerEntryInput): Promise<string> {
  const [row] = await db
    .insert(ledgerIndex)
    .values({
      siteId: input.siteId,
      subject: input.subject,
      tool: input.tool,
      redactedArgs: input.redactedArgs,
      correlationId: input.correlationId,
      ...(input.snapshotPointer !== undefined && { snapshotPointer: input.snapshotPointer }),
      ...(input.rawRatio !== undefined && { rawRatio: input.rawRatio }),
      ...(input.nativeness !== undefined && { nativeness: input.nativeness }),
      ...(input.approvalTokenRef !== undefined && { approvalTokenRef: input.approvalTokenRef }),
    })
    .returning({ id: ledgerIndex.id });

  if (!row) {
    throw new Error('writeLedgerEntry: insert returned no row.');
  }

  return row.id;
}
