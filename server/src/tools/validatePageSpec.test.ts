import { afterEach, describe, expect, it, vi } from 'vitest';

const { getSiteMock, listWidgetsMock } = vi.hoisted(() => ({
  getSiteMock: vi.fn(),
  listWidgetsMock: vi.fn(),
}));

vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return { ...actual, getSite: getSiteMock, listWidgets: listWidgetsMock };
});

const { validatePageSpecTool } = await import('./validatePageSpec.js');

const SITE_V4 = {
  elementor_version: '4.2.3',
  generation_default: 'v4',
  pro_tier: 'essential',
  breakpoints: {},
  experiments: {},
};

const WIDGETS = {
  widget_count: 1,
  widgets: [{ name: 'e-heading', title: 'Heading', categories: [], keywords: [] }],
};

function stubHappyPath(): void {
  getSiteMock.mockResolvedValue(SITE_V4);
  listWidgetsMock.mockResolvedValue(WIDGETS);
}

describe('validate_page_spec', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a grammatically malformed spec before ever calling the site', async () => {
    stubHappyPath();
    const result = await validatePageSpecTool.handler({ spec: { dslVersion: 99, page: { title: 'x' }, elements: [] } });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ valid: false });
    expect(getSiteMock).not.toHaveBeenCalled();
  });

  it('reports a clean compile as valid, with real nativeness/raw_ratio', async () => {
    stubHappyPath();
    const spec = {
      dslVersion: 1,
      page: { title: 'Test' },
      elements: [{ type: 'widget', widgetType: 'e-heading', settings: { title: 'Hi' } }],
    };

    const result = await validatePageSpecTool.handler({ spec });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ valid: true, nativeness: 1, raw_ratio: 0 });
  });

  it('reports WIDGET_NOT_AVAILABLE for a widget not on this site, without writing anything', async () => {
    stubHappyPath();
    const spec = {
      dslVersion: 1,
      page: { title: 'Test' },
      elements: [{ type: 'widget', widgetType: 'nonexistent-widget', settings: {} }],
    };

    const result = await validatePageSpecTool.handler({ spec });

    expect(result.isError).toBe(true);
    const structured = result.structuredContent as { valid: boolean; diagnostics: Array<{ code: string }> };
    expect(structured.valid).toBe(false);
    expect(structured.diagnostics.some((d) => d.code === 'WIDGET_NOT_AVAILABLE')).toBe(true);
  });

  it('refuses to validate against a legacy-default site — the compiler cannot author legacy content', async () => {
    getSiteMock.mockResolvedValue({ ...SITE_V4, generation_default: 'legacy' });
    listWidgetsMock.mockResolvedValue(WIDGETS);

    const spec = { dslVersion: 1, page: { title: 'Test' }, elements: [] };
    const result = await validatePageSpecTool.handler({ spec });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/legacy/i);
  });
});
