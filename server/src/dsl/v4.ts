import { randomHex7, registerEmitter, validateBreakpoint, type EmitContext, type EmitOutcome } from './compile.js';
import type { BoxShorthand, DimensionValue, LayoutProps, StyleProps, SpecNode } from './types.js';

/**
 * EMCP-051 — Blueprints.md §3.2's v4 column, for real: registers a
 * `compile.ts` emitter for every node type this task could verify a real,
 * confident mapping for. Ground truth for v4 is **not** `GET /widgets/{type}`
 * the way v3's was (EMCP-050) — CLAUDE.md's own gotcha: atomic widgets'
 * `get_controls()` returns empty; their real schema lives in each widget
 * class's `define_props_schema()`, a PHP method, not introspectable through
 * anything this project has built. So every shape below was confirmed one
 * of two ways: (1) direct source reads of the real atomic-widget classes
 * (`modules/atomic-widgets/elements/**\/*.php`) and the shared style schema
 * (`modules/atomic-widgets/styles/style-schema.php`), or (2) the committed,
 * hash-checked fixtures (`tests/fixtures/v4-atomic.json` etc.) — never
 * inferred from v3's naming conventions or general Elementor familiarity.
 *
 * **The recursive `$$type`/`value` wrapping (§3.2's "the single most
 * likely v4 bug") is confirmed from source, not just observed in
 * fixtures**: `Plain_Prop_Type::validate()`/`Object_Prop_Type::validate()`
 * (`modules/atomic-widgets/prop-types/base/`) both require `is_transformable`
 * — every prop, at every nesting level, is stored as `{ $$type, value }`,
 * recursively, with no exception. `toTyped()` below is the one place that
 * wrapping happens, reused by every emitter, so it can only be gotten
 * right or wrong once.
 *
 * **A real gap found and fixed in `compile.ts` itself while building
 * this:** v4's local-class convention embeds the *owning element's own
 * id* (`e-<elementId>-<suffix>`, confirmed in `v4-atomic.json`) — but
 * `compile.ts`'s original design (EMCP-049) generated an element's id
 * *after* calling its emitter, since v3 emitters never needed it. Fixed
 * by generating the id first and passing it via `EmitContext.elementId` —
 * a real design gap EMCP-049 had no way to know about until a v4 emitter
 * actually needed it, closed here rather than worked around.
 *
 * Importing this module is what registers its emitters — `import
 * './v4.js'` (for its side effect) is required before `compile()` is
 * called against a `generation: 'v4'` `siteProfile`.
 */

registerEmitter('container', 'v4', emitFlexbox);
registerEmitter('heading', 'v4', emitHeading);
registerEmitter('text', 'v4', emitParagraph);
registerEmitter('button', 'v4', emitButton);
registerEmitter('image', 'v4', emitImage);
registerEmitter('divider', 'v4', emitDivider);

/**
 * §3.2: `container → elType: e-flexbox`. Confirmed live (`v4-atomic.json`):
 * `settings.classes = { $$type: "classes", value: [...] }`, `isInner`
 * (same convention as v3 — confirmed on the same fixture), `interactions:
 * []`, `editor_settings: []`, `version: "0.0"`. Layout properties are
 * **not** settings in v4 — they're local style props (`buildLocalStyle()`).
 *
 * **`display: flex` is forced into every container's local style,
 * unconditionally.** Confirmed live (a real 3-section page build): without
 * it, the container renders as a plain block, not a flex container — the
 * frontend CSS's own base rule is `.e-con{display:var(--display)}`, and
 * nothing in Elementor's generated CSS ever sets that custom property; a
 * container gets `display:flex` only from its own local style, which
 * `v4-atomic.json`'s uncustomized fixture never had a reason to carry
 * (nothing else about it was customized either). Forcing it here — the one
 * place every real container passes through — is what makes `flex-direction`/
 * `justify-content`/etc. actually take visual effect at all, not just
 * compile without error.
 */
function emitFlexbox(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'container') throw new Error('unreachable');

  return withLocalStyle(
    node,
    ctx,
    (classes) => {
      const settings: Record<string, unknown> = {};
      if (classes) settings['classes'] = toTyped('classes', classes);

      return {
        element: {
          elType: 'e-flexbox',
          settings,
          isInner: isNestedPath(ctx.path),
          interactions: [],
          editor_settings: [],
          version: '0.0',
        },
        diagnostics: [],
      };
    },
    { display: toTyped('string', 'flex') },
  );
}

/**
 * `heading → widgetType: e-heading`. `title` (`Html_V3_Prop_Type`, confirmed
 * both from `atomic-heading.php`'s schema and every fixture using it) and
 * `tag` (`String_Prop_Type`, enum `h1`–`h6`, confirmed from source) — the
 * DSL's `level` maps directly onto `tag`, matching the real prop's own
 * name and constraint.
 */
function emitHeading(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'heading') throw new Error('unreachable');

  const settings: Record<string, unknown> = { title: toHtmlV3(node.text) };
  if (node.level !== undefined) settings['tag'] = toTyped('string', `h${node.level}`);

  // No linkWarning() here — the DSL's HeadingNode has no `link` field
  // (Blueprints.md §2.3's table only gives heading `text`/`level`), even
  // though the real v4 e-heading widget's own schema supports one. That's
  // a grammar-layer scope decision (EMCP-048), not something this task
  // changes.
  return withLocalStyle(node, ctx, (classes) => {
    if (classes) settings['classes'] = toTyped('classes', classes);
    return { element: atomicWidgetElement('e-heading', settings), diagnostics: [] };
  });
}

/** `text → widgetType: e-paragraph`. `paragraph` (confirmed: `atomic-paragraph.php`'s real field name, matching `unicode-roundtrip.json`) and `tag` (enum `p`/`span`, default `p`). */
function emitParagraph(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'text') throw new Error('unreachable');

  const settings: Record<string, unknown> = { paragraph: toHtmlV3(node.html) };

  return withLocalStyle(node, ctx, (classes) => {
    if (classes) settings['classes'] = toTyped('classes', classes);
    return { element: atomicWidgetElement('e-paragraph', settings), diagnostics: [] };
  });
}

/** `button → widgetType: e-button`. `text` (confirmed: `atomic-button.php`) and `tag` (default `'button'`, no enum in source). */
function emitButton(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'button') throw new Error('unreachable');

  const settings: Record<string, unknown> = { text: toHtmlV3(node.text) };

  return withLocalStyle(node, ctx, (classes) => {
    if (classes) settings['classes'] = toTyped('classes', classes);
    return { element: atomicWidgetElement('e-button', settings), diagnostics: linkWarning(node, ctx) };
  });
}

/**
 * `image → widgetType: e-image`. Confirmed live from `atomic-image.php` +
 * `image-prop-type.php`/`image-src-prop-type.php`: `image` is `{ src: {
 * id | url, alt }, size }`. **v4 supports `alt` directly** — a real
 * improvement over v3, which had no `alt` control at all (EMCP-050).
 */
function emitImage(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'image') throw new Error('unreachable');

  const src: Record<string, unknown> = typeof node.src === 'number'
    ? { id: toTyped('image-attachment-id', node.src) }
    : { url: toTyped('url', node.src) };
  if (node.alt !== undefined) src['alt'] = toTyped('string', node.alt);

  const settings: Record<string, unknown> = {
    image: toTyped('image', { src: toTyped('image-src', src), size: toTyped('string', 'full') }),
  };

  return withLocalStyle(node, ctx, (classes) => {
    if (classes) settings['classes'] = toTyped('classes', classes);
    return { element: atomicWidgetElement('e-image', settings), diagnostics: linkWarning(node, ctx) };
  });
}

/** `divider → widgetType: e-divider`. Confirmed live (`atomic-divider.php`): no content props at all beyond `classes`/`attributes` — an empty divider needs no settings. */
function emitDivider(node: SpecNode, ctx: EmitContext): EmitOutcome {
  if (node.type !== 'divider') throw new Error('unreachable');

  return withLocalStyle(node, ctx, (classes) => {
    const settings: Record<string, unknown> = {};
    if (classes) settings['classes'] = toTyped('classes', classes);
    return { element: atomicWidgetElement('e-divider', settings), diagnostics: [] };
  });
}

function atomicWidgetElement(widgetType: string, settings: Record<string, unknown>): NonNullable<EmitOutcome['element']> {
  return { elType: 'widget', widgetType, settings, interactions: [], editor_settings: [], version: '0.0' };
}

/**
 * `link` (§2.3: button/icon/image all carry one) needs `Link_Prop_Type`'s
 * `destination` field — a `Union_Prop_Type` of `url`/`query` whose exact
 * wire shape wasn't confirmed by any fixture (every captured example only
 * ever showed the unset `{isTargetBlank: null}` default, never a real
 * destination). Rather than guess at a Union's serialization — exactly
 * the kind of nested-typed-prop mistake §3.2 warns is "the single most
 * likely v4 bug" — `link` is not emitted at all when given, and this
 * warns instead of silently dropping it.
 */
function linkWarning(node: SpecNode, ctx: EmitContext): EmitOutcome['diagnostics'] {
  if (!('link' in node) || node.link === undefined) return [];

  return [
    {
      path: `${ctx.path}.link`,
      severity: 'warning',
      code: 'NATIVENESS_LOW',
      message:
        'link is not applied on v4 — the real Link_Prop_Type "destination" field is a Union type whose exact wire shape has not been confirmed against real data, so nothing is emitted for it rather than guessing.',
    },
  ];
}

/**
 * Builds the local style class (`styles: { [class]: { id, label: "local",
 * type: "class", variants: [...] } }`, confirmed live) for whatever of
 * `layout`'s properties this task could confirm a real style-schema
 * mapping for (`modules/atomic-widgets/styles/style-schema.php`, read
 * directly), plus one additional variant per entry in `responsive`
 * (EMCP-052) — confirmed live (`tests/fixtures/responsive-widescreen.json`):
 * every breakpoint, including `widescreen`, is just another entry in the
 * same flat `variants` array, `{ meta: { breakpoint: <name>, state: null },
 * props, custom_css: null }` — there is no widescreen-specific shape to
 * get right here. The `min`-vs-`max` direction CLAUDE.md's gotcha warns
 * about is Elementor's own `Breakpoints_Manager` concern when it later
 * generates CSS from this data, not something this compiler's *output
 * shape* needs to branch on — confirmed by the fixture's own provenance
 * note ("the raw `_elementor_data` here only names the breakpoint... does
 * not itself say min-width vs max-width").
 *
 * §2.9: "Unknown breakpoint names are an error" — each `responsive` key
 * is checked against `siteProfile.breakpoints` via `compile.ts`'s shared
 * `validateBreakpoint()`, the same check EMCP-052 gives v3.
 *
 * Returns no `styles`/`classes` at all when there's nothing this emitter
 * knows how to map anywhere (desktop or responsive), matching every
 * uncustomized element in the fixtures (`styles: []`, `classes` absent).
 */
function withLocalStyle(
  node: SpecNode,
  ctx: EmitContext,
  build: (classes: string[] | null) => EmitOutcome,
  forcedDesktopProps?: Record<string, unknown>,
): EmitOutcome {
  const desktop = buildStyleProps(node.layout, node.style, ctx);
  const diagnostics: EmitOutcome['diagnostics'] = [...desktop.diagnostics];
  const variants: Record<string, unknown>[] = [];
  const desktopProps = { ...forcedDesktopProps, ...desktop.props };

  if (Object.keys(desktopProps).length > 0) {
    variants.push({ meta: { breakpoint: 'desktop', state: null }, props: desktopProps, custom_css: null });
  }

  for (const [breakpoint, override] of Object.entries(node.responsive ?? {})) {
    const breakpointPath = `${ctx.path}.responsive.${breakpoint}`;
    const diag = validateBreakpoint(breakpoint, ctx.siteProfile, breakpointPath);
    if (diag) {
      diagnostics.push(diag);
      continue;
    }

    const { props, diagnostics: propDiagnostics } = buildStyleProps(override.layout, override.style, {
      ...ctx,
      path: breakpointPath,
    });
    diagnostics.push(...propDiagnostics);
    if (Object.keys(props).length > 0) {
      variants.push({ meta: { breakpoint, state: null }, props, custom_css: null });
    }
  }

  if (variants.length === 0) {
    const outcome = build(null);
    return { element: outcome.element, diagnostics: [...diagnostics, ...outcome.diagnostics] };
  }

  const className = `e-${ctx.elementId}-${randomHex7()}`;
  const outcome = build([className]);

  if (!outcome.element) {
    return { element: null, diagnostics: [...diagnostics, ...outcome.diagnostics] };
  }

  return {
    element: {
      ...outcome.element,
      styles: { [className]: { id: className, label: 'local', type: 'class', variants } },
    },
    diagnostics: [...diagnostics, ...outcome.diagnostics],
  };
}

/**
 * §3.2's v4 style-schema mapping — every key confirmed against
 * `style-schema.php`: `flex-direction`/`flex-wrap`/`justify-content`/
 * `align-items` (`String_Prop_Type`), `gap`/`width`/`min-height`
 * (`Size_Prop_Type`, `{unit,size}` — confirmed live via `gap` in
 * `v4-atomic.json`), `padding`/`margin` (`Dimensions_Prop_Type` — **logical**
 * properties `block-start`/`inline-end`/`block-end`/`inline-start`, not
 * physical top/right/bottom/left; for LTR content these correspond
 * 1:1 to the DSL's own `[top, right, bottom, left]` box-shorthand order).
 *
 * `style` mapping added for the first time here — every key confirmed
 * against the same `style-schema.php` read live: `color`/`border-color`
 * (`Color_Prop_Type`, a bare `String_Prop_Type` subclass — `{$$type:
 * "color", value: "<css color>"}`), `font-family` (`Font_Family_Prop_Type`,
 * same bare-string shape), `font-weight`/`text-align`/`text-transform`/
 * `border-style` (`String_Prop_Type` enums), `font-size`/`line-height`/
 * `letter-spacing`/`border-width`/`border-radius` (`Size_Prop_Type` or a
 * `Union_Prop_Type` whose second member is a plain `Size_Prop_Type` for a
 * uniform value — the composite per-corner/per-side shape is deliberately
 * not used here), and `background` (`Object_Prop_Type` — `{$$type:
 * "background", value: { color: <Color> } }`, only the `color` sub-field
 * mapped; `background-overlay`/`clip` are real but out of this task's
 * scope). `box-shadow` is deliberately not mapped — not needed by the
 * brief this was built for, and its `Box_Shadow_Prop_Type` shape wasn't
 * read.
 */
function buildStyleProps(
  layout: LayoutProps | undefined,
  style: StyleProps | undefined,
  ctx: EmitContext,
): { props: Record<string, unknown>; diagnostics: EmitOutcome['diagnostics'] } {
  const props: Record<string, unknown> = {};
  const diagnostics: EmitOutcome['diagnostics'] = [];

  if (layout) {
    if (layout.direction !== undefined) props['flex-direction'] = toTyped('string', layout.direction);
    if (layout.wrap !== undefined) props['flex-wrap'] = toTyped('string', layout.wrap ? 'wrap' : 'nowrap');
    if (layout.justify !== undefined) props['justify-content'] = toTyped('string', JUSTIFY_MAP[layout.justify]);
    if (layout.align !== undefined) props['align-items'] = toTyped('string', ALIGN_MAP[layout.align]);
    if (layout.gap !== undefined) props['gap'] = toSize(layout.gap);
    if (layout.padding !== undefined) props['padding'] = toDimensions(layout.padding);
    if (layout.margin !== undefined) props['margin'] = toDimensions(layout.margin);
    if (layout.width !== undefined) {
      if (typeof layout.width === 'number' || /^-?[\d.]+[a-z%]*$/.test(layout.width.trim())) {
        props['width'] = toSize(layout.width);
      } else {
        diagnostics.push({
          path: `${ctx.path}.layout.width`,
          severity: 'warning',
          code: 'NATIVENESS_LOW',
          message: `layout.width "${layout.width}" is not applied on v4 — only a numeric size (e.g. "1200px"/"50%") maps to the real "width" style prop; keyword values like "full"/"boxed" don't have a v4 equivalent (that's a v3 content_width concept).`,
        });
      }
    }
    if (layout.minHeight !== undefined) props['min-height'] = toSize(layout.minHeight);
    if (layout.maxWidth !== undefined) props['max-width'] = toSize(layout.maxWidth);
    if (layout.position !== undefined) props['position'] = toTyped('string', layout.position);
    if (layout.overflow !== undefined) props['overflow'] = toTyped('string', layout.overflow);
  }

  if (style) {
    if (style.color !== undefined) props['color'] = toTyped('color', style.color);
    if (style.opacity !== undefined) props['opacity'] = toTyped('size', { unit: '%', size: style.opacity * 100 });
    if (style.radius !== undefined) props['border-radius'] = toSize(style.radius);

    if (style.border) {
      if (style.border.width !== undefined) props['border-width'] = toSize(style.border.width);
      if (style.border.color !== undefined) props['border-color'] = toTyped('color', style.border.color);
      if (style.border.style !== undefined) props['border-style'] = toTyped('string', style.border.style);
    }

    if (style.background?.color !== undefined) {
      props['background'] = toTyped('background', { color: toTyped('color', style.background.color) });
    }

    if (style.typography) {
      const t = style.typography;
      if (t.family !== undefined) props['font-family'] = toTyped('font-family', t.family);
      if (t.weight !== undefined) props['font-weight'] = toTyped('string', String(t.weight));
      if (t.size !== undefined) props['font-size'] = toSize(t.size);
      if (t.lineHeight !== undefined) props['line-height'] = toLineHeight(t.lineHeight);
      if (t.letterSpacing !== undefined) props['letter-spacing'] = toSize(t.letterSpacing);
      if (t.transform !== undefined) props['text-transform'] = toTyped('string', t.transform);
      if (t.align !== undefined) {
        const mapped = TEXT_ALIGN_MAP[t.align] ?? t.align;
        props['text-align'] = toTyped('string', mapped);
      }
    }
  }

  return { props, diagnostics };
}

/** DSL `TypographyProps.align` is a free string (`left`/`right`/etc.); the real `text-align` enum is `start`/`center`/`end`/`justify`. */
const TEXT_ALIGN_MAP: Record<string, string> = {
  left: 'start',
  right: 'end',
  center: 'center',
  justify: 'justify',
  start: 'start',
  end: 'end',
};

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

/** The one place every prop gets its `{ $$type, value }` wrapper (see module docblock — confirmed from `Plain_Prop_Type`/`Object_Prop_Type`'s own `validate()` source, not just fixture pattern-matching). */
function toTyped(type: string, value: unknown): { $$type: string; value: unknown } {
  return { $$type: type, value };
}

/** `Html_V3_Prop_Type`'s real shape — confirmed identical across every fixture using it (heading/paragraph/button all share it). */
function toHtmlV3(content: string): { $$type: string; value: { content: unknown; children: unknown[] } } {
  return toTyped('html-v3', { content: toTyped('string', content), children: [] }) as ReturnType<typeof toHtmlV3>;
}

/**
 * `line-height`'s real unit list (`size-constants.php`: `typography` preset)
 * includes `'custom'` — a unitless ratio (the CSS convention for tight,
 * editorial line-heights like `0.95`). A bare number/unitless string here
 * means that ratio, not pixels — unlike `toSize()`'s default elsewhere,
 * where §2.6 defines a bare number as px. Only a value carrying an
 * explicit unit suffix (`"24px"`) falls back to normal size parsing.
 */
function toLineHeight(value: DimensionValue): { $$type: string; value: { unit: string; size: number } } {
  if (typeof value === 'number') return toTyped('size', { unit: 'custom', size: value }) as ReturnType<typeof toSize>;

  const trimmed = value.trim();
  if (/^-?[\d.]+$/.test(trimmed)) {
    return toTyped('size', { unit: 'custom', size: Number(trimmed) }) as ReturnType<typeof toSize>;
  }

  return toSize(value);
}

/** `size` — confirmed live (`gap`/`font-size` in `v4-atomic.json`): `{ unit, size }`, no `sizes: []` (that's v3's SLIDER-control quirk, not v4's). */
function toSize(value: DimensionValue): { $$type: string; value: { unit: string; size: number } } {
  if (typeof value === 'number') return toTyped('size', { unit: 'px', size: value }) as ReturnType<typeof toSize>;

  const match = /^(-?[\d.]+)([a-z%]*)$/.exec(value.trim());
  if (!match) return toTyped('size', { unit: 'px', size: 0 }) as ReturnType<typeof toSize>;

  return toTyped('size', { unit: match[2] || 'px', size: Number(match[1]) }) as ReturnType<typeof toSize>;
}

/**
 * `dimensions` — confirmed live source (`dimensions-prop-type.php`):
 * logical properties, each independently `size`-typed. §2.6's box
 * shorthand `[top, right, bottom, left]` maps 1:1 onto
 * `[block-start, inline-end, block-end, inline-start]` for LTR content.
 */
function toDimensions(box: BoxShorthand): {
  $$type: string;
  value: { 'block-start': unknown; 'inline-end': unknown; 'block-end': unknown; 'inline-start': unknown };
} {
  const [top, right, bottom, left] = expandBox(box);

  return toTyped('dimensions', {
    'block-start': toSize(top),
    'inline-end': toSize(right),
    'block-end': toSize(bottom),
    'inline-start': toSize(left),
  }) as ReturnType<typeof toDimensions>;
}

function expandBox(box: BoxShorthand): [DimensionValue, DimensionValue, DimensionValue, DimensionValue] {
  if (box.length === 1) return [box[0]!, box[0]!, box[0]!, box[0]!];
  if (box.length === 2) return [box[0]!, box[1]!, box[0]!, box[1]!];
  return [box[0]!, box[1]!, box[2]!, box[3]!];
}

function isNestedPath(path: string): boolean {
  return path.includes('.children[');
}

/**
 * Deliberately deferred, not registered — each for a specific reason:
 *
 * - **`grid`**: needs `e-grid`'s own `define_props_schema()`/style-schema
 *   entries, not read within this task's time budget.
 * - **`icon`/`list`/`video`/`spacer`/`shortcode`/`html`**: `GET
 *   /wp-json/emcp/v1/widgets` (live, `wp-v4-pro`) confirms the real v4
 *   atomic widget set is exactly `e-button, e-component, e-divider,
 *   e-heading, e-image, e-paragraph, e-self-hosted-video, e-svg,
 *   e-youtube` — there is **no v4 icon or spacer widget at all**, no
 *   plain list widget (same repeater-shape problem v3's `list` has), and
 *   video is split across `e-self-hosted-video`/`e-youtube` (needing the
 *   same URL-type detection v3's `video` deferred for). `shortcode`/`html`
 *   have no atomic equivalent confirmed to exist — v3's `shortcode`/`html`
 *   widgets are legacy `Controls_Stack` widgets, usable on a v4 site via
 *   the DSL's own `widget` escape rung (already generation-agnostic,
 *   `compile.ts`'s own built-in emitter) rather than needing a v4-specific
 *   mapping here at all.
 * - **`style.background.image`/`.position`/`.size`, `style.border.width`
 *   as a per-side value, `style.shadow`**: `style.color`, `.opacity`,
 *   `.radius`, `.border.{width,color,style}` (uniform, not per-side), and
 *   `.background.color`, plus every `.typography` field, ARE now mapped
 *   (added after this module's initial build — see `buildStyleProps()`'s
 *   own docblock for the confirmed shapes). Background images/overlays and
 *   box-shadow were not read/mapped.
 * - **`link` (button/heading/image)**: see `linkWarning()` above — the
 *   real `Union_Prop_Type` destination shape isn't confirmed.
 *
 * `responsive` (EMCP-052) is implemented for every emitter here, since
 * they all route through `withLocalStyle()`, including `responsive.<bp>.style`
 * now that `style` itself is mapped.
 */
