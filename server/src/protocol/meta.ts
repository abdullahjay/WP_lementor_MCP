import type { FastifyRequest } from 'fastify';
import type { JsonRpcRequest } from './types.js';

export const SUPPORTED_PROTOCOL_VERSION = '2026-07-28';

const HEADER_NAMES = {
  protocolVersion: 'mcp-protocol-version',
  method: 'mcp-method',
  name: 'mcp-name',
} as const;

export interface MetaValidationResult {
  ok: boolean;
  message?: string;
}

/**
 * Cross-checks the transport-level headers against the JSON-RPC body's
 * `_meta` block and the request's own `method` field. EMCP-006's
 * acceptance criterion names exactly these three headers; a mismatch in
 * either direction (header present but body's `_meta` disagrees, or a
 * header missing outright) is treated the same way — both mean a client
 * that can't be trusted to route a mutating call correctly.
 */
export function validateMeta(request: FastifyRequest, body: JsonRpcRequest): MetaValidationResult {
  const headerProtocolVersion = headerValue(request, HEADER_NAMES.protocolVersion);
  const headerMethod = headerValue(request, HEADER_NAMES.method);
  const headerName = headerValue(request, HEADER_NAMES.name);

  const missing: string[] = [];
  if (headerProtocolVersion === undefined) missing.push('MCP-Protocol-Version');
  if (headerMethod === undefined) missing.push('Mcp-Method');
  if (headerName === undefined) missing.push('Mcp-Name');

  if (missing.length > 0) {
    return { ok: false, message: `Missing required header(s): ${missing.join(', ')}.` };
  }

  const meta = body._meta;

  if (!meta) {
    return { ok: false, message: 'Request body is missing "_meta".' };
  }

  if (headerProtocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
    return {
      ok: false,
      message: `Unsupported MCP-Protocol-Version "${headerProtocolVersion}" — this server implements "${SUPPORTED_PROTOCOL_VERSION}".`,
    };
  }

  if (meta.protocolVersion !== headerProtocolVersion) {
    return {
      ok: false,
      message: `MCP-Protocol-Version header ("${headerProtocolVersion}") does not match _meta.protocolVersion ("${meta.protocolVersion}").`,
    };
  }

  if (meta.method !== headerMethod) {
    return {
      ok: false,
      message: `Mcp-Method header ("${headerMethod}") does not match _meta.method ("${meta.method}").`,
    };
  }

  if (meta.name !== headerName) {
    return {
      ok: false,
      message: `Mcp-Name header ("${headerName}") does not match _meta.name ("${meta.name}").`,
    };
  }

  if (meta.method !== body.method) {
    return {
      ok: false,
      message: `_meta.method ("${meta.method}") does not match the request's "method" ("${body.method}").`,
    };
  }

  return { ok: true };
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}
