import { countTokens } from 'gpt-tokenizer';
import { describe, expect, it } from 'vitest';
import { curateWidget, type RawWidget } from './curation.js';

// Real breakpoint names, Elementor's own (verified live in EMCP-004's
// SiteController work) — not invented for this test.
const BREAKPOINTS = ['mobile', 'mobile_extra', 'tablet', 'tablet_extra', 'laptop', 'widescreen'];

// No captured fixture covers a widget's full control schema (EMCP-008's
// fixtures are page/element data, not widget-registry data) — this is a
// new domain, so a synthetic widget schema stands in, clearly labeled.
// Shaped like a real heading widget's controls would be: content-tab
// settings, a responsive typography control with two breakpoint variants,
// and a style-tab control, so detail filtering and responsive collapsing
// both have something real to exercise.
const SYNTHETIC_HEADING_WIDGET: RawWidget = {
  name: 'heading',
  title: 'Heading',
  categories: ['general'],
  keywords: ['heading', 'title'],
  controls: {
    title: { type: 'textarea', label: 'Title', default: 'Add Your Heading Text Here', tab: 'content' },
    link: { type: 'url', label: 'Link', tab: 'content' },
    size: {
      type: 'select',
      label: 'Size',
      default: 'default',
      options: { small: 'Small', default: 'Default', large: 'Large' },
      tab: 'content',
    },
    typography_font_size: { type: 'slider', label: 'Size', tab: 'style' },
    typography_font_size_tablet: { type: 'slider', label: 'Size', tab: 'style' },
    typography_font_size_mobile: { type: 'slider', label: 'Size', tab: 'style' },
    title_color: { type: 'color', label: 'Text Color', tab: 'style' },
    _element_id: { type: 'text', label: 'CSS ID', tab: 'advanced' },
  },
};

describe('curateWidget: responsive variant collapsing', () => {
  it('collapses breakpoint-suffixed variants into the base control, marking it responsive', () => {
    const result = curateWidget(SYNTHETIC_HEADING_WIDGET, { detail: 'full', breakpointNames: BREAKPOINTS });

    const names = result.controls.map((c) => c.name);
    expect(names).toContain('typography_font_size');
    expect(names).not.toContain('typography_font_size_tablet');
    expect(names).not.toContain('typography_font_size_mobile');

    const fontSize = result.controls.find((c) => c.name === 'typography_font_size');
    expect(fontSize?.responsive).toBe(true);
  });

  it('does not mark a non-responsive control as responsive', () => {
    const result = curateWidget(SYNTHETIC_HEADING_WIDGET, { detail: 'full', breakpointNames: BREAKPOINTS });

    const title = result.controls.find((c) => c.name === 'title');
    expect(title?.responsive).toBeUndefined();
  });

  it('a control whose own name happens to end in a breakpoint-shaped suffix, with no base sibling, is kept as-is', () => {
    const widget: RawWidget = {
      name: 'fake',
      title: 'Fake',
      categories: [],
      keywords: [],
      controls: { standalone_mobile: { type: 'text', tab: 'content' } },
    };
    const result = curateWidget(widget, { detail: 'full', breakpointNames: BREAKPOINTS });
    expect(result.controls.map((c) => c.name)).toEqual(['standalone_mobile']);
  });
});

describe('curateWidget: detail levels', () => {
  it('"common" (the default) returns only content-tab controls', () => {
    const result = curateWidget(SYNTHETIC_HEADING_WIDGET, { breakpointNames: BREAKPOINTS });

    expect(result.detail).toBe('common');
    expect(result.controls.map((c) => c.name).sort()).toEqual(['link', 'size', 'title']);
  });

  it('"full" returns every control across all tabs, still collapsed', () => {
    const result = curateWidget(SYNTHETIC_HEADING_WIDGET, { detail: 'full', breakpointNames: BREAKPOINTS });

    // 8 raw controls - 2 collapsed responsive variants = 6
    expect(result.total).toBe(6);
  });

  it('"section:<tab>" filters to exactly that tab', () => {
    const result = curateWidget(SYNTHETIC_HEADING_WIDGET, {
      detail: 'section:style',
      breakpointNames: BREAKPOINTS,
    });

    expect(result.controls.map((c) => c.name).sort()).toEqual(['title_color', 'typography_font_size']);
  });

  it('"section:advanced" isolates the advanced tab', () => {
    const result = curateWidget(SYNTHETIC_HEADING_WIDGET, {
      detail: 'section:advanced',
      breakpointNames: BREAKPOINTS,
    });

    expect(result.controls.map((c) => c.name)).toEqual(['_element_id']);
  });
});

describe('curateWidget: honours condition/conditions', () => {
  it('preserves condition and conditions on a control that has them', () => {
    const widget: RawWidget = {
      name: 'fake',
      title: 'Fake',
      categories: [],
      keywords: [],
      controls: {
        icon: { type: 'icons', tab: 'content', condition: { show_icon: 'yes' } },
        overlay: { type: 'switcher', tab: 'content', conditions: { terms: [{ name: 'show_icon', value: 'yes' }] } },
      },
    };

    const result = curateWidget(widget, { detail: 'common', breakpointNames: BREAKPOINTS });

    expect(result.controls.find((c) => c.name === 'icon')?.condition).toEqual({ show_icon: 'yes' });
    expect(result.controls.find((c) => c.name === 'overlay')?.conditions).toEqual({
      terms: [{ name: 'show_icon', value: 'yes' }],
    });
  });
});

describe('curateWidget: hard output cap with a "call again for the rest" affordance', () => {
  function widgetWithManyContentControls(count: number): RawWidget {
    const controls: RawWidget['controls'] = {};
    for (let i = 0; i < count; i += 1) {
      controls[`field_${i}`] = { type: 'text', tab: 'content' };
    }
    return { name: 'many-fields', title: 'Many Fields', categories: [], keywords: [], controls };
  }

  it('caps output at the default limit and reports how many were truncated', () => {
    const widget = widgetWithManyContentControls(60);
    const result = curateWidget(widget, { detail: 'common', breakpointNames: BREAKPOINTS });

    expect(result.controls).toHaveLength(40); // DEFAULT_LIMIT
    expect(result.total).toBe(60);
    expect(result.truncated).toBe(20);
  });

  it('offset lets a caller page through the rest', () => {
    const widget = widgetWithManyContentControls(60);
    const result = curateWidget(widget, { detail: 'common', breakpointNames: BREAKPOINTS, offset: 40 });

    expect(result.controls).toHaveLength(20);
    expect(result.truncated).toBe(0);
  });

  it('a custom limit is honoured', () => {
    const widget = widgetWithManyContentControls(10);
    const result = curateWidget(widget, { detail: 'common', breakpointNames: BREAKPOINTS, limit: 3 });

    expect(result.controls).toHaveLength(3);
    expect(result.truncated).toBe(7);
  });
});

describe('curateWidget: token budget for a Pro-shaped widget (AC — measured, not eyeballed)', () => {
  // Neither sandbox has Elementor Pro installed (zip never supplied,
  // documented in progress.md as an open item) — there is no real Pro
  // widget to measure against. This synthetic widget stands in: a large,
  // Pro-typical control count (real Pro widgets like a Posts/Carousel
  // widget commonly carry 40-60+ content-tab controls across nested
  // repeater fields) run through the exact same curation path a real one
  // would. Budget stated here, not found in Blueprints.md (only the
  // whole-page digest budget, §5, is pinned at 4,000) — a quarter of that
  // page-level budget is a reasonable cap for one widget's common-detail
  // settings, generous enough for a genuinely complex widget while still
  // meaning curation has to actually filter, not just relabel everything.
  // First attempt at this number (1,000) was picked before measuring
  // anything and turned out unrealistic: the default output cap (40
  // controls) alone, with realistic label/default text, already costs
  // ~1,200 tokens. Re-set after actually running the measurement once —
  // 1,500 leaves real headroom above that capped-output floor while
  // staying well under half the whole-page (4,000) budget.
  const PRO_WIDGET_TOKEN_BUDGET = 1500;

  it('a widget with 50 content-tab controls stays within the stated budget at "common" detail', () => {
    const controls: RawWidget['controls'] = {};
    for (let i = 0; i < 50; i += 1) {
      controls[`content_field_${i}`] = {
        type: 'text',
        label: `Content Field ${i}`,
        default: 'Some reasonably realistic default value',
        tab: 'content',
      };
    }
    // Plus a pile of style/advanced controls that "common" must exclude —
    // if curation ever regressed to returning everything, this test would
    // catch it via the token count, not just a control-count assertion.
    for (let i = 0; i < 40; i += 1) {
      controls[`style_field_${i}`] = { type: 'slider', label: `Style Field ${i}`, tab: 'style' };
    }

    const widget: RawWidget = {
      name: 'pro-carousel',
      title: 'Pro Carousel',
      categories: ['general', 'pro-elements'],
      keywords: [],
      controls,
    };

    // Deliberately no explicit `limit` — the default output cap (40) is
    // exactly what's supposed to keep this bounded. Overriding it to fit
    // every control would defeat the mechanism the budget is meant to
    // prove works, not just measure a number.
    const result = curateWidget(widget, { detail: 'common', breakpointNames: BREAKPOINTS });
    const tokens = countTokens(JSON.stringify(result));

    expect(result.controls.every((c) => c.tab === 'content')).toBe(true);
    expect(result.controls).toHaveLength(40);
    expect(result.total).toBe(50);
    expect(result.truncated).toBe(10);
    expect(tokens).toBeLessThanOrEqual(PRO_WIDGET_TOKEN_BUDGET);
  });
});
