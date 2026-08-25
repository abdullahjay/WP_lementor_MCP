import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectNodeGeneration,
  detectTreeGenerations,
  flattenDetectedTree,
  UnknownElementTypeError,
  type ElementorNode,
  type Generation,
} from './detect.js';

function loadFixture(name: string): { elements: ElementorNode[] } {
  const path = fileURLToPath(new URL(`../../../tests/fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as { elements: ElementorNode[] };
}

function generationsById(nodes: ReturnType<typeof detectTreeGenerations>): Record<string, Generation> {
  const result: Record<string, Generation> = {};
  for (const node of flattenDetectedTree(nodes)) {
    if (node.id) {
      result[node.id] = node.generation;
    }
  }
  return result;
}

describe('detectNodeGeneration', () => {
  it('classifies section/column as legacy', () => {
    expect(detectNodeGeneration({ elType: 'section' })).toBe('legacy');
    expect(detectNodeGeneration({ elType: 'column' })).toBe('legacy');
  });

  it('classifies container as v3', () => {
    expect(detectNodeGeneration({ elType: 'container' })).toBe('v3');
  });

  it('classifies e-prefixed layout elTypes as v4 regardless of parent', () => {
    expect(detectNodeGeneration({ elType: 'e-flexbox' }, 'legacy')).toBe('v4');
    expect(detectNodeGeneration({ elType: 'e-grid' })).toBe('v4');
    expect(detectNodeGeneration({ elType: 'e-div-block' })).toBe('v4');
  });

  it('classifies an atomic widget (e-prefixed widgetType + styles/version) as v4 even with a v3 parent', () => {
    const node: ElementorNode = { elType: 'widget', widgetType: 'e-heading', styles: [], version: '0.0' };
    expect(detectNodeGeneration(node, 'v3')).toBe('v4');
  });

  it('classifies an atomic widget as v4 even with no parent generation given', () => {
    const node: ElementorNode = { elType: 'widget', widgetType: 'e-paragraph', styles: [] };
    expect(detectNodeGeneration(node)).toBe('v4');
  });

  it('inherits parent generation for a non-atomic widget', () => {
    const node: ElementorNode = { elType: 'widget', widgetType: 'heading' };
    expect(detectNodeGeneration(node, 'legacy')).toBe('legacy');
    expect(detectNodeGeneration(node, 'v3')).toBe('v3');
  });

  it('defaults a parentless non-atomic widget to v3', () => {
    const node: ElementorNode = { elType: 'widget', widgetType: 'heading' };
    expect(detectNodeGeneration(node)).toBe('v3');
  });

  it('does not misroute an e-prefixed widgetType lacking styles/version as v4', () => {
    // Without styles or version, the e- prefix alone isn't enough — a
    // third-party widget could legitimately be named "e-something".
    const node: ElementorNode = { elType: 'widget', widgetType: 'e-custom-thing' };
    expect(detectNodeGeneration(node, 'v3')).toBe('v3');
  });

  it('throws UnknownElementTypeError on an unrecognized elType rather than guessing', () => {
    expect(() => detectNodeGeneration({ elType: 'mystery' })).toThrow(UnknownElementTypeError);
  });
});

describe('detectTreeGenerations against real captured fixtures', () => {
  it('legacy-section-column: section/column/widgets all legacy', () => {
    const { elements } = loadFixture('legacy-section-column');
    const byId = generationsById(detectTreeGenerations(elements));

    expect(byId['9c2bab0']).toBe('legacy'); // section
    expect(byId['e25c035']).toBe('legacy'); // column
    expect(byId['fb1a12a']).toBe('legacy'); // heading widget
    expect(byId['102c3c7']).toBe('legacy'); // button widget
    expect(byId['9c6a05d']).toBe('legacy'); // empty column
  });

  it('mixed-legacy-v3: legacy subtree stays legacy, sibling container subtree is v3', () => {
    const { elements } = loadFixture('mixed-legacy-v3');
    const byId = generationsById(detectTreeGenerations(elements));

    expect(byId['9c2bab0']).toBe('legacy'); // section
    expect(byId['fb1a12a']).toBe('legacy'); // widget inside section
    expect(byId['6268511']).toBe('v3'); // container
    expect(byId['1da6bf7']).toBe('v3'); // widget inside container
    expect(byId['37449cc']).toBe('v3'); // icon widget inside container
  });

  it('mixed-v3-v4: an e-heading/e-paragraph inside a v3 container is v4, not misrouted into the v3 widget path', () => {
    const { elements } = loadFixture('mixed-v3-v4');
    const byId = generationsById(detectTreeGenerations(elements));

    expect(byId['b562e5e']).toBe('v3'); // container
    expect(byId['186bf22']).toBe('v3'); // legacy-flat "heading" widget, inherits v3 from container
    expect(byId['e41d5bc']).toBe('v3'); // legacy-flat "button" widget, inherits v3
    expect(byId['0b17c4b']).toBe('v4'); // e-heading — must NOT inherit v3 from its container parent
    expect(byId['1637e99']).toBe('v4'); // e-paragraph — same
  });

  it('deep-nested: an e-heading 6 levels below the root is still v4 despite 5 levels of v3 container ancestry', () => {
    const { elements } = loadFixture('deep-nested');
    const byId = generationsById(detectTreeGenerations(elements));

    expect(byId['c8a1583']).toBe('v3');
    expect(byId['a5bdf07']).toBe('v3');
    expect(byId['3d93511']).toBe('v3');
    expect(byId['30201b8']).toBe('v3');
    expect(byId['1638085']).toBe('v3');
    expect(byId['77535a2']).toBe('v4'); // the "Level 5" e-heading
  });

  it('v4-atomic: top-level layout and content nodes are all v4', () => {
    const { elements } = loadFixture('v4-atomic');
    const flat = flattenDetectedTree(detectTreeGenerations(elements));

    expect(flat.length).toBeGreaterThan(0);
    for (const node of flat) {
      expect(node.generation).toBe('v4');
    }
  });

  it('v3-container: every node is v3', () => {
    const { elements } = loadFixture('v3-container');
    const flat = flattenDetectedTree(detectTreeGenerations(elements));

    expect(flat.length).toBeGreaterThan(0);
    for (const node of flat) {
      expect(node.generation).toBe('v3');
    }
  });

  it('unicode-roundtrip and responsive-widescreen fixtures detect without throwing', () => {
    for (const fixture of ['unicode-roundtrip', 'responsive-widescreen']) {
      const { elements } = loadFixture(fixture);
      expect(() => detectTreeGenerations(elements)).not.toThrow();
    }
  });
});
