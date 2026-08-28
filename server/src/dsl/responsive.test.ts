import { beforeAll, describe, expect, it } from 'vitest';
import { compile, type BreakpointConfig, type SiteProfile } from './compile.js';
import type { Spec, SpecNode } from './types.js';

async function loadEmitters(): Promise<void> {
  await import('./v3.js');
  await import('./v4.js');
}

/**
 * EMCP-052 — the real, live-confirmed `GET /site` breakpoints shape
 * (`wp-v4-pro`, `plugin/src/Rest/SiteController.php`): `desktop` is
 * deliberately absent (Elementor's implicit base case, never itself a
 * configurable breakpoint), `mobile_extra`/`tablet_extra`/`laptop` are
 * present but disabled by default, and `widescreen` is the one
 * `direction: 'min'` entry (CLAUDE.md's gotcha) — everything else `'max'`.
 */
const REAL_BREAKPOINTS: Record<string, BreakpointConfig> = {
  mobile: { enabled: true, direction: 'max', value: 767 },
  mobile_extra: { enabled: false, direction: 'max', value: 880 },
  tablet: { enabled: true, direction: 'max', value: 1024 },
  tablet_extra: { enabled: false, direction: 'max', value: 1200 },
  laptop: { enabled: false, direction: 'max', value: 1366 },
  widescreen: { enabled: true, direction: 'min', value: 2400 },
};

function siteProfile(generation: 'v3' | 'v4'): SiteProfile {
  return {
    generation,
    elementorVersion: '4.2.3',
    breakpoints: REAL_BREAKPOINTS,
    kitTokens: {},
    widgetRegistry: [],
    proTier: 'essential',
    activeExperiments: {},
  };
}

function spec(elements: SpecNode[]): Spec {
  return { dslVersion: 1, page: { title: 'Test Page' }, elements };
}

beforeAll(async () => {
  await loadEmitters();
});

describe('responsive — breakpoint validation (§2.9: "Unknown breakpoint names are an error")', () => {
  it('rejects an unconfigured breakpoint name on v3', () => {
    const result = compile(
      spec([{ type: 'container', responsive: { fourk: { layout: { direction: 'column' } } } }]),
      siteProfile('v3'),
    );

    expect(result.elements).toEqual([]);
    const diag = result.diagnostics.find((d) => d.code === 'BREAKPOINT_UNKNOWN');
    expect(diag).toBeDefined();
    expect(diag?.allowed).toEqual(expect.arrayContaining(['mobile', 'tablet', 'widescreen']));
    expect(diag?.allowed).not.toContain('laptop'); // disabled — not in the real "allowed" set
  });

  it('rejects an unconfigured breakpoint name on v4', () => {
    const result = compile(
      spec([{ type: 'container', responsive: { fourk: { layout: { direction: 'column' } } } }]),
      siteProfile('v4'),
    );

    expect(result.elements).toEqual([]);
    expect(result.diagnostics.some((d) => d.code === 'BREAKPOINT_UNKNOWN')).toBe(true);
  });

  it('rejects a real but disabled breakpoint (laptop) — configured is not the same as enabled', () => {
    const result = compile(
      spec([{ type: 'container', responsive: { laptop: { layout: { direction: 'column' } } } }]),
      siteProfile('v3'),
    );

    expect(result.diagnostics.some((d) => d.code === 'BREAKPOINT_UNKNOWN')).toBe(true);
  });

  it('rejects "desktop" as a responsive key — it is the implicit base case, never itself configurable', () => {
    const result = compile(
      spec([{ type: 'container', responsive: { desktop: { layout: { direction: 'column' } } } }]),
      siteProfile('v4'),
    );

    expect(result.diagnostics.some((d) => d.code === 'BREAKPOINT_UNKNOWN')).toBe(true);
  });

  it('does not partially apply — one bad breakpoint fails the whole compile even alongside a valid one', () => {
    const result = compile(
      spec([
        {
          type: 'container',
          responsive: {
            tablet: { layout: { direction: 'column' } },
            fourk: { layout: { direction: 'row' } },
          },
        },
      ]),
      siteProfile('v3'),
    );

    expect(result.elements).toEqual([]);
  });
});

describe('responsive — v3 emits suffixed keys, confirmed live convention', () => {
  it('emits _tablet/_mobile suffixed keys alongside the unsuffixed desktop key', () => {
    const result = compile(
      spec([
        {
          type: 'container',
          layout: { direction: 'row' },
          responsive: {
            tablet: { layout: { direction: 'column' } },
            mobile: { layout: { gap: 8 } },
          },
        },
      ]),
      siteProfile('v3'),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]?.['settings']).toMatchObject({
      flex_direction: 'row',
      flex_direction_tablet: 'column',
      flex_gap_mobile: { unit: 'px', column: '8', row: '8', isLinked: true },
    });
  });

  it('emits the widescreen suffix the same generic way as every other breakpoint — no special-cased shape', () => {
    const result = compile(
      spec([{ type: 'container', responsive: { widescreen: { layout: { gap: 40 } } } }]),
      siteProfile('v3'),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]?.['settings']).toMatchObject({
      flex_gap_widescreen: { unit: 'px', column: '40', row: '40', isLinked: true },
    });
  });

  it('a container with only responsive overrides (no desktop layout) still compiles', () => {
    const result = compile(
      spec([{ type: 'container', responsive: { tablet: { layout: { direction: 'column' } } } }]),
      siteProfile('v3'),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.elements[0]?.['settings']).toEqual({ flex_direction_tablet: 'column' });
  });
});

describe('responsive — v4 adds variants to the same styles array, matching responsive-widescreen.json\'s real shape', () => {
  it('emits one variant per breakpoint in the same flat variants array, including widescreen', () => {
    const result = compile(
      spec([
        {
          type: 'container',
          layout: { direction: 'column' },
          responsive: {
            widescreen: { layout: { gap: 40 } },
            tablet: { layout: { direction: 'row' } },
          },
        },
      ]),
      siteProfile('v4'),
    );

    expect(result.diagnostics).toEqual([]);
    const styles = result.elements[0]?.['styles'] as Record<string, { variants: { meta: { breakpoint: string } }[] }>;
    const [className] = Object.keys(styles);
    const breakpoints = styles[className!]!.variants.map((v) => v.meta.breakpoint).sort();
    expect(breakpoints).toEqual(['desktop', 'tablet', 'widescreen']);
  });

  it('the widescreen variant carries no special shape — same {meta,props,custom_css} as any other breakpoint (confirmed against responsive-widescreen.json)', () => {
    const result = compile(
      spec([{ type: 'container', responsive: { widescreen: { layout: { gap: 40 } } } }]),
      siteProfile('v4'),
    );

    const styles = result.elements[0]?.['styles'] as Record<string, { variants: unknown[] }>;
    const [className] = Object.keys(styles);
    const variant = styles[className!]!.variants[0] as { meta: unknown; props: unknown; custom_css: unknown };
    expect(variant).toEqual({
      meta: { breakpoint: 'widescreen', state: null },
      props: { gap: { $$type: 'size', value: { unit: 'px', size: 40 } } },
      custom_css: null,
    });
  });

  it('a widget (not just container) with only responsive overrides still gets a local style class', () => {
    const result = compile(
      spec([{ type: 'heading', text: 'Hi', responsive: { tablet: { layout: { minHeight: '40px' } } } }]),
      siteProfile('v4'),
    );

    expect(result.diagnostics).toEqual([]);
    const settings = result.elements[0]?.['settings'] as { classes?: { value: string[] } };
    expect(settings.classes?.value).toHaveLength(1);
  });

  it('no styles/classes at all when responsive gives nothing mappable (e.g. only unmapped style properties)', () => {
    const result = compile(spec([{ type: 'container' }]), siteProfile('v4'));

    expect(result.elements[0]?.['styles']).toBeUndefined();
  });
});

describe('responsive — cross-generation: the same DSL spec compiles under both, breakpoint validation identical', () => {
  it('the same invalid breakpoint is rejected the same way on v3 and v4', () => {
    const badSpec = spec([{ type: 'container', responsive: { bogus: { layout: { direction: 'column' } } } }]);

    const v3Result = compile(badSpec, siteProfile('v3'));
    const v4Result = compile(badSpec, siteProfile('v4'));

    expect(v3Result.diagnostics[0]?.code).toBe('BREAKPOINT_UNKNOWN');
    expect(v4Result.diagnostics[0]?.code).toBe('BREAKPOINT_UNKNOWN');
  });
});
