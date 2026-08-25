import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSiteBySlugMock, getGrantMock, getCredentialMock } = vi.hoisted(() => ({
  getSiteBySlugMock: vi.fn(),
  getGrantMock: vi.fn(),
  getCredentialMock: vi.fn(),
}));

vi.mock('../registry/reader.js', () => ({ getSiteBySlug: getSiteBySlugMock }));
vi.mock('./grantReader.js', () => ({ getGrant: getGrantMock }));
vi.mock('../credentials/store.js', () => ({ getCredential: getCredentialMock }));

const { GrantDeniedError, resolveCredential, resolveGrant } = await import('./grants.js');

const FAKE_DB = {} as never;
const FAKE_SITE = { id: 'site-1', slug: 'abc123', url: 'http://wp-v4-pro' };

describe('grant resolution', () => {
  beforeEach(() => {
    getSiteBySlugMock.mockReset();
    getGrantMock.mockReset();
    getCredentialMock.mockReset();
  });

  it('denies (403) when the site does not exist, without ever checking for a grant', async () => {
    getSiteBySlugMock.mockResolvedValue(null);

    await expect(resolveGrant(FAKE_DB, 'user-1', 'unknown-slug')).rejects.toBeInstanceOf(
      GrantDeniedError,
    );
    expect(getGrantMock).not.toHaveBeenCalled();
  });

  it('denies (403) when the site exists but the subject has no grant for it', async () => {
    getSiteBySlugMock.mockResolvedValue(FAKE_SITE);
    getGrantMock.mockResolvedValue(null);

    await expect(resolveGrant(FAKE_DB, 'user-1', 'abc123')).rejects.toBeInstanceOf(
      GrantDeniedError,
    );
  });

  it('resolves scopes when a grant exists', async () => {
    getSiteBySlugMock.mockResolvedValue(FAKE_SITE);
    getGrantMock.mockResolvedValue({ scopes: ['pages:read'] });

    const result = await resolveGrant(FAKE_DB, 'user-1', 'abc123');

    expect(result.scopes).toEqual(['pages:read']);
    expect(result.site).toBe(FAKE_SITE);
  });

  it('a missing grant means getCredential is never called — denial happens before any outbound-request precondition', async () => {
    getSiteBySlugMock.mockResolvedValue(FAKE_SITE);
    getGrantMock.mockResolvedValue(null);

    await expect(resolveCredential(FAKE_DB, 'user-1', 'abc123')).rejects.toBeInstanceOf(
      GrantDeniedError,
    );
    expect(getCredentialMock).not.toHaveBeenCalled();
  });

  it('an unknown site means getCredential is never called either', async () => {
    getSiteBySlugMock.mockResolvedValue(null);

    await expect(resolveCredential(FAKE_DB, 'user-1', 'unknown-slug')).rejects.toBeInstanceOf(
      GrantDeniedError,
    );
    expect(getCredentialMock).not.toHaveBeenCalled();
    expect(getGrantMock).not.toHaveBeenCalled();
  });

  it('getCredential IS called, with the resolved site id, once a grant exists', async () => {
    getSiteBySlugMock.mockResolvedValue(FAKE_SITE);
    getGrantMock.mockResolvedValue({ scopes: ['pages:read', 'pages:write'] });
    getCredentialMock.mockResolvedValue('decrypted-secret');

    const result = await resolveCredential(FAKE_DB, 'user-1', 'abc123');

    expect(getCredentialMock).toHaveBeenCalledWith(FAKE_DB, FAKE_SITE.id);
    expect(result.secret).toBe('decrypted-secret');
    expect(result.scopes).toEqual(['pages:read', 'pages:write']);
  });

  it('the same GrantDeniedError message shape is used whether the site is missing or the grant is missing (no enumeration oracle)', async () => {
    getSiteBySlugMock.mockResolvedValue(null);
    let unknownSiteMessage = '';
    try {
      await resolveGrant(FAKE_DB, 'user-1', 'slug-a');
    } catch (error) {
      unknownSiteMessage = (error as Error).message;
    }

    getSiteBySlugMock.mockResolvedValue(FAKE_SITE);
    getGrantMock.mockResolvedValue(null);
    let noGrantMessage = '';
    try {
      await resolveGrant(FAKE_DB, 'user-1', 'slug-a');
    } catch (error) {
      noGrantMessage = (error as Error).message;
    }

    expect(unknownSiteMessage).toBe(noGrantMessage);
  });
});
