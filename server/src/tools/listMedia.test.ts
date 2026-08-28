import { afterEach, describe, expect, it, vi } from 'vitest';

const { listMediaMock } = vi.hoisted(() => ({
  listMediaMock: vi.fn(),
}));

vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return { ...actual, listMedia: listMediaMock };
});

const { listMediaTool } = await import('./listMedia.js');
const { WordPressApiError } = await import('../wp/client.js');

describe('list_media', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the real media listing from the plugin', async () => {
    const body = {
      media: [{ id: 3, url: 'http://wp/img.jpg', filename: 'img.jpg', mime_type: 'image/jpeg', created_at: '2026-08-28T00:00:00+00:00' }],
    };
    listMediaMock.mockResolvedValue(body);

    const result = await listMediaTool.handler({});

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(body);
  });

  it('surfaces a WordPress API error', async () => {
    listMediaMock.mockRejectedValue(new WordPressApiError('nope', 500, null));

    const result = await listMediaTool.handler({});

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('500');
  });
});
