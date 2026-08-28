import { beforeAll, describe, expect, it } from 'vitest';
import { compile, type SiteProfile } from './compile.js';
import { mergeRaw } from './raw.js';
import type { Spec, SpecNode } from './types.js';

async function loadEmitters(): Promise<void> {
  await import('./v3.js');
  await import('./v4.js');
}

function siteProfile(generation: 'v3' | 'v4'): SiteProfile {
  return {
    generation,
    elementorVersion: '4.2.3',
    breakpoints: {},
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

describe('mergeRaw — deep merge (§2.8 rule 1: never replace, sibling structures survive)', () => {
  it('merges a raw key alongside existing settings, leaving them untouched', () => {
    const { merged, diagnostics } = mergeRaw({ title: 'Hi' }, { title_color: '#fff' }, 'elements[0].raw', 'v3');

    expect(diagnostics).toEqual([]);
    expect(merged).toEqual({ title: 'Hi', title_color: '#fff' });
  });

  it('raw wins on a conflicting leaf key — it exists to override', () => {
    const { merged } = mergeRaw({ title: 'DSL value' }, { title: 'raw override' }, 'elements[0].raw', 'v3');

    expect(merged['title']).toBe('raw override');
  });

  it('deep-merges nested objects rather than replacing the whole sub-object', () => {
    const target = { image: { url: 'https://example.com/a.jpg', id: '' } };
    const raw = { image: { alt: 'A photo' } };

    const { merged } = mergeRaw(target, raw, 'elements[0].raw', 'v3');

    // "alt" is added; "url"/"id" survive — a shallow replace would have lost them.
    expect(merged).toEqual({ image: { url: 'https://example.com/a.jpg', id: '', alt: 'A photo' } });
  });

  it('an array value replaces rather than element-wise merging (arrays are not objects)', () => {
    const { merged } = mergeRaw({ items: ['a', 'b'] }, { items: ['c'] }, 'elements[0].raw', 'v3');

    expect(merged['items']).toEqual(['c']);
  });
});

describe('mergeRaw — reserved-key denylist (§2.8 rule 2), rejected with an error, not silently dropped', () => {
  it.each(['__globals__', '__dynamic__', '_element_id'])('rejects "%s" at the top level', (key) => {
    const { merged, diagnostics } = mergeRaw({}, { [key]: 'anything' }, 'elements[0].raw', 'v3');

    expect(merged).toEqual({}); // rejected — original target untouched
    const diag = diagnostics.find((d) => d.code === 'RAW_DENIED_KEY');
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe('error');
    expect(diag?.path).toBe(`elements[0].raw.${key}`);
  });

  it('rejects a reserved key nested inside raw, not just at the top level', () => {
    const { diagnostics } = mergeRaw({}, { nested: { __globals__: 'x' } }, 'elements[0].raw', 'v3');

    const diag = diagnostics.find((d) => d.code === 'RAW_DENIED_KEY');
    expect(diag?.path).toBe('elements[0].raw.nested.__globals__');
  });

  it('rejects "classes" on v4 — the compiler owns it for local-style-class linkage', () => {
    const { diagnostics } = mergeRaw({}, { classes: { $$type: 'classes', value: ['hijacked'] } }, 'elements[0].raw', 'v4');

    expect(diagnostics.some((d) => d.code === 'RAW_DENIED_KEY' && d.path === 'elements[0].raw.classes')).toBe(true);
  });

  it('does NOT reject "classes" on v3 — it is not a reserved key there', () => {
    const { diagnostics } = mergeRaw({}, { classes: 'my-class' }, 'elements[0].raw', 'v3');

    expect(diagnostics).toEqual([]);
  });
});

describe('mergeRaw — value sanitisation (§8.3), rejected with an error, not silently stripped', () => {
  it('rejects a <script> tag', () => {
    const { merged, diagnostics } = mergeRaw({}, { html: '<script>alert(1)</script>' }, 'elements[0].raw', 'v3');

    expect(merged).toEqual({});
    const diag = diagnostics.find((d) => d.code === 'RAW_SANITISED');
    expect(diag?.severity).toBe('error');
  });

  it.each(['<iframe src="x">', '<object data="x">', '<embed src="x">'])('rejects "%s"', (value) => {
    const { diagnostics } = mergeRaw({}, { html: value }, 'elements[0].raw', 'v3');

    expect(diagnostics.some((d) => d.code === 'RAW_SANITISED' && d.severity === 'error')).toBe(true);
  });

  it('rejects an on* event handler attribute', () => {
    const { diagnostics } = mergeRaw({}, { html: '<div onclick="doEvil()">x</div>' }, 'elements[0].raw', 'v3');

    expect(diagnostics.some((d) => d.code === 'RAW_SANITISED')).toBe(true);
  });

  it('rejects a javascript: URL', () => {
    const { diagnostics } = mergeRaw({}, { link: { url: 'javascript:alert(1)' } }, 'elements[0].raw', 'v3');

    expect(diagnostics.some((d) => d.code === 'RAW_SANITISED')).toBe(true);
  });

  it('rejects a vbscript: URL', () => {
    const { diagnostics } = mergeRaw({}, { link: { url: 'vbscript:msgbox(1)' } }, 'elements[0].raw', 'v3');

    expect(diagnostics.some((d) => d.code === 'RAW_SANITISED')).toBe(true);
  });

  it('rejects a top-level data: URL', () => {
    const { diagnostics } = mergeRaw({}, { src: 'data:text/html,<script>alert(1)</script>' }, 'elements[0].raw', 'v3');

    expect(diagnostics.some((d) => d.code === 'RAW_SANITISED')).toBe(true);
  });

  it('warns (does not reject) on an external http(s) URL — "flag for human review", not blocked', () => {
    const { merged, diagnostics } = mergeRaw({}, { link: 'https://example.com/x' }, 'elements[0].raw', 'v3');

    expect(merged).toEqual({ link: 'https://example.com/x' }); // still applied
    const diag = diagnostics.find((d) => d.code === 'RAW_SANITISED');
    expect(diag?.severity).toBe('warning');
  });

  it('accepts an ordinary benign value with no diagnostics at all', () => {
    const { merged, diagnostics } = mergeRaw({}, { title_color: '#ff0000' }, 'elements[0].raw', 'v3');

    expect(diagnostics).toEqual([]);
    expect(merged).toEqual({ title_color: '#ff0000' });
  });

  it('checks string values nested inside arrays too', () => {
    const { diagnostics } = mergeRaw({}, { items: ['fine', '<script>bad</script>'] }, 'elements[0].raw', 'v3');

    expect(diagnostics.some((d) => d.code === 'RAW_SANITISED' && d.path === 'elements[0].raw.items[1]')).toBe(true);
  });
});

describe('raw — wired centrally into compile(), same for v3 and v4', () => {
  it('merges raw into the real v3 heading emitter\'s output, on top of the DSL-derived settings', () => {
    const result = compile(
      spec([
        {
          type: 'heading',
          text: 'Hi',
          raw: { title_color: '#ff0000' },
          reason: 'no DSL color property yet',
        },
      ]),
      siteProfile('v3'),
    );

    /* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.any(String) is untyped by design */
    expect(result.diagnostics).toEqual([
      { path: 'elements[0]', severity: 'warning', code: 'NATIVENESS_LOW', message: expect.any(String) },
    ]);
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    expect(result.elements[0]?.['settings']).toEqual({ title: 'Hi', title_color: '#ff0000' });
  });

  it('merges raw into the real v4 heading emitter\'s output the same way', () => {
    const result = compile(
      spec([{ type: 'heading', text: 'Hi', raw: { tag: { $$type: 'string', value: 'h1' } }, reason: 'override tag' }]),
      siteProfile('v4'),
    );

    /* eslint-disable @typescript-eslint/no-unsafe-assignment -- expect.any(String) is untyped by design */
    expect(result.diagnostics).toEqual([
      { path: 'elements[0]', severity: 'warning', code: 'NATIVENESS_LOW', message: expect.any(String) },
    ]);
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    expect(result.elements[0]?.['settings']).toMatchObject({ tag: { $$type: 'string', value: 'h1' } });
  });

  it('a rejected raw block fails the whole compile (elements: []), same all-or-nothing rule as everything else', () => {
    const result = compile(
      spec([{ type: 'heading', text: 'Hi', raw: { __globals__: 'x' }, reason: 'trying to sneak a global' }]),
      siteProfile('v3'),
    );

    expect(result.elements).toEqual([]);
    expect(result.diagnostics.some((d) => d.code === 'RAW_DENIED_KEY')).toBe(true);
  });

  it('a rejected raw block on one node fails the whole spec, even with other valid nodes present', () => {
    const result = compile(
      spec([
        { type: 'heading', text: 'Fine' },
        { type: 'button', text: 'Bad', raw: { link: 'javascript:alert(1)' }, reason: 'x' },
      ]),
      siteProfile('v3'),
    );

    expect(result.elements).toEqual([]);
  });

  it('raw is still counted into rawRatio even when it gets rejected — the metric is about intent, not success', () => {
    const result = compile(
      spec([{ type: 'heading', text: 'Hi', raw: { __globals__: 'x' }, reason: 'x' }]),
      siteProfile('v3'),
    );

    expect(result.rawRatio).toBe(1);
  });

  it('an external URL in raw warns but does not block a v3 compile', () => {
    const result = compile(
      spec([{ type: 'button', text: 'Go', raw: { link: { url: 'https://external.example/x' } }, reason: 'custom link shape' }]),
      siteProfile('v3'),
    );

    expect(result.elements).toHaveLength(1);
    expect(result.diagnostics.some((d) => d.code === 'RAW_SANITISED' && d.severity === 'warning')).toBe(true);
  });
});
