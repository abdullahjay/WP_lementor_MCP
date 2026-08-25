import { describe, expect, it } from 'vitest';
import {
  diffRegistrySnapshots,
  formatDriftReport,
  type RegistrySnapshot,
} from '../snapshots/diff.js';

function makeSnapshot(widgets: RegistrySnapshot['widgets']): RegistrySnapshot {
  return {
    elementor_version: '4.2.3',
    plugin_version: '0.1.0',
    widget_count: widgets.length,
    widgets,
  };
}

const HEADING = {
  name: 'heading',
  title: 'Heading',
  categories: ['basic'],
  keywords: ['heading', 'title'],
  controls: { title: { type: 'text', label: 'Title' } },
};

const BUTTON = {
  name: 'button',
  title: 'Button',
  categories: ['basic'],
  keywords: ['button', 'link'],
  controls: { text: { type: 'text', label: 'Text' } },
};

describe('diffRegistrySnapshots', () => {
  it('reports no drift when snapshots are identical', () => {
    const snapshot = makeSnapshot([HEADING, BUTTON]);

    expect(diffRegistrySnapshots(snapshot, snapshot)).toEqual([]);
  });

  it('detects a widget added since the committed snapshot', () => {
    const committed = makeSnapshot([HEADING]);
    const current = makeSnapshot([HEADING, BUTTON]);

    const drift = diffRegistrySnapshots(committed, current);

    expect(drift).toEqual([{ kind: 'widget_added', widgetName: 'button' }]);
  });

  it('detects a widget removed since the committed snapshot', () => {
    const committed = makeSnapshot([HEADING, BUTTON]);
    const current = makeSnapshot([HEADING]);

    const drift = diffRegistrySnapshots(committed, current);

    expect(drift).toEqual([{ kind: 'widget_removed', widgetName: 'button' }]);
  });

  it('detects a changed control on an existing widget', () => {
    const committed = makeSnapshot([HEADING]);
    const changedHeading = {
      ...HEADING,
      controls: { title: { type: 'text', label: 'Title' }, size: { type: 'select' } },
    };
    const current = makeSnapshot([changedHeading]);

    const drift = diffRegistrySnapshots(committed, current);

    expect(drift).toEqual([
      { kind: 'widget_changed', widgetName: 'heading', detail: 'controls differ' },
    ]);
  });

  it('reports multiple drift entries sorted by widget name', () => {
    const committed = makeSnapshot([HEADING, BUTTON]);
    const current = makeSnapshot([BUTTON]); // heading removed

    const drift = diffRegistrySnapshots(committed, current);

    expect(drift.map((entry) => entry.widgetName)).toEqual(['heading']);
  });
});

describe('formatDriftReport', () => {
  it('reports cleanly when there is no drift', () => {
    expect(formatDriftReport('wp-v4-pro', [])).toBe('wp-v4-pro: no drift.');
  });

  it('states plainly what drift means and forbids silently regenerating the snapshot', () => {
    const report = formatDriftReport('wp-v4-pro', [
      { kind: 'widget_added', widgetName: 'e-new-widget' },
    ]);

    expect(report).toContain('DRIFT DETECTED');
    expect(report).toContain('Elementor');
    expect(report).toContain('changed');
    expect(report).toMatch(/investigate/i);
    expect(report).toMatch(/do not regenerate/i);
    expect(report).toContain('e-new-widget');
  });
});
