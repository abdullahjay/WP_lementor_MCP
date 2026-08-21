import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthConfigError, registerHeaderAuth } from './auth.js';
import { buildServer } from './server.js';

const ORIGINAL_TOKEN = process.env['MCP_HEADER_AUTH_TOKEN'];

describe('header auth', () => {
  beforeEach(() => {
    process.env['MCP_HEADER_AUTH_TOKEN'] = 'test-token';
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env['MCP_HEADER_AUTH_TOKEN'];
    } else {
      process.env['MCP_HEADER_AUTH_TOKEN'] = ORIGINAL_TOKEN;
    }
  });

  it('refuses to wire up with no token configured', () => {
    delete process.env['MCP_HEADER_AUTH_TOKEN'];
    const app = Fastify();

    expect(() => registerHeaderAuth(app)).toThrow(AuthConfigError);
  });

  it('allows /healthz with no Authorization header', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
  });

  it('rejects a protected route with no Authorization header', async () => {
    const app = buildServer();
    app.get('/protected', async () => ({ ok: true }));

    const response = await app.inject({ method: 'GET', url: '/protected' });

    expect(response.statusCode).toBe(401);
  });

  it('rejects a protected route with the wrong token', async () => {
    const app = buildServer();
    app.get('/protected', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer wrong-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts a protected route with the correct bearer token', async () => {
    const app = buildServer();
    app.get('/protected', async () => ({ ok: true }));

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('echoes a correlation id header on every response', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.headers['x-correlation-id']).toBeTypeOf('string');
  });
});
