import { describe, expect, it } from 'vitest';
import { assertPluginVersionCompatible, MINIMUM_PLUGIN_VERSION, PluginVersionMismatchError } from './contract.js';

describe('assertPluginVersionCompatible', () => {
  it('accepts a version equal to the minimum', () => {
    expect(() => assertPluginVersionCompatible(MINIMUM_PLUGIN_VERSION)).not.toThrow();
  });

  it('accepts a version newer than the minimum', () => {
    expect(() => assertPluginVersionCompatible('99.0.0')).not.toThrow();
  });

  it('accepts a newer patch version', () => {
    expect(() => assertPluginVersionCompatible('0.1.1')).not.toThrow();
  });

  it('rejects a version older than the minimum', () => {
    expect(() => assertPluginVersionCompatible('0.0.9')).toThrow(PluginVersionMismatchError);
  });

  it('rejects a missing version', () => {
    expect(() => assertPluginVersionCompatible(undefined)).toThrow(PluginVersionMismatchError);
  });

  it('rejects a non-string version', () => {
    expect(() => assertPluginVersionCompatible(42)).toThrow(PluginVersionMismatchError);
  });

  it('rejects an empty string', () => {
    expect(() => assertPluginVersionCompatible('')).toThrow(PluginVersionMismatchError);
  });

  it('carries an actionable message naming both versions', () => {
    try {
      assertPluginVersionCompatible('0.0.1');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PluginVersionMismatchError);
      const mismatch = error as PluginVersionMismatchError;
      expect(mismatch.installedVersion).toBe('0.0.1');
      expect(mismatch.minimumVersion).toBe(MINIMUM_PLUGIN_VERSION);
      expect(mismatch.message).toContain('0.0.1');
      expect(mismatch.message).toContain(MINIMUM_PLUGIN_VERSION);
    }
  });

  it('compares version segments numerically, not lexically', () => {
    // "0.10.0" > "0.9.0" numerically, even though "10" < "9" as strings.
    expect(() => assertPluginVersionCompatible('0.10.0')).not.toThrow();
  });
});
