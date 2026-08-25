/**
 * Recursive lookup over the **raw** native element tree — shared by
 * `get_element` (EMCP-025) and `find_elements` (EMCP-026), both of which
 * need to walk arbitrarily nested elements to locate one or more nodes.
 * Deliberately separate from `digest.ts`: that module normalizes and
 * depth-limits for a compact read shape, this one does neither — widgets
 * are not always leaves (Blueprints.md §3.3), so a search must walk every
 * level regardless of how deep `get_page_structure`'s digest would have
 * truncated it.
 */
import { detectNodeGeneration, type ElementorNode, type Generation } from './detect.js';

export function findElementById(nodes: ElementorNode[], id: string): ElementorNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }

    const found = findElementById(node.elements ?? [], id);
    if (found) {
      return found;
    }
  }

  return undefined;
}

export interface FoundElement {
  node: ElementorNode;
  generation: Generation;
}

export type ElementPredicate = (node: ElementorNode, generation: Generation) => boolean;

/**
 * Walks every node regardless of depth (same rationale as
 * `findElementById` — widgets are not always leaves) and collects every
 * match, not just the first. Generation is threaded down exactly like
 * `detectTreeGenerations`/`buildDigest` — a predicate on `widgetType`
 * still needs the correct per-node generation available if it wants it,
 * and a caller building a result summary (`digest.ts`'s `describeNode()`)
 * needs it regardless.
 */
export function findElements(
  nodes: ElementorNode[],
  predicate: ElementPredicate,
  parentGeneration?: Generation,
): FoundElement[] {
  const results: FoundElement[] = [];

  for (const node of nodes) {
    const generation = detectNodeGeneration(node, parentGeneration);

    if (predicate(node, generation)) {
      results.push({ node, generation });
    }

    results.push(...findElements(node.elements ?? [], predicate, generation));
  }

  return results;
}

/**
 * True if `needle` (case-insensitive) appears anywhere in `value`'s text —
 * walks both v3's flat strings and v4's nested typed props (`{"$$type":
 * "html-v3", "value": {"content": {"$$type": "string", "value": "…"}}}`)
 * without special-casing either shape: every string leaf, at any depth
 * inside `settings`, is a candidate. Deliberately broader than
 * `label.ts`'s key-name-restricted text-bearing-setting heuristic — a
 * content search should find a match wherever the text actually lives,
 * not just in the one setting that would become the element's label.
 */
export function containsText(value: unknown, needle: string): boolean {
  const needleLower = needle.toLowerCase();
  return searchText(value, needleLower);
}

function searchText(value: unknown, needleLower: string): boolean {
  if (typeof value === 'string') {
    return value.toLowerCase().includes(needleLower);
  }

  if (Array.isArray(value)) {
    return value.some((item) => searchText(item, needleLower));
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((item) => searchText(item, needleLower));
  }

  return false;
}
