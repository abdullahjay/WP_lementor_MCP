import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

/**
 * Self-contained blob: `iv || authTag || ciphertext`, base64-encoded — one
 * string per encrypted value, no separate columns needed for the IV/tag.
 * Used both for "DEK encrypted under the KEK" and "secret encrypted under
 * the DEK" (the two layers of envelope encryption, solution.md §9.4).
 */
export function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Throws `DecryptionError` — never includes the ciphertext, the key, or
 * anything derived from either — on a wrong key or tampered data (AES-GCM's
 * authentication tag check fails first, before any plaintext is produced).
 */
export function decrypt(key: Buffer, blob: string): string {
  const buffer = Buffer.from(blob, 'base64');

  if (buffer.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    throw new DecryptionError('Encrypted blob is too short to be valid.');
  }

  const iv = buffer.subarray(0, IV_LENGTH_BYTES);
  const authTag = buffer.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = buffer.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf-8');
  } catch {
    // Deliberately swallow the underlying node:crypto error — it can
    // include buffer contents in some Node versions' error messages, which
    // would defeat the entire point of this module.
    throw new DecryptionError('Decryption failed: wrong key or corrupted/tampered data.');
  }
}

export class DecryptionError extends Error {}

export function generateDek(): Buffer {
  return randomBytes(32); // AES-256
}
