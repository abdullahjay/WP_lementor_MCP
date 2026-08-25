import { randomBytes } from 'node:crypto';

/**
 * Blueprints.md §10: site slugs are unguessable, not sequential. 16 random
 * bytes (128 bits) base64url-encoded — derived from neither the site's `id`
 * (a sequential-feeling UUID is still fine for a primary key; the slug is
 * what appears in URLs/logs and is the thing that must resist guessing) nor
 * anything about the site itself (URL, name), which would make it
 * predictable to anyone who already knows the site.
 */
export function generateSiteSlug(): string {
  return randomBytes(16).toString('base64url');
}
