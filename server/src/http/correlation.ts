import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Fastify's default genReqId is a per-process counter, which is fine for a
 * single instance but useless once a request's log lines need to be found
 * again from the plugin side (solution.md §12: "A failed apply_page_spec can
 * be a DSL error, a compiler bug, a bridge failure, a PHP fatal, an
 * Elementor rejection or a cache no-op — without traces crossing the
 * boundary that is a three-hour debug, daily."). A UUID per request, echoed
 * back to the caller, is what makes that boundary crossable.
 */
export function correlationIdGenerator(): string {
  return randomUUID();
}

export function registerCorrelationHeader(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header(CORRELATION_HEADER, request.id);
    return payload;
  });
}
