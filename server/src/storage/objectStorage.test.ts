import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CONFIG = {
  endpoint: 'http://minio:9000',
  publicEndpoint: 'http://localhost:9000',
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minioadmin_dev_only',
  bucket: 'emcp-previews',
};

const { sendMock, getSignedUrlMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getSignedUrlMock: vi.fn(),
}));

class FakeS3Client {
  send = sendMock;
  config: unknown;
  constructor(config: unknown) {
    this.config = config;
  }
}

function fakeCommand(type: string) {
  return class {
    __type = type;
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  };
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: FakeS3Client,
  HeadBucketCommand: fakeCommand('HeadBucket'),
  CreateBucketCommand: fakeCommand('CreateBucket'),
  PutObjectCommand: fakeCommand('PutObject'),
  GetObjectCommand: fakeCommand('GetObject'),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: getSignedUrlMock }));

describe('uploadPreviewImage', () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    getSignedUrlMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uploads the bytes and returns a presigned resource link', async () => {
    sendMock.mockResolvedValue(undefined); // HeadBucket succeeds, PutObject succeeds
    getSignedUrlMock.mockResolvedValue('http://minio.test:9000/emcp-previews/previews/some-uuid.png?X-Amz-Signature=abc');

    const { uploadPreviewImage } = await import('./objectStorage.js');
    const result = await uploadPreviewImage(Buffer.from('fake-png'), 3600, CONFIG);

    expect(result.resourceLink).toBe(
      'http://minio.test:9000/emcp-previews/previews/some-uuid.png?X-Amz-Signature=abc',
    );
    expect(result.key).toMatch(/^previews\/[0-9a-f-]{36}\.png$/);
  });

  it('creates the bucket when HeadBucket fails (bucket does not exist yet)', async () => {
    sendMock
      .mockRejectedValueOnce(new Error('NotFound')) // HeadBucket
      .mockResolvedValueOnce(undefined) // CreateBucket
      .mockResolvedValueOnce(undefined); // PutObject
    getSignedUrlMock.mockResolvedValue('http://minio.test:9000/signed');

    const { uploadPreviewImage } = await import('./objectStorage.js');
    await uploadPreviewImage(Buffer.from('fake-png'), 3600, CONFIG);

    const calledTypes = sendMock.mock.calls.map((call) => (call[0] as { __type: string }).__type);
    expect(calledTypes).toEqual(['HeadBucket', 'CreateBucket', 'PutObject']);
  });

  it('passes the requested TTL through to getSignedUrl', async () => {
    sendMock.mockResolvedValue(undefined);
    getSignedUrlMock.mockResolvedValue('http://minio.test:9000/signed');

    const { uploadPreviewImage } = await import('./objectStorage.js');
    await uploadPreviewImage(Buffer.from('fake-png'), 120, CONFIG);

    const [, , options] = getSignedUrlMock.mock.calls[0] as [unknown, unknown, { expiresIn: number }];
    expect(options.expiresIn).toBe(120);
  });

  it('signs the URL against publicEndpoint, not the internal endpoint used for the upload', async () => {
    sendMock.mockResolvedValue(undefined);
    getSignedUrlMock.mockResolvedValue('http://localhost:9000/signed');

    const { uploadPreviewImage } = await import('./objectStorage.js');
    await uploadPreviewImage(Buffer.from('fake-png'), 3600, CONFIG);

    const [signingClient] = getSignedUrlMock.mock.calls[0] as [FakeS3Client];
    expect((signingClient.config as { endpoint: string }).endpoint).toBe('http://localhost:9000');
  });
});
