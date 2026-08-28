import { describe, expect, it } from 'vitest';
import { parseSpec } from './validate.js';

function codes(diagnostics: { code: string }[]): string[] {
  return diagnostics.map((d) => d.code);
}

describe('parseSpec', () => {
  it('accepts a minimal valid spec', () => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'Pricing' },
      elements: [],
    });

    expect(diagnostics).toEqual([]);
    expect(spec).toEqual({ dslVersion: 1, page: { title: 'Pricing' }, elements: [] });
  });

  it('accepts a full spec with nested children, layout, style, responsive, and every optional page field', () => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'Pricing', template: 'elementor_canvas', status: 'draft' },
      elements: [
        {
          type: 'container',
          ref: 'hero',
          label: 'Hero',
          layout: { direction: 'column', gap: 24, padding: [80, 20] },
          style: { color: '@primary', typography: { size: 'h1', weight: 600 } },
          responsive: { tablet: { layout: { direction: 'column' } } },
          children: [
            { type: 'heading', text: 'Welcome', level: 1 },
            { type: 'button', text: 'Get started', link: '/signup' },
          ],
        },
      ],
    });

    expect(diagnostics).toEqual([]);
    expect(spec).not.toBeNull();
    expect(spec?.page).toEqual({ title: 'Pricing', template: 'elementor_canvas', status: 'draft' });
    expect(spec?.elements[0]?.type).toBe('container');
    expect(spec?.elements[0]?.children).toHaveLength(2);
  });

  it('rejects a non-object input', () => {
    const { spec, diagnostics } = parseSpec('not an object');

    expect(spec).toBeNull();
    expect(codes(diagnostics)).toContain('SPEC_MALFORMED');
  });

  it('rejects a missing dslVersion', () => {
    const { spec, diagnostics } = parseSpec({ page: { title: 'x' }, elements: [] });

    expect(spec).toBeNull();
    expect(codes(diagnostics)).toContain('DSL_VERSION_UNSUPPORTED');
  });

  it('rejects a non-integer dslVersion', () => {
    const { diagnostics } = parseSpec({ dslVersion: 1.5, page: { title: 'x' }, elements: [] });

    expect(codes(diagnostics)).toContain('DSL_VERSION_UNSUPPORTED');
  });

  it('rejects an unsupported dslVersion rather than guessing — "fail loudly, not partially apply"', () => {
    const { spec, diagnostics } = parseSpec({ dslVersion: 2, page: { title: 'x' }, elements: [] });

    expect(spec).toBeNull();
    const diag = diagnostics.find((d) => d.code === 'DSL_VERSION_UNSUPPORTED');
    expect(diag).toBeDefined();
    expect(diag?.allowed).toEqual(['1']);
  });

  it('rejects a spec with no page', () => {
    const { spec, diagnostics } = parseSpec({ dslVersion: 1, elements: [] });

    expect(spec).toBeNull();
    expect(diagnostics.some((d) => d.path === 'page')).toBe(true);
  });

  it('rejects a page with no title', () => {
    const { spec, diagnostics } = parseSpec({ dslVersion: 1, page: {}, elements: [] });

    expect(spec).toBeNull();
    expect(diagnostics.some((d) => d.path === 'page.title')).toBe(true);
  });

  it('rejects an unrecognized page.template', () => {
    const { diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x', template: 'not_a_real_template' },
      elements: [],
    });

    expect(diagnostics.some((d) => d.path === 'page.template')).toBe(true);
  });

  it('rejects any page.status other than "draft" — publishing is a separate tool', () => {
    const { diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x', status: 'publish' },
      elements: [],
    });

    const diag = diagnostics.find((d) => d.path === 'page.status');
    expect(diag).toBeDefined();
    expect(diag?.allowed).toEqual(['draft']);
  });

  it('rejects a spec with no elements array', () => {
    const { spec, diagnostics } = parseSpec({ dslVersion: 1, page: { title: 'x' } });

    expect(spec).toBeNull();
    expect(diagnostics.some((d) => d.path === 'elements')).toBe(true);
  });

  it('rejects an unknown node type, listing the real set as "allowed"', () => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'carousel' }],
    });

    expect(spec).toBeNull();
    const diag = diagnostics.find((d) => d.code === 'NODE_TYPE_UNKNOWN');
    expect(diag).toBeDefined();
    expect(diag?.allowed).toContain('container');
    expect(diag?.allowed).toContain('widget');
    expect(diag?.allowed).toContain('html');
  });

  it('requires "reason" when "raw" is present', () => {
    const { diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'container', raw: { some_setting: 'value' } }],
    });

    expect(codes(diagnostics)).toContain('REASON_REQUIRED');
  });

  it('accepts "raw" when "reason" is given', () => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'container', raw: { some_setting: 'value' }, reason: 'no DSL equivalent yet' }],
    });

    expect(diagnostics).toEqual([]);
    expect(spec?.elements[0]).toMatchObject({ raw: { some_setting: 'value' }, reason: 'no DSL equivalent yet' });
  });

  it('requires "reason" on an html node even without raw', () => {
    const { diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'html', html: '<div>custom</div>' }],
    });

    expect(codes(diagnostics)).toContain('REASON_REQUIRED');
  });

  it('accepts an html node with reason given', () => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'html', html: '<div>custom</div>', reason: 'embed widget has no DSL equivalent' }],
    });

    expect(diagnostics).toEqual([]);
    expect(spec?.elements[0]).toMatchObject({ type: 'html', html: '<div>custom</div>' });
  });

  it.each([
    ['heading', {}, 'text'],
    ['text', {}, 'html'],
    ['image', {}, 'src'],
    ['button', {}, 'text'],
    ['icon', {}, 'name'],
    ['list', {}, 'items'],
    ['video', {}, 'src'],
    ['spacer', {}, 'size'],
    ['widget', {}, 'widgetType'],
    ['shortcode', {}, 'shortcode'],
  ] as const)('rejects a "%s" node missing its required field "%s"', (type, extra, field) => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type, ...extra }],
    });

    expect(spec).toBeNull();
    const diag = diagnostics.find((d) => d.code === 'NODE_FIELD_MISSING');
    expect(diag).toBeDefined();
    expect(diag?.path).toBe(`elements[0].${field}`);
  });

  it('accepts container and grid and divider with no type-specific fields at all', () => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'container' }, { type: 'grid' }, { type: 'divider' }],
    });

    expect(diagnostics).toEqual([]);
    expect(spec?.elements).toHaveLength(3);
  });

  it('accepts an image node with a numeric media id for src', () => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'image', src: 42 }],
    });

    expect(diagnostics).toEqual([]);
    expect(spec?.elements[0]).toMatchObject({ src: 42 });
  });

  it('rejects an image node whose src is neither a string nor a number', () => {
    const { diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'image', src: true }],
    });

    expect(diagnostics.some((d) => d.path === 'elements[0].src')).toBe(true);
  });

  it('rejects a heading level outside 1-6', () => {
    const { diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'heading', text: 'x', level: 7 }],
    });

    expect(diagnostics.some((d) => d.path === 'elements[0].level')).toBe(true);
  });

  it('rejects a list whose items are not all strings', () => {
    const { diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'list', items: ['a', 2, 'c'] }],
    });

    expect(diagnostics.some((d) => d.path === 'elements[0].items')).toBe(true);
  });

  it('recurses into children and surfaces a nested error with the full path', () => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'container', children: [{ type: 'heading' }] }],
    });

    expect(spec).toBeNull();
    const diag = diagnostics.find((d) => d.code === 'NODE_FIELD_MISSING');
    expect(diag?.path).toBe('elements[0].children[0].text');
  });

  it('does not partially apply — a single invalid node fails the whole spec, not just that node', () => {
    const { spec } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'container' }, { type: 'heading' /* missing text */ }],
    });

    expect(spec).toBeNull();
  });

  it('rejects children that is not an array', () => {
    const { diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'container', children: 'not-an-array' }],
    });

    expect(diagnostics.some((d) => d.path === 'elements[0].children')).toBe(true);
  });

  it('rejects layout/style/responsive/raw that are not objects', () => {
    const { diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'container', layout: 'nope', style: 5, responsive: [], raw: 'x', reason: 'x' }],
    });

    const paths = diagnostics.map((d) => d.path);
    expect(paths).toContain('elements[0].layout');
    expect(paths).toContain('elements[0].style');
    expect(paths).toContain('elements[0].responsive');
    expect(paths).toContain('elements[0].raw');
  });

  it('accepts a widget escape-rung node with settings', () => {
    const { spec, diagnostics } = parseSpec({
      dslVersion: 1,
      page: { title: 'x' },
      elements: [{ type: 'widget', widgetType: 'testimonial-carousel', settings: { autoplay: true } }],
    });

    expect(diagnostics).toEqual([]);
    expect(spec?.elements[0]).toMatchObject({ widgetType: 'testimonial-carousel', settings: { autoplay: true } });
  });
});
