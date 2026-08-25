/**
 * Blueprints.md §5 — one normalized shape across all four generations, so
 * the model consuming a page never has to learn Elementor's storage
 * differences. `type` reuses the DSL's own small vocabulary (§2.3) rather
 * than inventing a second one — a `container` here means the same thing a
 * `container` means in a spec the model writes, whether the native node
 * underneath is `elType: "section"`, `"container"`, or `"e-flexbox"`.
 */
import { detectNodeGeneration, type ElementorNode, type Generation } from './detect.js';
import { resolveLabel } from './label.js';

export type DigestKind = 'layout' | 'content';

export interface NativeInfo {
  elType: string;
  widgetType: string | null;
}

export interface DigestNode {
  id: string | undefined;
  kind: DigestKind;
  type: string;
  generation: Generation;
  native: NativeInfo;
  label: string;
  childCount: number;
  children: DigestChild[];
}

/** Blueprints.md §5: "at the depth limit a node emits `{ id, type, truncated: N }`." */
export interface TruncatedNode {
  id: string | undefined;
  type: string;
  truncated: number;
}

export type DigestChild = DigestNode | TruncatedNode;

export function isTruncatedNode(node: DigestChild): node is TruncatedNode {
  return !('kind' in node);
}

/**
 * Digest budget (Blueprints.md §5): "≤ 4,000 tokens at depth 3 across the
 * fixture set" is the only concrete number the design docs give for a
 * sane default — depth 3 is where that budget was measured against, so
 * it's the natural default rather than an arbitrary round number.
 */
export const DEFAULT_MAX_DEPTH = 3;

const LEGACY_LAYOUT_TYPES = new Set(['section', 'column']);

/**
 * DSL-type by native widgetType, §3.2's emission table read in reverse.
 * v3 and v4 use genuinely different native names for the same DSL concept
 * (`text-editor` vs `e-paragraph`), so this can't be a single "strip the
 * e- prefix and look up one table" — each generation's name is listed
 * explicitly.
 */
const WIDGET_TYPE_TO_DSL_TYPE: Record<string, string> = {
  heading: 'heading',
  'e-heading': 'heading',
  'text-editor': 'text',
  'e-paragraph': 'text',
  image: 'image',
  'e-image': 'image',
  button: 'button',
  'e-button': 'button',
};

function classify(node: ElementorNode): { kind: DigestKind; type: string } {
  if (LEGACY_LAYOUT_TYPES.has(node.elType) || node.elType === 'container') {
    return { kind: 'layout', type: 'container' };
  }

  if (node.elType === 'e-grid') {
    return { kind: 'layout', type: 'grid' };
  }

  if (node.elType.startsWith('e-')) {
    // Any other V4 layout elType (e-flexbox, e-div-block, ...) — the DSL
    // only models container/grid, so anything else collapses to the
    // structural default rather than inventing a type the DSL can't emit.
    return { kind: 'layout', type: 'container' };
  }

  // elType === 'widget': the escape rung is the DSL's own `widget` type
  // (§2.3) — passthrough with the native widgetType preserved separately
  // in `native`, exactly like the DSL's own `widget` node shape.
  const widgetType = node.widgetType ?? '';
  return { kind: 'content', type: WIDGET_TYPE_TO_DSL_TYPE[widgetType] ?? 'widget' };
}

/** Total descendant count under `node` (not including `node` itself) — what a `TruncatedNode`'s `truncated` field reports. */
function countDescendants(nodes: ElementorNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countDescendants(node.elements ?? []), 0);
}

function buildTruncatedNode(node: ElementorNode): TruncatedNode {
  const { type } = classify(node);
  return { id: node.id, type, truncated: countDescendants(node.elements ?? []) };
}

export function buildDigestNode(
  node: ElementorNode,
  parentGeneration?: Generation,
  depth = 0,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): DigestNode {
  const generation = detectNodeGeneration(node, parentGeneration);
  const { kind, type } = classify(node);
  const childDepth = depth + 1;
  const children: DigestChild[] = (node.elements ?? []).map((child) =>
    childDepth > maxDepth ? buildTruncatedNode(child) : buildDigestNode(child, generation, childDepth, maxDepth),
  );

  return {
    id: node.id,
    kind,
    type,
    generation,
    native: { elType: node.elType, widgetType: node.widgetType ?? null },
    label: resolveLabel(node, type),
    childCount: node.elements?.length ?? 0,
    children,
  };
}

/** One node's digest fields, without recursing into `children` — what
 * `find_elements` (EMCP-026) reports per match: "enough per match to skip
 * a follow-up get_element in the common case" (Blueprints.md §7.3)
 * without duplicating get_element's job of returning the full native
 * settings tree. */
export type DigestNodeSummary = Omit<DigestNode, 'children'>;

export function describeNode(node: ElementorNode, generation: Generation): DigestNodeSummary {
  const { kind, type } = classify(node);

  return {
    id: node.id,
    kind,
    type,
    generation,
    native: { elType: node.elType, widgetType: node.widgetType ?? null },
    label: resolveLabel(node, type),
    childCount: node.elements?.length ?? 0,
  };
}

export interface BuildDigestOptions {
  maxDepth?: number;
  parentGeneration?: Generation;
}

export function buildDigest(nodes: ElementorNode[], options: BuildDigestOptions = {}): DigestNode[] {
  const { maxDepth = DEFAULT_MAX_DEPTH, parentGeneration } = options;
  return nodes.map((node) => buildDigestNode(node, parentGeneration, 0, maxDepth));
}
