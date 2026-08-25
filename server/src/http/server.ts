import Fastify, { type FastifyInstance } from 'fastify';
import { registerHeaderAuth } from './auth.js';
import { correlationIdGenerator, registerCorrelationHeader } from './correlation.js';
import { loggerOptions } from './logger.js';
import { MethodRegistry } from '../protocol/registry.js';
import { registerMcpRoute } from '../protocol/route.js';
import { getSiteInfoTool } from '../tools/getSiteInfo.js';
import { listPagesTool } from '../tools/listPages.js';
import { getPageStructureTool } from '../tools/getPageStructure.js';
import { getElementTool } from '../tools/getElement.js';
import { findElementsTool } from '../tools/findElements.js';
import { listWidgetsTool } from '../tools/listWidgets.js';
import { describeWidgetTool } from '../tools/describeWidget.js';

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: loggerOptions(),
    genReqId: correlationIdGenerator,
  });

  registerCorrelationHeader(app);
  registerHeaderAuth(app);

  // Unauthenticated on purpose (auth.ts's PUBLIC_PATHS) — container
  // orchestration needs to probe liveness before any client presents a
  // token.
  app.get('/healthz', async () => ({ status: 'ok' }));

  const registry = new MethodRegistry();
  registry.registerTool(getSiteInfoTool);
  registry.registerTool(listPagesTool);
  registry.registerTool(getPageStructureTool);
  registry.registerTool(getElementTool);
  registry.registerTool(findElementsTool);
  registry.registerTool(listWidgetsTool);
  registry.registerTool(describeWidgetTool);
  registerMcpRoute(app, registry);

  return app;
}
