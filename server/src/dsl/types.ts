/**
 * Blueprints.md §2 — the DSL grammar, as TypeScript types. Pure type
 * definitions only; `validate.ts` is where structural correctness is
 * actually checked at runtime. Kept separate so the shape a compiler
 * (EMCP-049+) programs against is readable without wading through
 * validation logic.
 *
 * These types describe what a **well-formed** spec looks like once
 * `validate.ts` has accepted it — `unknown` is always the real input type
 * for anything arriving over MCP.
 */

/** §2.3 — deliberately small and CSS/HTML-shaped. */
export type SpecNodeType =
  | 'container'
  | 'grid'
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'icon'
  | 'list'
  | 'video'
  | 'divider'
  | 'spacer'
  | 'widget'
  | 'shortcode'
  | 'html';

export const SPEC_NODE_TYPES: readonly SpecNodeType[] = [
  'container',
  'grid',
  'heading',
  'text',
  'image',
  'button',
  'icon',
  'list',
  'video',
  'divider',
  'spacer',
  'widget',
  'shortcode',
  'html',
];

/** §2.1 — the only page templates Elementor itself offers for this purpose. */
export type PageTemplate = 'elementor_canvas' | 'elementor_header_footer' | 'elementor_theme' | 'default';

/**
 * §2.6 — a bare number is px; a string carries its own unit
 * (`"2rem"`, `"50%"`, `"auto"`, `"100vh"`).
 */
export type DimensionValue = number | string;

/**
 * §2.6 — CSS-shorthand box values: `[all]`, `[vertical, horizontal]`, or
 * `[top, right, bottom, left]`. Any other array length is a grammar error,
 * checked in `validate.ts` (a type alone can't express "length 1, 2, or 4").
 */
export type BoxShorthand = DimensionValue[];

/** §2.4 */
export interface LayoutProps {
  direction?: 'row' | 'column';
  wrap?: boolean;
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  align?: 'start' | 'center' | 'end' | 'stretch';
  gap?: DimensionValue;
  padding?: BoxShorthand;
  margin?: BoxShorthand;
  width?: string;
  minHeight?: string;
  /** grid only — the compiler (EMCP-049+), not this grammar layer, enforces that. */
  columns?: number;
}

/** §2.5 */
export interface BackgroundProps {
  color?: string;
  /** A media id (number) or a URL (string) — same duality as `image.src`. */
  image?: number | string;
  position?: string;
  size?: string;
}

export interface BorderProps {
  width?: DimensionValue;
  color?: string;
  style?: string;
}

export interface TypographyProps {
  size?: DimensionValue;
  weight?: number;
  lineHeight?: DimensionValue;
  letterSpacing?: string;
  family?: string;
  transform?: string;
  align?: string;
}

export interface StyleProps {
  /** A literal (hex/`rgb()`) or a `@token` reference (§2.7) — resolved by the compiler, not this layer. */
  color?: string;
  background?: BackgroundProps;
  border?: BorderProps;
  radius?: DimensionValue;
  shadow?: string;
  opacity?: number;
  typography?: TypographyProps;
}

/**
 * §2.9 — keyed by breakpoint name **as configured on the target site**.
 * Validating that a given key is a real breakpoint needs `siteProfile`
 * (§3.1), which this grammar layer never sees — that check is the
 * compiler's job (`BREAKPOINT_UNKNOWN`, §8.2). Grammar validation only
 * confirms each value is a well-formed partial `{ layout?, style? }`.
 */
export type ResponsiveOverrides = Record<string, { layout?: LayoutProps; style?: StyleProps }>;

interface SpecNodeBase {
  type: SpecNodeType;
  /** Spec-local stable handle (§2.2) — never written into Elementor, never an Elementor id. */
  ref?: string;
  label?: string;
  layout?: LayoutProps;
  style?: StyleProps;
  responsive?: ResponsiveOverrides;
  children?: SpecNode[];
  /** §2.8 — supervised merge into compiled settings. Requires `reason`. */
  raw?: Record<string, unknown>;
  /** Required when `raw` is present or `type` is `"html"`. */
  reason?: string;
}

export interface HeadingNode extends SpecNodeBase {
  type: 'heading';
  text: string;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface TextNode extends SpecNodeBase {
  type: 'text';
  /** Restricted inline markup (§8.3's sanitisation rules apply at compile time). */
  html: string;
}

export interface ImageNode extends SpecNodeBase {
  type: 'image';
  /** A media id (number) or a URL (string). */
  src: number | string;
  alt?: string;
  link?: string;
}

export interface ButtonNode extends SpecNodeBase {
  type: 'button';
  text: string;
  link?: string;
  icon?: string;
}

export interface IconNode extends SpecNodeBase {
  type: 'icon';
  name: string;
  link?: string;
}

export interface ListNode extends SpecNodeBase {
  type: 'list';
  items: string[];
  ordered?: boolean;
}

export interface VideoNode extends SpecNodeBase {
  type: 'video';
  src: string;
  poster?: string;
  autoplay?: boolean;
}

export interface DividerNode extends SpecNodeBase {
  type: 'divider';
}

export interface SpacerNode extends SpecNodeBase {
  type: 'spacer';
  size: DimensionValue;
}

export interface ContainerNode extends SpecNodeBase {
  type: 'container';
}

export interface GridNode extends SpecNodeBase {
  type: 'grid';
}

/**
 * §2.3: "Any registry widget the DSL doesn't model" — reaches the full
 * installed registry (Free/Pro/third-party) at full nativeness. Whether
 * `widgetType` actually exists on the target site needs `siteProfile`
 * (`WIDGET_NOT_AVAILABLE`, EMCP-049+'s job) — this layer only checks shape.
 */
export interface WidgetNode extends SpecNodeBase {
  type: 'widget';
  widgetType: string;
  settings?: Record<string, unknown>;
}

/**
 * §2.3 lists `shortcode` as a native wrapper for third-party-plugin
 * capability but doesn't spell out its field — inferred here as the raw
 * shortcode string (`[gallery ids="1,2,3"]`) as the simplest, most literal
 * reading. Revisit if a real spec author needs something richer.
 */
export interface ShortcodeNode extends SpecNodeBase {
  type: 'shortcode';
  shortcode: string;
}

export interface HtmlNode extends SpecNodeBase {
  type: 'html';
  html: string;
  /** Always required for `html` (§2.3: "Non-native. Requires `reason`"). */
  reason: string;
}

export type SpecNode =
  | ContainerNode
  | GridNode
  | HeadingNode
  | TextNode
  | ImageNode
  | ButtonNode
  | IconNode
  | ListNode
  | VideoNode
  | DividerNode
  | SpacerNode
  | WidgetNode
  | ShortcodeNode
  | HtmlNode;

/** §2.1 */
export interface SpecPage {
  title: string;
  template?: PageTemplate;
  /** Draft only — publishing is a separate tool (`publish_draft`). */
  status?: 'draft';
}

/**
 * §2.1 — the spec root. `dslVersion` is mandatory and the compiler (and
 * this grammar layer) refuses unknown versions rather than guessing.
 */
export interface Spec {
  dslVersion: 1;
  page: SpecPage;
  elements: SpecNode[];
}

/** The only `dslVersion` this grammar currently accepts. */
export const SUPPORTED_DSL_VERSIONS: readonly number[] = [1];
