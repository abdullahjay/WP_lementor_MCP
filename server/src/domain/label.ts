/**
 * Blueprints.md §5's label resolution, in order: the Navigator title if
 * set; else the first text-bearing setting; else the type name. Every
 * result is sanitised regardless of which branch resolved it —
 * solution.md §9.1's "neutralise on ingest": site-derived text (a page
 * copy, a filename, a template name) flows into model context in a
 * session holding write authority, so it is treated as an instruction
 * channel until proven otherwise. Stripping markup/zero-width
 * characters/newlines and truncating to 40 characters is the structural
 * mitigation — this module does not attempt semantic prompt-injection
 * detection, which solution.md §9.1 doesn't ask for either.
 */
import type { ElementorNode } from './detect.js';

const MAX_LABEL_LENGTH = 40;

// Elementor's own "Custom CSS ID"-style advanced-tab field that becomes
// the element's Navigator title when set.
const NAVIGATOR_TITLE_KEY = '_title';

const MARKUP_PATTERN = /<[^>]*>/g;
const NEWLINE_PATTERN = /[\r\n]+/g;

// Built from explicit numeric code points (U+200B ZWSP, U+200C ZWNJ,
// U+200D ZWJ, U+FEFF BOM/ZWNBSP) rather than a literal character class in
// source — an invisible character typed directly into a source file is
// exactly the kind of thing that silently corrupts on copy/paste/re-encoding.
const ZERO_WIDTH_CODE_POINTS = [0x200b, 0x200c, 0x200d, 0xfeff];
const ZERO_WIDTH_PATTERN = new RegExp(
  ZERO_WIDTH_CODE_POINTS.map((code) => `\\u${code.toString(16).padStart(4, '0')}`).join('|'),
  'g',
);

export function sanitizeLabel(raw: string): string {
  const stripped = raw
    .replace(MARKUP_PATTERN, '')
    .replace(ZERO_WIDTH_PATTERN, '')
    .replace(NEWLINE_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return stripped.slice(0, MAX_LABEL_LENGTH);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Unwraps a v4 typed prop down to its underlying string, or returns a
 * plain v3 string as-is. Handles exactly the two shapes seen in real
 * fixtures (§3.2): a flat scalar, and `{"$$type":"html-v3","value":{"content":{"$$type":"string","value":"…"}}}`.
 * Anything else (links, colors, classes, numeric sizes) is not text and
 * is skipped, not guessed at.
 */
function unwrapTextValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  if (value['$$type'] === 'string' && typeof value['value'] === 'string' && value['value'].length > 0) {
    return value['value'];
  }

  if (value['$$type'] === 'html-v3' && isPlainObject(value['value'])) {
    const content = value['value']['content'];
    if (isPlainObject(content) && content['$$type'] === 'string' && typeof content['value'] === 'string') {
      return content['value'];
    }
  }

  return undefined;
}

function extractNavigatorTitle(settings: unknown): string | undefined {
  if (!isPlainObject(settings)) {
    return undefined;
  }

  const title = settings[NAVIGATOR_TITLE_KEY];
  return typeof title === 'string' && title.trim().length > 0 ? title : undefined;
}

// A setting's *key* has to look text-bearing before its string value is
// trusted as one — without this, an enum-ish flat v3 setting like
// `align: "start"` or a hex `primary_color` string gets picked up as if it
// were real copy, which is wrong: those aren't content, they're
// configuration that happens to be string-typed. Matches on the whole key
// or its last `_`-separated segment, so both `title` and `button_text`
// (or v4's un-prefixed equivalents) qualify.
const TEXT_BEARING_KEY_PATTERN = /(?:^|_)(title|text|content|caption|description|alt|html)$/i;

function extractFirstTextSetting(settings: unknown): string | undefined {
  // Empty settings serialize as `[]`, not `{}` (CLAUDE.md) — isPlainObject
  // rejects the array case, so this returns undefined rather than throwing.
  if (!isPlainObject(settings)) {
    return undefined;
  }

  for (const [key, value] of Object.entries(settings)) {
    if (key === NAVIGATOR_TITLE_KEY || !TEXT_BEARING_KEY_PATTERN.test(key)) {
      continue;
    }
    const text = unwrapTextValue(value);
    if (text !== undefined) {
      return text;
    }
  }

  return undefined;
}

export function resolveLabel(node: ElementorNode, typeName: string): string {
  const navigatorTitle = extractNavigatorTitle(node.settings);
  if (navigatorTitle !== undefined) {
    return sanitizeLabel(navigatorTitle);
  }

  const textSetting = extractFirstTextSetting(node.settings);
  if (textSetting !== undefined) {
    return sanitizeLabel(textSetting);
  }

  return sanitizeLabel(typeName);
}
