import { afterEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, resolveCurrentSiteMock, findIdempotentResultMock, recordIdempotentResultMock, createDocumentMock } =
  vi.hoisted(() => ({
    getDbMock: vi.fn(),
    resolveCurrentSiteMock: vi.fn(),
    findIdempotentResultMock: vi.fn(),
    recordIdempotentResultMock: vi.fn(),
    createDocumentMock: vi.fn(),
  }));

vi.mock('../db/connection.js', () => ({ getDb: getDbMock }));
vi.mock('../registry/currentSite.js', async () => {
  const actual = await vi.importActual<typeof import('../registry/currentSite.js')>('../registry/currentSite.js');
  return { ...actual, resolveCurrentSite: resolveCurrentSiteMock };
});
vi.mock('../idempotency/store.js', () => ({
  findIdempotentResult: findIdempotentResultMock,
  recordIdempotentResult: recordIdempotentResultMock,
}));
vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return { ...actual, createDocument: createDocumentMock };
});

const { createPageTool } = await import('./createPage.js');
const { InvalidPostTypeError, InvalidPageTemplateError, WordPressApiError } = await import('../wp/client.js');

const FAKE_SITE = { id: 'site-1', slug: 'abc', url: 'http://wp-v4-pro' };

const CREATED = {
  id: 55,
  status: 'draft',
  type: 'page',
  link: 'http://wp-v4-pro/?page_id=55',
  editUrl: 'http://wp-v4-pro/wp-admin/post.php?post=55&action=elementor',
  pageTemplate: 'default',
  documentHash: 'hash-1',
};

function stubHappyPath(): void {
  getDbMock.mockReturnValue({});
  resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
  findIdempotentResultMock.mockResolvedValue(null);
  recordIdempotentResultMock.mockResolvedValue(undefined);
  createDocumentMock.mockResolvedValue(CREATED);
}

describe('create_page', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a missing title without calling anything', async () => {
    const result = await createPageTool.handler({});

    expect(result.isError).toBe(true);
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it('rejects a blank title', async () => {
    const result = await createPageTool.handler({ title: '   ' });

    expect(result.isError).toBe(true);
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it('creates a page and returns the snake_case result', async () => {
    stubHappyPath();

    const result = await createPageTool.handler({ title: 'New Page' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      id: 55,
      status: 'draft',
      type: 'page',
      link: 'http://wp-v4-pro/?page_id=55',
      edit_url: 'http://wp-v4-pro/wp-admin/post.php?post=55&action=elementor',
      page_template: 'default',
      document_hash: 'hash-1',
    });
    expect(createDocumentMock).toHaveBeenCalledWith('New Page', { postType: undefined, pageTemplate: undefined });
  });

  it('passes post_type and page_template through', async () => {
    stubHappyPath();

    await createPageTool.handler({ title: 'New Post', post_type: 'post', page_template: 'elementor_canvas' });

    expect(createDocumentMock).toHaveBeenCalledWith('New Post', { postType: 'post', pageTemplate: 'elementor_canvas' });
  });

  it('returns the cached result on a repeated idempotency_key without creating again', async () => {
    stubHappyPath();
    const cached = { id: 55, status: 'draft', type: 'page', link: 'l', edit_url: 'e', page_template: 'default', document_hash: 'h' };
    findIdempotentResultMock.mockResolvedValue(cached);

    const result = await createPageTool.handler({ title: 'New Page', idempotency_key: 'key-1' });

    expect(result.structuredContent).toEqual(cached);
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it('records the result under idempotency_key after a real create', async () => {
    stubHappyPath();

    await createPageTool.handler({ title: 'New Page', idempotency_key: 'key-1' });

    expect(recordIdempotentResultMock).toHaveBeenCalledWith(
      expect.anything(),
      FAKE_SITE.id,
      'local-header-auth',
      'key-1',
      expect.objectContaining({ id: 55 }),
    );
  });

  it('reports InvalidPostTypeError as isError', async () => {
    stubHappyPath();
    createDocumentMock.mockRejectedValue(new InvalidPostTypeError('attachment'));

    const result = await createPageTool.handler({ title: 'X', post_type: 'attachment' });

    expect(result.isError).toBe(true);
  });

  it('reports InvalidPageTemplateError as isError', async () => {
    stubHappyPath();
    createDocumentMock.mockRejectedValue(new InvalidPageTemplateError('bogus'));

    const result = await createPageTool.handler({ title: 'X', page_template: 'bogus' });

    expect(result.isError).toBe(true);
  });

  it('reports a 403 WordPressApiError with a clear permission message', async () => {
    stubHappyPath();
    createDocumentMock.mockRejectedValue(new WordPressApiError('forbidden', 403, {}));

    const result = await createPageTool.handler({ title: 'X' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/not permitted/i);
  });

  it('still creates the page when site resolution fails (idempotency best-effort)', async () => {
    stubHappyPath();
    resolveCurrentSiteMock.mockRejectedValue(new Error('no site registered'));

    const result = await createPageTool.handler({ title: 'New Page', idempotency_key: 'key-1' });

    expect(result.isError).toBe(false);
    expect(createDocumentMock).toHaveBeenCalled();
  });
});
