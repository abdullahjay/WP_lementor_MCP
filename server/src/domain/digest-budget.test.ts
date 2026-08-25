import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countTokens } from 'gpt-tokenizer';
import { describe, expect, it } from 'vitest';
import { buildDigest, DEFAULT_MAX_DEPTH } from './digest.js';
import type { ElementorNode } from './detect.js';

/**
 * Blueprints.md §5's digest budget: "≤ 4,000 tokens at depth 3 across the
 * fixture set, measured with `count_tokens`" — an explicitly measured
 * acceptance criterion, not prose ("a number, not a judgement", prd.md
 * EMCP-024). Measured here with `gpt-tokenizer` (cl100k_base) against the
 * serialized JSON a real `get_page_structure` call would return, summed
 * across every real captured fixture (EMCP-008) — not estimated, not a
 * synthetic stand-in.
 */
const FIXTURES_DIR = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));
const MAX_TOTAL_TOKENS = 4000;

function loadFixtureNames(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'hashes.json')
    .map((name) => name.replace(/\.json$/, ''));
}

function loadFixtureElements(name: string): ElementorNode[] {
  const raw = JSON.parse(readFileSync(`${FIXTURES_DIR}${name}.json`, 'utf8')) as {
    elements: ElementorNode[];
  };
  return raw.elements;
}

describe('digest token budget (Blueprints.md §5)', () => {
  it(`stays at or under ${MAX_TOTAL_TOKENS} tokens at depth ${DEFAULT_MAX_DEPTH}, summed across the fixture set`, () => {
    const fixtureNames = loadFixtureNames();
    expect(fixtureNames.length).toBeGreaterThan(0);

    let total = 0;
    const perFixture: Record<string, number> = {};

    for (const name of fixtureNames) {
      const elements = loadFixtureElements(name);
      const digest = buildDigest(elements, { maxDepth: DEFAULT_MAX_DEPTH });
      const tokens = countTokens(JSON.stringify(digest));
      perFixture[name] = tokens;
      total += tokens;
    }

    // Printed on failure via the assertion message context, not swallowed —
    // if this ever regresses, knowing which fixture grew is the first
    // useful fact, not just "the sum is too big."
    expect(total, `per-fixture token counts: ${JSON.stringify(perFixture)}`).toBeLessThanOrEqual(
      MAX_TOTAL_TOKENS,
    );
  });
});
