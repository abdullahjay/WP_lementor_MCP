import type { JsonRpcResponse } from './types.js';

/**
 * -32601 is JSON-RPC 2.0's standard "Method not found". -32020 is this
 * project's own code, in JSON-RPC's reserved server-error band
 * (-32000..-32099), for the header/`_meta` cross-validation failure that
 * has no standard equivalent (prd.md EMCP-006, Blueprints.md §8.2).
 */
export const JsonRpcErrorCode = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  META_MISMATCH: -32020,
} as const;

export function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Thrown by dispatch-time code (unknown tool, malformed tools/call params)
 * that belongs on the JSON-RPC error channel per Blueprints.md §8.1 — as
 * opposed to a tool's own business-logic failure (WordPress unreachable, a
 * missing widget), which a tool handler reports via `isError: true` in a
 * normal 200 result instead of throwing. route.ts is the only place that
 * catches this.
 */
export class JsonRpcMethodError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
  }
}
