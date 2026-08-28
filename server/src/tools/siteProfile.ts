import type { BreakpointConfig, SiteProfile } from '../dsl/compile.js';
import type { RawWidget } from '../domain/curation.js';
import { getSite, listWidgets } from '../wp/client.js';

/**
 * Thrown when the connected site's default generation is `legacy` —
 * `compile()`'s emitter tables only cover `v3`/`v4` (Blueprints.md §5.1:
 * "legacy is Create: No"), so there is genuinely no generation this
 * compiler can target for such a site.
 */
export class UnsupportedGenerationError extends Error {
  constructor(public readonly generation: string) {
    super(
      `This site's default generation is "${generation}" — the DSL compiler only supports authoring "v3" or "v4" content (legacy sections/columns are read-only, per Blueprints.md §5.1).`,
    );
  }
}

/**
 * EMCP-055: assembles a real `SiteProfile` (`server/src/dsl/compile.ts`)
 * from live tool calls — `GET /site` for generation/breakpoints/proTier/
 * experiments, `GET /widgets` for the registry `emitWidgetNode` checks
 * `WIDGET_NOT_AVAILABLE` against. The first real caller to build this from
 * live data rather than a hand-written test fixture (`compile.test.ts`'s
 * own `siteProfile()` helper).
 */
export async function buildSiteProfile(): Promise<SiteProfile> {
  const [site, widgets] = await Promise.all([getSite(), listWidgets()]);

  const generationDefault = site['generation_default'];
  if (generationDefault !== 'v3' && generationDefault !== 'v4') {
    throw new UnsupportedGenerationError(String(generationDefault));
  }

  const widgetList = Array.isArray(widgets['widgets']) ? widgets['widgets'] : [];
  const widgetRegistry: RawWidget[] = widgetList.map((w) => {
    const widget = w as { name: string; title: string; categories: string[]; keywords: string[] };
    return { ...widget, controls: {} };
  });

  return {
    generation: generationDefault,
    elementorVersion: typeof site['elementor_version'] === 'string' ? site['elementor_version'] : null,
    breakpoints: (site['breakpoints'] ?? {}) as Record<string, BreakpointConfig>,
    kitTokens: {},
    widgetRegistry,
    proTier: typeof site['pro_tier'] === 'string' ? site['pro_tier'] : 'free',
    activeExperiments: (site['experiments'] ?? {}) as Record<string, string>,
  };
}
