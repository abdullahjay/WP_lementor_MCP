import { afterEach, describe, expect, it, vi } from 'vitest';

const { renderScreenshotMock } = vi.hoisted(() => ({
  renderScreenshotMock: vi.fn(),
}));

vi.mock('../render.js', () => ({ renderScreenshot: renderScreenshotMock }));

const { buildServer } = await import('./server.js');

describe('renderer HTTP server', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('GET /healthz returns ok without touching the browser', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(renderScreenshotMock).not.toHaveBeenCalled();
  });

  it('POST /render with a missing url returns 400 and never calls the renderer', async () => {
    const app = buildServer();

    const response = await app.inject({ method: 'POST', url: '/render', payload: {} });

    expect(response.statusCode).toBe(400);
    expect(renderScreenshotMock).not.toHaveBeenCalled();
  });

  it('POST /render with an invalid URL returns 400', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/render',
      payload: { url: 'not a url' },
    });

    expect(response.statusCode).toBe(400);
    expect(renderScreenshotMock).not.toHaveBeenCalled();
  });

  it('POST /render rejects a non-http(s) scheme (e.g. file://) before calling the renderer', async () => {
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/render',
      payload: { url: 'file:///etc/passwd' },
    });

    expect(response.statusCode).toBe(400);
    expect(renderScreenshotMock).not.toHaveBeenCalled();
  });

  it('POST /render with a valid http URL calls the renderer and returns a PNG', async () => {
    renderScreenshotMock.mockResolvedValue(Buffer.from('fake-png-bytes'));
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/render',
      payload: { url: 'http://wp-v4-pro/some-page/' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(renderScreenshotMock).toHaveBeenCalledWith('http://wp-v4-pro/some-page/', {});
  });

  it('POST /render passes selector, allowedHost, and extraHeaders through to the renderer (EMCP-034)', async () => {
    renderScreenshotMock.mockResolvedValue(Buffer.from('fake-png-bytes'));
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/render',
      payload: {
        url: 'http://wp-v4-pro/some-page/',
        selector: '.elementor-38',
        allowedHost: 'wp-v4-pro',
        extraHeaders: { 'X-EMCP-Preview-Token': 'abc.def' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(renderScreenshotMock).toHaveBeenCalledWith('http://wp-v4-pro/some-page/', {
      selector: '.elementor-38',
      allowedHost: 'wp-v4-pro',
      extraHeaders: { 'X-EMCP-Preview-Token': 'abc.def' },
    });
  });

  it('ignores non-string selector/allowedHost and non-string-record extraHeaders rather than passing bad input through', async () => {
    renderScreenshotMock.mockResolvedValue(Buffer.from('fake-png-bytes'));
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/render',
      payload: { url: 'http://wp-v4-pro/some-page/', selector: 123, allowedHost: [ 'a' ], extraHeaders: 'nope' },
    });

    expect(response.statusCode).toBe(200);
    expect(renderScreenshotMock).toHaveBeenCalledWith('http://wp-v4-pro/some-page/', {});
  });

  it('POST /render returns 502 when the renderer throws', async () => {
    renderScreenshotMock.mockRejectedValue(new Error('navigation timeout'));
    const app = buildServer();

    const response = await app.inject({
      method: 'POST',
      url: '/render',
      payload: { url: 'http://wp-v4-pro/some-page/' },
    });

    expect(response.statusCode).toBe(502);
  });
});
