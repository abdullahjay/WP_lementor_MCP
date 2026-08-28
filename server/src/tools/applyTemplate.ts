import { parseSpec } from '../dsl/validate.js';
import type { ToolImplementation } from '../protocol/types.js';
import { getTemplate, TemplateNotFoundError, WordPressApiError } from '../wp/client.js';
import { applyCompiledSpec } from './applyCompiledSpec.js';

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
    document_hash: { type: 'string' },
    diagnostics: { type: 'array', items: DIAGNOSTIC_SCHEMA },
    nativeness: { type: 'number' },
    raw_ratio: { type: 'number' },
    applied: { type: 'boolean' },
    path: { type: 'string', enum: ['draft', 'autosave'] },
  },
  required: ['document_hash', 'diagnostics', 'nativeness', 'raw_ratio', 'applied', 'path'],
  additionalProperties: false,
} as const;

/**
 * EMCP-061 — Blueprints.md §7.8/prd.md Task 61. Instantiates a stored
 * template (`save_as_template`, EMCP-060) onto a page — fetches the
 * template's spec (`GET /templates/{id}`), then runs the exact same
 * `applyCompiledSpec()` pipeline `apply_page_spec` uses. "Regenerates
 * element IDs" (prd.md) needs no extra work here: `compile()` already
 * generates fresh, whole-tree-unique ids on every call (`generateUniqueId()`,
 * EMCP-049) — applying the same template twice, to the same page or two
 * different ones, produces two different id sets simply because each is a
 * fresh `compile()` call, never a copy of a previous result.
 */
export const applyTemplateTool: ToolImplementation = {
  name: 'apply_template',
  description:
    "Instantiates a saved template (from save_as_template) onto a page, " +
    'compiling its stored spec fresh against this site — element IDs are ' +
    'always regenerated, so applying the same template more than once never ' +
    'produces id collisions. Replaces the target page\'s entire content, the ' +
    'same way apply_page_spec does (use edit_elements instead to patch ' +
    'specific existing elements). Requires the document_hash from ' +
    'get_page_structure/get_element as a compare-and-swap. Pass dry_run: ' +
    "true to validate the template against this site without writing " +
    'anything — useful for checking whether a template authored on a Pro ' +
    'site will apply cleanly to a Free one before committing to it.',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The target post ID, from list_pages.' },
      template_id: { type: 'integer', description: 'The template ID, from list_templates.' },
      document_hash: {
        type: 'string',
        description: 'The document_hash from a prior read of the target post — enforced as a compare-and-swap.',
      },
      dry_run: {
        type: 'boolean',
        description: 'Validate and compile without writing anything. Default false.',
      },
      idempotency_key: {
        type: 'string',
        description: 'A caller-chosen key making a retried call safe — see apply_page_spec\'s description.',
      },
    },
    required: ['post_id', 'template_id', 'document_hash'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },

  async handler(args, correlationId) {
    const postId = args?.['post_id'];
    const templateId = args?.['template_id'];
    const expectedHash = args?.['document_hash'];
    const dryRun = args?.['dry_run'] === true;

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return errorResult('apply_template requires an integer "post_id".');
    }

    if (typeof templateId !== 'number' || !Number.isInteger(templateId)) {
      return errorResult('apply_template requires an integer "template_id".');
    }

    if (typeof expectedHash !== 'string' || expectedHash === '') {
      return errorResult('apply_template requires a non-empty string "document_hash".');
    }

    const idempotencyKey =
      typeof args?.['idempotency_key'] === 'string' && args['idempotency_key'] !== ''
        ? args['idempotency_key']
        : undefined;

    let template;
    try {
      template = await getTemplate(templateId);
    } catch (error) {
      return { content: [{ type: 'text', text: describeTemplateError(error) }], isError: true };
    }

    const { spec, diagnostics: parseDiagnostics } = parseSpec(template.spec);

    if (!spec) {
      // A stored template failing parseSpec would mean save_as_template's
      // own decompile() output was somehow corrupted between save and
      // fetch — genuinely unexpected, but reported the same structured way
      // as any other compile failure rather than a bare error string.
      const result = { document_hash: '', diagnostics: parseDiagnostics, nativeness: 0, raw_ratio: 0, applied: false, path: 'draft' as const };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true,
      };
    }

    return applyCompiledSpec({
      toolName: 'apply_template',
      postId,
      expectedHash,
      spec,
      dryRun,
      idempotencyKey,
      correlationId,
    });
  },
};

function errorResult(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function describeTemplateError(error: unknown): string {
  if (error instanceof TemplateNotFoundError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `apply_template failed: ${error instanceof Error ? error.message : String(error)}`;
}
