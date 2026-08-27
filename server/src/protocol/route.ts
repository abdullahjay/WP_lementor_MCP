import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { jsonRpcError, JsonRpcErrorCode, JsonRpcMethodError } from './errors.js';
import { validateMeta } from './meta.js';
import { isOriginAllowed } from './origin.js';
import type { MethodRegistry } from './registry.js';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';

const MCP_ROUTE = '/mcp';

export function registerMcpRoute(app: FastifyInstance, registry: MethodRegistry): void {
  app.post(MCP_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    await handlePost(request, reply, registry);
  });

  // Streamable HTTP under MCP 2026-07-28 has no session/SSE stream on this
  // transport — sessions and `initialize` were removed (solution.md §3).
  // GET (stream open) and DELETE (session termination) were legal verbs in
  // older revisions; reject them explicitly here rather than letting
  // Fastify's default 404 leave the distinction ambiguous to a client.
  app.get(MCP_ROUTE, async (_request: FastifyRequest, reply: FastifyReply) => {
    await methodNotAllowed(reply);
  });
  app.delete(MCP_ROUTE, async (_request: FastifyRequest, reply: FastifyReply) => {
    await methodNotAllowed(reply);
  });
}

async function methodNotAllowed(reply: FastifyReply): Promise<void> {
  await reply
    .code(405)
    .header('allow', 'POST')
    .send({ error: { code: 'METHOD_NOT_ALLOWED', message: 'This route only accepts POST.' } });
}

async function handlePost(
  request: FastifyRequest,
  reply: FastifyReply,
  registry: MethodRegistry,
): Promise<void> {
  if (!isOriginAllowed(request)) {
    await reply
      .code(403)
      .send({ error: { code: 'ORIGIN_REJECTED', message: 'Origin header is not on the allowlist.' } });
    return;
  }

  const body = request.body;

  if (!isJsonRpcRequest(body)) {
    await reply
      .code(400)
      .send(jsonRpcError(null, JsonRpcErrorCode.INVALID_REQUEST, 'Malformed JSON-RPC request.'));
    return;
  }

  const requestId = body.id ?? null;
  const metaResult = validateMeta(request, body);

  if (!metaResult.ok) {
    await reply
      .code(400)
      .send(
        jsonRpcError(
          requestId,
          JsonRpcErrorCode.META_MISMATCH,
          metaResult.message ?? 'Header/_meta mismatch.',
        ),
      );
    return;
  }

  if (!registry.has(body.method)) {
    await reply
      .code(404)
      .send(
        jsonRpcError(
          requestId,
          JsonRpcErrorCode.METHOD_NOT_FOUND,
          `Method not found: ${body.method}`,
        ),
      );
    return;
  }

  let result: Record<string, unknown>;

  try {
    result = await registry.dispatch(body.method, body.params, request.id);
  } catch (error) {
    if (error instanceof JsonRpcMethodError) {
      await reply.code(error.httpStatus).send(jsonRpcError(requestId, error.code, error.message));
      return;
    }

    request.log.error(error, 'Unhandled error dispatching method');
    await reply.code(500).send(jsonRpcError(requestId, -32603, 'Internal error.'));
    return;
  }

  // A request with no id is a notification (JSON-RPC 2.0): process it, but
  // send no response body. Still 200-class so infra doesn't read it as a
  // failure.
  if (body.id === undefined || body.id === null) {
    await reply.code(202).send();
    return;
  }

  const response: JsonRpcResponse = { jsonrpc: '2.0', id: body.id, result };

  await reply.code(200).send(response);
}

function isJsonRpcRequest(body: unknown): body is JsonRpcRequest {
  if (typeof body !== 'object' || body === null) {
    return false;
  }

  const candidate = body as Record<string, unknown>;

  return candidate['jsonrpc'] === '2.0' && typeof candidate['method'] === 'string';
}
