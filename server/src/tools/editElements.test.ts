import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  resolveCurrentSiteMock,
  writeLedgerEntryMock,
  findIdempotentResultMock,
  recordIdempotentResultMock,
  getDocumentMock,
  getWidgetDetailMock,
  captureSnapshotMock,
  editElementsRemoteMock,
  invalidateCacheMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  resolveCurrentSiteMock: vi.fn(),
  writeLedgerEntryMock: vi.fn(),
  findIdempotentResultMock: vi.fn(),
  recordIdempotentResultMock: vi.fn(),
  getDocumentMock: vi.fn(),
  getWidgetDetailMock: vi.fn(),
  captureSnapshotMock: vi.fn(),
  editElementsRemoteMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
}));

vi.mock('../db/connection.js', () => ({ getDb: getDbMock }));
vi.mock('../registry/currentSite.js', async () => {
  const actual = await vi.importActual<typeof import('../registry/currentSite.js')>('../registry/currentSite.js');
  return { ...actual, resolveCurrentSite: resolveCurrentSiteMock };
});
vi.mock('../ledger/writer.js', () => ({ writeLedgerEntry: writeLedgerEntryMock }));
vi.mock('../idempotency/store.js', () => ({
  findIdempotentResult: findIdempotentResultMock,
  recordIdempotentResult: recordIdempotentResultMock,
}));
vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return {
    ...actual,
    getDocument: getDocumentMock,
    getWidgetDetail: getWidgetDetailMock,
    captureSnapshot: captureSnapshotMock,
    editElements: editElementsRemoteMock,
    invalidateCache: invalidateCacheMock,
  };
});

const { editElementsTool } = await import('./editElements.js');
const { DocumentHashMismatchError, DocumentLockedError } = await import('../wp/client.js');

const FAKE_SITE = { id: 'site-1', slug: 'abc', url: 'http://wp-v4-pro' };

const HEADING_WIDGET = {
  name: 'heading',
  title: 'Heading',
  categories: [],
  keywords: [],
  controls: {
    title: { type: 'textarea', label: 'Title' },
  },
};

const DOCUMENT = {
  elements: [
    { id: 'a1', elType: 'widget', widgetType: 'heading', settings: { title: 'old' }, elements: [] },
    { id: 'b2', elType: 'widget', widgetType: 'heading', settings: { title: 'old2' }, elements: [] },
  ],
  document_hash: 'hash-1',
};

function stubHappyPath(): void {
  getDbMock.mockReturnValue({});
  resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
  writeLedgerEntryMock.mockResolvedValue('ledger-id-1');
  findIdempotentResultMock.mockResolvedValue(null);
  recordIdempotentResultMock.mockResolvedValue(undefined);
  getDocumentMock.mockResolvedValue(DOCUMENT);
  getWidgetDetailMock.mockResolvedValue(HEADING_WIDGET);
  captureSnapshotMock.mockResolvedValue({ id: 9, postId: 5, source: 'parent', hash: 'hash-1', createdAt: 'x' });
  invalidateCacheMock.mockResolvedValue({ postId: 5, invalidated: true, warmed: true });
}

describe('edit_elements', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-integer post_id without touching anything', async () => {
    const result = await editElementsTool.handler({ post_id: 'nope', document_hash: 'h', operations: [] });
    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('rejects a missing document_hash', async () => {
    const result = await editElementsTool.handler({ post_id: 5, operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'x' } }] });
    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('rejects an empty operations array', async () => {
    const result = await editElementsTool.handler({ post_id: 5, document_hash: 'h', operations: [] });
    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('rejects more than the max allowed operations', async () => {
    const operations = Array.from({ length: 21 }, () => ({ op: 'set_settings', element_id: 'a1', settings: { title: 'x' } }));
    const result = await editElementsTool.handler({ post_id: 5, document_hash: 'h', operations });
    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed operation (wrong op, missing element_id, empty settings) without touching anything', async () => {
    const badOps = [
      [{ op: 'delete', element_id: 'a1', settings: { title: 'x' } }],
      [{ op: 'set_settings', settings: { title: 'x' } }],
      [{ op: 'set_settings', element_id: 'a1', settings: {} }],
    ];
    for (const operations of badOps) {
      const result = await editElementsTool.handler({ post_id: 5, document_hash: 'h', operations });
      expect(result.isError).toBe(true);
    }
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('validates all operations before applying any — an unknown control blocks the whole batch', async () => {
    stubHappyPath();

    const result = await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [
        { op: 'set_settings', element_id: 'a1', settings: { title: 'new' } },
        { op: 'set_settings', element_id: 'b2', settings: { titel: 'typo' } },
      ],
    });

    expect(result.isError).toBe(true);
    const diagnostics = result.structuredContent?.['diagnostics'] as Array<Record<string, unknown>>;
    expect(diagnostics.some((d) => d['code'] === 'CONTROL_NOT_FOUND')).toBe(true);
    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(editElementsRemoteMock).not.toHaveBeenCalled();
  });

  it('flags a nonexistent element id as a diagnostic without applying anything', async () => {
    stubHappyPath();

    const result = await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'does-not-exist', settings: { title: 'x' } }],
    });

    expect(result.isError).toBe(true);
    const diagnostics = result.structuredContent?.['diagnostics'] as Array<Record<string, unknown>>;
    expect(diagnostics[0]).toMatchObject({ code: 'ELEMENT_NOT_FOUND' });
    expect(captureSnapshotMock).not.toHaveBeenCalled();
  });

  it('on a fully valid batch: snapshots, writes, invalidates cache, and writes a ledger entry', async () => {
    stubHappyPath();
    editElementsRemoteMock.mockResolvedValue({
      id: 5,
      documentHash: 'hash-2',
      results: [
        { elementId: 'a1', applied: true },
        { elementId: 'b2', applied: true },
      ],
    });

    const result = await editElementsTool.handler(
      {
        post_id: 5,
        document_hash: 'hash-1',
        operations: [
          { op: 'set_settings', element_id: 'a1', settings: { title: 'new' } },
          { op: 'set_settings', element_id: 'b2', settings: { title: 'new2' } },
        ],
      },
      'corr-123',
    );

    expect(result.isError).toBe(false);
    expect(captureSnapshotMock).toHaveBeenCalledWith(5, 'parent');
    expect(editElementsRemoteMock).toHaveBeenCalledWith(
      5,
      [
        { op: 'set_settings', elementId: 'a1', settings: { title: 'new' } },
        { op: 'set_settings', elementId: 'b2', settings: { title: 'new2' } },
      ],
      'hash-1',
      { overrideLock: false },
    );
    expect(invalidateCacheMock).toHaveBeenCalledWith(5);
    expect(writeLedgerEntryMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        siteId: 'site-1',
        tool: 'edit_elements',
        redactedArgs: { post_id: 5 },
        correlationId: 'corr-123',
        snapshotPointer: '9',
      }),
    );
    expect(result.structuredContent).toEqual({
      document_hash: 'hash-2',
      results: [
        { element_id: 'a1', applied: true },
        { element_id: 'b2', applied: true },
      ],
      diagnostics: [],
    });
  });

  it('a ledger-write failure does not turn a successful write into an error', async () => {
    stubHappyPath();
    writeLedgerEntryMock.mockRejectedValue(new Error('db unavailable'));
    editElementsRemoteMock.mockResolvedValue({
      id: 5,
      documentHash: 'hash-2',
      results: [{ elementId: 'a1', applied: true }],
    });

    const result = await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'new' } }],
    });

    expect(result.isError).toBe(false);
  });

  it('reports a clear message and does not throw when the document is locked', async () => {
    stubHappyPath();
    editElementsRemoteMock.mockRejectedValue(new DocumentLockedError(5, 3, 'Someone Else'));

    const result = await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'new' } }],
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Someone Else');
  });

  it('reports a clear message when the hash is stale', async () => {
    stubHappyPath();
    editElementsRemoteMock.mockRejectedValue(new DocumentHashMismatchError(5, 'real-hash'));

    const result = await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'new' } }],
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('real-hash');
  });

  it('passes override_lock through when set', async () => {
    stubHappyPath();
    editElementsRemoteMock.mockResolvedValue({ id: 5, documentHash: 'hash-2', results: [{ elementId: 'a1', applied: true }] });

    await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'new' } }],
      override_lock: true,
    });

    expect(editElementsRemoteMock).toHaveBeenCalledWith(5, expect.anything(), 'hash-1', { overrideLock: true });
  });

  it('only fetches a given widget type once, even when multiple operations target it', async () => {
    stubHappyPath();
    editElementsRemoteMock.mockResolvedValue({
      id: 5,
      documentHash: 'hash-2',
      results: [
        { elementId: 'a1', applied: true },
        { elementId: 'b2', applied: true },
      ],
    });

    await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [
        { op: 'set_settings', element_id: 'a1', settings: { title: 'new' } },
        { op: 'set_settings', element_id: 'b2', settings: { title: 'new2' } },
      ],
    });

    expect(getWidgetDetailMock).toHaveBeenCalledTimes(1);
  });

  it('replays a cached result for a repeated idempotency_key without touching WordPress at all', async () => {
    stubHappyPath();
    const cached = { document_hash: 'hash-2', results: [{ element_id: 'a1', applied: true }], diagnostics: [] };
    findIdempotentResultMock.mockResolvedValue(cached);

    const result = await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'new' } }],
      idempotency_key: 'key-1',
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(cached);
    expect(getDocumentMock).not.toHaveBeenCalled();
    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(editElementsRemoteMock).not.toHaveBeenCalled();
  });

  it('records the result under idempotency_key after a successful write', async () => {
    stubHappyPath();
    editElementsRemoteMock.mockResolvedValue({
      id: 5,
      documentHash: 'hash-2',
      results: [{ elementId: 'a1', applied: true }],
    });

    await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'new' } }],
      idempotency_key: 'key-1',
    });

    expect(recordIdempotentResultMock).toHaveBeenCalledWith(
      {},
      'site-1',
      'local-header-auth',
      'key-1',
      { document_hash: 'hash-2', results: [{ element_id: 'a1', applied: true }], diagnostics: [] },
    );
  });

  it('does not record anything under idempotency_key when validation fails', async () => {
    stubHappyPath();

    await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { titel: 'typo' } }],
      idempotency_key: 'key-1',
    });

    expect(recordIdempotentResultMock).not.toHaveBeenCalled();
  });

  it('does not record anything under idempotency_key when the write is refused (lock/hash)', async () => {
    stubHappyPath();
    editElementsRemoteMock.mockRejectedValue(new DocumentHashMismatchError(5, 'real-hash'));

    await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'new' } }],
      idempotency_key: 'key-1',
    });

    expect(recordIdempotentResultMock).not.toHaveBeenCalled();
  });

  it('proceeds with a normal (non-idempotent) write when the site cannot be resolved', async () => {
    stubHappyPath();
    resolveCurrentSiteMock.mockRejectedValue(new Error('site not registered'));
    editElementsRemoteMock.mockResolvedValue({
      id: 5,
      documentHash: 'hash-2',
      results: [{ elementId: 'a1', applied: true }],
    });

    const result = await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'new' } }],
      idempotency_key: 'key-1',
    });

    expect(result.isError).toBe(false);
    expect(findIdempotentResultMock).not.toHaveBeenCalled();
    expect(recordIdempotentResultMock).not.toHaveBeenCalled();
    expect(writeLedgerEntryMock).not.toHaveBeenCalled();
  });

  it('does not look up or record anything when no idempotency_key is given', async () => {
    stubHappyPath();
    editElementsRemoteMock.mockResolvedValue({
      id: 5,
      documentHash: 'hash-2',
      results: [{ elementId: 'a1', applied: true }],
    });

    await editElementsTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      operations: [{ op: 'set_settings', element_id: 'a1', settings: { title: 'new' } }],
    });

    expect(findIdempotentResultMock).not.toHaveBeenCalled();
    expect(recordIdempotentResultMock).not.toHaveBeenCalled();
  });
});
