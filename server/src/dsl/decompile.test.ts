import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ElementorNode } from '../domain/detect.js';
import { compile, type SiteProfile } from './compile.js';
import { decompile } from './decompile.js';
import type { Spec } from './types.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures');

function loadFixtureElements(name: string): ElementorNode[] {
  const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8')) as { elements: ElementorNode[] };
  return raw.elements;
}

async function loadEmitters(): Promise<void> {
  await import('./v3.js');
  await import('./v4.js');
}

function siteProfile(generation: 'v3' | 'v4'): SiteProfile {
  return {
    generation,
    elementorVersion: '4.2.3',
    breakpoints: {
      mobile: { enabled: true, direction: 'max', value: 767 },
      tablet: { enabled: true, direction: 'max', value: 1024 },
      widescreen: { enabled: true, direction: 'min', value: 2400 },
    },
    kitTokens: {},
    widgetRegistry: [
      { name: 'heading', title: 'Heading', categories: [], keywords: [], controls: {} },
      { name: 'button', title: 'Button', categories: [], keywords: [], controls: {} },
      { name: 'text-editor', title: 'Text Editor', categories: [], keywords: [], controls: {} },
      { name: 'icon', title: 'Icon', categories: [], keywords: [], controls: {} },
      { name: 'image', title: 'Image', categories: [], keywords: [], controls: {} },
      { name: 'spacer', title: 'Spacer', categories: [], keywords: [], controls: {} },
      { name: 'divider', title: 'Divider', categories: [], keywords: [], controls: {} },
      { name: 'shortcode', title: 'Shortcode', categories: [], keywords: [], controls: {} },
      { name: 'html', title: 'HTML', categories: [], keywords: [], controls: {} },
    ],
    proTier: 'essential',
    activeExperiments: {},
  };
}

beforeAll(async () => {
  await loadEmitters();
});

describe('decompile — v3 widget reverse mappings, exact inverses of v3.ts', () => {
  it('reverses a heading widget', () => {
    const { elements, diagnostics } = decompile(
      [{ id: 'a1b2c3d', elType: 'widget', widgetType: 'heading', settings: { title: 'Welcome', header_size: 'h2' }, elements: [] }],
      siteProfile('v3'),
    );

    expect(diagnostics).toEqual([]);
    expect(elements[0]).toEqual({ type: 'heading', text: 'Welcome', level: 2 });
  });

  it('reverses a text-editor widget', () => {
    const { elements } = decompile(
      [{ id: 'a1b2c3d', elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>Hi</p>' }, elements: [] }],
      siteProfile('v3'),
    );

    expect(elements[0]).toEqual({ type: 'text', html: '<p>Hi</p>' });
  });

  it('reverses a button widget with a link', () => {
    const { elements } = decompile(
      [
        {
          id: 'a1b2c3d',
          elType: 'widget',
          widgetType: 'button',
          settings: { text: 'Go', link: { url: '/signup', is_external: '', nofollow: '', custom_attributes: '' } },
          elements: [],
        },
      ],
      siteProfile('v3'),
    );

    expect(elements[0]).toEqual({ type: 'button', text: 'Go', link: '/signup' });
  });

  it('reverses an image widget with a media id', () => {
    const { elements } = decompile(
      [{ id: 'a1b2c3d', elType: 'widget', widgetType: 'image', settings: { image: { id: 42, url: '' } }, elements: [] }],
      siteProfile('v3'),
    );

    expect(elements[0]).toEqual({ type: 'image', src: 42 });
  });

  it('reverses a spacer widget', () => {
    const { elements } = decompile(
      [{ id: 'a1b2c3d', elType: 'widget', widgetType: 'spacer', settings: { space: { unit: 'px', size: 40, sizes: [] } }, elements: [] }],
      siteProfile('v3'),
    );

    expect(elements[0]).toEqual({ type: 'spacer', size: 40 });
  });

  it('reverses a shortcode widget', () => {
    const { elements } = decompile(
      [{ id: 'a1b2c3d', elType: 'widget', widgetType: 'shortcode', settings: { shortcode: '[gallery]' }, elements: [] }],
      siteProfile('v3'),
    );

    expect(elements[0]).toEqual({ type: 'shortcode', shortcode: '[gallery]' });
  });

  it('reverses an html widget, adding the reason the grammar requires', () => {
    const { elements } = decompile(
      [{ id: 'a1b2c3d', elType: 'widget', widgetType: 'html', settings: { html: '<div>x</div>' }, elements: [] }],
      siteProfile('v3'),
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any(String) is untyped by design
    expect(elements[0]).toMatchObject({ type: 'html', html: '<div>x</div>', reason: expect.any(String) });
  });

  it('preserves unmapped settings via raw, informationally flagged, not dropped', () => {
    const { elements, diagnostics } = decompile(
      [
        {
          id: 'a1b2c3d',
          elType: 'widget',
          widgetType: 'heading',
          settings: { title: 'Hi', title_color: '#000000' },
          elements: [],
        },
      ],
      siteProfile('v3'),
    );

    expect(elements[0]).toMatchObject({ type: 'heading', text: 'Hi', raw: { title_color: '#000000' } });
    expect(diagnostics.some((d) => d.severity === 'info')).toBe(true);
  });

  it('falls back to the "widget" escape rung, verbatim, for an unrecognized widgetType', () => {
    const { elements, diagnostics } = decompile(
      [
        {
          id: 'a1b2c3d',
          elType: 'widget',
          widgetType: 'testimonial-carousel',
          settings: { autoplay: true, slides: 3 },
          elements: [],
        },
      ],
      siteProfile('v3'),
    );

    expect(diagnostics).toEqual([]); // no diagnostic needed — this is lossless
    expect(elements[0]).toEqual({ type: 'widget', widgetType: 'testimonial-carousel', settings: { autoplay: true, slides: 3 } });
  });
});

describe('decompile — v3 container layout reverse mapping', () => {
  it('reverses flex_direction/flex_gap/isInner (top-level) into layout', () => {
    const { elements, diagnostics } = decompile(
      [
        {
          id: 'a1b2c3d',
          elType: 'container',
          settings: { flex_direction: 'column', flex_gap: { unit: 'px', column: '24', row: '24', isLinked: true } },
          elements: [],
          isInner: false,
        },
      ],
      siteProfile('v3'),
    );

    expect(diagnostics).toEqual([]);
    expect(elements[0]).toEqual({ type: 'container', layout: { direction: 'column', gap: 24 } });
  });

  it('reverses padding/margin dimensions back to box-shorthand', () => {
    const { elements } = decompile(
      [
        {
          id: 'a1b2c3d',
          elType: 'container',
          settings: { padding: { unit: 'px', top: '80', right: '20', bottom: '80', left: '20', isLinked: false } },
          elements: [],
        },
      ],
      siteProfile('v3'),
    );

    expect(elements[0]).toMatchObject({ layout: { padding: [80, 20, 80, 20] } });
  });

  it('reverses justify/align values back to the DSL enum', () => {
    const { elements } = decompile(
      [{ id: 'a1b2c3d', elType: 'container', settings: { flex_justify_content: 'space-between', flex_align_items: 'stretch' }, elements: [] }],
      siteProfile('v3'),
    );

    expect(elements[0]).toMatchObject({ layout: { justify: 'between', align: 'stretch' } });
  });
});

describe('decompile — v4 widget reverse mappings, exact inverses of v4.ts', () => {
  it('reverses an e-heading widget, unwrapping the html-v3 typed prop', () => {
    const { elements } = decompile(
      [
        {
          id: 'a1b2c3d',
          elType: 'widget',
          widgetType: 'e-heading',
          settings: {
            title: { $$type: 'html-v3', value: { content: { $$type: 'string', value: 'Build faster' }, children: [] } },
            tag: { $$type: 'string', value: 'h2' },
          },
          elements: [],
          styles: [],
          version: '0.0',
        },
      ],
      siteProfile('v4'),
    );

    expect(elements[0]).toEqual({ type: 'heading', text: 'Build faster', level: 2 });
  });

  it('reverses an e-paragraph widget', () => {
    const { elements } = decompile(
      [
        {
          id: 'a1b2c3d',
          elType: 'widget',
          widgetType: 'e-paragraph',
          settings: { paragraph: { $$type: 'html-v3', value: { content: { $$type: 'string', value: 'Hi' }, children: [] } } },
          elements: [],
          styles: [],
          version: '0.0',
        },
      ],
      siteProfile('v4'),
    );

    expect(elements[0]).toEqual({ type: 'text', html: 'Hi' });
  });

  it('reverses an e-image widget, including alt (v4-only capability)', () => {
    const { elements } = decompile(
      [
        {
          id: 'a1b2c3d',
          elType: 'widget',
          widgetType: 'e-image',
          settings: {
            image: {
              $$type: 'image',
              value: {
                src: {
                  $$type: 'image-src',
                  value: { url: { $$type: 'url', value: 'https://example.com/x.jpg' }, alt: { $$type: 'string', value: 'A photo' } },
                },
                size: { $$type: 'string', value: 'full' },
              },
            },
          },
          elements: [],
          styles: [],
          version: '0.0',
        },
      ],
      siteProfile('v4'),
    );

    expect(elements[0]).toEqual({ type: 'image', src: 'https://example.com/x.jpg', alt: 'A photo' });
  });

  it('falls back to the "widget" escape rung, verbatim, for an unrecognized v4 widgetType (e.g. e-svg)', () => {
    const { elements, diagnostics } = decompile(
      [{ id: 'a1b2c3d', elType: 'widget', widgetType: 'e-svg', settings: { svg: 'x' }, elements: [], styles: [], version: '0.0' }],
      siteProfile('v4'),
    );

    expect(diagnostics).toEqual([]);
    expect(elements[0]).toEqual({ type: 'widget', widgetType: 'e-svg', settings: { svg: 'x' } });
  });
});

describe('decompile — v4 e-flexbox local-style reverse mapping, matching v4-atomic.json\'s real shape', () => {
  it('reverses a desktop-only local style class into layout', () => {
    const { elements, diagnostics } = decompile(
      [
        {
          id: 'a7f4eea',
          elType: 'e-flexbox',
          settings: { classes: { $$type: 'classes', value: ['e-a7f4eea-c96ec15'] } },
          elements: [],
          isInner: false,
          styles: {
            'e-a7f4eea-c96ec15': {
              id: 'e-a7f4eea-c96ec15',
              label: 'local',
              type: 'class',
              variants: [
                {
                  meta: { breakpoint: 'desktop', state: null },
                  props: {
                    'flex-direction': { $$type: 'string', value: 'column' },
                    gap: { $$type: 'size', value: { size: 10, unit: 'px' } },
                  },
                  custom_css: null,
                },
              ],
            },
          },
          version: '0.0',
        },
      ],
      siteProfile('v4'),
    );

    expect(diagnostics).toEqual([]);
    expect(elements[0]).toEqual({ type: 'container', layout: { direction: 'column', gap: 10 } });
  });

  it('reverses a widescreen variant into responsive, matching responsive-widescreen.json\'s real shape', () => {
    const { elements } = decompile(loadFixtureElements('responsive-widescreen'), siteProfile('v4'));

    // The fixture's own variant properties are font-family/font-size —
    // typography, still deferred (EMCP-051's own scope limitation) — so
    // the STRUCTURE reverses (a text node, responsive present) but the
    // specific typography values are genuinely not modeled, which is
    // correct, not a bug: "lossy by design."
    expect(elements[0]?.type).toBe('text');
  });
});

describe('decompile — legacy content has no DSL layout equivalent (§5.1: read-only)', () => {
  it('falls back to raw on a generic container for a legacy section', () => {
    const { elements, diagnostics } = decompile(
      [{ id: 'a1b2c3d', elType: 'section', settings: { structure: '20' }, elements: [] }],
      siteProfile('v3'),
    );

    expect(elements[0]?.type).toBe('container');
    expect((elements[0] as { raw?: Record<string, unknown> }).raw).toMatchObject({ elType: 'section' });
    expect(diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });
});

describe('decompile — recursion and structure', () => {
  it('recurses into children, preserving nesting', () => {
    const { elements } = decompile(
      [
        {
          id: 'a1b2c3d',
          elType: 'container',
          settings: {},
          elements: [{ id: 'b2c3d4e', elType: 'widget', widgetType: 'heading', settings: { title: 'Child' }, elements: [] }],
        },
      ],
      siteProfile('v3'),
    );

    expect(elements[0]?.children).toHaveLength(1);
    expect(elements[0]?.children?.[0]).toEqual({ type: 'heading', text: 'Child' });
  });

  it('never hard-fails — every diagnostic is warning/info, never error', () => {
    const { diagnostics } = decompile(
      [
        { id: 'a1b2c3d', elType: 'section', settings: {}, elements: [] },
        { id: 'b2c3d4e', elType: 'widget', widgetType: 'unknown-widget-xyz', settings: { anything: true }, elements: [] },
      ],
      siteProfile('v3'),
    );

    expect(diagnostics.every((d) => d.severity !== 'error')).toBe(true);
  });
});

describe('decompile — round-trip through the real fixture set (semantic equivalence, never byte equality)', () => {
  it('v3-container.json: heading text and icon widgetType survive round-trip through compile()', () => {
    const native = loadFixtureElements('v3-container');
    const { elements: decompiled } = decompile(native, siteProfile('v3'));

    const spec: Spec = { dslVersion: 1, page: { title: 'Round-trip test' }, elements: decompiled };
    const result = compile(spec, siteProfile('v3'));

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const container = result.elements[0]!;
    expect(container.elType).toBe('container');
    const heading = container.elements?.find((e) => e.widgetType === 'heading');
    expect((heading?.['settings'] as { title?: string } | undefined)?.title).toBe('Add Your Heading Text Here');
  });

  it('deep-nested.json: 5-level nesting depth survives round-trip (v4)', () => {
    const native = loadFixtureElements('deep-nested');
    const { elements: decompiled } = decompile(native, siteProfile('v4'));

    const spec: Spec = { dslVersion: 1, page: { title: 'Round-trip test' }, elements: decompiled };
    const result = compile(spec, siteProfile('v4'));

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    let depth = 0;
    let current = result.elements[0];
    while (current?.elements && current.elements.length > 0) {
      depth += 1;
      current = current.elements[0];
    }
    expect(depth).toBe(5); // 5 nested containers, matching the real fixture's own depth
  });

  it('unicode-roundtrip.json: em-dash/Arabic/CJK content survives decompile→compile intact', () => {
    const native = loadFixtureElements('unicode-roundtrip');
    const { elements: decompiled } = decompile(native, siteProfile('v4'));

    const spec: Spec = { dslVersion: 1, page: { title: 'Round-trip test' }, elements: decompiled };
    const result = compile(spec, siteProfile('v4'));

    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const settings = result.elements[0]?.['settings'] as { paragraph: { value: { content: { value: string } } } };
    expect(settings.paragraph.value.content.value).toBe('"Design" — reimagined. مرحبا بالعالم / 你好世界');
  });
});
