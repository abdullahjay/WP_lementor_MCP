import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, DecryptionError, encrypt, generateDek } from './crypto.js';

describe('envelope encryption primitives', () => {
  it('round-trips a plaintext through encrypt/decrypt', () => {
    const key = generateDek();
    const plaintext = 'a WordPress Application Password, or any other secret';

    const blob = encrypt(key, plaintext);

    expect(decrypt(key, blob)).toBe(plaintext);
  });

  it('the encrypted blob does not contain the plaintext as a substring', () => {
    const key = generateDek();
    const plaintext = 'UNMISTAKABLE_MARKER_1234567890';

    const blob = encrypt(key, plaintext);

    expect(blob).not.toContain(plaintext);
    expect(blob).not.toContain(Buffer.from(plaintext).toString('base64'));
  });

  it('produces a different blob each time (random IV) for the same plaintext', () => {
    const key = generateDek();
    const plaintext = 'same secret both times';

    expect(encrypt(key, plaintext)).not.toBe(encrypt(key, plaintext));
  });

  it('rejects decryption with the wrong key', () => {
    const blob = encrypt(generateDek(), 'secret');

    expect(() => decrypt(generateDek(), blob)).toThrow(DecryptionError);
  });

  it('rejects a tampered ciphertext (auth tag check fails)', () => {
    const key = generateDek();
    const blob = encrypt(key, 'secret');
    const bytes = Buffer.from(blob, 'base64');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! ^ 0xff) & 0xff; // flip last byte
    const tampered = bytes.toString('base64');

    expect(() => decrypt(key, tampered)).toThrow(DecryptionError);
  });

  it('rejects a too-short blob rather than throwing an unrelated error', () => {
    expect(() => decrypt(generateDek(), Buffer.from('short').toString('base64'))).toThrow(
      DecryptionError,
    );
  });

  it('generateDek produces 32-byte (256-bit) keys that differ each call', () => {
    const a = generateDek();
    const b = generateDek();

    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(false);
  });

  it('handles binary-unfriendly plaintext (unicode, empty string)', () => {
    const key = generateDek();

    for (const plaintext of ['', '"Design" — مرحبا 你好', randomBytes(4).toString('hex')]) {
      expect(decrypt(key, encrypt(key, plaintext))).toBe(plaintext);
    }
  });
});
