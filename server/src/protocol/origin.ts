import type { FastifyRequest } from 'fastify';

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost', 'https://localhost'];

/**
 * The Origin check exists to stop a malicious *webpage* from talking to this
 * server through a victim's browser (DNS rebinding) — it has nothing to
 * protect against for a non-browser client. Claude Code's local bridge,
 * `mcp-remote`, and curl don't send an Origin header at all, so absence is
 * allowed; presence means a browser context, which must be on the
 * allowlist.
 */
export function isOriginAllowed(request: FastifyRequest): boolean {
  const origin = request.headers['origin'];

  if (origin === undefined) {
    return true;
  }

  return allowedOrigins().includes(origin);
}

function allowedOrigins(): string[] {
  const configured = process.env['MCP_ALLOWED_ORIGINS'];

  if (!configured) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return configured
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
