import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildDigest, isTruncatedNode, DEFAULT_MAX_DEPTH, type DigestNode } from './digest.js';
import type { ElementorNode } from './detect.js';

function loadFixture(name: string): { elements: ElementorNode[] } {
  const path = fileURLToPath(new URL(`../../../tests/fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as { elements: ElementorNode[] };
}

function flatten(nodes: DigestNode[]): DigestNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children.filter((child): child is DigestNode => !isTruncatedNode(child)))]);
}

function byId(nodes: DigestNode[]): Record<string, DigestNode> {
  const result: Record<string, DigestNode> = {};
  for (const node of flatten(nodes)) {
    if (node.id) {
      result[node.id] = node;
    }
  }
  return result;
}

describe('buildDigest against real captured fixtures', () => {
  it('legacy-section-column: section/column are layout/container, widgets are content', () => {
    const { elements } = loadFixture('legacy-section-column');
    const nodes = byId(buildDigest(elements));

    expect(nodes['9c2bab0']).toMatchObject({
      kind: 'layout',
      type: 'container',
      generation: 'legacy',
      native: { elType: 'section', widgetType: null },
      childCount: 2,
    });
    expect(nodes['e25c035']).toMatchObject({ kind: 'layout', type: 'container', generation: 'legacy', childCount: 2 });
    expect(nodes['fb1a12a']).toMatchObject({
      kind: 'content',
      type: 'heading',
      generation: 'legacy',
      native: { elType: 'widget', widgetType: 'heading' },
      childCount: 0,
    });
    expect(nodes['102c3c7']).toMatchObject({ kind: 'content', type: 'button', generation: 'legacy' });
  });

  it('v3-container: container is layout/container, heading/icon widgets normalize correctly', () => {
    const { elements } = loadFixture('v3-container');
    const nodes = byId(buildDigest(elements));

    expect(nodes['6268511']).toMatchObject({ kind: 'layout', type: 'container', generation: 'v3', childCount: 2 });
    expect(nodes['1da6bf7']).toMatchObject({ kind: 'content', type: 'heading', generation: 'v3' });
    // "icon" has no DSL-vocabulary mapping — falls back to the escape rung
    expect(nodes['37449cc']).toMatchObject({
      kind: 'content',
      type: 'widget',
      generation: 'v3',
      native: { elType: 'widget', widgetType: 'icon' },
    });
  });

  it('v4-atomic: e-flexbox is layout/container, e-heading/e-button normalize to heading/button', () => {
    const { elements } = loadFixture('v4-atomic');
    const nodes = byId(buildDigest(elements));

    expect(nodes['a7f4eea']).toMatchObject({
      kind: 'layout',
      type: 'container',
      generation: 'v4',
      native: { elType: 'e-flexbox', widgetType: null },
      childCount: 2,
    });
    expect(nodes['74f5254']).toMatchObject({
      kind: 'content',
      type: 'heading',
      generation: 'v4',
      native: { elType: 'widget', widgetType: 'e-heading' },
    });
    expect(nodes['98acb61']).toMatchObject({ kind: 'content', type: 'button', generation: 'v4' });
  });

  it('mixed-legacy-v3: one shape covers a legacy subtree and a v3 subtree in the same document', () => {
    const { elements } = loadFixture('mixed-legacy-v3');
    const nodes = byId(buildDigest(elements));

    expect(nodes['9c2bab0']?.generation).toBe('legacy');
    expect(nodes['fb1a12a']?.generation).toBe('legacy');
    expect(nodes['6268511']).toMatchObject({ kind: 'layout', type: 'container', generation: 'v3' });
    expect(nodes['1da6bf7']?.generation).toBe('v3');
  });

  it('mixed-v3-v4: e-heading/e-paragraph inside a v3 container digest as v4 content, not v3', () => {
    const { elements } = loadFixture('mixed-v3-v4');
    const nodes = byId(buildDigest(elements));

    expect(nodes['b562e5e']).toMatchObject({ kind: 'layout', type: 'container', generation: 'v3', childCount: 4 });
    expect(nodes['186bf22']).toMatchObject({ kind: 'content', type: 'heading', generation: 'v3' });
    expect(nodes['0b17c4b']).toMatchObject({
      kind: 'content',
      type: 'heading',
      generation: 'v4',
      native: { elType: 'widget', widgetType: 'e-heading' },
    });
    expect(nodes['1637e99']).toMatchObject({
      kind: 'content',
      type: 'text', // e-paragraph normalizes to the DSL's "text" type
      generation: 'v4',
      native: { elType: 'widget', widgetType: 'e-paragraph' },
    });
  });

  it('deep-nested: childCount and children are correct at every level, digest matches raw structure depth', () => {
    const { elements } = loadFixture('deep-nested');
    // maxDepth well past this fixture's real depth (5) — this test is
    // about traversal correctness, not truncation (that's covered below).
    const [root] = buildDigest(elements, { maxDepth: 10 });
    let cursor: DigestNode = root!;
    let depth = 0;
    while (cursor.children.length > 0) {
      const [firstChild] = cursor.children;
      expect(isTruncatedNode(firstChild!)).toBe(false);
      expect(cursor.childCount).toBe(cursor.children.length);
      cursor = firstChild as DigestNode;
      depth += 1;
    }
    expect(depth).toBe(5);
    expect(cursor.type).toBe('heading');
    expect(cursor.generation).toBe('v4');
  });
});

describe('buildDigest depth limiting against the deep-nested fixture', () => {
  // 6 real levels: c8a1583(0) > a5bdf07(1) > 3d93511(2) > 30201b8(3) >
  // 1638085(4) > 77535a2(5, the "Level 5" e-heading, a leaf).
  it('applies the sane default (DEFAULT_MAX_DEPTH = 3) when no options are given', () => {
    const { elements } = loadFixture('deep-nested');
    const [root] = buildDigest(elements);

    let cursor: DigestNode = root!;
    for (let i = 0; i < DEFAULT_MAX_DEPTH; i += 1) {
      expect(cursor.children).toHaveLength(1);
      const [child] = cursor.children;
      expect(isTruncatedNode(child!)).toBe(false);
      cursor = child as DigestNode;
    }

    // One level past maxDepth, the child is truncated rather than expanded.
    expect(cursor.children).toHaveLength(1);
    const truncatedChild = cursor.children[0]!;
    expect(isTruncatedNode(truncatedChild)).toBe(true);
    expect(truncatedChild).toEqual({ id: '1638085', type: 'container', truncated: 1 });
    // childCount still reports the real native child count, unaffected by truncation.
    expect(cursor.childCount).toBe(1);
  });

  it('truncated counts the full pruned subtree size, not just the immediate child', () => {
    const { elements } = loadFixture('deep-nested');
    const [root] = buildDigest(elements, { maxDepth: 2 });

    // depth 0, 1, 2 full: c8a1583 > a5bdf07 > 3d93511
    const depth2 = root!.children[0]!;
    expect(isTruncatedNode(depth2)).toBe(false);
    const depth3 = (depth2 as DigestNode).children[0]!;
    expect(isTruncatedNode(depth3)).toBe(false);
    const truncatedAtDepth4 = (depth3 as DigestNode).children[0]!;

    // 30201b8's child is 1638085, which itself has one child (77535a2) —
    // the truncated count covers both, not just the direct child.
    expect(truncatedAtDepth4).toEqual({ id: '30201b8', type: 'container', truncated: 2 });
  });

  it('maxDepth is configurable per call — a deeper limit reaches the leaf itself, un-truncated', () => {
    const { elements } = loadFixture('deep-nested');
    const [root] = buildDigest(elements, { maxDepth: 5 });

    let cursor: DigestNode = root!;
    while (cursor.children.length > 0) {
      const [child] = cursor.children;
      expect(isTruncatedNode(child!)).toBe(false);
      cursor = child as DigestNode;
    }
    expect(cursor.type).toBe('heading');
    expect(cursor.native.widgetType).toBe('e-heading');
  });
});

describe('buildDigest traverses nested-widget children correctly', () => {
  // The real `nested-widget` fixture (Nested Tabs/Accordion) is a permanent,
  // documented blocker (EMCP-008 — the widget doesn't appear in this
  // Elementor build's live editor). This synthetic node reproduces the one
  // structural fact the AC cares about: a `widget` node itself carrying
  // `elements` children, per Blueprints.md §3.3 ("widgets are not always
  // leaves").
  const syntheticNestedTabs: ElementorNode = {
    id: 'aaaaaaa',
    elType: 'widget',
    widgetType: 'nested-tabs',
    settings: {},
    elements: [
      {
        id: 'bbbbbbb',
        elType: 'widget',
        widgetType: 'nested-tabs-content',
        settings: {},
        elements: [
          {
            id: 'ccccccc',
            elType: 'widget',
            widgetType: 'heading',
            settings: { title: 'Inside a tab' },
            elements: [],
          },
        ],
      },
    ],
  };

  it('walks into a widget node children rather than treating widgets as always-leaves', () => {
    const [digestNode] = buildDigest([syntheticNestedTabs]);
    expect(digestNode).toBeDefined();
    expect(digestNode!.kind).toBe('content');
    expect(digestNode!.childCount).toBe(1);
    expect(digestNode!.children).toHaveLength(1);

    const tabContentChild = digestNode!.children[0]!;
    expect(isTruncatedNode(tabContentChild)).toBe(false);
    const tabContent = tabContentChild as DigestNode;
    expect(tabContent.native.widgetType).toBe('nested-tabs-content');
    expect(tabContent.children).toHaveLength(1);

    const headingChild = tabContent.children[0]!;
    expect(isTruncatedNode(headingChild)).toBe(false);
    const heading = headingChild as DigestNode;
    expect(heading.type).toBe('heading');
    expect(heading.kind).toBe('content');
    expect(heading.children).toHaveLength(0);
  });
});
