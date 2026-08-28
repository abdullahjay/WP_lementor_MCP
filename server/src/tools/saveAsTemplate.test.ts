import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getDbMock,
  resolveCurrentSiteMock,
  findIdempotentResultMock,
  recordIdempotentResultMock,
  getDocumentMock,
  saveTemplateMock,
  getSiteMock,
  listWidgetsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  resolveCurrentSiteMock: vi.fn(),
  findIdempotentResultMock: vi.fn(),
  recordIdempotentResultMock: vi.fn(),
  getDocumentMock: vi.fn(),
  saveTemplateMock: vi.fn(),
  getSiteMock: vi.fn(),
  listWidgetsMock: vi.fn(),
}));

vi.mock('../db/connection.js', () => ({ getDb: getDbMock }));
vi.mock('../registry/currentSite.js', async () => {
  const actual = await vi.importActual<typeof import('../registry/currentSite.js')>('../registry/currentSite.js');
  return { ...actual, resolveCurrentSite: resolveCurrentSiteMock };
});
vi.mock('../idempotency/store.js', () => ({
  findIdempotentResult: findIdempotentResultMock,
  recordIdempotentResult: recordIdempotentResultMock,
}));
vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return {
    ...actual,
    getDocument: getDocumentMock,
    saveTemplate: saveTemplateMock,
    getSite: getSiteMock,
    listWidgets: listWidgetsMock,
  };
});

const { saveAsTemplateTool } = await import('./saveAsTemplate.js');

const FAKE_SITE = { id: 'site-1', slug: 'abc', url: 'http://wp-v4-pro' };

const SITE_V4 = {
  elementor_version: '4.2.3',
  generation_default: 'v4',
  pro_tier: 'essential',
  breakpoints: {},
  experiments: {},
};

const V4_DOCUMENT = {
  status: 'publish',
  document_hash: 'hash-1',
  elements: [
    {
      id: 'a1b2c3d',
      elType: 'widget',
      widgetType: 'e-heading',
      settings: {
        tag: { $$type: 'string', value: 'h2' },
        title: { $$type: 'html-v3', value: { content: { $$type: 'string', value: 'Hi' }, children: [] } },
      },
      styles: [],
      elements: [],
    },
  ],
};

function stubHappyPath(): void {
  getDbMock.mockReturnValue({});
  resolveCurrentSiteMock.mockResolvedValue(FAKE_SITE);
  findIdempotentResultMock.mockResolvedValue(null);
  recordIdempotentResultMock.mockResolvedValue(undefined);
  getDocumentMock.mockResolvedValue(V4_DOCUMENT);
  getSiteMock.mockResolvedValue(SITE_V4);
  listWidgetsMock.mockResolvedValue({ widget_count: 0, widgets: [] });
  saveTemplateMock.mockResolvedValue({ id: 7, name: 'My template', createdAt: '2026-08-28T00:00:00+00:00' });
}

describe('save_as_template', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a non-integer post_id without touching anything', async () => {
    const result = await saveAsTemplateTool.handler({ post_id: 'nope', name: 'x' });

    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('rejects an empty name', async () => {
    const result = await saveAsTemplateTool.handler({ post_id: 5, name: '  ' });

    expect(result.isError).toBe(true);
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it('decompiles the real page content and stores the resulting spec, not native JSON', async () => {
    stubHappyPath();
    const result = await saveAsTemplateTool.handler({ post_id: 5, name: 'My template' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ id: 7, name: 'My template' });
    const [name, spec, sourcePostId] = saveTemplateMock.mock.calls[0] as [
      string,
      { dslVersion: number; page: { title: string }; elements: Array<{ type: string; text: string }> },
      number,
    ];
    expect(name).toBe('My template');
    expect(sourcePostId).toBe(5);
    expect(spec.dslVersion).toBe(1);
    expect(spec.page).toEqual({ title: 'My template' });
    expect(spec.elements).toHaveLength(1);
    expect(spec.elements[0]).toMatchObject({ type: 'heading', text: 'Hi' });
  });

  it('defaults to the parent source, not autosave', async () => {
    stubHappyPath();
    await saveAsTemplateTool.handler({ post_id: 5, name: 'x' });

    expect(getDocumentMock).toHaveBeenCalledWith(5, { source: 'parent' });
  });

  it('honours an explicit autosave source', async () => {
    stubHappyPath();
    await saveAsTemplateTool.handler({ post_id: 5, name: 'x', source: 'autosave' });

    expect(getDocumentMock).toHaveBeenCalledWith(5, { source: 'autosave' });
  });

  it('works on a legacy-default site — decompile has no generation restriction', async () => {
    stubHappyPath();
    getSiteMock.mockResolvedValue({ ...SITE_V4, generation_default: 'legacy' });

    const result = await saveAsTemplateTool.handler({ post_id: 5, name: 'x' });

    expect(result.isError).toBe(false);
  });

  it('a repeated call under the same idempotency_key replays the cached result without saving again', async () => {
    stubHappyPath();
    const cached = { id: 7, name: 'My template', created_at: '2026-08-28T00:00:00+00:00', diagnostics: [] };
    findIdempotentResultMock.mockResolvedValue(cached);

    const result = await saveAsTemplateTool.handler({ post_id: 5, name: 'My template', idempotency_key: 'key-1' });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(cached);
    expect(getDocumentMock).not.toHaveBeenCalled();
    expect(saveTemplateMock).not.toHaveBeenCalled();
  });
});
