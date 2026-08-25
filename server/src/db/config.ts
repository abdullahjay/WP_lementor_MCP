export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function loadDatabaseConfig(): DatabaseConfig {
  return {
    // `db`/5432: the docker-compose service name and Postgres's own
    // container-internal port — not POSTGRES_PORT, which is the host-side
    // mapped port (5433) for connecting from outside Docker entirely.
    host: process.env['POSTGRES_HOST'] ?? 'db',
    port: Number(process.env['POSTGRES_INTERNAL_PORT'] ?? 5432),
    database: requireEnv('POSTGRES_DB'),
    user: requireEnv('POSTGRES_USER'),
    password: requireEnv('POSTGRES_PASSWORD'),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set.`);
  }

  return value;
}
