import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadDatabaseConfig } from './config.js';
import * as schema from './schema.js';

export function createDb(config = loadDatabaseConfig()) {
  const pool = new Pool(config);
  return { db: drizzle(pool, { schema }), pool };
}
