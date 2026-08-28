import type { Diagnostic } from '../domain/validate.js';

/**
 * EMCP-053 — Blueprints.md §2.8: "`raw` merges into compiled settings
 * under four constraints (P6)." Three of the four are this module's job
 * — deep merge, reserved-key denylist, value-level sanitisation (§8.3).
 * The other two are already done elsewhere and never repeated here:
 * `reason` is mandatory at the grammar layer (`REASON_REQUIRED`,
 * EMCP-048, `server/src/dsl/validate.ts`), and `raw_ratio` is already
 * computed over the whole tree (`compile()`, EMCP-049) regardless of
 * whether any given `raw` block turns out to be rejected.
 *
 * Wired in centrally by `compile.ts`, once, after every emitter runs —
 * not duplicated per emitter, per generation. `raw`'s mechanics (merge,
 * denylist, sanitise) don't vary by v3 vs v4; only *where* the merged
 * result lands does (`settings`, the one place both generations keep
 * their own DSL-derived, per-node data — never a v4 local-style
 * `variants[].props`, which §2.8's own wording ("merges into compiled
 * settings") doesn't cover, and which isn't per-node-exclusive the way
 * `settings` is).
 *
 * **Every violation is an error, not a silent clean-and-continue** —
 * §8.3's own words: "it produces a legible error instead of silent
 * stripping." A `raw` block that fails these checks fails the whole
 * compile (`compile()`'s existing all-or-nothing rule, EMCP-049/EMCP-048),
 * the same as any other diagnostic-producing failure in this compiler.
 */

/**
 * §2.8: "`__globals__`, `__dynamic__`, `_element_id`, and anything the
 * compiler owns." `classes` is v4-specific — `v4.ts`'s own emitters
 * generate and depend on that exact key for local-style-class linkage
 * (`withLocalStyle()`); a `raw` block overwriting it would silently
 * detach an element from styles this compiler just built for it.
 */
const UNIVERSAL_DENIED_KEYS = new Set(['__globals__', '__dynamic__', '_element_id']);
const V4_DENIED_KEYS = new Set([...UNIVERSAL_DENIED_KEYS, 'classes']);

/** §8.3's five rules, applied to every string value found anywhere in a `raw` block (recursively — a denylisted script tag three levels deep is exactly as dangerous as one at the top). */
const SCRIPT_TAG_PATTERN = /<\s*(script|iframe|object|embed)\b/i;
const EVENT_ATTRIBUTE_PATTERN = /\bon[a-z]+\s*=/i;
const DANGEROUS_URL_PATTERN = /(javascript|vbscript)\s*:/i;
const TOP_LEVEL_DATA_URL_PATTERN = /^\s*data\s*:/i;
const EXTERNAL_URL_PATTERN = /^https?:\/\//i;

export interface MergeRawResult {
  merged: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

/**
 * Deep-merges `raw` on top of `target` (§2.8 rule 1: "never replace, so
 * sibling structures survive") after checking every key against the
 * denylist and every string value against §8.3's sanitisation rules.
 * `raw` wins on a conflicting leaf key — it exists specifically for an
 * author to override or extend what the DSL alone produced.
 */
export function mergeRaw(
  target: Record<string, unknown>,
  raw: Record<string, unknown>,
  path: string,
  generation: 'v3' | 'v4',
): MergeRawResult {
  const diagnostics: Diagnostic[] = [];
  const deniedKeys = generation === 'v4' ? V4_DENIED_KEYS : UNIVERSAL_DENIED_KEYS;

  checkTree(raw, path, deniedKeys, diagnostics);

  if (diagnostics.some((d) => d.severity === 'error')) {
    return { merged: target, diagnostics };
  }

  return { merged: deepMerge(target, raw), diagnostics };
}

function checkTree(value: unknown, path: string, deniedKeys: Set<string>, diagnostics: Diagnostic[]): void {
  if (typeof value === 'string') {
    checkString(value, path, diagnostics);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, i) => checkTree(item, `${path}[${i}]`, deniedKeys, diagnostics));
    return;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (deniedKeys.has(key)) {
        diagnostics.push({
          path: `${path}.${key}`,
          severity: 'error',
          code: 'RAW_DENIED_KEY',
          message: `"${key}" is a reserved key and cannot be set via "raw" — it's set through dedicated DSL keys, or owned by the compiler itself.`,
          allowed: [...deniedKeys].sort(),
        });
        continue;
      }
      checkTree(child, `${path}.${key}`, deniedKeys, diagnostics);
    }
  }
}

function checkString(value: string, path: string, diagnostics: Diagnostic[]): void {
  if (SCRIPT_TAG_PATTERN.test(value)) {
    diagnostics.push(sanitisedError(path, 'contains a <script>/<iframe>/<object>/<embed> tag'));
    return;
  }
  if (EVENT_ATTRIBUTE_PATTERN.test(value)) {
    diagnostics.push(sanitisedError(path, 'contains an "on*" event handler attribute'));
    return;
  }
  if (DANGEROUS_URL_PATTERN.test(value) || TOP_LEVEL_DATA_URL_PATTERN.test(value.trim())) {
    diagnostics.push(sanitisedError(path, 'contains a javascript:/vbscript:/data: URL'));
    return;
  }
  if (EXTERNAL_URL_PATTERN.test(value.trim())) {
    diagnostics.push({
      path,
      severity: 'warning',
      code: 'RAW_SANITISED',
      message: `Value introduces an external URL ("${value}") — flagged for human review, not blocked.`,
    });
  }
}

function sanitisedError(path: string, reason: string): Diagnostic {
  return {
    path,
    severity: 'error',
    code: 'RAW_SANITISED',
    message: `Value ${reason} — rejected by §8.3's sanitisation rules, not silently stripped.`,
  };
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result[key];
    if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
