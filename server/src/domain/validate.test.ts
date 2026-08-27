import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateWidgetSettings } from './validate.js';
import type { RawWidget } from './curation.js';

const HEADING: RawWidget = {
  name: 'heading',
  title: 'Heading',
  categories: ['general'],
  keywords: ['heading', 'title'],
  controls: {
    title: { type: 'textarea', label: 'Title', default: 'Add Your Heading Text Here' },
    size: {
      type: 'select',
      label: 'Size',
      default: 'default',
      options: { small: 'Small', default: 'Default', large: 'Large' },
      condition: { 'size!': 'default' },
    },
    typography_font_size: {
      type: 'slider',
      label: 'Size',
      condition: { 'typography_typography!': '' },
    },
    typography_typography: { type: 'select', label: 'Typography', default: '', options: { '': 'Default', custom: 'Custom' } },
    link_url: { type: 'text', label: 'Link URL', condition: { link: ['custom'] } },
    link: { type: 'select', label: 'Link Type', default: 'none', options: { none: 'None', custom: 'Custom' } },
  },
};

const REGISTRY: RawWidget[] = [HEADING];

describe('validateWidgetSettings: widget existence', () => {
  it('returns no diagnostics for a fully valid settings object', () => {
    const diagnostics = validateWidgetSettings('heading', { title: 'Hello' }, REGISTRY);
    expect(diagnostics).toEqual([]);
  });

  it('flags an unregistered widget with WIDGET_NOT_AVAILABLE', () => {
    const diagnostics = validateWidgetSettings('not-a-real-widget', {}, REGISTRY);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'WIDGET_NOT_AVAILABLE', path: 'settings' });
  });

  it('suggests the closest real widget name for a near-miss typo', () => {
    const diagnostics = validateWidgetSettings('headin', {}, REGISTRY);
    expect(diagnostics[0]?.suggestion).toBe('heading');
  });

  it('omits suggestion when nothing is close enough', () => {
    const diagnostics = validateWidgetSettings('completely-unrelated-xyz', {}, REGISTRY);
    expect(diagnostics[0]?.suggestion).toBeUndefined();
  });
});

describe('validateWidgetSettings: control existence', () => {
  it('flags a settings key that is not a real control, with the JSON path and allowed list', () => {
    const diagnostics = validateWidgetSettings('heading', { titel: 'Hello' }, REGISTRY);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'CONTROL_NOT_FOUND', path: 'settings.titel' });
    expect(diagnostics[0]?.allowed).toContain('title');
  });

  it('suggests the closest real control name for a near-miss typo', () => {
    const diagnostics = validateWidgetSettings('heading', { titel: 'Hello' }, REGISTRY);
    expect(diagnostics[0]?.suggestion).toBe('title');
  });

  it('prefixes the path with a custom basePath when given', () => {
    const diagnostics = validateWidgetSettings('heading', { titel: 'Hello' }, REGISTRY, {
      basePath: 'elements[2].settings',
    });
    expect(diagnostics[0]?.path).toBe('elements[2].settings.titel');
  });
});

describe('validateWidgetSettings: control conditions (singular `condition`)', () => {
  it('passes when a conditioned control\'s negative-suffix condition is satisfied', () => {
    // size!: "default" means "visible when size is NOT default"
    const diagnostics = validateWidgetSettings('heading', { size: 'large' }, REGISTRY);
    expect(diagnostics).toEqual([]);
  });

  it('flags CONTROL_CONDITION_UNMET when the negated condition is not satisfied', () => {
    const diagnostics = validateWidgetSettings('heading', { size: 'default' }, REGISTRY);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'CONTROL_CONDITION_UNMET', path: 'settings.size' });
  });

  it('treats a missing referenced key as condition-unmet, matching Elementor\'s own behavior', () => {
    const diagnostics = validateWidgetSettings('heading', { typography_font_size: '20px' }, REGISTRY);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'CONTROL_CONDITION_UNMET' });
  });

  it('passes when the referenced key is present and non-empty (typography_typography set)', () => {
    const diagnostics = validateWidgetSettings(
      'heading',
      { typography_typography: 'custom', typography_font_size: '20px' },
      REGISTRY,
    );
    expect(diagnostics).toEqual([]);
  });

  it('handles array-valued conditions (array "contains" semantics both ways)', () => {
    const passing = validateWidgetSettings('heading', { link: 'custom', link_url: '/x' }, REGISTRY);
    expect(passing).toEqual([]);

    const failing = validateWidgetSettings('heading', { link: 'none', link_url: '/x' }, REGISTRY);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({ code: 'CONTROL_CONDITION_UNMET', path: 'settings.link_url' });
  });
});

describe('validateWidgetSettings: control conditions (plural `conditions`, terms/relation)', () => {
  const WITH_PLURAL: RawWidget = {
    name: 'test-widget',
    title: 'Test',
    categories: [],
    keywords: [],
    controls: {
      mode: { type: 'select', label: 'Mode', default: 'a', options: { a: 'A', b: 'B', c: 'C' } },
      extra: {
        type: 'text',
        label: 'Extra',
        conditions: {
          relation: 'or',
          terms: [
            { name: 'mode', operator: '==', value: 'b' },
            { name: 'mode', operator: '==', value: 'c' },
          ],
        },
      },
    },
  };

  it('honours an OR relation across terms', () => {
    expect(validateWidgetSettings('test-widget', { mode: 'b', extra: 'x' }, [WITH_PLURAL])).toEqual([]);
    expect(validateWidgetSettings('test-widget', { mode: 'c', extra: 'x' }, [WITH_PLURAL])).toEqual([]);

    const failing = validateWidgetSettings('test-widget', { mode: 'a', extra: 'x' }, [WITH_PLURAL]);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({ code: 'CONTROL_CONDITION_UNMET', path: 'settings.extra' });
  });
});

describe('validateWidgetSettings: against the real committed registry snapshot (EMCP-018)', () => {
  const snapshotPath = fileURLToPath(new URL('../../../tests/snapshots/wp-v4-pro.json', import.meta.url));
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
    snapshot: { widgets: RawWidget[] };
  };
  const realRegistry = snapshot.snapshot.widgets;

  it('finds the real heading widget and validates its real "size!" condition', () => {
    const passing = validateWidgetSettings('heading', { size: 'large' }, realRegistry);
    expect(passing).toEqual([]);

    const failing = validateWidgetSettings('heading', { size: 'default' }, realRegistry);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({ code: 'CONTROL_CONDITION_UNMET', path: 'settings.size' });
  });

  it('flags a widget name that has never existed on this real registry', () => {
    const diagnostics = validateWidgetSettings('definitely-not-a-widget', {}, realRegistry);
    expect(diagnostics[0]).toMatchObject({ code: 'WIDGET_NOT_AVAILABLE' });
  });
});
