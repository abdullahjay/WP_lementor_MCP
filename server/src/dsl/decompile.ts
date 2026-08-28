import { detectNodeGeneration, UnknownElementTypeError, type ElementorNode, type Generation } from '../domain/detect.js';
import type { Diagnostic } from '../domain/validate.js';
import type { SiteProfile } from './compile.js';
import type { BoxShorthand, LayoutProps, SpecNode } from './types.js';

/**
 * EMCP-054 — Blueprints.md §4: `decompile(nativeElements, siteProfile) →
 * spec`. Needed for three things (§4's own words): `save_as_template`
 * storing specs rather than frozen native JSON, round-trip fixture
 * testing, and letting the model edit a page it didn't author.
 *
 * **"It is lossy by design... never byte equality" is the whole
 * architecture here, not a caveat bolted on afterward.** Every reverse
 * mapping below inverts exactly the same confirmed shapes `v3.ts`/`v4.ts`
 * already forward-map (EMCP-050/051) — no new research, since the ground
 * truth is identical in both directions. Anything this module doesn't
 * recognize — an unmapped widget type, unmapped settings on an otherwise-
 * recognized node, a legacy `section`/`column` (§5.1: legacy is
 * **read**-only; the DSL has no legacy container type to decompile *to*
 * at all) — falls back to the DSL's own `widget` escape rung (verbatim,
 * therefore **lossless** — `compile()`'s built-in `widget` emitter
 * round-trips it exactly) or `raw` (§2.8's supervised merge, so it's
 * still denylist/sanitisation-checked on the way back through `compile()`
 * — decompiled content isn't exempt from §2.8's own rules just because it
 * came from a real page).
 *
 * **Deliberately never fails the way `compile()`/`parseSpec()` do.**
 * Those two exist to catch a *spec author's* mistake before it's written
 * — refusing outright is correct there. `decompile()`'s job is the
 * opposite: make *whatever a real page already contains* editable, even
 * when it's ugly. Every diagnostic here is `warning`/`info` severity,
 * never `error` — there is no way to "fail" decompiling a page that
 * genuinely exists.
 *
 * `siteProfile` is accepted per §4's own signature but not yet used by
 * anything in this module — reverse token resolution (`@primary` ←
 * a kit color id) needs it, but forward token resolution was never
 * implemented either (EMCP-050/051 both deferred `style`/color mapping
 * entirely), so there is nothing yet for this direction to reverse.
 */
export interface DecompileResult {
  elements: SpecNode[];
  diagnostics: Diagnostic[];
}

export function decompile(
  nativeElements: ElementorNode[],
  _siteProfile: SiteProfile,
  parentGeneration?: Generation,
): DecompileResult {
  const diagnostics: Diagnostic[] = [];
  const elements = nativeElements.map((node, i) =>
    decompileNode(node, parentGeneration, `elements[${i}]`, diagnostics),
  );

  return { elements, diagnostics };
}

function decompileNode(
  node: ElementorNode,
  parentGeneration: Generation | undefined,
  path: string,
  diagnostics: Diagnostic[],
): SpecNode {
  let generation: Generation;
  try {
    generation = detectNodeGeneration(node, parentGeneration);
  } catch (error) {
    if (error instanceof UnknownElementTypeError) {
      diagnostics.push({
        path: `${path}.elType`,
        severity: 'warning',
        code: 'NATIVENESS_LOW',
        message: `Unrecognized elType "${node.elType}" — preserved verbatim via "raw" on a generic container.`,
      });
      return rawFallback('container', node, path, `unrecognized native elType "${node.elType}"`);
    }
    throw error;
  }

  const children = decompileChildren(node, generation, path, diagnostics);

  if (generation === 'legacy') {
    diagnostics.push({
      path,
      severity: 'warning',
      code: 'NATIVENESS_LOW',
      message: `Legacy "${node.elType}" has no DSL layout equivalent (§5.1: legacy is read-only) — preserved verbatim via "raw" on a generic container.`,
    });
    return withChildren(rawFallback('container', node, path, `legacy ${node.elType}, no DSL equivalent`), children);
  }

  if (node.elType === 'container' || node.elType === 'e-flexbox') {
    return withChildren(decompileContainer(node, generation, path, diagnostics), children);
  }

  if (node.elType === 'widget') {
    return withChildren(decompileWidget(node, generation, path, diagnostics), children);
  }

  // Any other v4 layout elType (e-grid, e-div-block, ...) — no DSL "grid"
  // reverse mapping exists yet (compile.ts's own v4.ts never registered
  // one forward either), so this is genuinely unrecognized content, not a
  // gap specific to decompiling.
  diagnostics.push({
    path: `${path}.elType`,
    severity: 'warning',
    code: 'NATIVENESS_LOW',
    message: `"${node.elType}" has no DSL layout equivalent yet — preserved verbatim via "raw" on a generic container.`,
  });
  return withChildren(rawFallback('container', node, path, `"${node.elType}" has no DSL equivalent yet`), children);
}

function withChildren(node: SpecNode, children: SpecNode[] | undefined): SpecNode {
  return children ? { ...node, children } : node;
}

function decompileChildren(
  node: ElementorNode,
  generation: Generation,
  path: string,
  diagnostics: Diagnostic[],
): SpecNode[] | undefined {
  if (!node.elements || node.elements.length === 0) return undefined;

  // §5.5 / §5.2: a non-atomic v3 widget's own children stay whatever
  // generation the *parent* already resolved to — the same
  // disambiguation rule `detectNodeGeneration` itself documents.
  return node.elements.map((child, i) =>
    decompileNode(child, generation, `${path}.children[${i}]`, diagnostics),
  );
}

function decompileContainer(
  node: ElementorNode,
  generation: Generation,
  path: string,
  diagnostics: Diagnostic[],
): SpecNode {
  const settings = isRecord(node['settings']) ? node['settings'] : {};

  if (generation === 'v3') {
    const { layout, consumed } = reverseFlexSettingsV3(settings);
    const remainder = omit(settings, consumed);
    return withRawRemainder({ type: 'container', ...(hasKeys(layout) && { layout }) }, remainder, path, diagnostics);
  }

  // v4: layout properties live in the local style's desktop variant, not settings.
  const styles = isRecord(node['styles']) ? node['styles'] : {};
  const classes = extractClasses(settings);
  const { layout, responsive, unmapped } = reverseStylePropsV4(styles, classes);

  for (const prop of unmapped) {
    diagnostics.push({
      path: `${path}.styles`,
      severity: 'info',
      code: 'NATIVENESS_LOW',
      message: `Style property "${prop}" has no DSL "layout"/"style" reverse mapping yet — not preserved.`,
    });
  }

  const node2: SpecNode = {
    type: 'container',
    ...(hasKeys(layout) && { layout }),
    ...(responsive && Object.keys(responsive).length > 0 && { responsive }),
  };
  return node2;
}

function decompileWidget(
  node: ElementorNode,
  generation: Generation,
  path: string,
  diagnostics: Diagnostic[],
): SpecNode {
  const widgetType = node.widgetType ?? '';
  const settings = isRecord(node['settings']) ? node['settings'] : {};

  const reverser = generation === 'v4' ? V4_WIDGET_REVERSERS[widgetType] : V3_WIDGET_REVERSERS[widgetType];

  if (!reverser) {
    // The DSL's own generic escape rung — lossless, since compile.ts's
    // built-in "widget" emitter passes settings through verbatim too.
    return { type: 'widget', widgetType, settings };
  }

  const { node: specFields, consumed } = reverser(settings);
  const remainder = omit(settings, consumed);
  return withRawRemainder(specFields, remainder, path, diagnostics);
}

function withRawRemainder(
  node: Partial<SpecNode> & { type: SpecNode['type'] },
  remainder: Record<string, unknown>,
  path: string,
  diagnostics: Diagnostic[],
): SpecNode {
  if (Object.keys(remainder).length === 0) {
    return node as SpecNode;
  }

  diagnostics.push({
    path: `${path}.raw`,
    severity: 'info',
    code: 'NATIVENESS_LOW',
    message: `${Object.keys(remainder).length} native setting(s) not modeled by the DSL, preserved via "raw": ${Object.keys(remainder).join(', ')}.`,
  });

  return {
    ...node,
    raw: remainder,
    reason: 'decompiled: preserving native settings this compiler doesn\'t model as DSL fields',
  } as SpecNode;
}

function rawFallback(type: 'container', node: ElementorNode, _path: string, reason: string): SpecNode {
  const { elType, widgetType, elements: _elements, id: _id, ...rest } = node;
  return {
    type,
    raw: { elType, ...(widgetType !== undefined && { widgetType }), ...rest },
    reason: `decompiled: ${reason}`,
  };
}

// ---------------------------------------------------------------------------
// v3 reverse mappings — exact inverses of v3.ts's confirmed forward shapes.
// ---------------------------------------------------------------------------

function reverseFlexSettingsV3(settings: Record<string, unknown>): { layout: LayoutProps; consumed: string[] } {
  const layout: LayoutProps = {};
  const consumed: string[] = [];

  const take = (key: string): unknown => {
    if (key in settings) {
      consumed.push(key);
      return settings[key];
    }
    return undefined;
  };

  const direction = take('flex_direction');
  if (direction === 'row' || direction === 'column') layout.direction = direction;

  const wrap = take('flex_wrap');
  if (wrap === 'wrap' || wrap === 'nowrap') layout.wrap = wrap === 'wrap';

  const justify = take('flex_justify_content');
  const reversedJustify = typeof justify === 'string' ? JUSTIFY_REVERSE[justify] : undefined;
  if (reversedJustify !== undefined) layout.justify = reversedJustify;

  const align = take('flex_align_items');
  const reversedAlign = typeof align === 'string' ? ALIGN_REVERSE[align] : undefined;
  if (reversedAlign !== undefined) layout.align = reversedAlign;

  const gap = take('flex_gap');
  const gapSize = reverseGaps(gap);
  if (gapSize !== undefined) layout.gap = gapSize;

  const padding = take('padding');
  const paddingBox = reverseDimensions(padding);
  if (paddingBox) layout.padding = paddingBox;

  const margin = take('margin');
  const marginBox = reverseDimensions(margin);
  if (marginBox) layout.margin = marginBox;

  const minHeight = take('min_height');
  const minHeightSize = reverseSize(minHeight);
  if (minHeightSize !== undefined) layout.minHeight = String(minHeightSize);

  const contentWidth = take('content_width');
  if (contentWidth === 'full' || contentWidth === 'boxed') layout.width = contentWidth;

  return { layout, consumed };
}

const JUSTIFY_REVERSE: Record<string, NonNullable<LayoutProps['justify']>> = {
  'flex-start': 'start',
  center: 'center',
  'flex-end': 'end',
  'space-between': 'between',
  'space-around': 'around',
};

const ALIGN_REVERSE: Record<string, NonNullable<LayoutProps['align']>> = {
  'flex-start': 'start',
  center: 'center',
  'flex-end': 'end',
  stretch: 'stretch',
};

function unitSuffix(unit: unknown): string {
  return typeof unit === 'string' ? unit : '';
}

function reverseSize(value: unknown): string | number | undefined {
  if (!isRecord(value)) return undefined;
  const size = value['size'];
  const unit = value['unit'];
  if (typeof size !== 'number') return undefined;
  return unit === 'px' || unit === undefined ? size : `${size}${unitSuffix(unit)}`;
}

function reverseGaps(value: unknown): string | number | undefined {
  if (!isRecord(value)) return undefined;
  const column = value['column'];
  const unit = value['unit'];
  const size = typeof column === 'string' ? Number(column) : column;
  if (typeof size !== 'number' || Number.isNaN(size)) return undefined;
  return unit === 'px' || unit === undefined ? size : `${size}${unitSuffix(unit)}`;
}

function reverseDimensions(value: unknown): BoxShorthand | undefined {
  if (!isRecord(value)) return undefined;
  const { top, right, bottom, left, unit } = value;
  if ([top, right, bottom, left].some((v) => typeof v !== 'string' && typeof v !== 'number')) return undefined;

  const withUnit = (v: unknown): string | number => {
    const n = typeof v === 'string' ? Number(v) : (v as number);
    return unit === 'px' || unit === undefined ? n : `${n}${unitSuffix(unit)}`;
  };

  return [withUnit(top), withUnit(right), withUnit(bottom), withUnit(left)];
}

type WidgetReverser = (settings: Record<string, unknown>) => {
  node: Partial<SpecNode> & { type: SpecNode['type'] };
  consumed: string[];
};

const V3_WIDGET_REVERSERS: Record<string, WidgetReverser> = {
  heading: (settings) => {
    const consumed = ['title'];
    const level = settings['header_size'];
    if (typeof level === 'string') consumed.push('header_size');
    return {
      node: {
        type: 'heading',
        text: typeof settings['title'] === 'string' ? settings['title'] : '',
        ...(typeof level === 'string' && /^h[1-6]$/.test(level) && { level: Number(level[1]) as 1 | 2 | 3 | 4 | 5 | 6 }),
      },
      consumed,
    };
  },
  'text-editor': (settings) => ({
    node: { type: 'text', html: typeof settings['editor'] === 'string' ? settings['editor'] : '' },
    consumed: ['editor'],
  }),
  button: (settings) => {
    const consumed = ['text'];
    const link = extractLinkUrl(settings['link']);
    if (settings['link'] !== undefined) consumed.push('link');
    return {
      node: { type: 'button', text: typeof settings['text'] === 'string' ? settings['text'] : '', ...(link && { link }) },
      consumed,
    };
  },
  icon: (settings) => {
    const consumed: string[] = [];
    const selectedIcon = settings['selected_icon'];
    let name = '';
    if (isRecord(selectedIcon) && typeof selectedIcon['value'] === 'string') {
      name = selectedIcon['value'];
      consumed.push('selected_icon');
    }
    const link = extractLinkUrl(settings['link']);
    if (settings['link'] !== undefined) consumed.push('link');
    return { node: { type: 'icon', name, ...(link && { link }) }, consumed };
  },
  image: (settings) => {
    const consumed: string[] = [];
    const image = settings['image'];
    let src: number | string = '';
    if (isRecord(image)) {
      consumed.push('image');
      if (typeof image['id'] === 'number' && image['id'] !== 0) src = image['id'];
      else if (typeof image['url'] === 'string' && image['url'] !== '') src = image['url'];
    }
    const link = extractLinkUrl(settings['link']);
    if (settings['link'] !== undefined) consumed.push('link');
    return { node: { type: 'image', src, ...(link && { link }) }, consumed };
  },
  spacer: (settings) => {
    const size = reverseSize(settings['space']);
    return { node: { type: 'spacer', size: size ?? 0 }, consumed: ['space'] };
  },
  divider: () => ({ node: { type: 'divider' }, consumed: [] }),
  shortcode: (settings) => ({
    node: { type: 'shortcode', shortcode: typeof settings['shortcode'] === 'string' ? settings['shortcode'] : '' },
    consumed: ['shortcode'],
  }),
  html: (settings) => ({
    node: { type: 'html', html: typeof settings['html'] === 'string' ? settings['html'] : '', reason: 'decompiled from a native html widget' },
    consumed: ['html'],
  }),
};

function extractLinkUrl(value: unknown): string | undefined {
  if (isRecord(value) && typeof value['url'] === 'string' && value['url'] !== '') return value['url'];
  return undefined;
}

// ---------------------------------------------------------------------------
// v4 reverse mappings — exact inverses of v4.ts's confirmed forward shapes.
// ---------------------------------------------------------------------------

const V4_WIDGET_REVERSERS: Record<string, WidgetReverser> = {
  'e-heading': (settings) => {
    const consumed = ['title'];
    const tag = unwrapTyped(settings['tag']);
    if (settings['tag'] !== undefined) consumed.push('tag');
    return {
      node: {
        type: 'heading',
        text: unwrapHtmlV3(settings['title']) ?? '',
        ...(typeof tag === 'string' && /^h[1-6]$/.test(tag) && { level: Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6 }),
      },
      consumed,
    };
  },
  'e-paragraph': (settings) => ({
    node: { type: 'text', html: unwrapHtmlV3(settings['paragraph']) ?? '' },
    consumed: ['paragraph'],
  }),
  'e-button': (settings) => ({
    node: { type: 'button', text: unwrapHtmlV3(settings['text']) ?? '' },
    consumed: ['text'],
  }),
  'e-image': (settings) => {
    const consumed = ['image'];
    const image = unwrapTyped(settings['image']);
    let src: number | string = '';
    let alt: string | undefined;
    if (isRecord(image)) {
      const srcValue = unwrapTyped(image['src']);
      if (isRecord(srcValue)) {
        const id = unwrapTyped(srcValue['id']);
        const url = unwrapTyped(srcValue['url']);
        const altValue = unwrapTyped(srcValue['alt']);
        if (typeof id === 'number') src = id;
        else if (typeof url === 'string' && url !== '') src = url;
        if (typeof altValue === 'string' && altValue !== '') alt = altValue;
      }
    }
    return { node: { type: 'image', src, ...(alt !== undefined && { alt }) }, consumed };
  },
  'e-divider': () => ({ node: { type: 'divider' }, consumed: [] }),
};

/** Unwraps one level of `{ $$type, value }` (confirmed shape, `v4.ts`'s `toTyped()`). */
function unwrapTyped(value: unknown): unknown {
  if (isRecord(value) && '$$type' in value && 'value' in value) return value['value'];
  return value;
}

/** `html-v3`'s real shape: `{content:{$$type:"string",value},children:[]}` — confirmed live across every fixture using it. */
function unwrapHtmlV3(value: unknown): string | undefined {
  const inner = unwrapTyped(value);
  if (!isRecord(inner)) return undefined;
  const content = unwrapTyped(inner['content']);
  return typeof content === 'string' ? content : undefined;
}

function extractClasses(settings: Record<string, unknown>): string[] {
  const classes = unwrapTyped(settings['classes']);
  return Array.isArray(classes) ? classes.filter((c): c is string => typeof c === 'string') : [];
}

/** Reverses `withLocalStyle()`'s output: desktop's variant → `layout`, every other breakpoint's variant → `responsive.<breakpoint>.layout`. Style props with no reverse mapping are reported via `unmapped`, not silently dropped. */
function reverseStylePropsV4(
  styles: Record<string, unknown>,
  classes: string[],
): { layout: LayoutProps; responsive: Record<string, { layout: LayoutProps }> | undefined; unmapped: string[] } {
  let layout: LayoutProps = {};
  const responsive: Record<string, { layout: LayoutProps }> = {};
  const unmapped: string[] = [];

  for (const className of classes) {
    const styleDef = styles[className];
    if (!isRecord(styleDef) || !Array.isArray(styleDef['variants'])) continue;

    for (const variant of styleDef['variants']) {
      if (!isRecord(variant) || !isRecord(variant['meta']) || !isRecord(variant['props'])) continue;
      const breakpoint = variant['meta']['breakpoint'];
      const { layout: variantLayout, unmapped: variantUnmapped } = reverseStylePropsOneVariant(variant['props']);
      unmapped.push(...variantUnmapped);

      if (breakpoint === 'desktop') {
        layout = { ...layout, ...variantLayout };
      } else if (typeof breakpoint === 'string') {
        responsive[breakpoint] = { layout: variantLayout };
      }
    }
  }

  return { layout, responsive: Object.keys(responsive).length > 0 ? responsive : undefined, unmapped };
}

const V4_STYLE_PROP_KEYS = ['flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'padding', 'margin', 'width', 'min-height'];

function reverseStylePropsOneVariant(props: Record<string, unknown>): { layout: LayoutProps; unmapped: string[] } {
  const layout: LayoutProps = {};
  const unmapped: string[] = [];

  const direction = unwrapTyped(props['flex-direction']);
  if (direction === 'row' || direction === 'column') layout.direction = direction;

  const wrap = unwrapTyped(props['flex-wrap']);
  if (wrap === 'wrap' || wrap === 'nowrap') layout.wrap = wrap === 'wrap';

  const justify = unwrapTyped(props['justify-content']);
  const reversedJustify = typeof justify === 'string' ? JUSTIFY_REVERSE[justify] : undefined;
  if (reversedJustify !== undefined) layout.justify = reversedJustify;

  const align = unwrapTyped(props['align-items']);
  const reversedAlign = typeof align === 'string' ? ALIGN_REVERSE[align] : undefined;
  if (reversedAlign !== undefined) layout.align = reversedAlign;

  const gap = reverseTypedSize(props['gap']);
  if (gap !== undefined) layout.gap = gap;

  const width = reverseTypedSize(props['width']);
  if (width !== undefined) layout.width = String(width);

  const minHeight = reverseTypedSize(props['min-height']);
  if (minHeight !== undefined) layout.minHeight = String(minHeight);

  const padding = reverseTypedDimensions(props['padding']);
  if (padding) layout.padding = padding;

  const margin = reverseTypedDimensions(props['margin']);
  if (margin) layout.margin = margin;

  for (const key of Object.keys(props)) {
    if (!V4_STYLE_PROP_KEYS.includes(key)) unmapped.push(key);
  }

  return { layout, unmapped };
}

function reverseTypedSize(value: unknown): string | number | undefined {
  const inner = unwrapTyped(value);
  if (!isRecord(inner)) return undefined;
  const size = inner['size'];
  const unit = inner['unit'];
  if (typeof size !== 'number') return undefined;
  return unit === 'px' || unit === undefined ? size : `${size}${unitSuffix(unit)}`;
}

function reverseTypedDimensions(value: unknown): BoxShorthand | undefined {
  const inner = unwrapTyped(value);
  if (!isRecord(inner)) return undefined;
  const top = reverseTypedSize(inner['block-start']);
  const right = reverseTypedSize(inner['inline-end']);
  const bottom = reverseTypedSize(inner['block-end']);
  const left = reverseTypedSize(inner['inline-start']);
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) return undefined;
  return [top, right, bottom, left];
}

// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

function omit(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result = { ...record };
  for (const key of keys) delete result[key];
  return result;
}
