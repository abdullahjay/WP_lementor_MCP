import { randomUUID } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadObjectStorageConfig, type ObjectStorageConfig } from './config.js';

let client: S3Client | undefined;
let signingClient: S3Client | undefined;
let bucketReady: Promise<void> | undefined;

function getClient(config: ObjectStorageConfig): S3Client {
  client ??= new S3Client({
    endpoint: config.endpoint,
    region: 'us-east-1', // MinIO ignores region but the SDK requires one.
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true, // MinIO is path-style only, not virtual-hosted-style.
  });

  return client;
}

/**
 * A presigned URL is built from the client instance's own `endpoint` — a
 * client configured with the internal docker-network endpoint produces a
 * link nothing outside that network can fetch. This second client exists
 * only to sign URLs against `publicEndpoint`; it never sends a request.
 */
function getSigningClient(config: ObjectStorageConfig): S3Client {
  signingClient ??= new S3Client({
    endpoint: config.publicEndpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  });

  return signingClient;
}

async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  bucketReady ??= (async () => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })();

  return bucketReady;
}

/**
 * Uploads a screenshot PNG and returns a presigned, time-limited GET URL —
 * `render_preview`'s `resource_link` (Blueprints.md §7.4). The object key
 * is a random UUID, not the post ID: previews are ephemeral capture
 * artifacts, not addressable by document identity.
 */
export async function uploadPreviewImage(
  bytes: Buffer,
  ttlSeconds = 3600,
  config: ObjectStorageConfig = loadObjectStorageConfig(),
): Promise<{ resourceLink: string; key: string }> {
  const s3 = getClient(config);
  await ensureBucket(s3, config.bucket);

  const key = `previews/${randomUUID()}.png`;

  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: bytes,
      ContentType: 'image/png',
    }),
  );

  const resourceLink = await getSignedUrl(
    getSigningClient(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );

  return { resourceLink, key };
}
