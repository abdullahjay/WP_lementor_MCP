import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * prd.md EMCP-014: "no tool can mutate the registry." Documented in
 * admin.ts's own docblock, but checked here mechanically — a future tool
 * that imports admin.ts should fail this test, not slip through on the
 * strength of a comment nobody re-reads.
 */
const TOOLS_DIR = fileURLToPath(new URL('../tools', import.meta.url));

describe('registry mutation boundary', () => {
  it('no file under src/tools/ imports registry/admin', () => {
    const toolFiles = readdirSync(TOOLS_DIR).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );

    expect(toolFiles.length).toBeGreaterThan(0);

    const offenders = toolFiles.filter((name) => {
      const content = readFileSync(join(TOOLS_DIR, name), 'utf-8');
      return /registry\/admin(\.js)?['"]/.test(content);
    });

    expect(offenders).toEqual([]);
  });
});
