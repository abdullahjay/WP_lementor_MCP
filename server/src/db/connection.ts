import { createDb } from './index.js';
import type { Database } from '../registry/reader.js';

/**
 * One shared pool for the process, created lazily on first use — same
 * "one shared X, created lazily" pattern `renderer/src/render.ts`'s
 * `browserPromise` uses for its Chromium process. Tool handlers are the
 * first real consumers (EMCP-039); `db/migrate.ts` intentionally calls
 * `createDb()` directly instead, since a migration run is a one-shot CLI
 * invocation, not a long-lived server process this pool would outlive.
 */
let instance: Database | undefined;

export function getDb(): Database {
  instance ??= createDb().db;
  return instance;
}
