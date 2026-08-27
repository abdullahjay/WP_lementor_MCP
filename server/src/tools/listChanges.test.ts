import { afterEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, resolveCurrentSiteMock, listChangesMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  resolveCurrentSiteMock: vi.fn(),
  listChangesMock: vi.fn(),
}));

vi.mock('../db/connection.js', () => ({ getDb: getDbMock }));
vi.mock('../registry/currentSite.js', async () => {
  const actual = await vi.importActual<typeof import('../registry/currentSite.js')>('../registry/currentSite.js');
  return { ...actual, resolveCurrentSite: resolveCurrentSiteMock };
});
vi.mock('../ledger/query.js', () => ({ listChanges: listChangesMock }));

const { listChangesTool } = await import('./listChanges.js');
const { CurrentSiteUnregisteredError } = await import('../registry/currentSite.js');

const FAKE_SITE = { id: 'site-1', slug: 'abc', url: 'http://wp-v4-pro' };

describe('list_changes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns changes for the resolved site, mapped to the wire shape', async () => {
    getDbMock.mockReturnValue({});
    resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
    listChangesMock.mockResolvedValue([
      {
        id: 'c1',
        subject: 'user-1',
        tool: 'edit_elements',
        redactedArgs: { post_id: 5 },
        correlationId: 'corr-1',
        timestamp: new Date('2026-08-27T00:00:00Z'),
        snapshotPointer: '3',
        rawRatio: 0.1,
        nativeness: 0.9,
        approvalTokenRef: null,
      },
    ]);

    const result = await listChangesTool.handler({});

    expect(result.isError).toBe(false);
    expect(result.structuredContent?.['count']).toBe(1);
    const changes = result.structuredContent?.['changes'] as Array<Record<string, unknown>>;
    expect(changes[0]).toMatchObject({ id: 'c1', tool: 'edit_elements', snapshot_pointer: '3' });
  });

  it('passes the given limit through to listChanges', async () => {
    getDbMock.mockReturnValue({});
    resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
    listChangesMock.mockResolvedValue([]);

    await listChangesTool.handler({ limit: 5 });

    expect(listChangesMock).toHaveBeenCalledWith({}, 'site-1', 5);
  });

  it('errors clearly when the site is not registered', async () => {
    getDbMock.mockReturnValue({});
    resolveCurrentSiteMock.mockRejectedValue(new CurrentSiteUnregisteredError('http://wp-v4-pro'));

    const result = await listChangesTool.handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type).toBe('text');
    expect((result.content[0] as { text: string }).text).toContain('No registered site');
    expect(listChangesMock).not.toHaveBeenCalled();
  });
});
