/**
 * solution.md §9.4: "KEK in a KMS, scheduled rotation, and a written
 * compromise runbook." None of that exists in this local Docker Compose
 * stack — there is no KMS here. `CREDENTIALS_KEK` is a **dev-only stand-in**
 * sourced from an env var, which is explicitly *not* what "outside the
 * database" is supposed to mean in production (an env var is still on the
 * same host as the database). This module is the single seam a real KMS
 * integration replaces later; nothing outside `credentials/` should read
 * `CREDENTIALS_KEK` directly.
 */
const KEK_LENGTH_BYTES = 32; // AES-256

export function loadKek(): Buffer {
  const value = process.env['CREDENTIALS_KEK'];

  if (!value) {
    throw new Error(
      'CREDENTIALS_KEK is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  const kek = Buffer.from(value, 'base64');

  if (kek.length !== KEK_LENGTH_BYTES) {
    throw new Error(
      `CREDENTIALS_KEK must decode to exactly ${KEK_LENGTH_BYTES} bytes (got ${kek.length}) — it should be a base64-encoded 256-bit key.`,
    );
  }

  return kek;
}
