import Fastify, { type FastifyInstance } from 'fastify';
import { correlationIdGenerator, registerCorrelationHeader } from './correlation.js';
import { loggerOptions } from './logger.js';
import { renderScreenshot } from '../render.js';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

interface RenderRequestBody {
  url?: unknown;
  selector?: unknown;
  allowedHost?: unknown;
  extraHeaders?: unknown;
  viewportWidth?: unknown;
  viewportHeight?: unknown;
}

/**
 * EMCP-031/EMCP-034: the renderer service itself — a real Playwright-backed
 * HTTP server, isolated (render_net only, no DB/credential-store
 * reachability — `scripts/test-renderer-isolation.sh` proves this
 * structurally).
 *
 * `POST /render` only rejects non-http(s) schemes here — that's a baseline
 * sanity check, **not** the SSRF control; the real one (RFC1918/loopback/
 * link-local rejection, re-checked after every redirect, plus the
 * `allowedHost` exception — EMCP-032/034) lives in `render.ts`/`egress.ts`.
 * Still unauthenticated at the HTTP layer — the caller (`server/`'s
 * `render_preview` tool) is the trusted side that decides `allowedHost` and
 * supplies the preview token as `extraHeaders`; this endpoint doesn't
 * verify a token itself (no credential store, solution.md §9.5).
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: loggerOptions(),
    genReqId: correlationIdGenerator,
  });

  registerCorrelationHeader(app);

  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post('/render', async (request, reply) => {
    const body = request.body as RenderRequestBody | undefined;
    const url = body?.url;

    if (typeof url !== 'string' || url.length === 0) {
      reply.code(400);
      return { error: 'Request body must include a non-empty string "url".' };
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reply.code(400);
      return { error: 'The provided "url" is not a valid URL.' };
    }

    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      reply.code(400);
      return { error: `Scheme "${parsed.protocol}" is not allowed — only http/https.` };
    }

    const selector = typeof body?.selector === 'string' ? body.selector : undefined;
    const allowedHost = typeof body?.allowedHost === 'string' ? body.allowedHost : undefined;
    const extraHeaders = isStringRecord(body?.extraHeaders) ? body.extraHeaders : undefined;
    const viewportWidth = typeof body?.viewportWidth === 'number' ? body.viewportWidth : undefined;
    const viewportHeight = typeof body?.viewportHeight === 'number' ? body.viewportHeight : undefined;

    try {
      const png = await renderScreenshot(parsed.toString(), {
        ...(selector !== undefined && { selector }),
        ...(allowedHost !== undefined && { allowedHost }),
        ...(extraHeaders !== undefined && { extraHeaders }),
        ...(viewportWidth !== undefined && viewportHeight !== undefined && { viewportWidth, viewportHeight }),
      });
      reply.header('content-type', 'image/png');
      return await reply.send(png);
    } catch (error) {
      request.log.error({ err: error }, 'Render failed');
      reply.code(502);
      return { error: `Failed to render "${url}".` };
    }
  });

  return app;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}
