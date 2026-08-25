import { and, eq } from 'drizzle-orm';
import { grants } from '../db/schema.js';
import type { Database } from '../registry/reader.js';

export interface GrantRecord {
  id: string;
  oauthSubject: string;
  siteId: string;
  scopes: string[];
}

/**
 * solution.md §9.2: `oauth_subject → grant on this site → credential
 * selection → ...`. Read-only, mirroring registry/reader.ts's split — this
 * is a separate module (not folded into grants.ts) specifically so it can
 * be mocked independently in tests without dragging in site/credential
 * mocking too.
 */
export async function getGrant(
  db: Database,
  oauthSubject: string,
  siteId: string,
): Promise<GrantRecord | null> {
  const rows = await db
    .select()
    .from(grants)
    .where(and(eq(grants.oauthSubject, oauthSubject), eq(grants.siteId, siteId)))
    .limit(1);

  return rows[0] ?? null;
}
