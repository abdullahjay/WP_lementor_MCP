import type { PinoLoggerOptions } from 'fastify/types/logger.js';

/**
 * Same shape as `server/src/http/logger.ts` — `service`/`env` let a
 * correlation ID be traced across the renderer/Node-server boundary
 * (solution.md §12), even though this is a separate package with its own
 * isolated network segment (§9.5), not shared code with `server/`.
 */
export function loggerOptions(): PinoLoggerOptions {
  return {
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: {
      service: 'emcp-renderer',
      env: process.env['NODE_ENV'] ?? 'development',
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
}
