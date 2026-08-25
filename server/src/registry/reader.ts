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

export async function listSites(db: Database): Promise<SiteRecord[]> {
  return db.select().from(sites);
}
