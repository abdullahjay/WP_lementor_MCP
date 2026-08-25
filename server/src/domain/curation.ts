/**
 * Turns the plugin's full, uncurated widget control list
 * (`GET /widgets/{type}`, EMCP-028) into what `describe_widget` actually
 * returns. Deliberately Node-side, not PHP — same rationale as
 * `detect.ts`'s generation rule (EMCP-019): this logic is genuinely
 * complex, benefits from real unit tests against realistic data, and
 * solution.md §6.1's "the plugin stays thin" applies here too. The plugin
 * hands over raw facts (every real control, its own `tab`, its exact
 * name); this module decides what's noise vs. signal.
 */

export interface RawControl {
  type: string;
  label?: string;
  default?: unknown;
  options?: Record<string, string>;
  condition?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  tab?: string;
}

export type RawControls = Record<string, RawControl>;

export interface RawWidget {
  name: string;
  title: string;
  categories: string[];
  keywords: string[];
  controls: RawControls;
}

export interface CuratedControl {
  name: string;
  type: string;
  label?: string;
  default?: unknown;
  options?: Record<string, string>;
  condition?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  tab?: string;
  /** True when at least one responsive breakpoint variant of this control was collapsed into it. */
  responsive?: boolean;
}

export type DetailLevel = 'common' | 'full' | `section:${string}`;

export interface CuratedWidget {
  name: string;
  title: string;
  categories: string[];
  keywords: string[];
  detail: DetailLevel;
  controls: CuratedControl[];
  total: number;
  truncated: number;
}

export interface CurateOptions {
  detail?: DetailLevel;
  /** Real breakpoint names from this site's own `get_site_info` (CLAUDE.md:
   * introspect Elementor, never hardcode breakpoint names). */
  breakpointNames: string[];
  offset?: number;
  limit?: number;
}

const DEFAULT_DETAIL: DetailLevel = 'common';
const DEFAULT_LIMIT = 40;

/**
 * A control named `<base>_<breakpointName>` is a responsive variant of
 * `<base>` (v3's storage convention, Blueprints.md §3.2). Elementor's own
 * `add_responsive_control()` registers one real control per active
 * breakpoint under exactly this naming pattern — collapsing them here
 * means "stated once, never enumerated" without hardcoding which
 * breakpoints exist (they're passed in, sourced from the live site).
 */
function collapseResponsiveVariants(controls: RawControls, breakpointNames: string[]): CuratedControl[] {
  const suffixPattern = breakpointNames.length > 0 ? new RegExp(`_(${breakpointNames.join('|')})$`) : null;

  const baseNames = new Set(Object.keys(controls));
  const responsiveBaseNames = new Set<string>();

  if (suffixPattern) {
    for (const name of Object.keys(controls)) {
      const match = suffixPattern.exec(name);
      if (!match) {
        continue;
      }
      const baseName = name.slice(0, match.index);
      if (baseNames.has(baseName)) {
        responsiveBaseNames.add(baseName);
        baseNames.delete(name); // the variant itself is dropped, not emitted separately
      }
    }
  }

  const result: CuratedControl[] = [];
  for (const name of baseNames) {
    const control = controls[name];
    if (!control) {
      continue;
    }
    result.push({
      name,
      type: control.type,
      ...(control.label !== undefined && { label: control.label }),
      ...(control.default !== undefined && { default: control.default }),
      ...(control.options !== undefined && { options: control.options }),
      ...(control.condition !== undefined && { condition: control.condition }),
      ...(control.conditions !== undefined && { conditions: control.conditions }),
      ...(control.tab !== undefined && { tab: control.tab }),
      ...(responsiveBaseNames.has(name) && { responsive: true }),
    });
  }

  return result;
}

/**
 * `common` is a heuristic, not a hand-authored per-widget-type list — with
 * 149+ widgets on one sandbox alone, and third-party/Pro widgets this
 * codebase has never seen, an exhaustive hand-curated table isn't
 * buildable now. Elementor's own `tab` grouping (every control already
 * carries one) stands in: the `content` tab is what a model almost always
 * needs to fill in a widget's primary settings, `style`/`advanced` are
 * secondary. Genuinely per-widget-type in effect (different widgets have
 * different content-tab controls) even though the rule generating it is
 * universal. Revisit with real hand curation if this heuristic proves too
 * coarse for a specific widget in practice.
 */
function filterByDetail(controls: CuratedControl[], detail: DetailLevel): CuratedControl[] {
  if (detail === 'full') {
    return controls;
  }

  if (detail === 'common') {
    return controls.filter((control) => control.tab === 'content');
  }

  const tab = detail.slice('section:'.length);
  return controls.filter((control) => control.tab === tab);
}

export function curateWidget(widget: RawWidget, options: CurateOptions): CuratedWidget {
  const detail = options.detail ?? DEFAULT_DETAIL;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;

  const collapsed = collapseResponsiveVariants(widget.controls, options.breakpointNames);
  const filtered = filterByDetail(collapsed, detail);
  const page = filtered.slice(offset, offset + limit);

  return {
    name: widget.name,
    title: widget.title,
    categories: widget.categories,
    keywords: widget.keywords,
    detail,
    controls: page,
    total: filtered.length,
    truncated: Math.max(0, filtered.length - (offset + page.length)),
  };
}
