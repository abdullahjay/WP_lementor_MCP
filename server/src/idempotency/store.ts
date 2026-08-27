import { and, eq, gt, sql } from 'drizzle-orm';
import { idempotencyKeys } from '../db/schema.js';
import type { Database } from '../registry/reader.js';

// Real systems (Stripe's idempotency keys, the closest well-known
// precedent) keep a key for 24 hours — long enough to cover a client's
// retry-after-timeout window, short enough that the table doesn't grow
// unbounded. No caller-configurable TTL exists yet (Blueprints.md §7.2
// doesn't name one on `edit_elements`'s `idempotency_key` param); revisit
// if a real need for a shorter/longer window ever surfaces.
const DEFAULT_TTL_MINUTES = 24 * 60;

/**
 * prd.md EMCP-044: "Scoped to `(subject, site)`, expiring; a repeat key
 * returns the prior result." EMCP-013's schema already carries a unique
 * `(subject, site_id, key)` index — this is the first code to actually
 * read and write it.
 *
 * Deliberately **only** caches a result that reached a real write
 * (`edit_elements`'s isError:false / a successful `Document::save()`), not
 * a validation failure or a lock/hash refusal — those had no side effect,
 * so replaying the exact request after fixing the input (or waiting out a
 * lock) should re-run fresh, not return a stale rejection. An idempotency
 * key protects against *duplicating a write*, not against re-validating
 * different input under an accidentally-reused key.
 */
export async function findIdempotentResult(
  db: Database,
  siteId: string,
  subject: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ result: idempotencyKeys.result })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.siteId, siteId),
        eq(idempotencyKeys.subject, subject),
        eq(idempotencyKeys.key, key),
        gt(idempotencyKeys.expiresAt, sql`now()`),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.result) {
    return null;
  }

  return row.result as Record<string, unknown>;
}

/**
 * Insert-if-not-exists, not upsert — the first successful call under a key
 * is the canonical result; a second insert attempt (a genuine race between
 * two concurrent retries) loses at the database's unique-index level, not
 * via a read-then-write gap this function would otherwise leave open. The
 * loser's own result is simply not stored; its caller already has the
 * correct (matching, since both requests carried identical input under
 * `edit_elements`'s CAS-checked write path) response to return.
 */
export async function recordIdempotentResult(
  db: Database,
  siteId: string,
  subject: string,
  key: string,
  result: Record<string, unknown>,
  ttlMinutes: number = DEFAULT_TTL_MINUTES,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  await db
    .insert(idempotencyKeys)
    .values({ siteId, subject, key, result, expiresAt })
    .onConflictDoNothing({ target: [idempotencyKeys.subject, idempotencyKeys.siteId, idempotencyKeys.key] });
}
