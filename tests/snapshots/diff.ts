export interface WidgetSnapshot {
  name: string;
  title: string;
  categories: string[];
  keywords: string[];
  controls: Record<string, unknown>;
}

export interface RegistrySnapshot {
  elementor_version: string | null;
  plugin_version: string;
  widget_count: number;
  widgets: WidgetSnapshot[];
}

export interface DriftEntry {
  kind: 'widget_added' | 'widget_removed' | 'widget_changed';
  widgetName: string;
  detail?: string;
}

/**
 * Pure comparison — no network, no filesystem. EMCP-018's live re-pull lives
 * in scripts/check-registry-drift.mjs; this is what it (and this file's own
 * unit test) both call, so the comparison logic itself is provably correct
 * independent of ever reaching a real sandbox.
 */
export function diffRegistrySnapshots(
  committed: RegistrySnapshot,
  current: RegistrySnapshot,
): DriftEntry[] {
  const committedByName = new Map(committed.widgets.map((widget) => [widget.name, widget]));
  const currentByName = new Map(current.widgets.map((widget) => [widget.name, widget]));
  const drift: DriftEntry[] = [];

  for (const name of currentByName.keys()) {
    if (!committedByName.has(name)) {
      drift.push({ kind: 'widget_added', widgetName: name });
    }
  }

  for (const name of committedByName.keys()) {
    if (!currentByName.has(name)) {
      drift.push({ kind: 'widget_removed', widgetName: name });
    }
  }

  for (const [name, committedWidget] of committedByName) {
    const currentWidget = currentByName.get(name);

    if (!currentWidget) {
      continue;
    }

    if (JSON.stringify(committedWidget.controls) !== JSON.stringify(currentWidget.controls)) {
      drift.push({ kind: 'widget_changed', widgetName: name, detail: 'controls differ' });
    }
  }

  return drift.sort((a, b) => a.widgetName.localeCompare(b.widgetName));
}

/**
 * ralphloop.md: "drift means Elementor changed. Investigate and record it;
 * re-pulling hides the signal the check exists to raise." That sentence is
 * deliberately embedded in the report text itself, not just this codebase's
 * docs — the person reading a failed CI job may never have read `ralphloop.md`.
 */
export function formatDriftReport(sandbox: string, drift: DriftEntry[]): string {
  if (drift.length === 0) {
    return `${sandbox}: no drift.`;
  }

  const lines = drift.map(
    (entry) => `  - ${entry.kind}: ${entry.widgetName}${entry.detail ? ` (${entry.detail})` : ''}`,
  );

  return [
    `${sandbox}: REGISTRY DRIFT DETECTED (${drift.length} change(s)).`,
    'This means Elementor (or its widget registry) changed on this sandbox since the committed snapshot was captured.',
    'Investigate before doing anything else. Do NOT regenerate the committed snapshot to make this pass — that hides the exact signal this check exists to raise.',
    ...lines,
  ].join('\n');
}
