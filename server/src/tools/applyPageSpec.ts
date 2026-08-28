import { parseSpec } from '../dsl/validate.js';
import type { ToolImplementation } from '../protocol/types.js';
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
 * EMCP-055 — Blueprints.md §7.1. Compiles a DSL spec (`server/src/dsl/
 * compile.ts`) into a full native element tree and **replaces** the whole
 * document with it — contrast with `edit_elements`, which patches specific
 * existing elements' settings. The actual write pipeline (document fetch,
 * `compile()`, dry_run short-circuit, snapshot/write/cache-invalidate,
 * ledger, idempotency) is shared with `apply_template` (EMCP-061) via
 * `applyCompiledSpec()` — this handler's own job is only parsing/validating
 * *this* tool's specific input shape (an inline `spec`) before handing off.
 */
export const applyPageSpecTool: ToolImplementation = {
  name: 'apply_page_spec',
  description:
    'Compiles a page spec (the DSL Blueprints.md §2 documents) and replaces ' +
    "an existing page's entire content with the result, in one document " +
    'save. Unlike edit_elements, which patches specific elements\' settings, ' +
    'this replaces the whole tree — use edit_elements instead when you only ' +
    'need to change settings on elements that already exist. Requires the ' +
    'document_hash from get_page_structure/get_element (or a prior ' +
    'apply_page_spec/edit_elements response) as a compare-and-swap — a ' +
    'stale hash is refused, not silently overwritten. Pass dry_run: true to ' +
    'validate against this specific page\'s site without writing anything ' +
    '(use validate_page_spec instead if there is no target page yet). ' +
    'Pass idempotency_key to make a retry safe after a timeout or dropped ' +
    'response.',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      document_hash: {
        type: 'string',
        description: 'The document_hash from a prior read of this post — enforced as a compare-and-swap.',
      },
      spec: { type: 'object', description: 'A page spec per Blueprints.md §2.' },
      dry_run: {
        type: 'boolean',
        description: 'Validate and compile without writing anything. Default false.',
      },
      idempotency_key: {
        type: 'string',
        description: 'A caller-chosen key making a retried call safe — see the tool description.',
      },
    },
    required: ['post_id', 'document_hash', 'spec'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },

  async handler(args, correlationId) {
    const postId = args?.['post_id'];
    const expectedHash = args?.['document_hash'];
    const dryRun = args?.['dry_run'] === true;

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return errorResult('apply_page_spec requires an integer "post_id".');
    }

    if (typeof expectedHash !== 'string' || expectedHash === '') {
      return errorResult('apply_page_spec requires a non-empty string "document_hash".');
    }

    const { spec, diagnostics: parseDiagnostics } = parseSpec(args?.['spec']);

    if (!spec) {
      const result = { document_hash: '', diagnostics: parseDiagnostics, nativeness: 0, raw_ratio: 0, applied: false, path: 'draft' as const };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: true,
      };
    }

    const idempotencyKey =
      typeof args?.['idempotency_key'] === 'string' && args['idempotency_key'] !== ''
        ? args['idempotency_key']
        : undefined;

    return applyCompiledSpec({
      toolName: 'apply_page_spec',
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
