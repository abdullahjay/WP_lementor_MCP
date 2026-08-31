import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const { downloadObjectMock, getDocumentMock, getSiteMock, issuePreviewTokenMock, renderScreenshotMock } = vi.hoisted(() => ({
  downloadObjectMock: vi.fn(),
  getDocumentMock: vi.fn(),
  getSiteMock: vi.fn(),
  issuePreviewTokenMock: vi.fn(),
  renderScreenshotMock: vi.fn(),
}));

vi.mock('../storage/objectStorage.js', async () => {
  const actual = await vi.importActual<typeof import('../storage/objectStorage.js')>('../storage/objectStorage.js');
  return { ...actual, downloadObject: downloadObjectMock };
});
vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return { ...actual, getDocument: getDocumentMock, getSite: getSiteMock, issuePreviewToken: issuePreviewTokenMock };
});
vi.mock('../renderer/client.js', async () => {
  const actual = await vi.importActual<typeof import('../renderer/client.js')>('../renderer/client.js');
  return { ...actual, renderScreenshot: renderScreenshotMock };
});

const { compareToReferenceTool } = await import('./compareToReference.js');
const { ObjectNotFoundError } = await import('../storage/objectStorage.js');

async function solidColorPng(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

const SITE = {
  breakpoints: {
    mobile: { enabled: true, direction: 'max', value: 767 },
    tablet: { enabled: true, direction: 'max', value: 1024 },
  },
};

function stubHappyPath(): void {
  vi.stubEnv('WP_BASE_URL', 'http://wp-v4-pro');
  vi.stubEnv('WP_AUTH_USER', 'admin');
  vi.stubEnv('WP_AUTH_APP_PASSWORD', 'app-pw');
  getDocumentMock.mockResolvedValue({ link: 'http://wp-v4-pro/some-page/' });
  getSiteMock.mockResolvedValue(SITE);
  issuePreviewTokenMock.mockResolvedValue({ token: 'preview-token' });
}

describe('compare_to_reference', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('rejects a non-integer post_id without touching anything', async () => {
    const result = await compareToReferenceTool.handler({ post_id: 'nope', reference_id: 'x' });

    expect(result.isError).toBe(true);
    expect(downloadObjectMock).not.toHaveBeenCalled();
  });

  it('rejects an empty reference_id', async () => {
    const result = await compareToReferenceTool.handler({ post_id: 5, reference_id: '' });

    expect(result.isError).toBe(true);
    expect(downloadObjectMock).not.toHaveBeenCalled();
  });

  it('compares a real render against the reference design and returns a score plus ranked regions', async () => {
    stubHappyPath();
    const refBytes = await solidColorPng(110, 193, 228);
    downloadObjectMock.mockResolvedValue(refBytes);
    renderScreenshotMock.mockResolvedValue(await solidColorPng(110, 193, 228));

    const result = await compareToReferenceTool.handler({ post_id: 5, reference_id: 'reference-designs/x.png' });

    expect(result.isError).toBe(false);
    const structured = result.structuredContent as { score: number; regions: unknown[] };
    expect(structured.score).toBeGreaterThan(0.99);
    expect(Array.isArray(structured.regions)).toBe(true);
  });

  it('rejects a reference object that is not a recognized image, without ever rendering the page', async () => {
    downloadObjectMock.mockResolvedValue(Buffer.from('<svg><script>alert(1)</script></svg>'));

    const result = await compareToReferenceTool.handler({ post_id: 5, reference_id: 'reference-designs/x' });

    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
    expect(renderScreenshotMock).not.toHaveBeenCalled();
  });

  it('resolves a real breakpoint to a real viewport width, not a hardcoded one', async () => {
    stubHappyPath();
    downloadObjectMock.mockResolvedValue(await solidColorPng(1, 1, 1));
    renderScreenshotMock.mockResolvedValue(await solidColorPng(1, 1, 1));

    await compareToReferenceTool.handler({ post_id: 5, reference_id: 'reference-designs/x.png', breakpoint: 'mobile' });

    const call = renderScreenshotMock.mock.calls[0]![0] as { viewportWidth: number; viewportHeight: number };
    expect(call.viewportWidth).toBe(767);
    expect(typeof call.viewportHeight).toBe('number');
  });

  it('rejects an unknown breakpoint name, naming the real known ones', async () => {
    stubHappyPath();
    downloadObjectMock.mockResolvedValue(await solidColorPng(1, 1, 1));

    const result = await compareToReferenceTool.handler({
      post_id: 5,
      reference_id: 'reference-designs/x.png',
      breakpoint: 'not-a-real-breakpoint',
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('mobile');
    expect(renderScreenshotMock).not.toHaveBeenCalled();
  });

  it('omits viewport overrides entirely when no breakpoint is given', async () => {
    stubHappyPath();
    downloadObjectMock.mockResolvedValue(await solidColorPng(1, 1, 1));
    renderScreenshotMock.mockResolvedValue(await solidColorPng(1, 1, 1));

    await compareToReferenceTool.handler({ post_id: 5, reference_id: 'reference-designs/x.png' });

    const call = renderScreenshotMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call['viewportWidth']).toBeUndefined();
  });

  it('surfaces a missing reference design as a real error', async () => {
    downloadObjectMock.mockRejectedValue(new ObjectNotFoundError('reference-designs/missing.png'));

    const result = await compareToReferenceTool.handler({ post_id: 5, reference_id: 'reference-designs/missing.png' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('missing.png');
  });

  it('refuses a post with no public link, without ever rendering', async () => {
    downloadObjectMock.mockResolvedValue(await solidColorPng(1, 1, 1));
    getDocumentMock.mockResolvedValue({});

    const result = await compareToReferenceTool.handler({ post_id: 5, reference_id: 'reference-designs/x.png' });

    expect(result.isError).toBe(true);
    expect(renderScreenshotMock).not.toHaveBeenCalled();
  });
});
