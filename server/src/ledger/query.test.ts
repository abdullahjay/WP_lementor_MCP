import { describe, expect, it, vi } from 'vitest';
import { getChange } from './query.js';

/**
 * A real bug, caught live (EMCP-039): `getChange` with a non-UUID
 * `changeId` reached Postgres as a malformed query and threw a raw driver
 * error whose message embedded the bound `siteId` — an internal id no
 * caller should see, surfaced by an ordinary bad input, not anything
 * adversarial. `id` is a `uuid` column; anything not shaped like one must
 * short-circuit to `null` before any query runs.
 */
describe('getChange: malformed change id', () => {
  it('returns null without ever querying the database for a non-UUID-shaped id', async () => {
    const select = vi.fn();
    const fakeDb = { select } as never;

    const result = await getChange(fakeDb, 'site-1', 'nonexistent');

    expect(result).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('returns null for an empty string id, without querying', async () => {
    const select = vi.fn();
    const fakeDb = { select } as never;

    const result = await getChange(fakeDb, 'site-1', '');

    expect(result).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('does query the database for a well-formed UUID', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where, orderBy });
    const select = vi.fn().mockReturnValue({ from });
    const fakeDb = { select } as never;

    const result = await getChange(fakeDb, 'site-1', '11111111-1111-1111-1111-111111111111');

    expect(select).toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
