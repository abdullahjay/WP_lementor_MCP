import { JsonRpcErrorCode, JsonRpcMethodError } from './errors.js';
import { SUPPORTED_PROTOCOL_VERSION } from './meta.js';
import type { MethodHandler, ToolImplementation } from './types.js';

// Tracks server/package.json's "version" — not read at runtime (no fs/JSON
// import for one string), so keep the two in sync by hand if either changes.
const SERVER_VERSION = '0.1.0';

/**
 * Method dispatcher. `ping`, `tools/list`, `tools/call`, and `server/discover`
 * ship built in; real tools register themselves via `registerTool()`
 * (EMCP-007+) rather than this file growing a hardcoded tool table.
 * `resultType` is stamped centrally in `dispatch()` so "every result carries
 * it" is a structural guarantee, not per-handler discipline — and it is
 * always the literal `"complete"` (the spec's MRTR enum), never the method
 * name; an earlier version of this file conflated the two, which happened
 * to work for hand-written tests but was never actually spec-shaped.
 */
export class MethodRegistry {
  private readonly handlers = new Map<string, MethodHandler>();
  private readonly tools = new Map<string, ToolImplementation>();

  constructor() {
    this.handlers.set('ping', () => ({}));
    this.handlers.set('tools/list', () => this.listTools());
    this.handlers.set('tools/call', (params, correlationId) => this.callTool(params, correlationId));
    // Spec-mandated ("Servers MUST implement server/discover") — a dual-era
    // client (confirmed live: claude-code/2.1.240) probes with this before
    // anything else, and falls back to the legacy `initialize` handshake if
    // it doesn't get a recognized modern response. This server deliberately
    // implements no `initialize` at all (solution.md §3), so a correct
    // `server/discover` response is what keeps a real client in modern mode
    // rather than the only way to reach it.
    this.handlers.set('server/discover', () => this.discover());
  }

  register(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  registerTool(tool: ToolImplementation): void {
    this.tools.set(tool.name, tool);
  }

  has(method: string): boolean {
    return this.handlers.has(method);
  }

  async dispatch(
    method: string,
    params: Record<string, unknown> | undefined,
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
    const handler = this.handlers.get(method);

    if (!handler) {
      throw new Error(`No handler registered for method "${method}".`);
    }

    const result = await handler(params, correlationId);

    return { ...result, resultType: 'complete' };
  }

  /**
   * DiscoverResult shape per
   * modelcontextprotocol.io/specification/2026-07-28/server/discover —
   * `resultType` is added by `dispatch()`, not set here, same as every
   * other handler.
   */
  private discover(): Record<string, unknown> {
    return {
      supportedVersions: [SUPPORTED_PROTOCOL_VERSION],
      capabilities: { tools: {} },
      _meta: {
        'io.modelcontextprotocol/serverInfo': { name: 'emcp-server', version: SERVER_VERSION },
      },
      instructions:
        'Elementor MCP server. Read Elementor page structure, widgets, and settings via tools/list and tools/call.',
      ttlMs: 3_600_000,
      cacheScope: 'public',
    };
  }

  private listTools(): Record<string, unknown> {
    // Deterministic ordering (solution.md §13): sorted by name, not
    // registration order, so the list doesn't depend on module import order.
    const tools = [...this.tools.values()]
      .map(({ handler: _handler, ...descriptor }) => descriptor)
      .sort((a, b) => a.name.localeCompare(b.name));

    return { tools, cacheScope: 'private', ttlMs: 60_000 };
  }

  private async callTool(
    params: Record<string, unknown> | undefined,
    correlationId?: string,
  ): Promise<Record<string, unknown>> {
    const name = params?.['name'];

    if (typeof name !== 'string') {
      throw new JsonRpcMethodError(
        JsonRpcErrorCode.INVALID_REQUEST,
        'tools/call requires a string "name" in params.',
        400,
      );
    }

    const tool = this.tools.get(name);

    if (!tool) {
      throw new JsonRpcMethodError(
        JsonRpcErrorCode.METHOD_NOT_FOUND,
        `Unknown tool: ${name}`,
        404,
      );
    }

    const rawArgs = params?.['arguments'];
    const args = isRecord(rawArgs) ? rawArgs : undefined;
    const result = await tool.handler(args, correlationId);

    // ToolCallResult has no index signature, so it isn't structurally
    // assignable to Record<string, unknown> on its own — spreading into a
    // fresh object literal is.
    return { ...result };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
