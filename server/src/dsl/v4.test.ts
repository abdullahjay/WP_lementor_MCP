import { beforeAll, describe, expect, it } from 'vitest';
import { compile, type SiteProfile } from './compile.js';
import type { Spec, SpecNode } from './types.js';

async function loadV4(): Promise<void> {
  await import('./v4.js');
}

function siteProfile(overrides: Partial<SiteProfile> = {}): SiteProfile {
  return {
    generation: 'v4',
    elementorVersion: '4.2.3',
    breakpoints: {},
    kitTokens: {},
    widgetRegistry: [],
    proTier: 'essential',
    activeExperiments: {},
    ...overrides,
  };
}

function spec(elements: SpecNode[]): Spec {
  return { dslVersion: 1, page: { title: 'Test Page' }, elements };
}

beforeAll(async () => {
  await loadV4();
});

describe('v4 emission — content, matching tests/fixtures/v4-atomic.json\'s exact typed-prop shapes', () => {
  it('emits container as e-flexbox with no classes/styles when layout is empty, matching an uncustomized element', () => {
    const result = compile(spec([{ type: 'container' }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    const el = result.elements[0]!;
    expect(el.elType).toBe('e-flexbox');
    expect(el['settings']).toEqual({});
    expect(el['styles']).toBeUndefined();
    expect(el['isInner']).toBe(false);
    expect(el['interactions']).toEqual([]);
    expect(el['editor_settings']).toEqual([]);
    expect(el['version']).toBe('0.0');
  });

  it('marks a nested e-flexbox isInner:true', () => {
    const result = compile(spec([{ type: 'container', children: [{ type: 'container' }] }]), siteProfile());

    expect(result.elements[0]?.['isInner']).toBe(false);
    expect(result.elements[0]?.elements?.[0]?.['isInner']).toBe(true);
  });

  it('emits heading with the exact real html-v3 typed title shape and tag from level', () => {
    const result = compile(spec([{ type: 'heading', text: 'Build faster', level: 2 }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    const el = result.elements[0]!;
    expect(el.widgetType).toBe('e-heading');
    expect(el['settings']).toEqual({
      title: { $$type: 'html-v3', value: { content: { $$type: 'string', value: 'Build faster' }, children: [] } },
      tag: { $$type: 'string', value: 'h2' },
    });
  });

  it('emits text as e-paragraph with the real "paragraph" field name, confirmed against unicode-roundtrip.json', () => {
    const result = compile(spec([{ type: 'text', html: '"Design" — reimagined. مرحبا بالعالم / 你好世界' }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    const el = result.elements[0]!;
    expect(el.widgetType).toBe('e-paragraph');
    expect(el['settings']).toEqual({
      paragraph: {
        $$type: 'html-v3',
        value: { content: { $$type: 'string', value: '"Design" — reimagined. مرحبا بالعالم / 你好世界' }, children: [] },
      },
    });
  });

  it('emits button with the real "text" html-v3 shape', () => {
    const result = compile(spec([{ type: 'button', text: 'Get started' }]), siteProfile());

    const el = result.elements[0]!;
    expect(el.widgetType).toBe('e-button');
    expect(el['settings']).toEqual({
      text: { $$type: 'html-v3', value: { content: { $$type: 'string', value: 'Get started' }, children: [] } },
    });
  });

  it('emits image with a URL src using the real {url,alt} image-src shape', () => {
    const result = compile(spec([{ type: 'image', src: 'https://example.com/x.jpg', alt: 'A photo' }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    const el = result.elements[0]!;
    expect(el.widgetType).toBe('e-image');
    expect(el['settings']).toEqual({
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
    });
  });

  it('emits image with a numeric media id using the real {id} image-src shape — v4 supports alt, unlike v3', () => {
    const result = compile(spec([{ type: 'image', src: 42 }]), siteProfile());

    const image = result.elements[0]?.['settings'] as { image: { value: { src: { value: Record<string, unknown> } } } };
    expect(image.image.value.src.value).toEqual({ id: { $$type: 'image-attachment-id', value: 42 } });
  });

  it('emits divider as e-divider with empty settings, matching the real widget having no content props', () => {
    const result = compile(spec([{ type: 'divider' }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]).toMatchObject({ elType: 'widget', widgetType: 'e-divider', settings: {} });
  });
});

describe('v4 emission — local styles, matching the real styles-array shape', () => {
  it('generates a local style class only when layout has mappable properties, embedding the real element id', () => {
    const result = compile(spec([{ type: 'container', layout: { direction: 'column', gap: 10 } }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    const el = result.elements[0]!;
    const classesValue = (el['settings'] as { classes: { value: string[] } }).classes.value;
    expect(classesValue).toHaveLength(1);
    const className = classesValue[0]!;
    expect(className).toMatch(new RegExp(`^e-${el.id}-[0-9a-f]{7}$`));

    const styles = el['styles'] as Record<string, unknown>;
    expect(styles[className]).toMatchObject({ id: className, label: 'local', type: 'class' });
  });

  it('matches the real desktop-only variant shape (meta.breakpoint desktop, state null, custom_css null)', () => {
    const result = compile(spec([{ type: 'container', layout: { direction: 'column' } }]), siteProfile());

    const styles = result.elements[0]?.['styles'] as Record<string, { variants: unknown[] }>;
    const [className] = Object.keys(styles);
    const variant = styles[className!]!.variants[0] as { meta: unknown; props: unknown; custom_css: unknown };
    expect(variant.meta).toEqual({ breakpoint: 'desktop', state: null });
    expect(variant.custom_css).toBeNull();
  });

  it('maps flex-direction to the real string-typed prop, matching v4-atomic.json exactly', () => {
    const result = compile(spec([{ type: 'container', layout: { direction: 'column' } }]), siteProfile());

    const props = firstVariantProps(result.elements[0]!);
    expect(props['flex-direction']).toEqual({ $$type: 'string', value: 'column' });
  });

  it('maps gap to the real size-typed prop, matching v4-atomic.json exactly (no sizes:[] — that\'s a v3-only quirk)', () => {
    const result = compile(spec([{ type: 'container', layout: { gap: 10 } }]), siteProfile());

    const props = firstVariantProps(result.elements[0]!);
    expect(props['gap']).toEqual({ $$type: 'size', value: { unit: 'px', size: 10 } });
  });

  it('maps justify/align to real CSS-value strings', () => {
    const result = compile(spec([{ type: 'container', layout: { justify: 'between', align: 'stretch' } }]), siteProfile());

    const props = firstVariantProps(result.elements[0]!);
    expect(props['justify-content']).toEqual({ $$type: 'string', value: 'space-between' });
    expect(props['align-items']).toEqual({ $$type: 'string', value: 'stretch' });
  });

  it('maps box-shorthand padding/margin to the real logical dimensions shape (block-start/inline-end/block-end/inline-start)', () => {
    const result = compile(spec([{ type: 'container', layout: { padding: [80, 20] } }]), siteProfile());

    const props = firstVariantProps(result.elements[0]!);
    expect(props['padding']).toEqual({
      $$type: 'dimensions',
      value: {
        'block-start': { $$type: 'size', value: { unit: 'px', size: 80 } },
        'inline-end': { $$type: 'size', value: { unit: 'px', size: 20 } },
        'block-end': { $$type: 'size', value: { unit: 'px', size: 80 } },
        'inline-start': { $$type: 'size', value: { unit: 'px', size: 20 } },
      },
    });
  });

  it('maps a numeric layout.width to the real "width" size prop', () => {
    const result = compile(spec([{ type: 'container', layout: { width: '1200px' } }]), siteProfile());

    const props = firstVariantProps(result.elements[0]!);
    expect(props['width']).toEqual({ $$type: 'size', value: { unit: 'px', size: 1200 } });
  });

  it('warns (not errors) on a keyword layout.width ("full"/"boxed") — that\'s a v3-only concept', () => {
    const result = compile(spec([{ type: 'container', layout: { width: 'full' } }]), siteProfile());

    expect(result.elements).toHaveLength(1);
    const diag = result.diagnostics.find((d) => d.path === 'elements[0].layout.width');
    expect(diag?.severity).toBe('warning');
  });

  it('nested children each get their own independent local style class', () => {
    const result = compile(
      spec([
        {
          type: 'container',
          layout: { direction: 'column' },
          children: [{ type: 'heading', text: 'Hi', layout: { minHeight: '40px' } }],
        },
      ]),
      siteProfile(),
    );

    expect(result.diagnostics).toEqual([]);
    const parent = result.elements[0]!;
    const child = parent.elements![0]!;
    const parentClass = ((parent['settings'] as { classes: { value: string[] } }).classes.value)[0];
    const childClass = ((child['settings'] as { classes: { value: string[] } }).classes.value)[0];
    expect(parentClass).not.toBe(childClass);
  });
});

describe('v4 emission — link deferred, not guessed', () => {
  it('warns when button has a link, and does not emit anything for it', () => {
    const result = compile(spec([{ type: 'button', text: 'Go', link: '/signup' }]), siteProfile());

    expect(result.elements).toHaveLength(1); // warning, not error
    expect((result.elements[0]!['settings'] as Record<string, unknown>)['link']).toBeUndefined();
    const diag = result.diagnostics.find((d) => d.path === 'elements[0].link');
    expect(diag?.severity).toBe('warning');
  });

  it('does not warn when no link is given', () => {
    const result = compile(spec([{ type: 'button', text: 'Go' }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
  });
});

describe('v4 emission — deliberately deferred node types', () => {
  it('reports EMISSION_NOT_IMPLEMENTED for grid/icon/list/video/spacer/shortcode on v4', () => {
    for (const node of [
      { type: 'grid' as const },
      { type: 'icon' as const, name: 'fas fa-star' },
      { type: 'list' as const, items: ['a'] },
      { type: 'video' as const, src: 'https://example.com/v.mp4' },
      { type: 'spacer' as const, size: 20 },
      { type: 'shortcode' as const, shortcode: '[gallery]' },
    ]) {
      const result = compile(spec([node]), siteProfile());
      expect(result.diagnostics.some((d) => d.code === 'EMISSION_NOT_IMPLEMENTED')).toBe(true);
    }
  });

  it('still routes html through the generation-agnostic widget escape rung, not a v4-specific emitter', () => {
    // html has no atomic-widget equivalent (deliberately not registered
    // for 'html'), but a spec author can always reach the real legacy
    // "html" widget via the DSL's own `widget` escape rung, which
    // compile.ts already handles generation-agnostically.
    const result = compile(
      spec([{ type: 'widget', widgetType: 'html', settings: { html: '<div></div>' } }]),
      siteProfile({ widgetRegistry: [{ name: 'html', title: 'HTML', categories: [], keywords: [], controls: {} }] }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]).toMatchObject({ elType: 'widget', widgetType: 'html' });
  });
});

describe('v4 emission — nested tree compiles end to end, matching v4-atomic.json\'s real nesting', () => {
  it('compiles a flexbox with heading and button children', () => {
    const result = compile(
      spec([
        {
          type: 'container',
          layout: { direction: 'column' },
          children: [
            { type: 'heading', text: 'Build faster' },
            { type: 'button', text: 'Get started' },
          ],
        },
      ]),
      siteProfile(),
    );

    expect(result.diagnostics).toEqual([]);
    const container = result.elements[0]!;
    expect(container.elType).toBe('e-flexbox');
    expect(container.elements).toHaveLength(2);
    expect(container.elements?.[0]?.widgetType).toBe('e-heading');
    expect(container.elements?.[1]?.widgetType).toBe('e-button');
  });
});

function firstVariantProps(element: { styles?: unknown }): Record<string, unknown> {
  const styles = element.styles as Record<string, { variants: { props: Record<string, unknown> }[] }>;
  const [className] = Object.keys(styles);
  return styles[className!]!.variants[0]!.props;
}
