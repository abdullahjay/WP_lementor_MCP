import type { RawControl, RawWidget } from './curation.js';

/**
 * EMCP-036: structural validation of a *proposed* write against the real,
 * live widget registry (`GET /registry/snapshot`, EMCP-017/018) — before
 * anything is ever written. Blueprints.md §3.4's diagnostic shape, at the
 * widget/settings granularity rather than a full DSL spec tree (the
 * compiler, EMCP-048+, doesn't exist yet; this module is what it — and the
 * eventual `edit_elements`, EMCP-043 — will both call).
 *
 * Three checks, matching this task's stated ACs exactly:
 * 1. The widget exists on this site (`WIDGET_NOT_AVAILABLE`).
 * 2. Every settings key is a real control name for that widget
 *    (`CONTROL_NOT_FOUND`).
 * 3. A settings key whose control has a `condition`/`conditions` that the
 *    rest of the given settings don't satisfy (`CONTROL_CONDITION_UNMET`)
 *    — CLAUDE.md's registry gotcha: "settings that Elementor ignores at
 *    render time pass validation... producing 'wrote it, nothing changed'"
 *    if this isn't checked.
 */

export interface Diagnostic {
  path: string;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  allowed?: string[];
  suggestion?: string;
}

export interface ValidateOptions {
  /** Prefixed onto every diagnostic's `path` — e.g. `"elements[2].settings"` from a future compiler's spec tree. Defaults to `"settings"`. */
  basePath?: string;
}

export function validateWidgetSettings(
  widgetType: string,
  settings: Record<string, unknown>,
  registry: RawWidget[],
  options: ValidateOptions = {},
): Diagnostic[] {
  const basePath = options.basePath ?? 'settings';
  const widget = registry.find((w) => w.name === widgetType);

  if (!widget) {
    const names = registry.map((w) => w.name);
    const diagnostic: Diagnostic = {
      path: basePath,
      severity: 'error',
      code: 'WIDGET_NOT_AVAILABLE',
      message: `Widget "${widgetType}" is not registered on this site.`,
    };
    const suggestion = closestMatch(widgetType, names);
    return [suggestion !== undefined ? { ...diagnostic, suggestion } : diagnostic];
  }

  const controlNames = Object.keys(widget.controls);
  const diagnostics: Diagnostic[] = [];

  for (const key of Object.keys(settings)) {
    const control = widget.controls[key];

    if (!control) {
      const diagnostic: Diagnostic = {
        path: `${basePath}.${key}`,
        severity: 'error',
        code: 'CONTROL_NOT_FOUND',
        message: `"${key}" is not a real control on the "${widgetType}" widget.`,
        allowed: controlNames,
      };
      const suggestion = closestMatch(key, controlNames);
      diagnostics.push(suggestion !== undefined ? { ...diagnostic, suggestion } : diagnostic);
      continue;
    }

    if (!isControlVisible(control, settings)) {
      diagnostics.push({
        path: `${basePath}.${key}`,
        severity: 'error',
        code: 'CONTROL_CONDITION_UNMET',
        message: `"${key}"'s control condition is not satisfied by the given settings — Elementor would ignore this value at render time.`,
      });
    }
  }

  return diagnostics;
}

/**
 * Faithful (with two documented simplifications) port of Elementor's own
 * `Controls_Stack::is_control_visible()` (`includes/base/controls-stack.php`)
 * — read from the real Elementor 4.2.3 source, not guessed at, since a
 * plausible-looking reimplementation that disagrees with the real engine
 * is worse than none (CLAUDE.md: "Introspect Elementor, never hardcode").
 *
 * Simplified, deliberately, vs. the PHP original:
 * - No responsive device-suffix resolution (the PHP checks a `_tablet`/
 *   `_mobile` sibling when the referencing control is itself responsive).
 *   `curation.ts` already collapses responsive variants before a curated
 *   widget reaches a caller; this module works against the *raw* registry
 *   shape, where the base (desktop) value is the one settings realistically
 *   carry.
 * - No "parent control" climbing fallback (an empty referenced value
 *   walking up a `parent` chain) — a legacy repeater-control mechanism with
 *   no current fixture or live widget observed using it.
 * Both are narrow, named gaps, not silent guesses — revisit if a real
 * widget's condition is ever found to depend on either.
 */
function isControlVisible(control: RawControl, values: Record<string, unknown>): boolean {
  if (control.conditions && !checkConditions(control.conditions, values)) {
    return false;
  }

  if (!control.condition) {
    return true;
  }

  for (const [conditionKey, conditionValue] of Object.entries(control.condition)) {
    const parsed = /^([a-z_\-0-9]+)(?:\[([a-z_]+)])?(!?)$/i.exec(conditionKey);
    if (!parsed) {
      continue;
    }
    const [, pureKey = '', subKey, negationFlag] = parsed;
    const isNegative = negationFlag === '!';

    const rawValue = values[pureKey];
    if (rawValue === undefined || rawValue === null) {
      return false;
    }

    let instanceValue: unknown = rawValue;
    if (subKey) {
      if (typeof instanceValue !== 'object' || instanceValue === null || !(subKey in instanceValue)) {
        return false;
      }
      instanceValue = (instanceValue as Record<string, unknown>)[subKey];
    }

    const isContains = computeContains(instanceValue, conditionValue);

    if ((isNegative && isContains) || (!isNegative && !isContains)) {
      return false;
    }
  }

  return true;
}

function computeContains(instanceValue: unknown, conditionValue: unknown): boolean {
  if (Array.isArray(conditionValue) && conditionValue.length > 0) {
    return conditionValue.some((v) => strictEquals(v, instanceValue));
  }
  if (Array.isArray(instanceValue) && instanceValue.length > 0) {
    return instanceValue.some((v) => strictEquals(v, conditionValue));
  }
  return strictEquals(instanceValue, conditionValue);
}

interface ConditionTerm {
  name?: string;
  operator?: string;
  value?: unknown;
  terms?: ConditionTerm[];
  relation?: string;
}

/** Port of `Conditions::check()` / `Conditions::compare()` (`includes/conditions.php`). */
function checkConditions(conditions: Record<string, unknown>, values: Record<string, unknown>): boolean {
  const terms = (conditions['terms'] as ConditionTerm[] | undefined) ?? [];
  const isOr = conditions['relation'] === 'or';
  const succeeded = !isOr;

  for (const term of terms) {
    let result: boolean;

    if (term.terms && term.terms.length > 0) {
      result = checkConditions(term as unknown as Record<string, unknown>, values);
    } else {
      const parsed = /^(\w+)(?:\[(\w+)])?/.exec(term.name ?? '');
      const pureName = parsed?.[1] ?? '';
      const subKey = parsed?.[2];
      let value = values[pureName];
      if (subKey && typeof value === 'object' && value !== null) {
        value = (value as Record<string, unknown>)[subKey];
      }
      result = compare(value, term.value, term.operator);
    }

    if (isOr) {
      if (result) {
        return true;
      }
    } else if (!result) {
      return false;
    }
  }

  return succeeded;
}

function compare(left: unknown, right: unknown, operator: string | undefined): boolean {
  switch (operator) {
    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    case '!==':
      return !strictEquals(left, right);
    case 'in':
      return Array.isArray(right) && right.some((v) => strictEquals(v, left));
    case '!in':
      return !(Array.isArray(right) && right.some((v) => strictEquals(v, left)));
    case 'contains':
      return Array.isArray(left) && left.some((v) => strictEquals(v, right));
    case '!contains':
      return !(Array.isArray(left) && left.some((v) => strictEquals(v, right)));
    case '<':
    case '<=':
    case '>':
    case '>=':
      return compareOrdered(left, right, operator);
    default:
      return strictEquals(left, right);
  }
}

function compareOrdered(left: unknown, right: unknown, operator: '<' | '<=' | '>' | '>='): boolean {
  if (typeof left !== 'number' && typeof left !== 'string') return false;
  if (typeof right !== 'number' && typeof right !== 'string') return false;
  switch (operator) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
}

function strictEquals(a: unknown, b: unknown): boolean {
  return a === b;
}

/** PHP's `==` on scalars — string/number coercion, otherwise identity. */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((typeof a === 'number' || typeof a === 'string') && (typeof b === 'number' || typeof b === 'string')) {
    return String(a) === String(b) || Number(a) === Number(b);
  }
  return false;
}

/**
 * A short, cheap Levenshtein — only ever run over one mistyped name against
 * a registry of real names, never in a hot path. No suggestion below a
 * confidence floor (distance > half the target's length) rather than
 * offering a misleading one.
 */
function closestMatch(target: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = levenshtein(target, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (best === undefined || bestDistance > Math.max(2, Math.ceil(target.length / 2))) {
    return undefined;
  }

  return best;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, (_, i) => [
    i,
    ...Array.from({ length: cols - 1 }, () => 0),
  ]);
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}
