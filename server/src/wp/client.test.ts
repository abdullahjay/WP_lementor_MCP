import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureSnapshot,
  DocumentHashMismatchError,
  DocumentLockedError,
  editElements,
  ElementsNotFoundError,
  getDocument,
  getGlobalStyles,
  getLockStatus,
  getSite,
  getWidgetDetail,
  InvalidOperationsError,
  invalidateCache,
  issuePreviewToken,
  listPages,
  listWidgets,
  restoreSnapshot,
  WordPressApiError,
} from './client.js';
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

describe('getGlobalStyles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the kit payload on success (v3 shape, no global_classes/variables)', async () => {
    const payload = {
      colors: { system: [{ _id: 'primary', title: 'Primary', color: '#6EC1E4' }], custom: [] },
      typography: { system: [], custom: [] },
      default_generic_fonts: 'Sans-serif',
      generation_default: 'v3',
    };
    mockFetchOnce(200, payload);

    const result = await getGlobalStyles(CONFIG);

    expect(result).toEqual(payload);
  });

  it('returns the v4 shape including global_classes and variables when the plugin includes them', async () => {
    const payload = {
      colors: { system: [], custom: [] },
      typography: { system: [], custom: [] },
      default_generic_fonts: 'Sans-serif',
      generation_default: 'v4',
      global_classes: { items: {}, order: [] },
      variables: { variables: [], total: 0, watermark: null },
    };
    mockFetchOnce(200, payload);

    const result = await getGlobalStyles(CONFIG);

    expect(result['global_classes']).toEqual({ items: {}, order: [] });
    expect(result['variables']).toEqual({ variables: [], total: 0, watermark: null });
  });

  it('throws WordPressApiError on a non-2xx response', async () => {
    mockFetchOnce(403, { message: 'forbidden' });

    await expect(getGlobalStyles(CONFIG)).rejects.toThrow(WordPressApiError);
  });

  it('throws WordPressApiError when the body is not an object', async () => {
    mockFetchOnce(200, [1, 2, 3]);

    await expect(getGlobalStyles(CONFIG)).rejects.toThrow(WordPressApiError);
  });
});

describe('issuePreviewToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the token payload on success', async () => {
    mockFetchOnce(200, { token: 'abc.def', expires_at: '2026-08-27T10:00:00+00:00', post_id: 5 });

    const result = await issuePreviewToken(5, undefined, CONFIG);

    expect(result).toEqual({ token: 'abc.def', expiresAt: '2026-08-27T10:00:00+00:00', postId: 5 });
  });

  it('sends post_id and ttl_minutes in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ token: 'x', expires_at: 'y', post_id: 5 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await issuePreviewToken(5, 10, CONFIG);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ post_id: 5, ttl_minutes: 10 });
  });

  it('omits ttl_minutes when not given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ token: 'x', expires_at: 'y', post_id: 5 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await issuePreviewToken(5, undefined, CONFIG);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ post_id: 5 });
  });

  it('throws WordPressApiError on a non-2xx response', async () => {
    mockFetchOnce(403, { message: 'forbidden' });

    await expect(issuePreviewToken(5, undefined, CONFIG)).rejects.toThrow(WordPressApiError);
  });

  it('throws WordPressApiError when the body is missing expected fields', async () => {
    mockFetchOnce(200, { token: 'abc' });

    await expect(issuePreviewToken(5, undefined, CONFIG)).rejects.toThrow(WordPressApiError);
  });
});

describe('captureSnapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the snapshot payload on success', async () => {
    mockFetchOnce(201, { id: 1, post_id: 5, source: 'parent', hash: 'abc', created_at: '2026-08-27T00:00:00+00:00' });

    const result = await captureSnapshot(5, 'parent', CONFIG);

    expect(result).toEqual({ id: 1, postId: 5, source: 'parent', hash: 'abc', createdAt: '2026-08-27T00:00:00+00:00' });
  });

  it('sends post_id and source in the request body, defaulting source to "parent"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ id: 1, post_id: 5, source: 'parent', hash: 'abc', created_at: 'x' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await captureSnapshot(5, undefined, CONFIG);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ post_id: 5, source: 'parent' });
  });

  it('throws WordPressApiError on a non-2xx response', async () => {
    mockFetchOnce(404, { message: 'not found' });

    await expect(captureSnapshot(5, 'parent', CONFIG)).rejects.toThrow(WordPressApiError);
  });
});

describe('restoreSnapshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the restore payload on success', async () => {
    mockFetchOnce(200, { post_id: 5, restored: true, hash: 'abc' });

    const result = await restoreSnapshot(1, CONFIG);

    expect(result).toEqual({ postId: 5, restored: true, hash: 'abc' });
  });

  it('throws WordPressApiError on a non-2xx response, naming the snapshot id', async () => {
    mockFetchOnce(404, { message: 'not found' });

    await expect(restoreSnapshot(999, CONFIG)).rejects.toThrow(WordPressApiError);
    await expect(restoreSnapshot(999, CONFIG)).rejects.toThrow(/snapshots\/999\/restore/);
  });
});

describe('invalidateCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the invalidation payload on success', async () => {
    mockFetchOnce(200, { post_id: 5, invalidated: true, warmed: true });

    const result = await invalidateCache(5, true, CONFIG);

    expect(result).toEqual({ postId: 5, invalidated: true, warmed: true });
  });

  it('sends post_id and warm in the request body, defaulting warm to true', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ post_id: 5, invalidated: true, warmed: false }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await invalidateCache(5, undefined, CONFIG);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ post_id: 5, warm: true });
  });

  it('throws WordPressApiError on a non-2xx response', async () => {
    mockFetchOnce(404, { message: 'not found' });

    await expect(invalidateCache(5, true, CONFIG)).rejects.toThrow(WordPressApiError);
  });
});

describe('editElements', () => {
  const ONE_OP = [{ op: 'set_settings' as const, elementId: '186bf22', settings: { title: 'x' } }];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the write payload on success', async () => {
    mockFetchOnce(200, { id: 5, results: [{ element_id: '186bf22', applied: true }], document_hash: 'new-hash' });

    const result = await editElements(5, ONE_OP, 'old-hash', {}, CONFIG);

    expect(result).toEqual({
      id: 5,
      documentHash: 'new-hash',
      results: [{ elementId: '186bf22', applied: true }],
    });
  });

  it('sends operations (with op/element_id/settings), document_hash, and override_lock when set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 5, results: [], document_hash: 'h' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await editElements(5, ONE_OP, 'old-hash', { overrideLock: true }, CONFIG);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      operations: [{ op: 'set_settings', element_id: '186bf22', settings: { title: 'x' } }],
      document_hash: 'old-hash',
      override_lock: true,
    });
  });

  it('sends multiple operations in one batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 5, results: [], document_hash: 'h' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await editElements(
      5,
      [
        { op: 'set_settings', elementId: 'a', settings: { title: 'A' } },
        { op: 'set_settings', elementId: 'b', settings: { title: 'B' } },
      ],
      'old-hash',
      {},
      CONFIG,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const sent = JSON.parse(init.body as string) as { operations: unknown[] };
    expect(sent.operations).toHaveLength(2);
  });

  it('omits override_lock from the body when not given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 5, results: [], document_hash: 'h' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await editElements(5, ONE_OP, 'old-hash', {}, CONFIG);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect('override_lock' in sent).toBe(false);
  });

  it('throws DocumentHashMismatchError with the current hash on a 409', async () => {
    mockFetchOnce(409, { id: 5, document_hash: 'real-current-hash', message: 'stale' });

    try {
      await editElements(5, ONE_OP, 'old-hash', {}, CONFIG);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentHashMismatchError);
      expect((error as DocumentHashMismatchError).currentHash).toBe('real-current-hash');
    }
  });

  it('throws DocumentLockedError with the locking user on a 423', async () => {
    mockFetchOnce(423, { id: 5, locked_by: { id: 3, name: 'Someone Else' }, message: 'locked' });

    try {
      await editElements(5, ONE_OP, 'old-hash', {}, CONFIG);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentLockedError);
      expect((error as DocumentLockedError).lockedByUserId).toBe(3);
      expect((error as DocumentLockedError).lockedByName).toBe('Someone Else');
    }
  });

  it('throws InvalidOperationsError with diagnostics on a 400 carrying them', async () => {
    mockFetchOnce(400, {
      code: 'emcp_invalid_operation',
      message: 'bad',
      data: { status: 400, diagnostics: [{ path: 'operations[0].op', code: 'DSL_VERSION_UNSUPPORTED', message: 'bad op' }] },
    });

    try {
      await editElements(5, ONE_OP, 'old-hash', {}, CONFIG);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidOperationsError);
      expect((error as InvalidOperationsError).diagnostics).toEqual([
        { path: 'operations[0].op', code: 'DSL_VERSION_UNSUPPORTED', message: 'bad op' },
      ]);
    }
  });

  it('throws ElementsNotFoundError with diagnostics on a 404 carrying them', async () => {
    mockFetchOnce(404, {
      code: 'emcp_element_not_found',
      message: 'missing',
      data: { status: 404, diagnostics: [{ path: 'operations[0]', code: 'ELEMENT_NOT_FOUND', message: 'no such element' }] },
    });

    try {
      await editElements(5, ONE_OP, 'old-hash', {}, CONFIG);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ElementsNotFoundError);
      expect((error as ElementsNotFoundError).diagnostics).toEqual([
        { path: 'operations[0]', code: 'ELEMENT_NOT_FOUND', message: 'no such element' },
      ]);
    }
  });

  it('throws a generic WordPressApiError for a 404 without diagnostics (e.g. document not found)', async () => {
    mockFetchOnce(404, { code: 'emcp_document_not_found', message: 'not found', data: { status: 404 } });

    await expect(editElements(5, ONE_OP, 'old-hash', {}, CONFIG)).rejects.toThrow(WordPressApiError);
  });
});

describe('getLockStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns unlocked state', async () => {
    mockFetchOnce(200, { id: 5, locked: false, locked_by: null });

    const result = await getLockStatus(5, CONFIG);

    expect(result).toEqual({ id: 5, locked: false, lockedBy: null });
  });

  it('returns locked state with the locking user', async () => {
    mockFetchOnce(200, { id: 5, locked: true, locked_by: { id: 3, name: 'Someone Else' } });

    const result = await getLockStatus(5, CONFIG);

    expect(result).toEqual({ id: 5, locked: true, lockedBy: { id: 3, name: 'Someone Else' } });
  });

  it('throws WordPressApiError on a non-2xx response', async () => {
    mockFetchOnce(404, { message: 'not found' });

    await expect(getLockStatus(5, CONFIG)).rejects.toThrow(WordPressApiError);
  });
});
