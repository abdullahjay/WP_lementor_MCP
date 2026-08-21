import type { FastifyBaseLogger } from 'fastify';
import type { PinoLoggerOptions } from 'fastify/types/logger.js';

/**
 * Structured logging config shared by every log line this process emits.
 * `service` and `env` let a correlation ID be traced across the Node/PHP
 * boundary later (solution.md §12) without grepping by process.
 */
export function loggerOptions(): PinoLoggerOptions {
  return {
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: {
      service: 'emcp-server',
      env: process.env['NODE_ENV'] ?? 'development',
    },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
}

export type Logger = FastifyBaseLogger;
