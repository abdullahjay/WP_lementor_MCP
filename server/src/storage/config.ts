export interface ObjectStorageConfig {
  endpoint: string;
  /**
   * The host a `resource_link` must be fetched from. Distinct from
   * `endpoint`: this server talks to MinIO over the docker network
   * (`http://minio:9000`), but whoever consumes `render_preview`'s output
   * is outside that network and needs the host-mapped address instead —
   * defaults to `endpoint` when unset, correct for any deployment where
   * both sides really do share one reachable address.
   */
  publicEndpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function loadObjectStorageConfig(): ObjectStorageConfig {
  const endpoint = requireEnv('MINIO_ENDPOINT');

  return {
    endpoint,
    publicEndpoint: process.env['MINIO_PUBLIC_ENDPOINT'] || endpoint,
    accessKeyId: requireEnv('MINIO_ROOT_USER'),
    secretAccessKey: requireEnv('MINIO_ROOT_PASSWORD'),
    bucket: requireEnv('MINIO_BUCKET'),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set.`);
  }

  return value;
}
