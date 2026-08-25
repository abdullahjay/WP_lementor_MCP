import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSite, WordPressApiError } from './client.js';
import { PluginVersionMismatchError } from './contract.js';

const CONFIG = { baseUrl: 'http://wp.test', username: 'admin', applicationPassword: 'app-pw' };

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

describe('getSite', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the site payload when the plugin version is compatible', async () => {
    mockFetchOnce(200, { plugin_version: '0.1.0', generation_default: 'v4' });

    const site = await getSite(CONFIG);

    expect(site['generation_default']).toBe('v4');
  });

  it('throws PluginVersionMismatchError when the plugin is older than required', async () => {
    mockFetchOnce(200, { plugin_version: '0.0.1', generation_default: 'v4' });

    await expect(getSite(CONFIG)).rejects.toThrow(PluginVersionMismatchError);
  });

  it('throws WordPressApiError on a non-2xx response', async () => {
    mockFetchOnce(403, { message: 'forbidden' });

    await expect(getSite(CONFIG)).rejects.toThrow(WordPressApiError);
  });
});
