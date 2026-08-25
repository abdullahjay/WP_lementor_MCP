import { describe, expect, it } from 'vitest';
import { generateSiteSlug } from './slug.js';

describe('generateSiteSlug', () => {
  it('produces a base64url string with no separators that would leak structure', () => {
    const slug = generateSiteSlug();

    expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(slug.length).toBeGreaterThanOrEqual(20);
  });

  it('produces distinct values across many calls (not sequential, not colliding)', () => {
    const slugs = new Set(Array.from({ length: 1000 }, () => generateSiteSlug()));

    expect(slugs.size).toBe(1000);
  });

  it('does not encode a detectable counter or timestamp pattern', () => {
    // A sequential/timestamp-derived slug would share a long common prefix
    // across close-in-time calls. 128 bits of real randomness won't.
    const first = generateSiteSlug();
    const second = generateSiteSlug();

    let commonPrefixLength = 0;
    while (
      commonPrefixLength < first.length &&
      first[commonPrefixLength] === second[commonPrefixLength]
    ) {
      commonPrefixLength += 1;
    }

    expect(commonPrefixLength).toBeLessThan(4);
  });
});
