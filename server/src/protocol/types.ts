/**
 * MCP revision 2026-07-28 (solution.md §3): sessions and the `initialize`
 * handshake no longer exist. Every request instead carries its own protocol
 * identity via per-request metadata.
 *
 * `_meta` lives inside `params`, not as a top-level sibling of `method` —
 * confirmed against a real `claude-code/2.1.240` request (EMCP-006 follow-up;
 * the original flat top-level shape here was an unverified guess that a real
 * client's request never matched). Keys are namespaced per the spec's `_meta`
 * convention; there is no `_meta.method`/`_meta.name` — the header/body
 * cross-checks for those two use `body.method` and `body.params.name`/`.uri`
 * directly (see meta.ts).
 */
export interface JsonRpcRequestMeta {
  'io.modelcontextprotocol/protocolVersion': string;
  'io.modelcontextprotocol/clientInfo'?: Record<string, unknown>;
  'io.modelcontextprotocol/clientCapabilities'?: Record<string, unknown>;
}

export interface JsonRpcRequestParams {
  _meta?: JsonRpcRequestMeta;
  [key: string]: unknown;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: JsonRpcRequestParams;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result: Record<string, unknown>;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export type MethodHandler = (
  params: Record<string, unknown> | undefined,
  correlationId?: string,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

/**
 * A `content` block in an MCP tool result — Blueprints.md §7's "results also
 * carry serialized JSON in a text block for compatibility" alongside
 * `structuredContent`, which is what `outputSchema` actually validates.
 */
export interface ToolTextContentBlock {
  type: 'text';
  text: string;
}

/** `render_preview`'s `return_image: true` path (Blueprints.md §7.4) — inline base64, never SVG. */
export interface ToolImageContentBlock {
  type: 'image';
  data: string;
  mimeType: 'image/png';
}

export type ToolContentBlock = ToolTextContentBlock | ToolImageContentBlock;

export interface ToolCallResult {
  content: ToolContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

/** The shape `tools/list` returns for one tool — no `handler` in it. */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  cacheScope: 'private' | 'public';
  ttlMs: number;
  annotations?: ToolAnnotations;
}

export interface ToolImplementation extends ToolDescriptor {
  /**
   * `correlationId` is Fastify's own request id (`route.ts`'s
   * `request.id`), threaded down from `registry.ts`'s `dispatch()` —
   * solution.md: "Correlation IDs generated in Node, propagated into every
   * WP REST call, written to ledger rows, echoed in every result and
   * error." Optional on the type (not every tool needs it, and it keeps
   * every handler already written before EMCP-043 — none of which declare
   * it — structurally valid without touching them) but always supplied by
   * the real dispatch path; only a direct unit-test call to `tool.handler`
   * would ever see it as `undefined`.
   */
  handler: (
    args: Record<string, unknown> | undefined,
    correlationId?: string,
  ) => Promise<ToolCallResult> | ToolCallResult;
}
