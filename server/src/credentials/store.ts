import { desc, eq } from 'drizzle-orm';
import { credentials } from '../db/schema.js';
import type { Database } from '../registry/reader.js';
import { decrypt, encrypt, generateDek } from './crypto.js';
import { loadKek } from './kek.js';

export class CredentialNotFoundError extends Error {
  constructor(siteId: string) {
    super(`No credential stored for site ${siteId}.`);
  }
}

/**
 * Envelope-encrypts `secretPlaintext` under a fresh per-site DEK, then
 * encrypts that DEK under the KEK, and stores both blobs. Always inserts a
 * new row rather than updating in place — `getCredential` returns the most
 * recent one, so calling this again is how rotation works; older rows stay
 * for audit rather than being overwritten. Scheduling rotation, and
 * actively retiring old rows, is out of scope here (solution.md §9.4 lists
 * it as a requirement, not something this task implements).
 */
export async function storeCredential(
  db: Database,
  siteId: string,
  secretPlaintext: string,
): Promise<void> {
  const kek = loadKek();
  const dek = generateDek();

  const encryptedSecret = encrypt(dek, secretPlaintext);
  const encryptedDek = encrypt(kek, dek.toString('base64'));

  await db.insert(credentials).values({ siteId, encryptedDek, encryptedSecret });
}

export async function getCredential(db: Database, siteId: string): Promise<string> {
  const kek = loadKek();
  const rows = await db
    .select()
    .from(credentials)
    .where(eq(credentials.siteId, siteId))
    .orderBy(desc(credentials.createdAt))
    .limit(1);
  const row = rows[0];

  if (!row) {
    throw new CredentialNotFoundError(siteId);
  }

  const dek = Buffer.from(decrypt(kek, row.encryptedDek), 'base64');
  return decrypt(dek, row.encryptedSecret);
}
