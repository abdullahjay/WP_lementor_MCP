import { and, desc, eq } from 'drizzle-orm';
import { ledgerIndex } from '../db/schema.js';
import type { Database } from '../registry/reader.js';

export interface LedgerChange {
  id: string;
  subject: string;
  tool: string;
  redactedArgs: Record<string, unknown>;
  correlationId: string;
  timestamp: Date;
  snapshotPointer: string | null;
  rawRatio: number | null;
  nativeness: number | null;
  approvalTokenRef: string | null;
}

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;

/**
 * `list_changes` (EMCP-039). Bounded (Blueprints.md §8's "no unbounded
 * scan" rule for anything ledger-adjacent) and scoped to exactly one
 * `siteId` — the `eq(ledgerIndex.siteId, siteId)` filter is not optional
 * and not a parameter a caller can widen; solution.md's "never crossing a
 * site boundary" is enforced structurally here, not by convention.
 */
export async function listChanges(db: Database, siteId: string, limit?: number): Promise<LedgerChange[]> {
  const boundedLimit = Math.min(Math.max(1, limit ?? DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT);

  const rows = await db
    .select()
    .from(ledgerIndex)
    .where(eq(ledgerIndex.siteId, siteId))
    .orderBy(desc(ledgerIndex.timestamp))
    .limit(boundedLimit);

  return rows as LedgerChange[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Single-row lookup for `rollback`, scoped to `siteId` the same way —
 * a `changeId` from a different site returns `null`, exactly as if it
 * didn't exist, never a cross-site read.
 *
 * `id` is a `uuid` column — a non-UUID-shaped `changeId` (a model
 * hallucinating an id, or just a typo) would otherwise reach Postgres as a
 * malformed query and throw a raw driver error whose message embeds the
 * literal SQL and bound parameters, including `siteId` — an internal
 * identifier a caller has no business seeing, surfaced by an ordinary bad
 * input rather than anything adversarial. Checked and short-circuited to
 * the same `null` a real-but-missing id returns, before the query runs.
 */
export async function getChange(db: Database, siteId: string, changeId: string): Promise<LedgerChange | null> {
  if (!UUID_PATTERN.test(changeId)) {
    return null;
  }

  const rows = await db
    .select()
    .from(ledgerIndex)
    .where(and(eq(ledgerIndex.id, changeId), eq(ledgerIndex.siteId, siteId)))
    .limit(1);

  return (rows[0] as LedgerChange | undefined) ?? null;
}
