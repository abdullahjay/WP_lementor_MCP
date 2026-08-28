import '../dsl/v3.js';
import '../dsl/v4.js';
import { compile } from '../dsl/compile.js';
import { parseSpec } from '../dsl/validate.js';
import type { ToolImplementation } from '../protocol/types.js';
import { WordPressApiError } from '../wp/client.js';
import { buildSiteProfile, UnsupportedGenerationError } from './siteProfile.js';

const DIAGNOSTIC_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    severity: { type: 'string' },
    code: { type: 'string' },
    message: { type: 'string' },
    allowed: { type: 'array' },
    suggestion: { type: 'string' },
  },
  required: ['path', 'severity', 'code', 'message'],
} as const;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    valid: { type: 'boolean' },
    diagnostics: { type: 'array', items: DIAGNOSTIC_SCHEMA },
    nativeness: { type: 'number' },
    raw_ratio: { type: 'number' },
  },
  required: ['valid', 'diagnostics', 'nativeness', 'raw_ratio'],
  additionalProperties: false,
} as const;

/**
 * EMCP-055 — Blueprints.md §7's confusable-pairs note: `apply_page_spec`
 * vs `edit_elements`, and per solution.md §5.4: "`validate_page_spec` is
 * standalone and read-only, for checking a spec before a target page
 * exists." No `post_id` — parses and compiles the given spec against the
 * connected site's real generation/registry, and reports diagnostics
 * without ever touching a document. `dry_run` on `apply_page_spec` covers
 * validating against a *specific* target page instead.
 */
export const validatePageSpecTool: ToolImplementation = {
  name: 'validate_page_spec',
  description:
    'Validates a page spec (the DSL Blueprints.md §2 documents) against the ' +
    'connected site — grammar, then compilation against the real widget ' +
    'registry and generation (V3/V4) — without writing anything or requiring ' +
    'a target page to already exist. Returns diagnostics, whether the spec ' +
    'is valid, and nativeness/raw_ratio (how much of the tree maps to real ' +
    'registry widgets vs. the "raw"/"html" escape rungs). Use this to check ' +
    'a spec before calling apply_page_spec, or when there is no target page ' +
    'yet. To validate against a specific existing page instead, use ' +
    'apply_page_spec with dry_run: true.',
  inputSchema: {
    type: 'object',
    properties: { spec: { type: 'object', description: 'A page spec per Blueprints.md §2.' } },
    required: ['spec'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler(args) {
    const { spec, diagnostics: parseDiagnostics } = parseSpec(args?.['spec']);

    if (!spec) {
      const result = { valid: false, diagnostics: parseDiagnostics, nativeness: 0, raw_ratio: 0 };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true,
      };
    }

    try {
      const siteProfile = await buildSiteProfile();
      const compiled = compile(spec, siteProfile);
      const hasErrors = compiled.diagnostics.some((d) => d.severity === 'error');
      const result = {
        valid: !hasErrors,
        diagnostics: compiled.diagnostics,
        nativeness: compiled.nativeness,
        raw_ratio: compiled.rawRatio,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: hasErrors,
      };
    } catch (error) {
      return { content: [{ type: 'text', text: describeError(error) }], isError: true };
    }
  },
};

function describeError(error: unknown): string {
  if (error instanceof UnsupportedGenerationError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `validate_page_spec failed: ${error instanceof Error ? error.message : String(error)}`;
}
