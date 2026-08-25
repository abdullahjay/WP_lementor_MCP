import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { containsText, findElementById, findElements } from './find.js';
import type { ElementorNode } from './detect.js';

function loadFixture(name: string): { elements: ElementorNode[] } {
  const path = fileURLToPath(new URL(`../../../tests/fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as { elements: ElementorNode[] };
}

describe('findElementById', () => {
  it('finds a top-level node by id', () => {
    const { elements } = loadFixture('v3-container');
    const found = findElementById(elements, '6268511');
    expect(found?.elType).toBe('container');
  });

  it('finds a node nested inside a top-level node', () => {
    const { elements } = loadFixture('legacy-section-column');
    const found = findElementById(elements, 'fb1a12a');
    expect(found?.widgetType).toBe('heading');
    expect(found?.settings).toMatchObject({ title: 'Build it on V3 / Free' });
  });

  it('finds a node several levels deep (deep-nested fixture, real 6-level tree)', () => {
    const { elements } = loadFixture('deep-nested');
    const found = findElementById(elements, '77535a2');
    expect(found?.widgetType).toBe('e-heading');
  });

  it('finds a widget nested inside another widget (synthetic — real nested-widget fixture is a permanent blocker, EMCP-008)', () => {
    const syntheticNestedTabs: ElementorNode = {
      id: 'aaaaaaa',
      elType: 'widget',
      widgetType: 'nested-tabs',
      settings: {},
      elements: [
        {
          id: 'bbbbbbb',
          elType: 'widget',
          widgetType: 'heading',
          settings: { title: 'Inside a tab' },
          elements: [],
        },
      ],
    };

    const found = findElementById([syntheticNestedTabs], 'bbbbbbb');
    expect(found?.settings).toMatchObject({ title: 'Inside a tab' });
  });

  it('returns undefined for an id that does not exist anywhere in the tree', () => {
    const { elements } = loadFixture('v3-container');
    expect(findElementById(elements, 'nonexistent')).toBeUndefined();
  });

  it('returns the exact native node, unmodified — full settings, not a digest', () => {
    const { elements } = loadFixture('v4-atomic');
    const found = findElementById(elements, '98acb61');
    expect(found?.widgetType).toBe('e-button');
    // Full native shape (styles, interactions, editor_settings, version) —
    // not the normalized/truncated digest.ts shape.
    expect(found).toHaveProperty('styles');
    expect(found).toHaveProperty('version');
  });
});

describe('containsText', () => {
  it('matches a plain v3 flat string, case-insensitively', () => {
    expect(containsText('Build it on V3 / Free', 'build it')).toBe(true);
    expect(containsText('Build it on V3 / Free', 'BUILD IT')).toBe(true);
    expect(containsText('Build it on V3 / Free', 'nope')).toBe(false);
  });

  it('matches inside a v4 nested typed prop', () => {
    const v4Title = {
      $$type: 'html-v3',
      value: { content: { $$type: 'string', value: 'Builder Faster' }, children: [] },
    };
    expect(containsText(v4Title, 'builder faster')).toBe(true);
    expect(containsText(v4Title, 'nope')).toBe(false);
  });

  it('does not match a non-string leaf and does not throw on null/undefined', () => {
    expect(containsText(42, 'nope')).toBe(false);
    expect(containsText(null, 'nope')).toBe(false);
    expect(containsText(undefined, 'nope')).toBe(false);
    expect(containsText([], 'nope')).toBe(false);
    expect(containsText({}, 'nope')).toBe(false);
  });
});

describe('findElements (predicate-based search)', () => {
  it('collects every match across the whole tree, not just the first', () => {
    const { elements } = loadFixture('mixed-v3-v4');
    const matches = findElements(elements, (node) => node.widgetType === 'e-paragraph');
    expect(matches.map((m) => m.node.id)).toEqual(['1637e99']);
  });

  it('finds matches by widgetType across mixed generations in one document', () => {
    const { elements } = loadFixture('mixed-legacy-v3');
    const matches = findElements(elements, (node) => node.widgetType === 'heading');

    // One legacy heading (in the section/column subtree) and one v3
    // heading (in the container subtree) — same widgetType, different
    // generation, both must be found.
    expect(matches).toHaveLength(2);
    expect(matches.find((m) => m.node.id === 'fb1a12a')?.generation).toBe('legacy');
    expect(matches.find((m) => m.node.id === '1da6bf7')?.generation).toBe('v3');
  });

  it('finds a match by text content anywhere in the tree, including several levels deep', () => {
    const { elements } = loadFixture('deep-nested');
    const matches = findElements(elements, (node) => containsText(node.settings, 'level 5'));

    expect(matches).toHaveLength(1);
    expect(matches[0]?.node.id).toBe('77535a2');
    expect(matches[0]?.generation).toBe('v4');
  });

  it('finds every element inside a nested widget (synthetic — real nested-widget fixture is a permanent blocker, EMCP-008)', () => {
    const syntheticNestedTabs: ElementorNode = {
      id: 'aaaaaaa',
      elType: 'widget',
      widgetType: 'nested-tabs',
      settings: {},
      elements: [
        {
          id: 'bbbbbbb',
          elType: 'widget',
          widgetType: 'heading',
          settings: { title: 'Tab one' },
          elements: [],
        },
        {
          id: 'ccccccc',
          elType: 'widget',
          widgetType: 'heading',
          settings: { title: 'Tab two' },
          elements: [],
        },
      ],
    };

    const matches = findElements([syntheticNestedTabs], (node) => node.widgetType === 'heading');
    expect(matches.map((m) => m.node.id)).toEqual(['bbbbbbb', 'ccccccc']);
  });

  it('returns an empty array when nothing matches', () => {
    const { elements } = loadFixture('v3-container');
    expect(findElements(elements, (node) => node.widgetType === 'nonexistent-widget')).toEqual([]);
  });
});
