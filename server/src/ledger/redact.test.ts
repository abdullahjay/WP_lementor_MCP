import { describe, expect, it } from 'vitest';
import { redactArgs } from './redact.js';

describe('redactArgs: allowlisted in, never denylisted out', () => {
  it('keeps only the allowlisted keys, dropping everything else', () => {
    const result = redactArgs({ post_id: 5, webhook_url: 'https://secret.example/hook' }, ['post_id']);
    expect(result).toEqual({ post_id: 5 });
  });

  it('returns an empty object for an empty allowlist, even with sensitive-looking args present', () => {
    const result = redactArgs({ post_id: 5, api_key: 'sk-very-secret' }, []);
    expect(result).toEqual({});
  });

  it('returns an empty object when args is undefined', () => {
    expect(redactArgs(undefined, ['post_id'])).toEqual({});
  });

  it('does not fabricate a key that is allowlisted but absent from args', () => {
    const result = redactArgs({ post_id: 5 }, ['post_id', 'element_id']);
    expect(result).toEqual({ post_id: 5 });
    expect('element_id' in result).toBe(false);
  });

  it('never picks up an inherited/prototype property, only the object\'s own keys', () => {
    const args = Object.create({ inherited: 'nope' }) as Record<string, unknown>;
    args['own'] = 'yes';
    const result = redactArgs(args, ['own', 'inherited']);
    expect(result).toEqual({ own: 'yes' });
  });

  it('a value that is itself an object/array is copied through as-is, not deep-redacted', () => {
    const nested = { url: 'https://example.com/webhook', secret: 'sk-123' };
    const result = redactArgs({ settings: nested }, ['settings']);
    expect(result['settings']).toBe(nested);
  });
});
