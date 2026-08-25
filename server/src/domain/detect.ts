/**
 * Blueprints.md §5.1/§5.2, CLAUDE.md's most emphasized gotcha: V4 atomic
 * content widgets are still `elType: "widget"` — an `e-heading` presents as
 * `{elType: "widget", widgetType: "e-heading"}`. Routing on `elType` alone
 * sends it into the V3 widget path, where its typed settings are misread
 * and a "safe" text edit destroys it. Detection is per-node, not
 * per-document — a single document, or even a single container, can
 * genuinely mix generations (confirmed live in EMCP-008's `mixed-v3-v4` and
 * `deep-nested` fixtures).
 */
export type Generation = 'legacy' | 'v3' | 'v4';

export interface ElementorNode {
  id?: string;
  elType: string;
  widgetType?: string;
  styles?: unknown;
  version?: unknown;
  elements?: ElementorNode[];
  [key: string]: unknown;
}

export class UnknownElementTypeError extends Error {
  constructor(elType: string) {
    super(`Unrecognized elType "${elType}" — refusing to guess its generation.`);
  }
}

/**
 * Classifies one node. `parentGeneration` matters only for a non-atomic
 * widget (`elType: "widget"` whose `widgetType` isn't `e-`-prefixed) —
 * Blueprints.md §5.2's disambiguation rule: "content inserted inside an
 * existing legacy section/column stays legacy." A legacy widget and a V3
 * widget are structurally identical in isolation (both flat `settings`);
 * only the parent's own shape tells them apart. Every other `elType`
 * carries its own generation signal and never needs the parent at all.
 */
export function detectNodeGeneration(node: ElementorNode, parentGeneration?: Generation): Generation {
  if (node.elType === 'section' || node.elType === 'column') {
    return 'legacy';
  }

  if (node.elType === 'container') {
    return 'v3';
  }

  if (node.elType.startsWith('e-')) {
    // e-flexbox, e-grid, e-div-block, ... — V4 layout nodes carry the
    // prefix on elType itself, unlike V4 content widgets.
    return 'v4';
  }

  if (node.elType === 'widget') {
    const widgetType = node.widgetType ?? '';
    const isAtomic = widgetType.startsWith('e-') && ('styles' in node || 'version' in node);

    if (isAtomic) {
      return 'v4';
    }

    return parentGeneration ?? 'v3';
  }

  throw new UnknownElementTypeError(node.elType);
}

export interface DetectedNode {
  id: string | undefined;
  elType: string;
  widgetType: string | undefined;
  generation: Generation;
  children: DetectedNode[];
}

export function detectTreeGenerations(
  nodes: ElementorNode[],
  parentGeneration?: Generation,
): DetectedNode[] {
  return nodes.map((node) => {
    const generation = detectNodeGeneration(node, parentGeneration);
    const children = node.elements
      ? detectTreeGenerations(node.elements, generation)
      : [];

    return {
      id: node.id,
      elType: node.elType,
      widgetType: node.widgetType,
      generation,
      children,
    };
  });
}

/** Flattens the tree into a single list — convenient for "assert every node
 * in this fixture got the expected generation" style tests. */
export function flattenDetectedTree(nodes: DetectedNode[]): DetectedNode[] {
  return nodes.flatMap((node) => [node, ...flattenDetectedTree(node.children)]);
}
