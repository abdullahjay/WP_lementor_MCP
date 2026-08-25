import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { loadKek } from './kek.js';

const ORIGINAL = process.env['CREDENTIALS_KEK'];

describe('loadKek', () => {
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env['CREDENTIALS_KEK'];
    } else {
      process.env['CREDENTIALS_KEK'] = ORIGINAL;
    }
  });

  it('throws when unset', () => {
    delete process.env['CREDENTIALS_KEK'];
    expect(() => loadKek()).toThrow(/CREDENTIALS_KEK is not set/);
  });

  it('throws when the decoded key is the wrong length', () => {
    process.env['CREDENTIALS_KEK'] = Buffer.from('too short').toString('base64');
    expect(() => loadKek()).toThrow(/32 bytes/);
  });

  it('returns a 32-byte buffer for a valid key', () => {
    process.env['CREDENTIALS_KEK'] = randomBytes(32).toString('base64');
    expect(loadKek().length).toBe(32);
  });
});
