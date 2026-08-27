import { getSiteByUrl, type Database, type SiteRecord } from './reader.js';
import { loadWordPressSiteConfig } from '../wp/config.js';

/**
 * EMCP-039: `list_changes`/`rollback` need a `site_id` to scope ledger
 * reads — this server's single-connector session (solution.md §3) only
 * carries `WP_BASE_URL`, never a registry slug. Resolves by exact URL
 * match against the already-existing `sites` table (EMCP-013/014).
 *
 * Deliberately does **not** auto-create a site row on a miss — EMCP-014's
 * "no tool can mutate the registry" boundary applies here exactly as it
 * does to every other tool; a site that was never registered via the
 * admin-only `createSite()` (`registry/admin.ts`) stays unregistered, and
 * callers get a clear, honest error instead of a tool silently inventing
 * registry state.
 */
export class CurrentSiteUnregisteredError extends Error {
  constructor(baseUrl: string) {
    super(
      `No registered site matches this connector's WP_BASE_URL ("${baseUrl}"). ` +
        'Register it via the admin site-registry bootstrap before using this tool.',
    );
  }
}

export async function resolveCurrentSite(
  db: Database,
  baseUrl: string = loadWordPressSiteConfig().baseUrl,
): Promise<SiteRecord> {
  const site = await getSiteByUrl(db, baseUrl);

  if (!site) {
    throw new CurrentSiteUnregisteredError(baseUrl);
  }

  return site;
}
