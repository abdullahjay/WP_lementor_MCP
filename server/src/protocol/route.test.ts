import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../http/server.js';
import { SUPPORTED_PROTOCOL_VERSION } from './meta.js';

const ORIGINAL_TOKEN = process.env['MCP_HEADER_AUTH_TOKEN'];
const AUTH_TOKEN = 'test-token';

// Real shape confirmed live against claude-code/2.1.240 (EMCP-006 follow-up):
// _meta lives inside params with namespaced keys, and Mcp-Name is header-only
// required for tools/call/resources/read/prompts/get — a plain `ping` or
// `server/discover` request correctly has neither a body name/uri nor the
// header, which is exactly what real client traffic looked like.
function mcpHeaders(method: string, overrides: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${AUTH_TOKEN}`,
    'content-type': 'application/json',
    'mcp-protocol-version': SUPPORTED_PROTOCOL_VERSION,
    'mcp-method': method,
  };

  if (method === 'tools/call') {
    headers['mcp-name'] = 'get_site_info';
  }

  return { ...headers, ...overrides };
}

function mcpBody(
  method: string,
  id: string | number | null = 1,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: { 'io.modelcontextprotocol/protocolVersion': SUPPORTED_PROTOCOL_VERSION },
    },
  };
}

describe('MCP protocol route', () => {
  beforeEach(() => {
    process.env['MCP_HEADER_AUTH_TOKEN'] = AUTH_TOKEN;
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env['MCP_HEADER_AUTH_TOKEN'];
    } else {
      process.env['MCP_HEADER_AUTH_TOKEN'] = ORIGINAL_TOKEN;
    }
    delete process.env['MCP_ALLOWED_ORIGINS'];
  });

  it('handles ping with matching headers and _meta', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('ping'),
      payload: mcpBody('ping'),
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{ result: { resultType: string } }>();
    expect(json.result.resultType).toBe('complete');
  });

  it('implements server/discover per spec (MUST-implement), no Mcp-Name required', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('server/discover'),
      payload: mcpBody('server/discover'),
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{
      result: {
        resultType: string;
        supportedVersions: string[];
        capabilities: Record<string, unknown>;
        _meta: Record<string, unknown>;
      };
    }>();
    expect(json.result.resultType).toBe('complete');
    expect(json.result.supportedVersions).toEqual([SUPPORTED_PROTOCOL_VERSION]);
    expect(json.result.capabilities).toEqual({ tools: {} });
    expect(json.result._meta['io.modelcontextprotocol/serverInfo']).toEqual({
      name: 'emcp-server',
      version: '0.1.0',
    });
  });

  it('returns tools/list with resultType, cacheScope, ttlMs and registered tools', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('tools/list'),
      payload: mcpBody('tools/list'),
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{
      result: {
        resultType: string;
        cacheScope: string;
        ttlMs: number;
        tools: Array<{ name: string }>;
      };
    }>();
    expect(json.result.resultType).toBe('complete');
    expect(json.result.cacheScope).toBe('private');
    expect(typeof json.result.ttlMs).toBe('number');
    expect(json.result.tools.map((tool) => tool.name)).toEqual([
      'describe_widget',
      'find_elements',
      'get_element',
      'get_page_structure',
      'get_site_info',
      'list_pages',
      'list_widgets',
    ]);
  });

  it('returns 404 + -32601 via tools/call for an unknown tool name', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('tools/call', { 'mcp-name': 'not_a_real_tool' }),
      payload: mcpBody('tools/call', 1, { name: 'not_a_real_tool' }),
    });

    expect(response.statusCode).toBe(404);
    const json = response.json<{ error: { code: number } }>();
    expect(json.error.code).toBe(-32601);
  });

  it('returns 400 when tools/call is missing a tool name', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('tools/call'),
      payload: mcpBody('tools/call', 1, {}),
    });

    expect(response.statusCode).toBe(400);
  });

  it('reports an unreachable WordPress site as isError, not a JSON-RPC error', async () => {
    const app = buildServer();
    delete process.env['WP_BASE_URL'];

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('tools/call'),
      payload: mcpBody('tools/call', 1, { name: 'get_site_info' }),
    });

    expect(response.statusCode).toBe(200);
    const json = response.json<{ result: { isError: boolean } }>();
    expect(json.result.isError).toBe(true);
  });

  it('returns 400 + -32020 when Mcp-Method header disagrees with the body method', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('ping', { 'mcp-method': 'tools/list' }),
      payload: mcpBody('ping'),
    });

    expect(response.statusCode).toBe(400);
    const json = response.json<{ error: { code: number } }>();
    expect(json.error.code).toBe(-32020);
  });

  it('does NOT require Mcp-Name for a method with no name/uri (e.g. ping) — real client traffic omits it', async () => {
    const app = buildServer();
    const headers = mcpHeaders('ping');
    delete headers['mcp-name'];

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: mcpBody('ping'),
    });

    expect(response.statusCode).toBe(200);
  });

  it('returns 400 + -32020 when Mcp-Name is missing for tools/call, which does require it', async () => {
    const app = buildServer();
    const headers = mcpHeaders('tools/call');
    delete headers['mcp-name'];

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: mcpBody('tools/call', 1, { name: 'get_site_info' }),
    });

    expect(response.statusCode).toBe(400);
    const json = response.json<{ error: { code: number } }>();
    expect(json.error.code).toBe(-32020);
  });

  it('returns 400 + -32020 for an unsupported protocol version', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('ping', { 'mcp-protocol-version': '2020-01-01' }),
      payload: mcpBody('ping'),
    });

    expect(response.statusCode).toBe(400);
    const json = response.json<{ error: { code: number } }>();
    expect(json.error.code).toBe(-32020);
  });

  it('returns 404 + -32601 for an unknown method', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('not/a/real/method'),
      payload: mcpBody('not/a/real/method'),
    });

    expect(response.statusCode).toBe(404);
    const json = response.json<{ error: { code: number } }>();
    expect(json.error.code).toBe(-32601);
  });

  it('returns 405 for GET', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/mcp',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(response.statusCode).toBe(405);
  });

  it('returns 405 for DELETE', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'DELETE',
      url: '/mcp',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });

    expect(response.statusCode).toBe(405);
  });

  it('returns 403 when Origin is present but not on the allowlist', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...mcpHeaders('ping'), origin: 'https://evil.example' },
      payload: mcpBody('ping'),
    });

    expect(response.statusCode).toBe(403);
  });

  it('allows an Origin that is on the configured allowlist', async () => {
    process.env['MCP_ALLOWED_ORIGINS'] = 'https://trusted.example';
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...mcpHeaders('ping'), origin: 'https://trusted.example' },
      payload: mcpBody('ping'),
    });

    expect(response.statusCode).toBe(200);
  });

  it('sends no body for a notification (no id)', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: mcpHeaders('ping'),
      payload: mcpBody('ping', null),
    });

    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('');
  });

  it('still requires the header auth token from EMCP-005', async () => {
    const app = buildServer();
    const headers = mcpHeaders('ping');
    delete headers['authorization'];

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers,
      payload: mcpBody('ping'),
    });

    expect(response.statusCode).toBe(401);
  });
});
