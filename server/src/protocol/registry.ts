import { JsonRpcErrorCode, JsonRpcMethodError } from './errors.js';
import type { MethodHandler, ToolImplementation } from './types.js';

/**
 * Method dispatcher. `tools/list` and `tools/call` ship built in; real tools
 * register themselves via `registerTool()` (EMCP-007+) rather than this file
 * growing a hardcoded tool table. `resultType` is stamped centrally in
 * `dispatch()` so "every result carries it" is a structural guarantee, not
 * per-handler discipline.
 */
export class MethodRegistry {
  private readonly handlers = new Map<string, MethodHandler>();
  private readonly tools = new Map<string, ToolImplementation>();

  constructor() {
    this.handlers.set('ping', () => ({}));
    this.handlers.set('tools/list', () => this.listTools());
    this.handlers.set('tools/call', (params) => this.callTool(params));
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
  ): Promise<Record<string, unknown>> {
    const handler = this.handlers.get(method);

    if (!handler) {
      throw new Error(`No handler registered for method "${method}".`);
    }

    const result = await handler(params);

    return { ...result, resultType: method };
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
    const result = await tool.handler(args);

    // ToolCallResult has no index signature, so it isn't structurally
    // assignable to Record<string, unknown> on its own — spreading into a
    // fresh object literal is.
    return { ...result };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
