import { beforeAll, describe, expect, it } from 'vitest';
import { compile, type SiteProfile } from './compile.js';
import type { Spec, SpecNode } from './types.js';

// Registering side effect — v3.ts populates compile.ts's registry on import.
async function loadV3(): Promise<void> {
  await import('./v3.js');
}

function siteProfile(overrides: Partial<SiteProfile> = {}): SiteProfile {
  return {
    generation: 'v3',
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
  await loadV3();
});

describe('v3 emission — container', () => {
  it('matches tests/fixtures/v3-container.json\'s real shape for flex_direction and top-level isInner', () => {
    const result = compile(spec([{ type: 'container', layout: { direction: 'column' } }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    const el = result.elements[0]!;
    expect(el.elType).toBe('container');
    expect(el['settings']).toMatchObject({ flex_direction: 'column' });
    expect(el['isInner']).toBe(false); // top-level, matches v3-container.json
  });

  it('marks a nested container isInner:true, matching tests/fixtures/deep-nested.json', () => {
    const result = compile(spec([{ type: 'container', children: [{ type: 'container' }] }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]?.['isInner']).toBe(false);
    expect(result.elements[0]?.elements?.[0]?.['isInner']).toBe(true);
  });

  it('maps every justify/align enum value to the real CSS-shaped Elementor value', () => {
    const result = compile(
      spec([{ type: 'container', layout: { justify: 'between', align: 'stretch' } }]),
      siteProfile(),
    );

    expect(result.elements[0]?.['settings']).toMatchObject({
      flex_justify_content: 'space-between',
      flex_align_items: 'stretch',
    });
  });

  it('expands box-shorthand padding/margin into the real DIMENSIONS shape', () => {
    const result = compile(
      spec([{ type: 'container', layout: { padding: [80, 20], margin: [0] } }]),
      siteProfile(),
    );

    expect(result.elements[0]?.['settings']).toMatchObject({
      padding: { unit: 'px', top: '80', right: '20', bottom: '80', left: '20', isLinked: false },
      margin: { unit: 'px', top: '0', right: '0', bottom: '0', left: '0', isLinked: true },
    });
  });

  it('converts gap to the real GAPS shape', () => {
    const result = compile(spec([{ type: 'container', layout: { gap: 24 } }]), siteProfile());

    expect(result.elements[0]?.['settings']).toMatchObject({
      flex_gap: { unit: 'px', column: '24', row: '24', isLinked: true },
    });
  });

  it('accepts width "full"/"boxed" as content_width, with no diagnostics', () => {
    const result = compile(spec([{ type: 'container', layout: { width: 'full' } }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]?.['settings']).toMatchObject({ content_width: 'full' });
  });

  it('warns (not errors) on an unsupported exact width value, and still compiles', () => {
    const result = compile(spec([{ type: 'container', layout: { width: '1200px' } }]), siteProfile());

    expect(result.elements).toHaveLength(1); // warning, not error — compile still succeeds
    const diag = result.diagnostics.find((d) => d.path === 'elements[0].layout.width');
    expect(diag?.severity).toBe('warning');
  });

  it('converts minHeight to the real SLIDER/SIZE shape', () => {
    const result = compile(spec([{ type: 'container', layout: { minHeight: '100vh' } }]), siteProfile());

    expect(result.elements[0]?.['settings']).toMatchObject({ min_height: { unit: 'vh', size: 100, sizes: [] } });
  });
});

describe('v3 emission — content widgets', () => {
  it('emits heading with title + header_size, matching v3-container.json\'s real "title" key', () => {
    const result = compile(spec([{ type: 'heading', text: 'Welcome', level: 2 }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    const el = result.elements[0]!;
    expect(el.elType).toBe('widget');
    expect(el.widgetType).toBe('heading');
    expect(el['settings']).toEqual({ title: 'Welcome', header_size: 'h2' });
  });

  it('emits text as text-editor/editor', () => {
    const result = compile(spec([{ type: 'text', html: '<p>Hi</p>' }]), siteProfile());

    expect(result.elements[0]).toMatchObject({ elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>Hi</p>' } });
  });

  it('emits button with text + wrapped link, matching the real link control shape', () => {
    const result = compile(spec([{ type: 'button', text: 'Go', link: '/signup' }]), siteProfile());

    expect(result.elements[0]).toMatchObject({
      elType: 'widget',
      widgetType: 'button',
      settings: { text: 'Go', link: { url: '/signup', is_external: '', nofollow: '', custom_attributes: '' } },
    });
  });

  it('emits icon with the real selected_icon {value, library} shape, inferring library from the fa* prefix', () => {
    const result = compile(spec([{ type: 'icon', name: 'far fa-heart' }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]).toMatchObject({
      elType: 'widget',
      widgetType: 'icon',
      settings: { selected_icon: { value: 'far fa-heart', library: 'fa-regular' } },
    });
  });

  it('warns when an icon name has no recognized fa* prefix, defaulting to fa-solid', () => {
    const result = compile(spec([{ type: 'icon', name: 'star' }]), siteProfile());

    expect(result.elements).toHaveLength(1);
    expect(result.elements[0]?.['settings']).toMatchObject({ selected_icon: { value: 'star', library: 'fa-solid' } });
    expect(result.diagnostics.some((d) => d.severity === 'warning' && d.path === 'elements[0].name')).toBe(true);
  });

  it('emits image with the real {url,id} media control shape for a URL src', () => {
    const result = compile(spec([{ type: 'image', src: 'https://example.com/x.jpg' }]), siteProfile());

    expect(result.elements[0]).toMatchObject({
      elType: 'widget',
      widgetType: 'image',
      settings: { image: { id: '', url: 'https://example.com/x.jpg' } },
    });
  });

  it('emits image with the real {id,url} media control shape for a numeric media id', () => {
    const result = compile(spec([{ type: 'image', src: 42 }]), siteProfile());

    expect(result.elements[0]?.['settings']).toMatchObject({ image: { id: 42, url: '' } });
  });

  it('warns that alt is not applied on v3 — no confirmed control for it', () => {
    const result = compile(spec([{ type: 'image', src: 42, alt: 'A photo' }]), siteProfile());

    expect(result.elements).toHaveLength(1); // warning, not error
    expect(result.diagnostics.some((d) => d.path === 'elements[0].alt' && d.severity === 'warning')).toBe(true);
  });

  it('emits spacer with the real SLIDER/SIZE shape for space', () => {
    const result = compile(spec([{ type: 'spacer', size: 40 }]), siteProfile());

    expect(result.elements[0]).toMatchObject({
      elType: 'widget',
      widgetType: 'spacer',
      settings: { space: { unit: 'px', size: 40, sizes: [] } },
    });
  });

  it('emits divider with no required settings', () => {
    const result = compile(spec([{ type: 'divider' }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]).toMatchObject({ elType: 'widget', widgetType: 'divider' });
  });

  it('emits shortcode verbatim into the real "shortcode" setting key', () => {
    const result = compile(spec([{ type: 'shortcode', shortcode: '[gallery ids="1,2,3"]' }]), siteProfile());

    expect(result.elements[0]).toMatchObject({
      elType: 'widget',
      widgetType: 'shortcode',
      settings: { shortcode: '[gallery ids="1,2,3"]' },
    });
  });

  it('emits html verbatim into the real "html" setting key, requiring reason at the grammar layer (not re-checked here)', () => {
    const result = compile(
      spec([{ type: 'html', html: '<iframe></iframe>', reason: 'embed with no DSL equivalent' }]),
      siteProfile(),
    );

    expect(result.elements[0]).toMatchObject({
      elType: 'widget',
      widgetType: 'html',
      settings: { html: '<iframe></iframe>' },
    });
  });
});

describe('v3 emission — deliberately deferred node types', () => {
  it('still reports EMISSION_NOT_IMPLEMENTED for grid/list/video on v3', () => {
    for (const node of [
      { type: 'grid' as const },
      { type: 'list' as const, items: ['a'] },
      { type: 'video' as const, src: 'https://example.com/v.mp4' },
    ]) {
      const result = compile(spec([node]), siteProfile());
      expect(result.diagnostics.some((d) => d.code === 'EMISSION_NOT_IMPLEMENTED')).toBe(true);
    }
  });
});

describe('v3 emission — nested tree compiles end to end', () => {
  it('compiles a container with heading and button children, matching the real fixture\'s widget nesting shape', () => {
    const result = compile(
      spec([
        {
          type: 'container',
          layout: { direction: 'column' },
          children: [
            { type: 'heading', text: 'Add Your Heading Text Here' },
            { type: 'icon', name: 'fas fa-star' },
          ],
        },
      ]),
      siteProfile(),
    );

    expect(result.diagnostics).toEqual([]);
    const container = result.elements[0]!;
    expect(container.elType).toBe('container');
    expect(container.elements).toHaveLength(2);
    expect(container.elements?.[0]?.widgetType).toBe('heading');
    expect(container.elements?.[1]?.widgetType).toBe('icon');
  });
});

describe('registry isolation', () => {
  it('v3 emitters do not register anything for v4 generation — no registry mutation needed to prove it', () => {
    // v3.ts registers every emitter under the ":v3" key only (`emitterKey`
    // is `${type}:${generation}`) — compiling against `generation: 'v4'`
    // naturally finds nothing for "container" regardless of what's
    // registered for v3, so this needs no `clearEmitters()` at all (and
    // deliberately avoids one — clearing here would wipe every other v3
    // emitter for the rest of this file's test run, since `import('./v3.js')`
    // is a cached no-op the second time and can't re-register them).
    const result = compile(spec([{ type: 'container' }]), siteProfile({ generation: 'v4' }));

    expect(result.diagnostics.some((d) => d.code === 'EMISSION_NOT_IMPLEMENTED')).toBe(true);
  });
});
