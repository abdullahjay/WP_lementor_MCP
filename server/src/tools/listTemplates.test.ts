import { afterEach, describe, expect, it, vi } from 'vitest';

const { listTemplatesMock } = vi.hoisted(() => ({
  listTemplatesMock: vi.fn(),
}));

vi.mock('../wp/client.js', async () => {
  const actual = await vi.importActual<typeof import('../wp/client.js')>('../wp/client.js');
  return { ...actual, listTemplates: listTemplatesMock };
});

const { listTemplatesTool } = await import('./listTemplates.js');
const { WordPressApiError } = await import('../wp/client.js');

describe('list_templates', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the real template listing from the plugin', async () => {
    const body = {
      templates: [{ id: 1, name: 'Hero section', source_post_id: 5, created_at: '2026-08-28T00:00:00+00:00' }],
      count: 1,
    };
    listTemplatesMock.mockResolvedValue(body);

    const result = await listTemplatesTool.handler({});

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual(body);
  });

  it('surfaces a WordPress API error', async () => {
    listTemplatesMock.mockRejectedValue(new WordPressApiError('nope', 500, null));

    const result = await listTemplatesTool.handler({});

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('500');
  });
});
