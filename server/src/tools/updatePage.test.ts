import { afterEach, describe, expect, it, vi } from 'vitest';

const { updateDocumentAttributesMock } = vi.hoisted(() => ({
  updateDocumentAttributesMock: vi.fn(),
}));

vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return { ...actual, updateDocumentAttributes: updateDocumentAttributesMock };
});

const { updatePageTool } = await import('./updatePage.js');
const { InvalidPageTemplateError, WordPressApiError } = await import('../wp/client.js');

const UPDATED = { id: 5, title: 'Renamed', pageTemplate: 'elementor_canvas', status: 'draft', link: 'http://wp.test/?page_id=5' };

describe('update_page', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-integer post_id without calling anything', async () => {
    const result = await updatePageTool.handler({ post_id: 'nope', title: 'x' });

    expect(result.isError).toBe(true);
    expect(updateDocumentAttributesMock).not.toHaveBeenCalled();
  });

  it('rejects a call with neither title nor page_template', async () => {
    const result = await updatePageTool.handler({ post_id: 5 });

    expect(result.isError).toBe(true);
    expect(updateDocumentAttributesMock).not.toHaveBeenCalled();
  });

  it('rejects a blank title alongside no page_template', async () => {
    const result = await updatePageTool.handler({ post_id: 5, title: '   ' });

    expect(result.isError).toBe(true);
    expect(updateDocumentAttributesMock).not.toHaveBeenCalled();
  });

  it('updates title and page_template and returns snake_case result', async () => {
    updateDocumentAttributesMock.mockResolvedValue(UPDATED);

    const result = await updatePageTool.handler({ post_id: 5, title: 'Renamed', page_template: 'elementor_canvas' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      id: 5,
      title: 'Renamed',
      page_template: 'elementor_canvas',
      status: 'draft',
      link: 'http://wp.test/?page_id=5',
    });
    expect(updateDocumentAttributesMock).toHaveBeenCalledWith(5, { title: 'Renamed', pageTemplate: 'elementor_canvas' });
  });

  it('updates only page_template when title is omitted', async () => {
    updateDocumentAttributesMock.mockResolvedValue(UPDATED);

    await updatePageTool.handler({ post_id: 5, page_template: 'elementor_canvas' });

    expect(updateDocumentAttributesMock).toHaveBeenCalledWith(5, { title: undefined, pageTemplate: 'elementor_canvas' });
  });

  it('reports InvalidPageTemplateError as isError', async () => {
    updateDocumentAttributesMock.mockRejectedValue(new InvalidPageTemplateError('bogus'));

    const result = await updatePageTool.handler({ post_id: 5, page_template: 'bogus' });

    expect(result.isError).toBe(true);
  });

  it('reports a 404 with a clear not-found message', async () => {
    updateDocumentAttributesMock.mockRejectedValue(new WordPressApiError('not found', 404, {}));

    const result = await updatePageTool.handler({ post_id: 5, title: 'x' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/no elementor document/i);
  });

  it('reports a 403 with a clear permission message', async () => {
    updateDocumentAttributesMock.mockRejectedValue(new WordPressApiError('forbidden', 403, {}));

    const result = await updatePageTool.handler({ post_id: 5, title: 'x' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/not permitted/i);
  });
});
