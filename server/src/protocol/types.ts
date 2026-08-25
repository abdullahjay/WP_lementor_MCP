/**
 * MCP revision 2026-07-28 (solution.md §3): sessions and the `initialize`
 * handshake no longer exist. Every request instead carries its own protocol
 * identity via headers, cross-checked against this `_meta` block in the
 * body (EMCP-006).
 */
export interface JsonRpcRequestMeta {
  protocolVersion: string;
  method: string;
  name: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
  _meta?: JsonRpcRequestMeta;
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
) => Promise<Record<string, unknown>> | Record<string, unknown>;

/**
 * A `content` block in an MCP tool result — Blueprints.md §7's "results also
 * carry serialized JSON in a text block for compatibility" alongside
 * `structuredContent`, which is what `outputSchema` actually validates.
 */
export interface ToolContentBlock {
  type: 'text';
  text: string;
}

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
  handler: (
    args: Record<string, unknown> | undefined,
  ) => Promise<ToolCallResult> | ToolCallResult;
}
