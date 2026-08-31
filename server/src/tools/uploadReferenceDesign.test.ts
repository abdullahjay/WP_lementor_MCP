import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchUrlSafelyMock, uploadReferenceDesignMock, presignReferenceDesignUploadMock } = vi.hoisted(() => ({
  fetchUrlSafelyMock: vi.fn(),
  uploadReferenceDesignMock: vi.fn(),
  presignReferenceDesignUploadMock: vi.fn(),
}));

vi.mock('../ingestion/safeFetch.js', async () => {
  const actual = await vi.importActual<typeof import('../ingestion/safeFetch.js')>('../ingestion/safeFetch.js');
  return { ...actual, fetchUrlSafely: fetchUrlSafelyMock };
});
vi.mock('../storage/objectStorage.js', () => ({
  uploadReferenceDesign: uploadReferenceDesignMock,
  presignReferenceDesignUpload: presignReferenceDesignUploadMock,
}));

const { uploadReferenceDesignTool } = await import('./uploadReferenceDesign.js');
const { SsrfBlockedError } = await import('../ingestion/safeFetch.js');

const REAL_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);

describe('upload_reference_design', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fetches, sniffs, and stores a real image given a url', async () => {
    fetchUrlSafelyMock.mockResolvedValue({ body: REAL_PNG, url: 'https://example.com/x.png', contentType: 'image/png' });
    uploadReferenceDesignMock.mockResolvedValue({
      referenceId: 'reference-designs/abc.png',
      resourceLink: 'http://minio/signed',
    });

    const result = await uploadReferenceDesignTool.handler({ url: 'https://example.com/x.png' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      reference_id: 'reference-designs/abc.png',
      resource_link: 'http://minio/signed',
    });
    expect(uploadReferenceDesignMock).toHaveBeenCalledWith(REAL_PNG, 'image/png');
    expect(presignReferenceDesignUploadMock).not.toHaveBeenCalled();
  });

  it('rejects fetched content that is not a recognized image format, without storing anything', async () => {
    fetchUrlSafelyMock.mockResolvedValue({
      body: Buffer.from('<svg><script>alert(1)</script></svg>'),
      url: 'https://example.com/x.svg',
      contentType: 'image/png', // a lying declared content-type, ignored
    });

    const result = await uploadReferenceDesignTool.handler({ url: 'https://example.com/x.svg' });

    expect(result.isError).toBe(true);
    expect(uploadReferenceDesignMock).not.toHaveBeenCalled();
  });

  it('surfaces an SSRF refusal as a real error', async () => {
    fetchUrlSafelyMock.mockRejectedValue(new SsrfBlockedError('http://127.0.0.1/'));

    const result = await uploadReferenceDesignTool.handler({ url: 'http://127.0.0.1/' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('private');
  });

  it('returns a presigned upload_url for the out-of-band path when url is omitted', async () => {
    presignReferenceDesignUploadMock.mockResolvedValue({
      referenceId: 'reference-designs/xyz',
      uploadUrl: 'http://minio/put-signed',
    });

    const result = await uploadReferenceDesignTool.handler({});

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({
      reference_id: 'reference-designs/xyz',
      upload_url: 'http://minio/put-signed',
    });
    expect(fetchUrlSafelyMock).not.toHaveBeenCalled();
  });

  it('rejects an empty url string rather than treating it as omitted', async () => {
    const result = await uploadReferenceDesignTool.handler({ url: '' });

    expect(result.isError).toBe(true);
    expect(fetchUrlSafelyMock).not.toHaveBeenCalled();
    expect(presignReferenceDesignUploadMock).not.toHaveBeenCalled();
  });
});
