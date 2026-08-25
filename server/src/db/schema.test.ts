import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  approvalTokens,
  credentials,
  grants,
  idempotencyKeys,
  ledgerIndex,
  previewNonces,
  sites,
} from './schema.js';

/**
 * Pure schema introspection — no database connection, matching this task's
 * `Verify: unit`. The live up/down/up cycle against the real `db` container
 * (progress.md, EMCP-013) is what actually proves the migrations apply;
 * this guards against the schema silently drifting from what §10 of
 * Blueprints.md and this task's AC require.
 */
describe('schema', () => {
  const siteScopedTables = {
    grants,
    credentials,
    ledger_index: ledgerIndex,
    idempotency_keys: idempotencyKeys,
    approval_tokens: approvalTokens,
    preview_nonces: previewNonces,
  };

  it('has all 7 tables required by Blueprints.md §10', () => {
    const names = [
      sites,
      grants,
      credentials,
      ledgerIndex,
      idempotencyKeys,
      approvalTokens,
      previewNonces,
    ].map((table) => getTableConfig(table).name);

    expect(names.sort()).toEqual(
      [
        'sites',
        'grants',
        'credentials',
        'ledger_index',
        'idempotency_keys',
        'approval_tokens',
        'preview_nonces',
      ].sort(),
    );
  });

  it.each(Object.entries(siteScopedTables))(
    'every site-scoped table (%s) has a siteId column and an index on it',
    (_name, table) => {
      const config = getTableConfig(table);

      expect(config.columns.some((column) => column.name === 'site_id')).toBe(true);

      const indexedColumns = config.indexes.flatMap((index) =>
        index.config.columns.map((column) =>
          'name' in column ? (column as { name: string }).name : null,
        ),
      );
      expect(indexedColumns).toContain('site_id');
    },
  );

  it('sites itself has no site_id column — it is the parent, not scoped to itself', () => {
    const config = getTableConfig(sites);
    expect(config.columns.some((column) => column.name === 'site_id')).toBe(false);
  });
});
