import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './index.js';

/**
 * prd.md EMCP-013: "migrations run forward and are reversible." drizzle-kit
 * only generates forward SQL, so each migration gets a hand-written
 * `<name>.down.sql` counterpart alongside it (see drizzle/), and this script
 * is what actually applies either direction — `drizzle-orm`'s own migrator
 * only goes forward.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));
const MIGRATIONS_TABLE = '__drizzle_migrations';
const MIGRATIONS_SCHEMA = 'drizzle';

async function up(): Promise<void> {
  const { db, pool } = createDb();

  try {
    await migrate(db, {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

async function down(): Promise<void> {
  const { pool } = createDb();

  try {
    const { rows } = await pool.query<{ hash: string }>(
      `SELECT hash FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ORDER BY created_at DESC LIMIT 1`,
    );
    const latest = rows[0];

    if (!latest) {
      console.log('No migrations recorded — nothing to roll back.');
      return;
    }

    // Single-migration assumption for now: rolls back the last migration
    // file by sort order. Revisit this mapping once a second migration
    // exists — sequential apply-in-order makes "last file" and "last
    // applied" the same thing today, but that won't hold forever.
    const files = readdirSync(MIGRATIONS_FOLDER)
      .filter((name) => name.endsWith('.sql') && !name.endsWith('.down.sql'))
      .sort();
    const lastFile = files.at(-1);

    if (!lastFile) {
      throw new Error('No migration files found to roll back.');
    }

    const downFile = lastFile.replace(/\.sql$/, '.down.sql');
    const sql = readFileSync(join(MIGRATIONS_FOLDER, downFile), 'utf-8');

    await pool.query(sql);
    await pool.query(`DELETE FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" WHERE hash = $1`, [
      latest.hash,
    ]);

    console.log(`Rolled back using ${downFile}`);
  } finally {
    await pool.end();
  }
}

const direction = process.argv[2];

if (direction === 'up') {
  await up();
} else if (direction === 'down') {
  await down();
} else {
  console.error('Usage: tsx src/db/migrate.ts <up|down>');
  process.exitCode = 1;
}
