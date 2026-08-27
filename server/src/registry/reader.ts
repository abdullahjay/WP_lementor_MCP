import { eq } from 'drizzle-orm';
import type { createDb } from '../db/index.js';
import { sites } from '../db/schema.js';

export type Database = ReturnType<typeof createDb>['db'];

export interface SiteRecord {
  id: string;
  slug: string;
  url: string;
  generationDefault: 'v4' | 'v3' | 'legacy' | null;
  environment: 'sandbox' | 'client';
  pluginVersion: string | null;
  minSupportedPluginVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Read-only access to the site registry. This is the module tool handlers
 * should import — `admin.ts`'s mutations deliberately live elsewhere
 * (prd.md EMCP-014: "no tool can mutate the registry").
 */
export async function getSiteBySlug(db: Database, slug: string): Promise<SiteRecord | null> {
  const rows = await db.select().from(sites).where(eq(sites.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/**
 * EMCP-039: `list_changes`/`rollback` need "the current site" in a
 * single-connector session that only carries `WP_BASE_URL` (solution.md
 * §3 — no `site_id` argument anywhere), not a slug. Matches on an exact
 * URL string, not a fuzzy one — `url` has no unique constraint, so an
 * ambiguous match (more than one row sharing a URL) is a real
 * misconfiguration, not something to silently pick a winner for.
 */
export async function getSiteByUrl(db: Database, url: string): Promise<SiteRecord | null> {
  const rows = await db.select().from(sites).where(eq(sites.url, url)).limit(2);

  if (rows.length > 1) {
    throw new Error(`More than one registered site has the URL "${url}" — registry is ambiguous.`);
  }

  return rows[0] ?? null;
}

export async function listSites(db: Database): Promise<SiteRecord[]> {
  return db.select().from(sites);
}
