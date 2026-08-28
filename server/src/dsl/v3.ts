import { registerEmitter, validateBreakpoint, type EmitContext, type EmitOutcome } from './compile.js';
import type { BoxShorthand, DimensionValue, LayoutProps, SpecNode } from './types.js';

/**
 * EMCP-050 — Blueprints.md §3.2's v3 column, for real: registers a
 * `compile.ts` emitter for every node type this task could verify a real,
 * confident mapping for, against **live-introspected control names**
 * (`GET /widgets/{type}` against `wp-v4-pro`, EMCP-028) and the committed
 * fixtures (`tests/fixtures/*.json`, EMCP-008/009, hash-checked and
 * agent-immutable) — never guessed from Elementor's general reputation for
 * control-naming conventions. Every setting key and value shape below is
 * one of those two things, not an assumption; where research ran out of
 * confidence before the task did, the node type is left unregistered
 * (`EMISSION_NOT_IMPLEMENTED`, EMCP-049) rather than shipping a plausible
 * guess. See "Deliberately deferred" at the bottom of this file for the
 * exact list and why each one specifically.
 *
 * Importing this module is what registers its emitters — `import
 * './v3.js'` (for its side effect) is required before `compile()` is
 * called against a `generation: 'v3'` `siteProfile`, same as any other
 * registry-population module in this codebase.
 */

registerEmitter('container', 'v3', emitContainer);
registerEmitter('heading', 'v3', emitHeading);
registerEmitter('text', 'v3', emitText);
registerEmitter('button', 'v3', emitButton);
registerEmitter('icon', 'v3', emitIcon);
registerEmitter('image', 'v3', emitImage);
registerEmitter('spacer', 'v3', emitSpacer);
registerEmitter('divider', 'v3', emitDivider);
registerEmitter('shortcode', 'v3', emitShortcode);
registerEmitter('html', 'v3', emitHtml);

/**
 * §3.2: `container → elType: container`. Real control names confirmed
 * live against `container.php` (Elementor 4.2.3) and cross-checked
 * against `tests/fixtures/v3-container.json`/`deep-nested.json`, which is
 * also where `isInner` (`false` for a document's own top-level elements,
 * `true` for every container nested inside another) was confirmed —
 * `compile.ts` doesn't track nesting depth for its own purposes, so this
 * emitter derives it from `ctx.path`: a path with no `.children[` segment
 * is top-level.
 *
 * `responsive` (EMCP-052) reuses `buildFlexSettings()` once per breakpoint,
 * merging suffixed keys (`flex_gap_tablet`, confirmed live: Elementor's
 * own responsive controls append `_<breakpoint>`) into the same settings
 * object desktop's unsuffixed keys already live in — no separate structure,
 * matching how a real Elementor-authored responsive container actually
 * stores it (one flat `settings` object, base keys plus suffixed overrides).
 */
function emitContainer(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'container') throw new Error('unreachable');

  const { settings, diagnostics } = buildFlexSettings(node.layout, undefined, ctx.path);

  for (const [breakpoint, override] of Object.entries(node.responsive ?? {})) {
    const breakpointPath = `${ctx.path}.responsive.${breakpoint}`;
    const diag = validateBreakpoint(breakpoint, ctx.siteProfile, breakpointPath);
    if (diag) {
      diagnostics.push(diag);
      continue;
    }

    const suffixed = buildFlexSettings(override.layout, breakpoint, breakpointPath);
    Object.assign(settings, suffixed.settings);
    diagnostics.push(...suffixed.diagnostics);
  }

  return { element: { elType: 'container', settings, isInner: isNestedPath(ctx.path) }, diagnostics };
}

/** Everything `emitContainer` maps from one `LayoutProps`, at either desktop (`suffix` undefined) or one responsive breakpoint (`suffix` = the breakpoint name). */
function buildFlexSettings(
  layout: LayoutProps | undefined,
  suffix: string | undefined,
  path: string,
): { settings: Record<string, unknown>; diagnostics: EmitOutcome['diagnostics'] } {
  const settings: Record<string, unknown> = {};
  const diagnostics: EmitOutcome['diagnostics'] = [];
  const key = (base: string): string => (suffix ? `${base}_${suffix}` : base);

  if (!layout) return { settings, diagnostics };

  if (layout.direction !== undefined) settings[key('flex_direction')] = layout.direction;
  if (layout.wrap !== undefined) settings[key('flex_wrap')] = layout.wrap ? 'wrap' : 'nowrap';
  if (layout.justify !== undefined) settings[key('flex_justify_content')] = JUSTIFY_MAP[layout.justify];
  if (layout.align !== undefined) settings[key('flex_align_items')] = ALIGN_MAP[layout.align];
  if (layout.gap !== undefined) settings[key('flex_gap')] = toGaps(layout.gap);
  if (layout.padding !== undefined) settings[key('padding')] = toDimensions(layout.padding);
  if (layout.margin !== undefined) settings[key('margin')] = toDimensions(layout.margin);
  if (layout.minHeight !== undefined) settings[key('min_height')] = toSize(layout.minHeight);

  const widthDiag = applyContainerWidth(layout, settings, key, path);
  if (widthDiag) diagnostics.push(widthDiag);

  return { settings, diagnostics };
}

/**
 * `content_width` is a plain `'boxed'|'full'` SELECT control (confirmed
 * live) — a DSL `width` of `"1200px"`/`"50%"` has no confirmed v3
 * mapping (it would need `boxed_width`, a *second*, conditionally-shown
 * control this task didn't verify the exact shape of) — reported as a
 * warning, not silently dropped and not a hard error, since the container
 * still compiles correctly without it.
 */
function applyContainerWidth(
  layout: LayoutProps,
  settings: Record<string, unknown>,
  key: (base: string) => string,
  path: string,
): EmitOutcome['diagnostics'][number] | undefined {
  if (layout.width === undefined) return undefined;

  if (layout.width === 'full' || layout.width === 'boxed') {
    settings[key('content_width')] = layout.width;
    return undefined;
  }

  return {
    path: `${path}.layout.width`,
    severity: 'warning',
    code: 'NATIVENESS_LOW',
    message: `layout.width "${layout.width}" is not applied on v3 — only "full"/"boxed" have a confirmed mapping; an exact size needs the container's "boxed_width" control, not yet implemented.`,
  };
}

/** §3.2: `heading → widgetType: heading`. `header_size` (`h1`–`h6`) and `title` confirmed live. */
function emitHeading(node: SpecNode, _ctx: EmitContext): EmitOutcome {
  if (node.type !== 'heading') throw new Error('unreachable');

  const settings: Record<string, unknown> = { title: node.text };
  if (node.level !== undefined) settings['header_size'] = `h${node.level}`;

  return { element: { elType: 'widget', widgetType: 'heading', settings }, diagnostics: [] };
}

/** §3.2: `text → widgetType: text-editor`. `editor` confirmed live — the widget's real setting key for its HTML content. */
function emitText(node: SpecNode, _ctx: EmitContext): EmitOutcome {
  if (node.type !== 'text') throw new Error('unreachable');

  return {
    element: { elType: 'widget', widgetType: 'text-editor', settings: { editor: node.html } },
    diagnostics: [],
  };
}

/** §3.2: `button → widgetType: button`. `text` confirmed live (matches the DSL's own field name); `link` wrapped into the real `url` control shape. */
function emitButton(node: SpecNode, _ctx: EmitContext): EmitOutcome {
  if (node.type !== 'button') throw new Error('unreachable');

  const settings: Record<string, unknown> = { text: node.text };
  if (node.link !== undefined) settings['link'] = toLinkControl(node.link);

  return { element: { elType: 'widget', widgetType: 'button', settings }, diagnostics: [] };
}

/**
 * `icon → widgetType: icon`. `selected_icon` (confirmed live: `{ value,
 * library }`) and `link` (wrapped) confirmed live. The DSL's `name` field
 * (a bare string, §2.3) is assumed to already be a full Font Awesome class
 * string (e.g. `"fas fa-star"`) — its library prefix maps to Elementor's
 * real library slugs; an unrecognized/missing prefix defaults to
 * `fa-solid` and is flagged as a warning, not a hard failure, since
 * `describe_widget`/`get_global_styles`-level icon-library enumeration
 * doesn't exist yet to validate against.
 */
function emitIcon(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'icon') throw new Error('unreachable');

  const diagnostics: EmitOutcome['diagnostics'] = [];
  const prefix = node.name.split(' ')[0] ?? '';
  const library = ICON_LIBRARY_PREFIXES[prefix];

  if (!library) {
    diagnostics.push({
      path: `${ctx.path}.name`,
      severity: 'warning',
      code: 'NATIVENESS_LOW',
      message: `Icon "${node.name}" doesn't start with a recognized Font Awesome prefix (fas/far/fab/fal/fad) — defaulting to the "fa-solid" library, which may not match.`,
    });
  }

  const settings: Record<string, unknown> = { selected_icon: { value: node.name, library: library ?? 'fa-solid' } };
  if (node.link !== undefined) settings['link'] = toLinkControl(node.link);

  return { element: { elType: 'widget', widgetType: 'icon', settings }, diagnostics };
}

/**
 * `image → widgetType: image`. `image` (confirmed live: `{ url, id }`)
 * and `link` (wrapped) confirmed live. `alt` has **no confirmed v3
 * mapping** — the image widget's own control list has no `alt` control at
 * all (confirmed live); real Elementor reads alt text from the attachment
 * itself when `src` is a media id. Reported as a warning when given, same
 * as `layout.width`'s unsupported-value case, rather than silently
 * dropped.
 */
function emitImage(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'image') throw new Error('unreachable');

  const diagnostics: EmitOutcome['diagnostics'] = [];
  const settings: Record<string, unknown> = {
    image: typeof node.src === 'number' ? { id: node.src, url: '' } : { id: '', url: node.src },
  };
  if (node.link !== undefined) settings['link'] = toLinkControl(node.link);
  if (node.alt !== undefined) {
    diagnostics.push({
      path: `${ctx.path}.alt`,
      severity: 'warning',
      code: 'NATIVENESS_LOW',
      message:
        'alt text is not applied on v3 — the image widget has no "alt" setting; real Elementor reads it from the attachment itself when src is a media id.',
    });
  }

  return { element: { elType: 'widget', widgetType: 'image', settings }, diagnostics };
}

/** `spacer → widgetType: spacer`. `space` (confirmed live) takes the SLIDER shape (`{ unit, size, sizes: [] }`). */
function emitSpacer(node: SpecNode, _ctx: EmitContext): EmitOutcome {
  if (node.type !== 'spacer') throw new Error('unreachable');

  return {
    element: { elType: 'widget', widgetType: 'spacer', settings: { space: toSize(node.size) } },
    diagnostics: [],
  };
}

/** `divider → widgetType: divider`. No DSL fields (§2.3) — Elementor's own defaults render a sensible plain rule. */
function emitDivider(_node: SpecNode, _ctx: EmitContext): EmitOutcome {
  return { element: { elType: 'widget', widgetType: 'divider', settings: {} }, diagnostics: [] };
}

/** `shortcode → widgetType: shortcode`. `shortcode` confirmed live — matches the DSL's own field name exactly. */
function emitShortcode(node: SpecNode, _ctx: EmitContext): EmitOutcome {
  if (node.type !== 'shortcode') throw new Error('unreachable');

  return {
    element: { elType: 'widget', widgetType: 'shortcode', settings: { shortcode: node.shortcode } },
    diagnostics: [],
  };
}

/** `html → widgetType: html`. `html` confirmed live — matches the DSL's own field name exactly. */
function emitHtml(node: SpecNode, _ctx: EmitContext): EmitOutcome {
  if (node.type !== 'html') throw new Error('unreachable');

  return { element: { elType: 'widget', widgetType: 'html', settings: { html: node.html } }, diagnostics: [] };
}

const JUSTIFY_MAP: Record<NonNullable<LayoutProps['justify']>, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
};

const ALIGN_MAP: Record<NonNullable<LayoutProps['align']>, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
};

const ICON_LIBRARY_PREFIXES: Record<string, string> = {
  fas: 'fa-solid',
  far: 'fa-regular',
  fab: 'fa-brands',
  fal: 'fa-light',
  fad: 'fa-duotone',
};

/** Elementor's real SLIDER/SIZE control value shape (confirmed live via `typography_font_size` in `tests/fixtures/mixed-legacy-v3.json`). */
function toSize(value: DimensionValue): { unit: string; size: number; sizes: unknown[] } {
  if (typeof value === 'number') return { unit: 'px', size: value, sizes: [] };

  const match = /^(-?[\d.]+)([a-z%]*)$/.exec(value.trim());
  if (!match) return { unit: 'px', size: 0, sizes: [] };

  return { unit: match[2] || 'px', size: Number(match[1]), sizes: [] };
}

/** Elementor's real DIMENSIONS control value shape — CSS shorthand (§2.6) expanded to four explicit sides. */
function toDimensions(box: BoxShorthand): { unit: string; top: string; right: string; bottom: string; left: string; isLinked: boolean } {
  const [top, right, bottom, left] = expandBox(box);
  const unit = firstUnit(box) ?? 'px';

  return {
    unit,
    top: String(numericPart(top)),
    right: String(numericPart(right)),
    bottom: String(numericPart(bottom)),
    left: String(numericPart(left)),
    isLinked: top === right && right === bottom && bottom === left,
  };
}

/** Elementor's real GAPS control value shape — one DSL `gap` value applies to both axes. */
function toGaps(value: DimensionValue): { unit: string; column: string; row: string; isLinked: boolean } {
  const size = toSize(value);
  return { unit: size.unit, column: String(size.size), row: String(size.size), isLinked: true };
}

function toLinkControl(url: string): { url: string; is_external: string; nofollow: string; custom_attributes: string } {
  return { url, is_external: '', nofollow: '', custom_attributes: '' };
}

/** §2.6: `[all]`, `[vertical, horizontal]`, or `[top, right, bottom, left]`. */
function expandBox(box: BoxShorthand): [DimensionValue, DimensionValue, DimensionValue, DimensionValue] {
  if (box.length === 1) return [box[0]!, box[0]!, box[0]!, box[0]!];
  if (box.length === 2) return [box[0]!, box[1]!, box[0]!, box[1]!];
  return [box[0]!, box[1]!, box[2]!, box[3]!];
}

function firstUnit(box: BoxShorthand): string | undefined {
  for (const v of box) {
    if (typeof v === 'string') {
      const match = /^-?[\d.]+([a-z%]+)$/.exec(v.trim());
      if (match) return match[1];
    }
  }
  return undefined;
}

function numericPart(value: DimensionValue): number {
  if (typeof value === 'number') return value;
  const match = /^(-?[\d.]+)/.exec(value.trim());
  return match ? Number(match[1]) : 0;
}

function isNestedPath(path: string): boolean {
  return path.includes('.children[');
}

/**
 * Deliberately deferred, not registered — each for a specific, verified
 * reason, not "ran out of time" hand-waving:
 *
 * - **`grid`**: §3.2 says `container` + grid-specific settings, but
 *   `container` isn't a widget (`GET /widgets/{type}` doesn't cover it),
 *   so its real control names aren't introspectable the way every widget
 *   above was — would need reading `Group_Control_Grid_Container`'s
 *   source the same way `flex-container.php` was read here, not done
 *   within this task.
 * - **`list`**: Elementor's real "Icon List" widget (`icon-list`) uses a
 *   REPEATER control (`icon_list`) where every item independently carries
 *   its own icon selection — there is no plain-text-list widget confirmed
 *   to exist. Mapping the DSL's flat `items: string[]` onto that shape
 *   needs a real per-item icon default decision this task didn't make.
 * - **`video`**: the real `video` widget's URL field is one of six
 *   type-specific keys (`youtube_url`/`vimeo_url`/`dailymotion_url`/
 *   `hosted_url`/`external_url`/`videopress_url`) selected by a
 *   `video_type` control — the DSL's single `src` field would need
 *   reliable URL-pattern detection this task didn't build or verify.
 *
 * `responsive` (EMCP-052) is implemented only for `container`'s
 * `layout`-derived settings — the only place this file maps `layout` to
 * anything in the first place. A content widget's `responsive.<bp>.style`
 * has no effect (matching `style` being deferred entirely at desktop too,
 * not a separate gap introduced by EMCP-052).
 */
