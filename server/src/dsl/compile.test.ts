import { afterEach, describe, expect, it } from 'vitest';
import { clearEmitters, compile, registerEmitter, type EmitOutcome, type SiteProfile } from './compile.js';
import type { Spec, SpecNode } from './types.js';

function siteProfile(overrides: Partial<SiteProfile> = {}): SiteProfile {
  return {
    generation: 'v4',
    elementorVersion: '4.2.3',
    breakpoints: {},
    kitTokens: {},
    widgetRegistry: [{ name: 'heading', title: 'Heading', categories: [], keywords: [], controls: {} }],
    proTier: 'essential',
    activeExperiments: {},
    ...overrides,
  };
}

function spec(elements: SpecNode[]): Spec {
  return { dslVersion: 1, page: { title: 'Test Page' }, elements };
}

describe('compile — orchestration invariants', () => {
  it('returns an empty, valid result for an empty spec', () => {
    const result = compile(spec([]), siteProfile());

    expect(result).toEqual({
      elements: [],
      diagnostics: [],
      nativeness: 1,
      rawRatio: 0,
      docMeta: { edit_mode: 'builder', template_type: 'wp-page', version: '4.2.3', page_settings: {} },
    });
  });

  it('compiles a widget node end to end, assigning a real 7-char hex id', () => {
    const result = compile(spec([{ type: 'widget', widgetType: 'heading', settings: { title: 'Hi' } }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    expect(result.elements).toHaveLength(1);
    const el = result.elements[0]!;
    expect(el.elType).toBe('widget');
    expect(el.widgetType).toBe('heading');
    expect(el.id).toMatch(/^[0-9a-f]{7}$/);
    expect(el.elements).toEqual([]);
  });

  it('rejects a widget type not on the site, via WIDGET_NOT_AVAILABLE, with the real registry as "allowed"', () => {
    const result = compile(spec([{ type: 'widget', widgetType: 'testimonial-carousel' }]), siteProfile());

    expect(result.elements).toEqual([]);
    const diag = result.diagnostics.find((d) => d.code === 'WIDGET_NOT_AVAILABLE');
    expect(diag).toBeDefined();
    expect(diag?.allowed).toEqual(['heading']);
  });

  it('produces EMISSION_NOT_IMPLEMENTED for a node type with no registered emitter, rather than silently skipping it', () => {
    const result = compile(spec([{ type: 'container' }]), siteProfile());

    expect(result.elements).toEqual([]);
    const diag = result.diagnostics.find((d) => d.code === 'EMISSION_NOT_IMPLEMENTED');
    expect(diag).toBeDefined();
    expect(diag?.path).toBe('elements[0].type');
  });

  it('does not partially apply — one unimplemented node fails the whole compile, not just that node', () => {
    const result = compile(
      spec([
        { type: 'widget', widgetType: 'heading', settings: {} },
        { type: 'container' }, // unimplemented in core
      ]),
      siteProfile(),
    );

    expect(result.elements).toEqual([]);
    expect(result.diagnostics.some((d) => d.code === 'EMISSION_NOT_IMPLEMENTED')).toBe(true);
  });

  it('assigns unique ids across the whole tree, including nested widget children — not just siblings', () => {
    const result = compile(
      spec([
        {
          type: 'widget',
          widgetType: 'heading',
          settings: {},
          children: [
            { type: 'widget', widgetType: 'heading', settings: {} },
            { type: 'widget', widgetType: 'heading', settings: {} },
          ],
        },
      ]),
      siteProfile(),
    );

    expect(result.diagnostics).toEqual([]);
    const top = result.elements[0]!;
    const childIds = top.elements!.map((c) => c.id);
    const allIds = [top.id, ...childIds];
    expect(new Set(allIds).size).toBe(allIds.length); // every id genuinely unique
    expect(top.elements).toHaveLength(2);
  });

  it('recurses into children and preserves them as the native elements array (§5.5: widgets are not always leaves)', () => {
    const result = compile(
      spec([
        {
          type: 'widget',
          widgetType: 'heading',
          settings: {},
          children: [{ type: 'widget', widgetType: 'heading', settings: { title: 'child' } }],
        },
      ]),
      siteProfile(),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]?.elements).toHaveLength(1);
    expect(result.elements[0]?.elements?.[0]?.widgetType).toBe('heading');
  });

  it('surfaces a nested child error with the correct nested path', () => {
    const result = compile(
      spec([
        {
          type: 'widget',
          widgetType: 'heading',
          settings: {},
          children: [{ type: 'widget', widgetType: 'nonexistent' }],
        },
      ]),
      siteProfile(),
    );

    const diag = result.diagnostics.find((d) => d.code === 'WIDGET_NOT_AVAILABLE');
    expect(diag?.path).toBe('elements[0].children[0].widgetType');
  });

  it('computes nativeness as the fraction of nodes that are not "html"', () => {
    // Deliberately triggers EMISSION_NOT_IMPLEMENTED for the non-widget
    // nodes (container/html have no core emitter) — nativeness/rawRatio
    // are still computed over the full input tree regardless of whether
    // the compile as a whole succeeded, since they describe spec intent.
    const result = compile(
      spec([
        { type: 'widget', widgetType: 'heading', settings: {} },
        { type: 'widget', widgetType: 'heading', settings: {} },
        { type: 'widget', widgetType: 'heading', settings: {} },
        { type: 'html', html: '<div></div>', reason: 'no equivalent' },
      ]),
      siteProfile(),
    );

    expect(result.nativeness).toBe(0.75); // 3 of 4 nodes are non-html
  });

  it('computes rawRatio as the fraction of nodes using "raw"', () => {
    const result = compile(
      spec([
        { type: 'widget', widgetType: 'heading', settings: {} },
        { type: 'widget', widgetType: 'heading', settings: {}, raw: { x: 1 }, reason: 'why' },
      ]),
      siteProfile(),
    );

    expect(result.rawRatio).toBe(0.5);
  });

  it('counts nested children toward nativeness/rawRatio, not just top-level nodes', () => {
    const result = compile(
      spec([
        {
          type: 'widget',
          widgetType: 'heading',
          settings: {},
          children: [{ type: 'html', html: '<div></div>', reason: 'x' }],
        },
      ]),
      siteProfile(),
    );

    expect(result.nativeness).toBe(0.5); // 1 of 2 total nodes (parent + child) is html
  });

  it('reports docMeta with the site\'s real Elementor version', () => {
    const result = compile(spec([]), siteProfile({ elementorVersion: '4.3.0' }));

    expect(result.docMeta.version).toBe('4.3.0');
    expect(result.docMeta.edit_mode).toBe('builder');
    expect(result.docMeta.template_type).toBe('wp-page');
  });

  it('handles a null elementorVersion (site info unavailable) without throwing', () => {
    const result = compile(spec([]), siteProfile({ elementorVersion: null }));

    expect(result.docMeta.version).toBeNull();
  });
});

describe('compile — emitter registry (registerEmitter/clearEmitters)', () => {
  afterEach(() => {
    // Always leave the registry in its real, module-load state for every
    // other test file that imports compile.ts in the same worker.
    clearEmitters();
    registerEmitter('widget', 'v3', REAL_WIDGET_EMITTER);
    registerEmitter('widget', 'v4', REAL_WIDGET_EMITTER);
  });

  // Captured once, from the module's own registered behavior, so these
  // tests can restore it after deliberately clearing the registry.
  const REAL_WIDGET_EMITTER = (node: SpecNode, ctx: { siteProfile: SiteProfile; path: string }): EmitOutcome => {
    if (node.type !== 'widget') throw new Error('unreachable');
    const exists = ctx.siteProfile.widgetRegistry.some((w) => w.name === node.widgetType);
    if (!exists) {
      return {
        element: null,
        diagnostics: [
          {
            path: `${ctx.path}.widgetType`,
            severity: 'error',
            code: 'WIDGET_NOT_AVAILABLE',
            message: `Widget "${node.widgetType}" is not registered on this site.`,
            allowed: ctx.siteProfile.widgetRegistry.map((w) => w.name),
          },
        ],
      };
    }
    return { element: { elType: 'widget', widgetType: node.widgetType, settings: node.settings ?? {} }, diagnostics: [] };
  };

  it('lets a future task (EMCP-050/051) register a real emitter for a currently-unimplemented type', () => {
    registerEmitter('container', 'v4', () => ({
      element: { elType: 'e-flexbox', settings: {} },
      diagnostics: [],
    }));

    const result = compile(spec([{ type: 'container' }]), siteProfile());

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]?.elType).toBe('e-flexbox');
  });

  it('a registered emitter only applies to its own generation', () => {
    registerEmitter('container', 'v3', () => ({
      element: { elType: 'container', settings: {} },
      diagnostics: [],
    }));

    // v4 still has no emitter for "container" — only v3 was registered above.
    const result = compile(spec([{ type: 'container' }]), siteProfile({ generation: 'v4' }));

    expect(result.diagnostics.some((d) => d.code === 'EMISSION_NOT_IMPLEMENTED')).toBe(true);
  });
});
