import { afterEach, describe, expect, it, vi } from 'vitest';

const { uploadMediaFromUrlMock } = vi.hoisted(() => ({
  uploadMediaFromUrlMock: vi.fn(),
}));

vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return { ...actual, uploadMediaFromUrl: uploadMediaFromUrlMock };
});

const { uploadMediaTool } = await import('./uploadMedia.js');
const { WordPressApiError } = await import('../wp/client.js');

describe('upload_media', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an empty url without calling WordPress', async () => {
    const result = await uploadMediaTool.handler({ url: '' });

    expect(result.isError).toBe(true);
    expect(uploadMediaFromUrlMock).not.toHaveBeenCalled();
  });

  it('rejects a missing url', async () => {
    const result = await uploadMediaTool.handler({});

    expect(result.isError).toBe(true);
    expect(uploadMediaFromUrlMock).not.toHaveBeenCalled();
  });

  it('uploads a real url and reports the resulting media', async () => {
    uploadMediaFromUrlMock.mockResolvedValue({
      id: 12,
      url: 'http://wp/wp-content/uploads/photo.jpg',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      width: 800,
      height: 600,
    });

    const result = await uploadMediaTool.handler({ url: 'https://example.com/photo.jpg' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      id: 12,
      url: 'http://wp/wp-content/uploads/photo.jpg',
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      width: 800,
      height: 600,
    });
    expect(uploadMediaFromUrlMock).toHaveBeenCalledWith('https://example.com/photo.jpg', undefined);
  });

  it('passes an explicit filename override through', async () => {
    uploadMediaFromUrlMock.mockResolvedValue({
      id: 12,
      url: 'http://wp/x',
      filename: 'custom.png',
      mimeType: 'image/png',
      width: null,
      height: null,
    });

    await uploadMediaTool.handler({ url: 'https://example.com/x', filename: 'custom.png' });

    expect(uploadMediaFromUrlMock).toHaveBeenCalledWith('https://example.com/x', 'custom.png');
  });

  it('surfaces a rejection (e.g. a denied MIME type or SSRF-blocked URL) as a real error, not a silent partial success', async () => {
    uploadMediaFromUrlMock.mockRejectedValue(new WordPressApiError('nope', 400, { message: 'Content type "image/svg+xml" is not allowed' }));

    const result = await uploadMediaTool.handler({ url: 'https://example.com/x.svg' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('400');
  });
});
