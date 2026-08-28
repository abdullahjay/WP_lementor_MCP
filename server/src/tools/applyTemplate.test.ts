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
  getTemplateMock,
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
  getTemplateMock: vi.fn(),
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
    getTemplate: getTemplateMock,
  };
});

const { applyTemplateTool } = await import('./applyTemplate.js');
const { TemplateNotFoundError } = await import('../wp/client.js');

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

const TEMPLATE = {
  id: 7,
  name: 'My template',
  createdAt: '2026-08-28T00:00:00+00:00',
  spec: {
    dslVersion: 1,
    page: { title: 'My template' },
    elements: [{ type: 'widget', widgetType: 'e-heading', settings: { title: 'Hi' } }],
  },
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
  getTemplateMock.mockResolvedValue(TEMPLATE);
  captureSnapshotMock.mockResolvedValue({ id: 9, postId: 5, source: 'parent', hash: 'hash-1', createdAt: 'x' });
  replaceDocumentTreeMock.mockResolvedValue({ id: 5, documentHash: 'hash-2', source: 'parent' });
  invalidateCacheMock.mockResolvedValue({ postId: 5, invalidated: true, warmed: true });
}

describe('apply_template', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-integer post_id without touching anything', async () => {
    const result = await applyTemplateTool.handler({ post_id: 'nope', template_id: 7, document_hash: 'h' });

    expect(result.isError).toBe(true);
    expect(getTemplateMock).not.toHaveBeenCalled();
  });

  it('rejects a non-integer template_id', async () => {
    const result = await applyTemplateTool.handler({ post_id: 5, template_id: 'nope', document_hash: 'h' });

    expect(result.isError).toBe(true);
    expect(getTemplateMock).not.toHaveBeenCalled();
  });

  it('fetches the stored template and applies its compiled spec in one write', async () => {
    stubHappyPath();
    const result = await applyTemplateTool.handler({ post_id: 5, template_id: 7, document_hash: 'hash-1' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ document_hash: 'hash-2', applied: true, path: 'draft' });
    expect(getTemplateMock).toHaveBeenCalledWith(7);
    expect(replaceDocumentTreeMock).toHaveBeenCalledWith(5, expect.any(Array), 'hash-1');
  });

  it('surfaces a 404 when the template does not exist, without ever reading the target document', async () => {
    getTemplateMock.mockRejectedValue(new TemplateNotFoundError(999));

    const result = await applyTemplateTool.handler({ post_id: 5, template_id: 999, document_hash: 'hash-1' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('999');
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('dry_run compiles the template against the real target site without writing', async () => {
    stubHappyPath();
    const result = await applyTemplateTool.handler({
      post_id: 5,
      template_id: 7,
      document_hash: 'hash-1',
      dry_run: true,
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ applied: false, path: 'draft' });
    expect(replaceDocumentTreeMock).not.toHaveBeenCalled();
  });

  it('regenerates element ids on every apply — two applies of the same template produce different ids', async () => {
    stubHappyPath();
    let capturedFirst: unknown;
    let capturedSecond: unknown;
    replaceDocumentTreeMock.mockImplementationOnce((_postId: number, elements: unknown) => {
      capturedFirst = elements;
      return Promise.resolve({ id: 5, documentHash: 'hash-2', source: 'parent' });
    });

    await applyTemplateTool.handler({ post_id: 5, template_id: 7, document_hash: 'hash-1' });

    getDocumentMock.mockResolvedValue({ status: 'draft', elements: [], document_hash: 'hash-2' });
    replaceDocumentTreeMock.mockImplementationOnce((_postId: number, elements: unknown) => {
      capturedSecond = elements;
      return Promise.resolve({ id: 5, documentHash: 'hash-3', source: 'parent' });
    });

    await applyTemplateTool.handler({ post_id: 5, template_id: 7, document_hash: 'hash-2' });

    const firstId = (capturedFirst as Array<{ id: string }>)[0]?.id;
    const secondId = (capturedSecond as Array<{ id: string }>)[0]?.id;
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(firstId).not.toBe(secondId);
  });
});
