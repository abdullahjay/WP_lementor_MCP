import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDocument, getSite, getWidgetDetail, listPages, listWidgets, WordPressApiError } from './client.js';
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

describe('listPages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the documents payload on success', async () => {
    const payload = {
      documents: [{ id: 5, title: 'Home', status: 'publish', type: 'page', modified: '2026-08-25T10:00:00+00:00', edit_url: 'http://wp.test/wp-admin/post.php?post=5&action=edit' }],
      count: 1,
    };
    mockFetchOnce(200, payload);

    const result = await listPages(CONFIG);

    expect(result).toEqual(payload);
  });

  it('throws WordPressApiError on a non-2xx response', async () => {
    mockFetchOnce(401, { message: 'unauthorized' });

    await expect(listPages(CONFIG)).rejects.toThrow(WordPressApiError);
  });

  it('throws WordPressApiError when the body is not an object', async () => {
    mockFetchOnce(200, [1, 2, 3]);

    await expect(listPages(CONFIG)).rejects.toThrow(WordPressApiError);
  });
});

describe('getDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the document payload on success', async () => {
    const payload = { id: 5, source: 'parent', elements: [], meta: {}, document_hash: 'abc123' };
    mockFetchOnce(200, payload);

    const result = await getDocument(5, {}, CONFIG);

    expect(result).toEqual(payload);
  });

  it('requests the given post id and defaults to no source param (plugin defaults to "parent")', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 5, source: 'parent', elements: [], meta: {}, document_hash: 'x' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await getDocument(5, {}, CONFIG);

    const requestedUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requestedUrl.pathname).toBe('/wp-json/emcp/v1/documents/5');
    expect(requestedUrl.searchParams.has('source')).toBe(false);
  });

  it('passes source=autosave through as a query param when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 5, source: 'autosave', elements: [], meta: {}, document_hash: 'x' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await getDocument(5, { source: 'autosave' }, CONFIG);

    const requestedUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requestedUrl.searchParams.get('source')).toBe('autosave');
  });

  it('throws WordPressApiError on a non-2xx response, naming the post id', async () => {
    mockFetchOnce(404, { message: 'not found' });

    await expect(getDocument(999, {}, CONFIG)).rejects.toThrow(WordPressApiError);
    await expect(getDocument(999, {}, CONFIG)).rejects.toThrow(/documents\/999/);
  });
});

describe('listWidgets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the widgets payload on success', async () => {
    const payload = {
      widget_count: 1,
      widgets: [{ name: 'heading', title: 'Heading', categories: ['general'], keywords: [] }],
    };
    mockFetchOnce(200, payload);

    const result = await listWidgets(CONFIG);

    expect(result).toEqual(payload);
  });

  it('throws WordPressApiError on a non-2xx response', async () => {
    mockFetchOnce(403, { message: 'forbidden' });

    await expect(listWidgets(CONFIG)).rejects.toThrow(WordPressApiError);
  });

  it('throws WordPressApiError when the body is not an object', async () => {
    mockFetchOnce(200, [1, 2, 3]);

    await expect(listWidgets(CONFIG)).rejects.toThrow(WordPressApiError);
  });
});

describe('getWidgetDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the widget payload on success', async () => {
    const payload = {
      name: 'heading',
      title: 'Heading',
      categories: ['general'],
      keywords: [],
      controls: { title: { type: 'textarea', tab: 'content' } },
    };
    mockFetchOnce(200, payload);

    const result = await getWidgetDetail('heading', CONFIG);

    expect(result).toEqual(payload);
  });

  it('URL-encodes the widget type into the request path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ name: 'x', title: 'X', categories: [], keywords: [], controls: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await getWidgetDetail('nested/tabs', CONFIG);

    const requestedUrl = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requestedUrl.pathname).toBe('/wp-json/emcp/v1/widgets/nested%2Ftabs');
  });

  it('throws WordPressApiError on a non-2xx response, naming the widget type', async () => {
    mockFetchOnce(404, { message: 'not found' });

    await expect(getWidgetDetail('nonexistent', CONFIG)).rejects.toThrow(WordPressApiError);
    await expect(getWidgetDetail('nonexistent', CONFIG)).rejects.toThrow(/nonexistent/);
  });
});
