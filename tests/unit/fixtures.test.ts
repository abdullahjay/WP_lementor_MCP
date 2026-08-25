import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * EMCP-009: fixtures are hash-checked and agent-immutable (Blueprints.md
 * §9.1). An agent told "make the tests pass" will otherwise regenerate a
 * fixture from its own compiler output — every test greens and you have
 * verified the compiler agrees with itself, not with real Elementor.
 */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures');
const HASHES_PATH = join(FIXTURES_DIR, 'hashes.json');

interface HashManifest {
  algorithm: 'sha256';
  hashes: Record<string, string>;
}

function loadManifest(): HashManifest {
  return JSON.parse(readFileSync(HASHES_PATH, 'utf-8')) as HashManifest;
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function fixtureFileNames(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'hashes.json')
    .sort();
}

describe('fixture immutability guard', () => {
  it('has a manifest entry for every fixture file, and vice versa', () => {
    const manifest = loadManifest();
    const onDisk = fixtureFileNames();
    const inManifest = Object.keys(manifest.hashes).sort();

    expect(onDisk).toEqual(inManifest);
  });

  it('matches the recorded hash for every fixture', () => {
    const manifest = loadManifest();

    for (const [fileName, expectedHash] of Object.entries(manifest.hashes)) {
      const content = readFileSync(join(FIXTURES_DIR, fileName));
      const actualHash = sha256(content);

      expect(actualHash, `${fileName} has changed since its hash was recorded`).toBe(expectedHash);
    }
  });

  it('the guard actually fires on a modified fixture', () => {
    // Proves the mechanism catches a real change, without touching a real
    // committed fixture (that would violate the immutability rule this test
    // exists to enforce) — mutate an isolated temp copy instead.
    const manifest = loadManifest();
    const [fileName] = fixtureFileNames();

    if (!fileName) {
      throw new Error('No fixtures found to test the guard against.');
    }

    const originalPath = join(FIXTURES_DIR, fileName);
    const originalContent = readFileSync(originalPath);
    const recordedHash = manifest.hashes[fileName];

    expect(sha256(originalContent)).toBe(recordedHash);

    const tempDir = mkdtempSync(join(tmpdir(), 'emcp-fixture-guard-'));
    try {
      const tamperedPath = join(tempDir, fileName);
      const tampered = JSON.parse(originalContent.toString('utf-8')) as Record<string, unknown>;
      tampered['_tamperedForTest'] = true;
      writeFileSync(tamperedPath, JSON.stringify(tampered));

      const tamperedHash = sha256(readFileSync(tamperedPath));

      expect(tamperedHash).not.toBe(recordedHash);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
