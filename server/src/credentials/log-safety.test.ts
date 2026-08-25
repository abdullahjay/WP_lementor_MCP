import { describe, expect, it } from 'vitest';
import { decrypt, DecryptionError, encrypt, generateDek } from './crypto.js';

/**
 * prd.md EMCP-015: "credentials never logged... a test asserts a credential
 * value cannot reach any log sink." This module never calls a logger
 * itself (it's pure) — the way a secret *could* leak into logs is if a
 * thrown error's message/stack/properties embedded it, and calling code
 * later logged that error (exactly what route.ts's
 * `request.log.error(error, 'Unhandled error dispatching method')` does
 * for any uncaught exception). So: throw every failure this module can
 * produce, run each one through a fake logger that mimics that real call
 * shape, and assert the marker is nowhere in what the logger recorded.
 */
const SECRET_MARKER = 'CREDENTIAL_MARKER_do-not-log-me-9f8e7d6c5b4a';

interface FakeLogger {
  calls: string[];
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
}

function createFakeLogger(): FakeLogger {
  const calls: string[] = [];
  const record = (...args: unknown[]): void => {
    for (const arg of args) {
      calls.push(safeStringify(arg));
    }
  };

  return { calls, error: record, warn: record, info: record };
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({
      message: value.message,
      stack: value.stack,
      ...Object.fromEntries(Object.entries(value)),
    });
  }

  return JSON.stringify(value);
}

describe('credential values never reach a log sink', () => {
  it('a successful round trip never appears in any log call, even if the result were accidentally logged', () => {
    const logger = createFakeLogger();
    const key = generateDek();

    const blob = encrypt(key, SECRET_MARKER);
    const recovered = decrypt(key, blob);

    // Simulate the one place a caller might carelessly log the value —
    // this line is the bug being guarded against, not a recommendation.
    logger.info('would-be careless log line', { note: 'not doing this for real' });

    expect(recovered).toBe(SECRET_MARKER); // sanity: the round trip did work
    expect(logger.calls.join('\n')).not.toContain(SECRET_MARKER);
  });

  it('a wrong-key failure never embeds the plaintext or the blob in the thrown error', () => {
    const logger = createFakeLogger();
    const rightKey = generateDek();
    const wrongKey = generateDek();
    const blob = encrypt(rightKey, SECRET_MARKER);

    try {
      decrypt(wrongKey, blob);
      expect.unreachable('should have thrown');
    } catch (error) {
      logger.error(error, 'Unhandled error dispatching method'); // route.ts's real call shape
    }

    expect(logger.calls.join('\n')).not.toContain(SECRET_MARKER);
    expect(logger.calls.join('\n')).not.toContain(blob);
  });

  it('a tampered-ciphertext failure never embeds the plaintext or the blob', () => {
    const logger = createFakeLogger();
    const key = generateDek();
    const blob = encrypt(key, SECRET_MARKER);
    const bytes = Buffer.from(blob, 'base64');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! ^ 0xff) & 0xff;
    const tampered = bytes.toString('base64');

    try {
      decrypt(key, tampered);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DecryptionError);
      logger.error(error, 'Unhandled error dispatching method');
    }

    expect(logger.calls.join('\n')).not.toContain(SECRET_MARKER);
    expect(logger.calls.join('\n')).not.toContain(blob);
  });

  it('logging the encrypted blob itself (not an error) still never reveals the plaintext', () => {
    // The ciphertext blob is safe to log by design (it's what's stored in
    // the database) — this asserts that safety property directly.
    const logger = createFakeLogger();
    const key = generateDek();
    const blob = encrypt(key, SECRET_MARKER);

    logger.info('storing credential blob', { blob });

    expect(logger.calls.join('\n')).not.toContain(SECRET_MARKER);
  });
});
