import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const { downloadObjectMock, getGlobalStylesMock } = vi.hoisted(() => ({
  downloadObjectMock: vi.fn(),
  getGlobalStylesMock: vi.fn(),
}));

vi.mock('../storage/objectStorage.js', async () => {
  const actual = await vi.importActual<typeof import('../storage/objectStorage.js')>('../storage/objectStorage.js');
  return { ...actual, downloadObject: downloadObjectMock };
});
vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return { ...actual, getGlobalStyles: getGlobalStylesMock };
});

const { extractDesignTokensTool } = await import('./extractDesignTokens.js');
const { ObjectNotFoundError } = await import('../storage/objectStorage.js');

const KIT = {
  colors: {
    system: [
      { _id: 'primary', title: 'Primary', color: '#6EC1E4' },
      { _id: 'secondary', title: 'Secondary', color: '#54595F' },
    ],
    custom: [],
  },
};

async function solidColorPng(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

describe('extract_design_tokens', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a missing reference_id without touching storage', async () => {
    const result = await extractDesignTokensTool.handler({});

    expect(result.isError).toBe(true);
    expect(downloadObjectMock).not.toHaveBeenCalled();
  });

  it('extracts a colour and matches it to an existing kit token by perceptual distance', async () => {
    downloadObjectMock.mockResolvedValue(await solidColorPng(110, 193, 228)); // exactly the kit's "Primary"
    getGlobalStylesMock.mockResolvedValue(KIT);

    const result = await extractDesignTokensTool.handler({ reference_id: 'reference-designs/x.png' });

    expect(result.isError).toBe(false);
    const structured = result.structuredContent as {
      colors: Array<{ hex: string; matched_token: { id: string; title: string; delta_e: number } | null }>;
    };
    expect(structured.colors[0]?.hex).toBe('#6EC1E4');
    expect(structured.colors[0]?.matched_token).toMatchObject({ id: 'primary', title: 'Primary' });
    expect(structured.colors[0]?.matched_token?.delta_e).toBeCloseTo(0, 1);
  });

  it('reports no match for a colour genuinely absent from the kit', async () => {
    downloadObjectMock.mockResolvedValue(await solidColorPng(10, 200, 10)); // a saturated green, nothing like the kit
    getGlobalStylesMock.mockResolvedValue(KIT);

    const result = await extractDesignTokensTool.handler({ reference_id: 'reference-designs/x.png' });

    expect(result.isError).toBe(false);
    const structured = result.structuredContent as { colors: Array<{ matched_token: unknown }> };
    expect(structured.colors[0]?.matched_token).toBeNull();
  });

  it('rejects non-image bytes read back from storage — the unvalidated out-of-band path defense', async () => {
    downloadObjectMock.mockResolvedValue(Buffer.from('<svg><script>alert(1)</script></svg>'));

    const result = await extractDesignTokensTool.handler({ reference_id: 'reference-designs/x' });

    expect(result.isError).toBe(true);
    expect(getGlobalStylesMock).not.toHaveBeenCalled();
  });

  it('surfaces a missing reference_id as a real 404-style error', async () => {
    downloadObjectMock.mockRejectedValue(new ObjectNotFoundError('reference-designs/missing.png'));

    const result = await extractDesignTokensTool.handler({ reference_id: 'reference-designs/missing.png' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('missing.png');
  });
});
