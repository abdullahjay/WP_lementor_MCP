import { afterEach, describe, expect, it, vi } from 'vitest';

const { getDocumentMock, issuePreviewTokenMock, renderScreenshotMock, uploadPreviewImageMock } = vi.hoisted(
  () => ({
    getDocumentMock: vi.fn(),
    issuePreviewTokenMock: vi.fn(),
    renderScreenshotMock: vi.fn(),
    uploadPreviewImageMock: vi.fn(),
  }),
);

vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return { ...actual, getDocument: getDocumentMock, issuePreviewToken: issuePreviewTokenMock };
});
vi.mock('../renderer/client.js', async () => {
  const actual = await vi.importActual<typeof import('../renderer/client.js')>('../renderer/client.js');
  return { ...actual, renderScreenshot: renderScreenshotMock };
});
vi.mock('../storage/objectStorage.js', () => ({ uploadPreviewImage: uploadPreviewImageMock }));

const { renderPreviewTool } = await import('./renderPreview.js');

describe('render_preview', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  function stubEnv(): void {
    vi.stubEnv('WP_BASE_URL', 'http://wp-v4-pro');
    vi.stubEnv('WP_AUTH_USER', 'admin');
    vi.stubEnv('WP_AUTH_APP_PASSWORD', 'app-pw');
  }

  it('rejects a non-integer post_id without calling anything downstream', async () => {
    const result = await renderPreviewTool.handler({ post_id: 'nope' });

    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('rebuilds the target URL from WP_BASE_URL\'s origin, not the permalink\'s host:port', async () => {
    stubEnv();
    getDocumentMock.mockResolvedValue({ link: 'http://wp-v4-pro:8081/some-page/?preview=1' });
    issuePreviewTokenMock.mockResolvedValue({ token: 'tok', expiresAt: 'x', postId: 5 });
    renderScreenshotMock.mockResolvedValue(Buffer.from('png'));
    uploadPreviewImageMock.mockResolvedValue({ resourceLink: 'http://minio/signed', key: 'previews/x.png' });

    await renderPreviewTool.handler({ post_id: 5 });

    expect(renderScreenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://wp-v4-pro/some-page/?preview=1', allowedHost: 'wp-v4-pro' }),
    );
  });

  it('captures the whole page by default and one element when element_id is given', async () => {
    stubEnv();
    getDocumentMock.mockResolvedValue({ link: 'http://wp-v4-pro/some-page/' });
    issuePreviewTokenMock.mockResolvedValue({ token: 'tok', expiresAt: 'x', postId: 5 });
    renderScreenshotMock.mockResolvedValue(Buffer.from('png'));
    uploadPreviewImageMock.mockResolvedValue({ resourceLink: 'http://minio/signed', key: 'previews/x.png' });

    await renderPreviewTool.handler({ post_id: 5 });
    expect(renderScreenshotMock).toHaveBeenCalledWith(expect.objectContaining({ selector: '.elementor-5' }));

    await renderPreviewTool.handler({ post_id: 5, element_id: 'a1b2c3d' });
    expect(renderScreenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ selector: '.elementor-element-a1b2c3d' }),
    );
  });

  it('sends the issued preview token as the X-EMCP-Preview-Token header', async () => {
    stubEnv();
    getDocumentMock.mockResolvedValue({ link: 'http://wp-v4-pro/some-page/' });
    issuePreviewTokenMock.mockResolvedValue({ token: 'signed.tok', expiresAt: 'x', postId: 5 });
    renderScreenshotMock.mockResolvedValue(Buffer.from('png'));
    uploadPreviewImageMock.mockResolvedValue({ resourceLink: 'http://minio/signed', key: 'previews/x.png' });

    await renderPreviewTool.handler({ post_id: 5 });

    expect(renderScreenshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ extraHeaders: { 'X-EMCP-Preview-Token': 'signed.tok' } }),
    );
  });

  it('returns a resource_link by default, not inline image bytes', async () => {
    stubEnv();
    getDocumentMock.mockResolvedValue({ link: 'http://wp-v4-pro/some-page/' });
    issuePreviewTokenMock.mockResolvedValue({ token: 'tok', expiresAt: 'x', postId: 5 });
    renderScreenshotMock.mockResolvedValue(Buffer.from('png'));
    uploadPreviewImageMock.mockResolvedValue({ resourceLink: 'http://minio/signed', key: 'previews/x.png' });

    const result = await renderPreviewTool.handler({ post_id: 5 });

    expect(result.isError).toBe(false);
    expect(result.structuredContent?.['resource_link']).toBe('http://minio/signed');
    expect(result.structuredContent?.['image']).toBeUndefined();
    expect(uploadPreviewImageMock).toHaveBeenCalled();
  });

  it('returns inline image bytes and skips upload when return_image is true', async () => {
    stubEnv();
    getDocumentMock.mockResolvedValue({ link: 'http://wp-v4-pro/some-page/' });
    issuePreviewTokenMock.mockResolvedValue({ token: 'tok', expiresAt: 'x', postId: 5 });
    renderScreenshotMock.mockResolvedValue(Buffer.from('png-bytes'));

    const result = await renderPreviewTool.handler({ post_id: 5, return_image: true });

    expect(result.isError).toBe(false);
    expect(uploadPreviewImageMock).not.toHaveBeenCalled();
    const imageBlock = result.content.find((block) => block.type === 'image');
    expect(imageBlock).toMatchObject({ type: 'image', mimeType: 'image/png' });
  });

  it('errors when the document has no link (nothing to render)', async () => {
    stubEnv();
    getDocumentMock.mockResolvedValue({});

    const result = await renderPreviewTool.handler({ post_id: 5 });

    expect(result.isError).toBe(true);
    expect(renderScreenshotMock).not.toHaveBeenCalled();
  });
});
