import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  resolveCurrentSiteMock,
  writeLedgerEntryMock,
  findIdempotentResultMock,
  recordIdempotentResultMock,
  getDocumentMock,
  captureSnapshotMock,
  replaceDocumentTreeMock,
  invalidateCacheMock,
  getSiteMock,
  listWidgetsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  resolveCurrentSiteMock: vi.fn(),
  writeLedgerEntryMock: vi.fn(),
  findIdempotentResultMock: vi.fn(),
  recordIdempotentResultMock: vi.fn(),
  getDocumentMock: vi.fn(),
  captureSnapshotMock: vi.fn(),
  replaceDocumentTreeMock: vi.fn(),
  invalidateCacheMock: vi.fn(),
  getSiteMock: vi.fn(),
  listWidgetsMock: vi.fn(),
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
    captureSnapshot: captureSnapshotMock,
    replaceDocumentTree: replaceDocumentTreeMock,
    invalidateCache: invalidateCacheMock,
    getSite: getSiteMock,
    listWidgets: listWidgetsMock,
  };
});

const { applyPageSpecTool } = await import('./applyPageSpec.js');
const { DocumentHashMismatchError, DocumentLockedError } = await import('../wp/client.js');

const FAKE_SITE = { id: 'site-1', slug: 'abc', url: 'http://wp-v4-pro' };

const SITE_V4 = {
  elementor_version: '4.2.3',
  generation_default: 'v4',
  pro_tier: 'essential',
  breakpoints: {},
  experiments: {},
};

const WIDGETS = {
  widget_count: 1,
  widgets: [{ name: 'e-heading', title: 'Heading', categories: [], keywords: [] }],
};

const DRAFT_DOCUMENT = { status: 'draft', elements: [], document_hash: 'hash-1' };

const SPEC = {
  dslVersion: 1,
  page: { title: 'Test' },
  elements: [{ type: 'widget', widgetType: 'e-heading', settings: { title: 'Hi' } }],
};

function stubHappyPath(): void {
  getDbMock.mockReturnValue({});
  resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
  writeLedgerEntryMock.mockResolvedValue('ledger-id-1');
  findIdempotentResultMock.mockResolvedValue(null);
  recordIdempotentResultMock.mockResolvedValue(undefined);
  getDocumentMock.mockResolvedValue(DRAFT_DOCUMENT);
  getSiteMock.mockResolvedValue(SITE_V4);
  listWidgetsMock.mockResolvedValue(WIDGETS);
  captureSnapshotMock.mockResolvedValue({ id: 9, postId: 5, source: 'parent', hash: 'hash-1', createdAt: 'x' });
  replaceDocumentTreeMock.mockResolvedValue({ id: 5, documentHash: 'hash-2', source: 'parent' });
  invalidateCacheMock.mockResolvedValue({ postId: 5, invalidated: true, warmed: true });
}

describe('apply_page_spec', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-integer post_id without touching anything', async () => {
    const result = await applyPageSpecTool.handler({ post_id: 'nope', document_hash: 'h', spec: SPEC });

    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed spec before any document lookup or write', async () => {
    stubHappyPath();
    const result = await applyPageSpecTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      spec: { dslVersion: 99, page: { title: 'x' }, elements: [] },
    });

    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
    expect(replaceDocumentTreeMock).not.toHaveBeenCalled();
  });

  it('compiles and writes a valid spec in one call, path "draft" for an unpublished post', async () => {
    stubHappyPath();
    const result = await applyPageSpecTool.handler({ post_id: 5, document_hash: 'hash-1', spec: SPEC });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ document_hash: 'hash-2', applied: true, path: 'draft' });
    expect(replaceDocumentTreeMock).toHaveBeenCalledWith(5, expect.any(Array), 'hash-1');
    expect(captureSnapshotMock).toHaveBeenCalledWith(5, 'parent');
    expect(invalidateCacheMock).toHaveBeenCalledWith(5);
  });

  it('a published post writes the autosave, not the parent — same rule edit_elements uses', async () => {
    stubHappyPath();
    getDocumentMock.mockImplementation((_id: number, opts?: { source?: string }) => {
      if (opts?.source === 'autosave') {
        return Promise.resolve({ status: 'publish', elements: [], document_hash: 'auto-hash' });
      }
      return Promise.resolve({ status: 'publish', elements: [], document_hash: 'parent-hash' });
    });
    replaceDocumentTreeMock.mockResolvedValue({ id: 5, documentHash: 'auto-hash-2', source: 'autosave' });

    const result = await applyPageSpecTool.handler({ post_id: 5, document_hash: 'auto-hash', spec: SPEC });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ path: 'autosave', applied: true });
    expect(captureSnapshotMock).toHaveBeenCalledWith(5, 'autosave');
  });

  it('dry_run compiles and reports against the real target site without writing anything', async () => {
    stubHappyPath();
    const result = await applyPageSpecTool.handler({ post_id: 5, document_hash: 'hash-1', spec: SPEC, dry_run: true });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ applied: false, document_hash: 'hash-1', path: 'draft' });
    expect(replaceDocumentTreeMock).not.toHaveBeenCalled();
    expect(captureSnapshotMock).not.toHaveBeenCalled();
    expect(invalidateCacheMock).not.toHaveBeenCalled();
  });

  it('refuses a spec compile error without writing, reporting the real diagnostic', async () => {
    stubHappyPath();
    const badSpec = {
      dslVersion: 1,
      page: { title: 'Test' },
      elements: [{ type: 'widget', widgetType: 'nonexistent-widget', settings: {} }],
    };

    const result = await applyPageSpecTool.handler({ post_id: 5, document_hash: 'hash-1', spec: badSpec });

    expect(result.isError).toBe(true);
    const structured = result.structuredContent as { applied: boolean; diagnostics: Array<{ code: string }> };
    expect(structured.applied).toBe(false);
    expect(structured.diagnostics.some((d) => d.code === 'WIDGET_NOT_AVAILABLE')).toBe(true);
    expect(replaceDocumentTreeMock).not.toHaveBeenCalled();
  });

  it('surfaces a stale document_hash as a real refusal, not a silent overwrite', async () => {
    stubHappyPath();
    replaceDocumentTreeMock.mockRejectedValue(new DocumentHashMismatchError(5, 'current-hash'));

    const result = await applyPageSpecTool.handler({ post_id: 5, document_hash: 'hash-1', spec: SPEC });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('current-hash');
  });

  it('surfaces a post lock refusal', async () => {
    stubHappyPath();
    replaceDocumentTreeMock.mockRejectedValue(new DocumentLockedError(5, 7, 'Alice'));

    const result = await applyPageSpecTool.handler({ post_id: 5, document_hash: 'hash-1', spec: SPEC });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Alice');
  });

  it('a repeated call under the same idempotency_key replays the cached result without writing again', async () => {
    stubHappyPath();
    const cached = { document_hash: 'hash-2', diagnostics: [], nativeness: 1, raw_ratio: 0, applied: true, path: 'draft' };
    findIdempotentResultMock.mockResolvedValue(cached);

    const result = await applyPageSpecTool.handler({
      post_id: 5,
      document_hash: 'hash-1',
      spec: SPEC,
      idempotency_key: 'key-1',
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(cached);
    expect(getDocumentMock).not.toHaveBeenCalled();
    expect(replaceDocumentTreeMock).not.toHaveBeenCalled();
  });
});
