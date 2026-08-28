import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  resolveCurrentSiteMock,
  writeLedgerEntryMock,
  captureSnapshotMock,
  invalidateCacheMock,
  publishDraftRemoteMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  resolveCurrentSiteMock: vi.fn(),
  writeLedgerEntryMock: vi.fn(),
  captureSnapshotMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  publishDraftRemoteMock: vi.fn(),
}));

vi.mock('../db/connection.js', () => ({ getDb: getDbMock }));
vi.mock('../registry/currentSite.js', async () => {
  const actual = await vi.importActual<typeof import('../registry/currentSite.js')>('../registry/currentSite.js');
  return { ...actual, resolveCurrentSite: resolveCurrentSiteMock };
});
vi.mock('../ledger/writer.js', () => ({ writeLedgerEntry: writeLedgerEntryMock }));
vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return {
    ...actual,
    captureSnapshot: captureSnapshotMock,
    invalidateCache: invalidateCacheMock,
    publishDraft: publishDraftRemoteMock,
  };
});

const { publishDraftTool } = await import('./publishDraft.js');
const { ApprovalContentChangedError, ApprovalTokenInvalidError, WordPressApiError } = await import('../wp/client.js');

const FAKE_SITE = { id: 'site-1', slug: 'abc', url: 'http://wp-v4-pro' };

function stubHappyPath(): void {
  getDbMock.mockReturnValue({});
  resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
  writeLedgerEntryMock.mockResolvedValue('ledger-id-1');
  captureSnapshotMock.mockResolvedValue({ id: 9, postId: 5, source: 'parent', hash: 'hash-1', createdAt: 'x' });
  invalidateCacheMock.mockResolvedValue({ postId: 5, invalidated: true, warmed: true });
}

describe('publish_draft', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-integer post_id without calling anything', async () => {
    const result = await publishDraftTool.handler({ post_id: 'nope' });

    expect(result.isError).toBe(true);
    expect(publishDraftRemoteMock).not.toHaveBeenCalled();
  });

  it('returns the pending state without capturing a snapshot when no token is given', async () => {
    stubHappyPath();
    publishDraftRemoteMock.mockResolvedValue({
      published: false,
      status: 'pending',
      message: 'Approval required.',
      approvalUrl: 'http://wp/tools.php?page=emcp-publish-approval&post_id=5',
    });

    const result = await publishDraftTool.handler({ post_id: 5 });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      published: false,
      status: 'pending',
      message: 'Approval required.',
      approval_url: 'http://wp/tools.php?page=emcp-publish-approval&post_id=5',
    });
    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(publishDraftRemoteMock).toHaveBeenCalledWith(5);
  });

  it('publishes with a valid token, snapshots first, invalidates cache, and writes a ledger entry', async () => {
    stubHappyPath();
    publishDraftRemoteMock.mockResolvedValue({ published: true, status: 'publish', url: 'http://wp/my-page' });

    const result = await publishDraftTool.handler({ post_id: 5, confirmation_token: 'real-token' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ published: true, status: 'publish', url: 'http://wp/my-page' });
    expect(captureSnapshotMock).toHaveBeenCalledWith(5, 'parent');
    expect(publishDraftRemoteMock).toHaveBeenCalledWith(5, 'real-token');
    expect(invalidateCacheMock).toHaveBeenCalledWith(5);
    /* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.any(String) is untyped by design */
    expect(writeLedgerEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tool: 'publish_draft',
        snapshotPointer: '9',
        approvalTokenRef: expect.any(String),
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  });

  it('never records the raw token as approvalTokenRef, only a hash', async () => {
    stubHappyPath();
    publishDraftRemoteMock.mockResolvedValue({ published: true, status: 'publish', url: 'http://wp/my-page' });

    await publishDraftTool.handler({ post_id: 5, confirmation_token: 'super-secret-raw-token' });

    const call = writeLedgerEntryMock.mock.calls[0]?.[1] as { approvalTokenRef?: string };
    expect(call.approvalTokenRef).not.toBe('super-secret-raw-token');
    expect(call.approvalTokenRef).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports ApprovalContentChangedError as isError, still having snapshotted first', async () => {
    stubHappyPath();
    publishDraftRemoteMock.mockRejectedValue(new ApprovalContentChangedError(5));

    const result = await publishDraftTool.handler({ post_id: 5, confirmation_token: 'stale-token' });

    expect(result.isError).toBe(true);
    expect(captureSnapshotMock).toHaveBeenCalled();
    expect(invalidateCacheMock).not.toHaveBeenCalled();
    expect(writeLedgerEntryMock).not.toHaveBeenCalled();
  });

  it('reports ApprovalTokenInvalidError as isError', async () => {
    stubHappyPath();
    publishDraftRemoteMock.mockRejectedValue(new ApprovalTokenInvalidError('already used'));

    const result = await publishDraftTool.handler({ post_id: 5, confirmation_token: 'used-token' });

    expect(result.isError).toBe(true);
  });

  it('reports a 403 WordPressApiError with a clear permission message', async () => {
    stubHappyPath();
    publishDraftRemoteMock.mockRejectedValue(new WordPressApiError('forbidden', 403, {}));

    const result = await publishDraftTool.handler({ post_id: 5, confirmation_token: 'real-token' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/not permitted to publish/i);
  });

  it('still publishes when site resolution fails (ledger best-effort)', async () => {
    stubHappyPath();
    resolveCurrentSiteMock.mockRejectedValue(new Error('no site registered'));
    publishDraftRemoteMock.mockResolvedValue({ published: true, status: 'publish', url: 'http://wp/my-page' });

    const result = await publishDraftTool.handler({ post_id: 5, confirmation_token: 'real-token' });

    expect(result.isError).toBe(false);
    expect(writeLedgerEntryMock).not.toHaveBeenCalled();
  });
});
