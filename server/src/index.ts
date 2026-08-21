import { buildServer } from './http/server.js';

const port = Number(process.env['MCP_PORT'] ?? 3000);
const host = process.env['MCP_HOST'] ?? '0.0.0.0';

const app = buildServer();

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error, 'Failed to start emcp-server');
  process.exitCode = 1;
}
