import { buildServer } from './http/server.js';
import { closeBrowser } from './render.js';

const port = Number(process.env['RENDERER_INTERNAL_PORT'] ?? 3100);
const host = '0.0.0.0';

const app = buildServer();

async function shutdown(): Promise<void> {
  await app.close();
  await closeBrowser();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

app.listen({ port, host }).catch((error: unknown) => {
  app.log.error(error, 'Failed to start emcp-renderer');
  process.exit(1);
});
