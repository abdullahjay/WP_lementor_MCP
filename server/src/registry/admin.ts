import { sites } from '../db/schema.js';
import type { Database, SiteRecord } from './reader.js';
import { generateSiteSlug } from './slug.js';

export interface CreateSiteInput {
  url: string;
  environment: 'sandbox' | 'client';
  generationDefault?: 'v4' | 'v3' | 'legacy';
  pluginVersion?: string;
  minSupportedPluginVersion?: string;
}

/**
 * Registry *mutation*. Deliberately not exported from `reader.ts` or
 * anywhere else a tool handler would import from — prd.md EMCP-014: "no
 * tool can mutate the registry." This is the only place that writes to the
 * `sites` table; wire it into an admin CLI or bootstrap script, never into
 * `server/src/tools/`. `admin.test.ts` asserts no tool file imports this
 * module, so the boundary is checked, not just documented.
 */
export async function createSite(db: Database, input: CreateSiteInput): Promise<SiteRecord> {
  const [row] = await db
    .insert(sites)
    .values({ slug: generateSiteSlug(), ...input })
    .returning();

  if (!row) {
    throw new Error('createSite: insert returned no row.');
  }

  return row;
}
