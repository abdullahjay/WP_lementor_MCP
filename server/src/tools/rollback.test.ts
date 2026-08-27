import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  resolveCurrentSiteMock,
  getChangeMock,
  getDocumentMock,
  captureSnapshotMock,
  restoreSnapshotMock,
  invalidateCacheMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  resolveCurrentSiteMock: vi.fn(),
  getChangeMock: vi.fn(),
  getDocumentMock: vi.fn(),
  captureSnapshotMock: vi.fn(),
  restoreSnapshotMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
}));

vi.mock('../db/connection.js', () => ({ getDb: getDbMock }));
vi.mock('../registry/currentSite.js', async () => {
  const actual = await vi.importActual<typeof import('../registry/currentSite.js')>('../registry/currentSite.js');
  return { ...actual, resolveCurrentSite: resolveCurrentSiteMock };
});
vi.mock('../ledger/query.js', () => ({ getChange: getChangeMock }));
vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return {
    ...actual,
    getDocument: getDocumentMock,
    captureSnapshot: captureSnapshotMock,
    restoreSnapshot: restoreSnapshotMock,
    invalidateCache: invalidateCacheMock,
  };
});

const { rollbackTool } = await import('./rollback.js');

const FAKE_SITE = { id: 'site-1', slug: 'abc', url: 'http://wp-v4-pro' };
const VALID_CHANGE = {
  id: 'c1',
  subject: 'user-1',
  tool: 'edit_elements',
  redactedArgs: { post_id: 5 },
  correlationId: 'corr-1',
  timestamp: new Date(),
  snapshotPointer: '3',
  rawRatio: null,
  nativeness: null,
  approvalTokenRef: null,
};

describe('rollback', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an empty change_ids array', async () => {
    const result = await rollbackTool.handler({ change_ids: [] });
    expect(result.isError).toBe(true);
  });

  it('rejects more than the max allowed change_ids', async () => {
    const result = await rollbackTool.handler({ change_ids: Array(21).fill('x') });
    expect(result.isError).toBe(true);
  });

  it('successfully rolls back a draft post: snapshots current state, restores, invalidates cache', async () => {
    getDbMock.mockReturnValue({});
    resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
    getChangeMock.mockResolvedValue(VALID_CHANGE);
    getDocumentMock.mockResolvedValue({ status: 'draft' });
    captureSnapshotMock.mockResolvedValue({ id: 99, postId: 5, source: 'parent', hash: 'h1', createdAt: 'x' });
    restoreSnapshotMock.mockResolvedValue({ postId: 5, restored: true, hash: 'h0' });
    invalidateCacheMock.mockResolvedValue({ postId: 5, invalidated: true, warmed: true });

    const result = await rollbackTool.handler({ change_ids: ['c1'] });

    expect(result.isError).toBe(false);
    expect(captureSnapshotMock).toHaveBeenCalledWith(5, 'parent');
    expect(restoreSnapshotMock).toHaveBeenCalledWith(3);
    expect(invalidateCacheMock).toHaveBeenCalledWith(5);
    const results = result.structuredContent?.['results'] as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({ change_id: 'c1', restored: true, post_id: 5, pre_rollback_snapshot_id: 99, hash: 'h0' });
  });

  it('refuses to roll back a published post, without ever snapshotting or restoring', async () => {
    getDbMock.mockReturnValue({});
    resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
    getChangeMock.mockResolvedValue(VALID_CHANGE);
    getDocumentMock.mockResolvedValue({ status: 'publish' });

    const result = await rollbackTool.handler({ change_ids: ['c1'] });

    expect(result.isError).toBe(true);
    const results = result.structuredContent?.['results'] as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({ change_id: 'c1', restored: false });
    expect(String(results[0]?.['error'])).toContain('published');
    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(restoreSnapshotMock).not.toHaveBeenCalled();
  });

  it('errors per-change when the change does not exist on this site, without touching WordPress', async () => {
    getDbMock.mockReturnValue({});
    resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
    getChangeMock.mockResolvedValue(null);

    const result = await rollbackTool.handler({ change_ids: ['unknown'] });

    expect(result.isError).toBe(true);
    const results = result.structuredContent?.['results'] as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({ change_id: 'unknown', restored: false });
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('errors per-change when the change has no snapshot pointer', async () => {
    getDbMock.mockReturnValue({});
    resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
    getChangeMock.mockResolvedValue({ ...VALID_CHANGE, snapshotPointer: null });

    const result = await rollbackTool.handler({ change_ids: ['c1'] });

    expect(result.isError).toBe(true);
    const results = result.structuredContent?.['results'] as Array<Record<string, unknown>>;
    expect(String(results[0]?.['error'])).toContain('snapshot');
  });

  it('errors per-change when the change has no post_id in its redacted args', async () => {
    getDbMock.mockReturnValue({});
    resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
    getChangeMock.mockResolvedValue({ ...VALID_CHANGE, redactedArgs: {} });

    const result = await rollbackTool.handler({ change_ids: ['c1'] });

    expect(result.isError).toBe(true);
    const results = result.structuredContent?.['results'] as Array<Record<string, unknown>>;
    expect(String(results[0]?.['error'])).toContain('post_id');
  });

  it('processes multiple change_ids independently — one failure does not block the rest', async () => {
    getDbMock.mockReturnValue({});
    resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
    getChangeMock.mockImplementation((_db: unknown, _site: unknown, id: string) =>
      id === 'good' ? Promise.resolve(VALID_CHANGE) : Promise.resolve(null),
    );
    getDocumentMock.mockResolvedValue({ status: 'draft' });
    captureSnapshotMock.mockResolvedValue({ id: 99, postId: 5, source: 'parent', hash: 'h1', createdAt: 'x' });
    restoreSnapshotMock.mockResolvedValue({ postId: 5, restored: true, hash: 'h0' });
    invalidateCacheMock.mockResolvedValue({ postId: 5, invalidated: true, warmed: true });

    const result = await rollbackTool.handler({ change_ids: ['bad', 'good'] });

    const results = result.structuredContent?.['results'] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ change_id: 'bad', restored: false });
    expect(results[1]).toMatchObject({ change_id: 'good', restored: true });
    expect(result.isError).toBe(false); // at least one succeeded
  });
});
