import type { FastifyRequest } from 'fastify';
import type { JsonRpcRequest } from './types.js';

export const SUPPORTED_PROTOCOL_VERSION = '2026-07-28';

const HEADER_NAMES = {
  protocolVersion: 'mcp-protocol-version',
  method: 'mcp-method',
  name: 'mcp-name',
} as const;

const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';

/**
 * Methods whose request carries a `name` or `uri` identifying *what* is
 * being called, not just the method itself — the spec requires `Mcp-Name`
 * only for these (modelcontextprotocol.io/specification/2026-07-28's
 * Streamable HTTP "Standard Request Headers" table). Every other method,
 * including `ping` and `server/discover`, has nothing for `Mcp-Name` to
 * name — a real `claude-code/2.1.240` `server/discover` request correctly
 * omits it, which is what caught the earlier unconditional-requirement bug.
 */
const METHODS_REQUIRING_NAME_HEADER = new Set(['tools/call', 'resources/read', 'prompts/get']);

export interface MetaValidationResult {
  ok: boolean;
  message?: string;
}

/**
 * Cross-checks the transport-level headers against the JSON-RPC body.
 * Per the Streamable HTTP spec, the header/body correspondence is NOT "one
 * unified _meta object" (the earlier version of this function invented that
 * shape and it never matched a real client) — it's three independent pairs:
 *
 *   MCP-Protocol-Version  <-> params._meta['io.modelcontextprotocol/protocolVersion']
 *   Mcp-Method             <-> body.method
 *   Mcp-Name (conditional) <-> body.params.name  (or .uri for resources/read)
 */
export function validateMeta(request: FastifyRequest, body: JsonRpcRequest): MetaValidationResult {
  const headerProtocolVersion = headerValue(request, HEADER_NAMES.protocolVersion);
  const headerMethod = headerValue(request, HEADER_NAMES.method);
  const headerName = headerValue(request, HEADER_NAMES.name);

  const nameHeaderRequired = METHODS_REQUIRING_NAME_HEADER.has(body.method);

  const missing: string[] = [];
  if (headerProtocolVersion === undefined) missing.push('MCP-Protocol-Version');
  if (headerMethod === undefined) missing.push('Mcp-Method');
  if (nameHeaderRequired && headerName === undefined) missing.push('Mcp-Name');

  if (missing.length > 0) {
    return { ok: false, message: `Missing required header(s): ${missing.join(', ')}.` };
  }

  if (headerProtocolVersion !== SUPPORTED_PROTOCOL_VERSION) {
    return {
      ok: false,
      message: `Unsupported MCP-Protocol-Version "${headerProtocolVersion}" — this server implements "${SUPPORTED_PROTOCOL_VERSION}".`,
    };
  }

  const bodyProtocolVersion = body.params?._meta?.[PROTOCOL_VERSION_META_KEY];

  if (bodyProtocolVersion === undefined) {
    return {
      ok: false,
      message: `Request body is missing params._meta["${PROTOCOL_VERSION_META_KEY}"].`,
    };
  }

  if (bodyProtocolVersion !== headerProtocolVersion) {
    return {
      ok: false,
      message: `MCP-Protocol-Version header ("${headerProtocolVersion}") does not match params._meta["${PROTOCOL_VERSION_META_KEY}"] ("${bodyProtocolVersion}").`,
    };
  }

  if (headerMethod !== body.method) {
    return {
      ok: false,
      message: `Mcp-Method header ("${headerMethod}") does not match the request's "method" ("${body.method}").`,
    };
  }

  if (nameHeaderRequired) {
    const bodyName = body.params?.['name'] ?? body.params?.['uri'];

    // Base64-sentinel decoding (=?base64?...?=) for non-ASCII names is a
    // real part of the spec's Value Encoding rules that this comparison
    // does not implement yet — every tool this server registers has a
    // plain-ASCII name, so it hasn't been needed. Flagged, not silently
    // skipped: revisit if a future tool/resource name needs it.
    if (headerName !== bodyName) {
      return {
        ok: false,
        message: `Mcp-Name header ("${headerName}") does not match the request body's name/uri ("${String(bodyName)}").`,
      };
    }
  }

  return { ok: true };
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}
