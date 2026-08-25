import { getCredential } from '../credentials/store.js';
import { getSiteBySlug, type Database, type SiteRecord } from '../registry/reader.js';
import { getGrant } from './grantReader.js';

/**
 * solution.md §9.2's chain: `oauth_subject → grant on this site →
 * credential selection → ...`. No fallback credential — a missing grant is
 * a denial before anything downstream of it runs, including credential
 * lookup (which is itself a precondition for any outbound WordPress call).
 * The same error covers "site doesn't exist" and "site exists but no
 * grant" on purpose — distinguishing them would let an unauthorized caller
 * use this as a site-slug enumeration oracle.
 */
export class GrantDeniedError extends Error {
  readonly status = 403;

  constructor(oauthSubject: string, siteSlug: string) {
    super(`Subject "${oauthSubject}" has no grant for site "${siteSlug}".`);
  }
}

export interface ResolvedGrant {
  site: SiteRecord;
  scopes: string[];
}

export async function resolveGrant(
  db: Database,
  oauthSubject: string,
  siteSlug: string,
): Promise<ResolvedGrant> {
  const site = await getSiteBySlug(db, siteSlug);

  if (!site) {
    throw new GrantDeniedError(oauthSubject, siteSlug);
  }

  const grant = await getGrant(db, oauthSubject, site.id);

  if (!grant) {
    throw new GrantDeniedError(oauthSubject, siteSlug);
  }

  return { site, scopes: grant.scopes };
}

export interface ResolvedCredential extends ResolvedGrant {
  secret: string;
}

/**
 * Grant check happens and is awaited *before* `getCredential` is ever
 * called — `GrantDeniedError` is thrown from `resolveGrant` above, which
 * this function does not catch, so a denial exits here and credential
 * lookup (the last local step before any outbound WordPress call) never
 * runs. `grants.test.ts` asserts this mechanically via a mock, not just by
 * reading the code.
 */
export async function resolveCredential(
  db: Database,
  oauthSubject: string,
  siteSlug: string,
): Promise<ResolvedCredential> {
  const { site, scopes } = await resolveGrant(db, oauthSubject, siteSlug);
  const secret = await getCredential(db, site.id);

  return { site, scopes, secret };
}
