import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreenshot, RendererApiError } from './client.js';

const RENDERER_URL = 'http://renderer.test';

describe('renderScreenshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the PNG bytes on success', async () => {
    const bytes = new TextEncoder().encode('fake-png');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) }),
    );

    const result = await renderScreenshot({ url: 'http://wp-v4-pro/page/' }, RENDERER_URL);

    expect(Buffer.from(result)).toEqual(Buffer.from(bytes));
  });

  it('sends url/selector/allowedHost/extraHeaders in the request body, omitting unset fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderScreenshot(
      {
        url: 'http://wp-v4-pro/page/',
        selector: '.elementor-5',
        allowedHost: 'wp-v4-pro',
        extraHeaders: { 'X-EMCP-Preview-Token': 'abc' },
      },
      RENDERER_URL,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      url: 'http://wp-v4-pro/page/',
      selector: '.elementor-5',
      allowedHost: 'wp-v4-pro',
      extraHeaders: { 'X-EMCP-Preview-Token': 'abc' },
    });
  });

  it('omits selector/allowedHost/extraHeaders entirely when not given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderScreenshot({ url: 'http://wp-v4-pro/page/' }, RENDERER_URL);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ url: 'http://wp-v4-pro/page/' });
  });

  it('sends viewportWidth/viewportHeight together when both are given (EMCP-066)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderScreenshot({ url: 'http://wp-v4-pro/page/', viewportWidth: 767, viewportHeight: 900 }, RENDERER_URL);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      url: 'http://wp-v4-pro/page/',
      viewportWidth: 767,
      viewportHeight: 900,
    });
  });

  it('throws RendererApiError on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: 'navigation timeout' }),
      }),
    );

    await expect(renderScreenshot({ url: 'http://wp-v4-pro/page/' }, RENDERER_URL)).rejects.toThrow(
      RendererApiError,
    );
  });
});
