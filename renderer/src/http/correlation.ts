import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const CORRELATION_HEADER = 'x-correlation-id';

/** Same pattern as `server/src/http/correlation.ts` — see its docblock. */
export function correlationIdGenerator(): string {
  return randomUUID();
}

export function registerCorrelationHeader(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header(CORRELATION_HEADER, request.id);
    return payload;
  });
}
