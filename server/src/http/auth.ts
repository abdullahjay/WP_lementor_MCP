import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const PUBLIC_PATHS = new Set(['/healthz']);

export class AuthConfigError extends Error {}

/**
 * Local header auth. solution.md §11.4 / CLAUDE.md: Claude Code connects
 * locally via a header token; OAuth 2.1 (EMCP-056+) only applies against a
 * deployed environment, so this mechanism is deliberately simple and is
 * superseded before any real deployment happens (§9.3), not hardened for one.
 */
export function registerHeaderAuth(app: FastifyInstance): void {
  const expectedToken = process.env['MCP_HEADER_AUTH_TOKEN'];

  if (!expectedToken) {
    throw new AuthConfigError(
      'MCP_HEADER_AUTH_TOKEN is not set — refusing to start without an auth token.',
    );
  }

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC_PATHS.has(request.url)) {
      return;
    }

    const token = extractBearerToken(request.headers['authorization']);

    if (!token || !constantTimeEquals(token, expectedToken)) {
      await reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header.',
        },
      });
    }
  });
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') {
    return null;
  }

  const [scheme, value] = header.split(' ');

  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return null;
  }

  return value;
}

/**
 * Fixed-size digest comparison so neither branch length nor input length
 * leaks through timing, unlike a direct string/charCode comparison.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();

  return timingSafeEqual(digestA, digestB);
}
