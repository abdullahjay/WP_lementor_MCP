import { randomBytes } from 'node:crypto';
import type { RawWidget } from '../domain/curation.js';
import type { ElementorNode } from '../domain/detect.js';
import type { Diagnostic } from '../domain/validate.js';
import { mergeRaw } from './raw.js';
import type { Spec, SpecNode, SpecNodeType } from './types.js';

/**
 * EMCP-049 — Blueprints.md §3, the compiler's orchestration layer:
 * `compile(spec, siteProfile) → { elements, diagnostics, nativeness,
 * rawRatio }`, pure and synchronous, §3.3's invariants enforced.
 *
 * **What "core" means here, deliberately, and what it doesn't:** the DSL→
 * native *emission tables* — the real per-node-type mapping this codebase
 * calls `container → e-flexbox`, `heading → e-heading`/`widgetType:
 * heading`, and so on (§3.2's whole table) — are EMCP-050 (v3) and
 * EMCP-051 (v4), not this task. What this task owns is everything those
 * two tasks will share and must never each reimplement: the tree walk,
 * unique-ID generation across the *whole* tree (§3.3), diagnostic
 * aggregation, `nativeness`/`rawRatio` computation, and the required
 * document meta shape (§3.3) — plus a pluggable emitter registry
 * (`registerEmitter`) that EMCP-050/051 populate rather than this module
 * hardcoding generation-specific logic it has no way to get right yet.
 *
 * **Ships one real, working emitter of its own: `widget` (§2.3's escape
 * rung).** Chosen specifically because it's the one node type §3.2's own
 * table says is generation-agnostic ("passthrough `widgetType`" for both
 * v3 and v4) — every other type needs the real mapping tables EMCP-050/051
 * own, but `widget` needs nothing generation-specific at all, so it's both
 * a genuinely correct, spec-faithful implementation *and* the natural
 * vehicle for testing the whole orchestration (ID uniqueness, nested
 * children, diagnostics, nativeness/rawRatio) without inventing a
 * throwaway fake mapping table this task would just have to delete later.
 * `WIDGET_NOT_AVAILABLE` is checked for real, against `siteProfile`'s
 * actual registered-widget list — the one site-dependent check this task
 * can do correctly without emission tables.
 *
 * A node type with no registered emitter for `siteProfile.generation`
 * produces an `EMISSION_NOT_IMPLEMENTED` diagnostic, not a silent skip or
 * a guess — matching `dslVersion`'s own "fail loudly, not partially apply"
 * rule (§2.1) and `parseSpec`'s all-or-nothing behavior (EMCP-048): a
 * single unimplemented or invalid node fails the *whole* compile
 * (`elements: []`), not a partial tree with that node missing.
 *
 * **`raw` supervision (EMCP-053, `./raw.js`) is wired in centrally, here,
 * after every emitter runs** — never per-emitter, per-generation. The
 * mechanics (deep merge, reserved-key denylist, §8.3 sanitisation) don't
 * vary by v3 vs v4, only where the merged result lands (`settings`, the
 * one place every generation keeps its own per-node data). A rejected
 * `raw` block is an error, following the same all-or-nothing rule as
 * everything else in this file.
 */

/**
 * §5.1: legacy is **read**-only — "Create: No." New content only ever
 * targets v3 (container) or v4, per solution.md §5.2's disambiguation
 * rule ("New top-level content → the site's own generation — V4 layout on
 * V4 sites, container on V3"). `siteProfile.generation` is therefore
 * narrower than `domain/detect.ts`'s full `Generation` (which also reads
 * `'legacy'` off existing content) — a compiler never emits legacy shapes.
 */
export type EmissionGeneration = 'v3' | 'v4';

/**
 * §3.1: "`siteProfile` comes from `get_site_info` and carries: generation
 * to emit, breakpoints, kit tokens, registered widget list, Pro tier,
 * active experiments." Field types mirror what those real tools already
 * return (`getSiteInfoTool`, `domain/curation.ts`'s `RawWidget`) rather
 * than inventing a parallel shape.
 */
/**
 * §2.9 / real `GET /site` shape (`plugin/src/Rest/SiteController.php`,
 * confirmed live on `wp-v4-pro`): `direction` is `'min'` for widescreen
 * and `'max'` for every other breakpoint — CLAUDE.md's own gotcha,
 * carried straight through rather than re-derived. `desktop` is
 * deliberately absent from this map (it's Elementor's implicit base case,
 * never itself a configurable named breakpoint) — a `responsive` key of
 * `"desktop"` is therefore always `BREAKPOINT_UNKNOWN`, correctly.
 */
export interface BreakpointConfig {
  enabled: boolean;
  direction: 'min' | 'max';
  value: number;
}

export interface SiteProfile {
  generation: EmissionGeneration;
  elementorVersion: string | null;
  breakpoints: Record<string, BreakpointConfig>;
  /**
   * Token name (without the `@`) → resolved reference. Exact resolution
   * shape is generation-dependent (§2.7) and genuinely unimplemented until
   * whichever of EMCP-050/051 first needs to emit `style.color`/etc. —
   * present here so that task doesn't need to touch `SiteProfile` itself.
   */
  kitTokens: Record<string, string>;
  widgetRegistry: RawWidget[];
  proTier: string;
  activeExperiments: Record<string, string>;
}

/** §3.3: the meta every compiled document needs, for the caller (e.g. a future `apply_page_spec`, EMCP-055) to actually write. */
export interface DocMeta {
  edit_mode: 'builder';
  /**
   * Elementor's own document-type key (`_elementor_template_type`) — always
   * `'wp-page'` today, since this compiler only targets whole-page specs
   * (`spec.page`) and every live document this project has inspected uses
   * that value for a Page document. Revisit if/when a spec can target a
   * non-page post type.
   */
  template_type: string;
  version: string | null;
  page_settings: Record<string, unknown>;
}

export interface CompileResult {
  elements: ElementorNode[];
  diagnostics: Diagnostic[];
  /** Fraction of nodes that are natively modeled — i.e. not the `html` escape rung (§2.3: "html — Non-native"). `1` for an empty tree. */
  nativeness: number;
  /** Fraction of nodes that used `raw` (§2.8: "every use is counted into raw_ratio"). `0` for an empty tree. */
  rawRatio: number;
  docMeta: DocMeta;
}

export interface EmitContext {
  siteProfile: SiteProfile;
  path: string;
  /**
   * The element's own id, generated *before* the emitter runs (EMCP-051
   * needed this: v4's local-class-name convention embeds the owning
   * element's id, e.g. `e-a7f4eea-c96ec15` — confirmed live in
   * `tests/fixtures/v4-atomic.json` — so the id has to exist before a v4
   * emitter can build its `classes`/`styles` output, not after). v3
   * emitters have no reason to reference it. `compile()` still owns
   * uniqueness (§3.3) — an emitter never generates its own id.
   */
  elementId: string;
}

/** What an emitter itself is responsible for — `compile()` owns `id`/`elements` (§3.3's whole-tree ID uniqueness and recursion) so no emitter can get either wrong. */
export interface EmittedElement {
  elType: string;
  widgetType?: string;
  settings?: Record<string, unknown>;
  styles?: unknown;
  version?: unknown;
  [key: string]: unknown;
}

export interface EmitOutcome {
  /** `null` on failure — `diagnostics` must then contain at least one `severity: 'error'` entry explaining why. */
  element: EmittedElement | null;
  diagnostics: Diagnostic[];
}

export type Emitter = (node: SpecNode, ctx: EmitContext) => EmitOutcome;

type EmitterKey = `${SpecNodeType}:${EmissionGeneration}`;

const emitterRegistry = new Map<EmitterKey, Emitter>();

function emitterKey(type: SpecNodeType, generation: EmissionGeneration): EmitterKey {
  return `${type}:${generation}`;
}

/** EMCP-050/051's registration point — see the module docblock. */
export function registerEmitter(nodeType: SpecNodeType, generation: EmissionGeneration, emitter: Emitter): void {
  emitterRegistry.set(emitterKey(nodeType, generation), emitter);
}

/** Test-only: restores a clean registry between tests that register fakes, matching this codebase's other test-isolation conventions. */
export function clearEmitters(): void {
  emitterRegistry.clear();
}

registerEmitter('widget', 'v3', emitWidgetNode);
registerEmitter('widget', 'v4', emitWidgetNode);

function emitWidgetNode(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'widget') {
    throw new Error(`emitWidgetNode called with node.type "${node.type}"`);
  }

  const exists = ctx.siteProfile.widgetRegistry.some((w) => w.name === node.widgetType);

  if (!exists) {
    const names = ctx.siteProfile.widgetRegistry.map((w) => w.name);
    return {
      element: null,
      diagnostics: [
        {
          path: `${ctx.path}.widgetType`,
          severity: 'error',
          code: 'WIDGET_NOT_AVAILABLE',
          message: `Widget "${node.widgetType}" is not registered on this site.`,
          allowed: names,
        },
      ],
    };
  }

  return {
    element: { elType: 'widget', widgetType: node.widgetType, settings: node.settings ?? {} },
    diagnostics: [],
  };
}

export function compile(spec: Spec, siteProfile: SiteProfile): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const usedIds = new Set<string>();

  const elements = compileNodes(spec.elements, 'elements', siteProfile, diagnostics, usedIds);

  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  const { total, htmlCount, rawCount } = countNodes(spec.elements);

  return {
    elements: hasErrors ? [] : elements,
    diagnostics,
    nativeness: total === 0 ? 1 : (total - htmlCount) / total,
    rawRatio: total === 0 ? 0 : rawCount / total,
    docMeta: {
      edit_mode: 'builder',
      template_type: 'wp-page',
      version: siteProfile.elementorVersion,
      page_settings: {},
    },
  };
}

function compileNodes(
  nodes: SpecNode[],
  basePath: string,
  siteProfile: SiteProfile,
  diagnostics: Diagnostic[],
  usedIds: Set<string>,
): ElementorNode[] {
  const compiled: ElementorNode[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    const path = `${basePath}[${i}]`;
    const emitter = emitterRegistry.get(emitterKey(node.type, siteProfile.generation));

    if (!emitter) {
      diagnostics.push({
        path: `${path}.type`,
        severity: 'error',
        code: 'EMISSION_NOT_IMPLEMENTED',
        message: `No compiler emitter is registered for "${node.type}" on ${siteProfile.generation}.`,
      });
      continue;
    }

    const elementId = generateUniqueId(usedIds);
    const outcome = emitter(node, { siteProfile, path, elementId });
    diagnostics.push(...outcome.diagnostics);

    if (!outcome.element) {
      continue;
    }

    let mergedElement = outcome.element;

    // §2.8 (EMCP-053): applied once, centrally, after every emitter —
    // never per-emitter, per-generation, since the mechanics (deep merge,
    // denylist, sanitisation) don't vary by generation, only where the
    // result lands (`settings`, every generation's own per-node data).
    if (node.raw !== undefined) {
      const { merged, diagnostics: rawDiagnostics } = mergeRaw(
        (outcome.element.settings as Record<string, unknown>) ?? {},
        node.raw,
        `${path}.raw`,
        siteProfile.generation,
      );
      diagnostics.push(...rawDiagnostics);
      mergedElement = { ...outcome.element, settings: merged };
    }

    const children = node.children
      ? compileNodes(node.children, `${path}.children`, siteProfile, diagnostics, usedIds)
      : [];

    const element: ElementorNode = {
      ...mergedElement,
      id: elementId,
      elements: children,
    };
    compiled.push(element);
  }

  return compiled;
}

/**
 * §3.3: "Element IDs are 7-char hex, unique across the **whole** tree
 * including nested widget children." One shared `usedIds` set threaded
 * through the entire recursive walk, not per-level — a collision between a
 * container and one of its own great-grandchildren is exactly the bug this
 * guards against. Regenerates on collision rather than failing; at 7 hex
 * chars (~268M values) a collision on any realistic page is astronomically
 * unlikely, but "assume it can't happen" is how style bleed (CLAUDE.md's
 * own gotcha) gets shipped.
 */
function generateUniqueId(usedIds: Set<string>): string {
  let id = randomHex7();
  while (usedIds.has(id)) {
    id = randomHex7();
  }
  usedIds.add(id);
  return id;
}

/**
 * Exported for v4 emitters (EMCP-051): the local-class-name suffix
 * (`e-<elementId>-<suffix>`, confirmed live in `tests/fixtures/
 * v4-atomic.json`) uses this exact same 7-hex-char shape. Deliberately
 * not uniqueness-checked against the tree's `usedIds` the way element ids
 * are (§3.3) — a v4 emitter has no access to that shared set, and a class
 * suffix colliding with another element's suffix (~1-in-268M per pair) is
 * a CSS-hygiene concern, not the structural correctness §3.3's own
 * uniqueness rule protects against (a duplicated *element* id, which
 * causes real style bleed — CLAUDE.md's gotcha).
 */
export function randomHex7(): string {
  return randomBytes(4).toString('hex').slice(0, 7);
}

/**
 * §2.9: "Keys are breakpoint names as configured on the target site...
 * Unknown breakpoint names are an error." Exported for EMCP-052's v3/v4
 * responsive emission — one shared check so both generations refuse the
 * same way, against the same real `siteProfile.breakpoints` map, rather
 * than each independently deciding what "known" means. A breakpoint
 * that exists but is `enabled: false` is treated as unknown too — a
 * disabled breakpoint has no real media query on this site, so a spec
 * targeting it is just as wrong as targeting a name that was never
 * configured at all.
 */
export function validateBreakpoint(name: string, siteProfile: SiteProfile, path: string): Diagnostic | null {
  const config = siteProfile.breakpoints[name];

  if (config && config.enabled) return null;

  const allowed = Object.entries(siteProfile.breakpoints)
    .filter(([, c]) => c.enabled)
    .map(([n]) => n);

  return {
    path,
    severity: 'error',
    code: 'BREAKPOINT_UNKNOWN',
    message: `"${name}" is not a configured, enabled breakpoint on this site.`,
    allowed,
  };
}

function countNodes(nodes: SpecNode[]): { total: number; htmlCount: number; rawCount: number } {
  let total = 0;
  let htmlCount = 0;
  let rawCount = 0;

  for (const node of nodes) {
    total += 1;
    if (node.type === 'html') htmlCount += 1;
    if (node.raw !== undefined) rawCount += 1;

    if (node.children) {
      const child = countNodes(node.children);
      total += child.total;
      htmlCount += child.htmlCount;
      rawCount += child.rawCount;
    }
  }

  return { total, htmlCount, rawCount };
}
