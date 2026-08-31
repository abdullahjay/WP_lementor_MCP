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

/**
 * Uploads reference-design bytes already fetched and validated by the
 * caller (`upload_reference_design`, EMCP-064) — Blueprints.md §11.2's
 * "Object storage: Screenshots, reference designs," the same bucket
 * `render_preview` already uses, under its own `reference-designs/` prefix.
 * Unlike a preview screenshot (an ephemeral capture artifact), a reference
 * design is meant to be reused across many `compare_to_reference` calls, so
 * the default TTL is measured in days, not the hour a preview link gets.
 */
export async function uploadReferenceDesign(
  bytes: Buffer,
  contentType: string,
  ttlSeconds = 7 * 24 * 3600,
  config: ObjectStorageConfig = loadObjectStorageConfig(),
): Promise<{ referenceId: string; resourceLink: string }> {
  const s3 = getClient(config);
  await ensureBucket(s3, config.bucket);

  const extension = contentType.split('/')[1] ?? 'bin';
  const key = `reference-designs/${randomUUID()}.${extension}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );

  const resourceLink = await getSignedUrl(
    getSigningClient(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );

  return { referenceId: key, resourceLink };
}

/**
 * The out-of-band half of D1's resolution for reference designs: a
 * presigned **PUT** URL a human uses to upload directly to object storage,
 * bypassing the model entirely — the S3-world equivalent of `upload_media`
 * (EMCP-063)'s direct-multipart-to-WordPress path. The `referenceId`
 * (object key) is allocated up front, before anything is actually
 * uploaded, so the caller can hand it to `compare_to_reference` later
 * without a second round trip to discover what id the upload landed under.
 *
 * **Deliberately un-validated, unlike every other ingestion path in this
 * project** — a presigned PUT goes straight from the uploader to MinIO;
 * nothing server-side ever sees the bytes before they're stored, so none
 * of §9.7's content-derived MIME/pixel-cap/EXIF checks can run here. This
 * is an inherent property of presigned uploads, not an oversight. Whatever
 * later reads a `reference-designs/` object back (`extract_design_tokens`,
 * not yet built) must treat every object there as untrusted input and
 * re-validate independently — the same discipline `sniffImageMimeType()`
 * already applies to the URL-fetch path, just not enforceable at write
 * time for this one.
 */
export async function presignReferenceDesignUpload(
  ttlSeconds = 3600,
  config: ObjectStorageConfig = loadObjectStorageConfig(),
): Promise<{ referenceId: string; uploadUrl: string }> {
  const s3 = getClient(config);
  await ensureBucket(s3, config.bucket);

  const key = `reference-designs/${randomUUID()}`;

  const uploadUrl = await getSignedUrl(
    getSigningClient(config),
    new PutObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );

  return { referenceId: key, uploadUrl };
}
