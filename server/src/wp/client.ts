import { loadWordPressSiteConfig, type WordPressSiteConfig } from './config.js';
import { assertPluginVersionCompatible } from './contract.js';

/**
 * A non-2xx response from the plugin's REST contract (Blueprints.md §6).
 * Distinct from a network-level failure (DNS, connection refused, timeout)
 * so callers — currently just get_site_info's handler — can report a
 * different message for "WordPress said no" vs. "couldn't reach it at all".
 */
export class WordPressApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

/**
 * `GET /wp-json/emcp/v1/site` (Blueprints.md §6, implemented in EMCP-004).
 * Application Passwords over Basic auth for now — the plugin's own
 * audience-scoped short-lived tokens are a later phase (solution.md's
 * decision table).
 */
export async function getSite(
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<Record<string, unknown>> {
  const url = new URL('/wp-json/emcp/v1/site', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString(
    'base64',
  );

  const response = await fetch(url, {
    headers: { authorization: `Basic ${credentials}` },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(`GET /site returned ${response.status}`, response.status, body);
  }

  if (!isRecord(body)) {
    throw new WordPressApiError('GET /site returned a non-object body.', response.status, body);
  }

  // Blueprints.md §6: fail loudly on a plugin/server version mismatch. No
  // persistent connection exists to gate once (solution.md §3), so this
  // runs on every call that reaches the plugin, not just a one-time check.
  assertPluginVersionCompatible(body['plugin_version']);

  return body;
}

/**
 * `GET /wp-json/emcp/v1/documents` (Blueprints.md §6, implemented EMCP-023).
 * Lists posts Elementor has actually built (`_elementor_edit_mode = 'builder'`)
 * — deliberately thin, no native elements/generation/document hash. Those
 * belong to `GET /documents/{id}` (EMCP-024+), a separate, per-document call.
 */
export async function listPages(
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<Record<string, unknown>> {
  const url = new URL('/wp-json/emcp/v1/documents', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString(
    'base64',
  );

  const response = await fetch(url, {
    headers: { authorization: `Basic ${credentials}` },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(`GET /documents returned ${response.status}`, response.status, body);
  }

  if (!isRecord(body)) {
    throw new WordPressApiError('GET /documents returned a non-object body.', response.status, body);
  }

  return body;
}

/**
 * `GET /wp-json/emcp/v1/documents/{id}` (Blueprints.md §6, implemented
 * EMCP-024). Returns raw native elements, meta, and a server-computed
 * `document_hash` (§6.4) — deliberately **no** `generation` field; that's
 * derived Node-side by `get_page_structure` from `server/src/domain/detect.ts`
 * (EMCP-019), the one tested implementation of that rule, per the "why"
 * documented in `DocumentsController.php`'s docblock.
 */
export async function getDocument(
  postId: number,
  options: { source?: 'parent' | 'autosave' } = {},
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<Record<string, unknown>> {
  const url = new URL(`/wp-json/emcp/v1/documents/${postId}`, config.baseUrl);
  if (options.source) {
    url.searchParams.set('source', options.source);
  }

  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString(
    'base64',
  );

  const response = await fetch(url, {
    headers: { authorization: `Basic ${credentials}` },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(
      `GET /documents/${postId} returned ${response.status}`,
      response.status,
      body,
    );
  }

  if (!isRecord(body)) {
    throw new WordPressApiError(
      `GET /documents/${postId} returned a non-object body.`,
      response.status,
      body,
    );
  }

  return body;
}

/**
 * `GET /wp-json/emcp/v1/widgets` (Blueprints.md §6, implemented EMCP-027).
 * A lightweight registry listing — `name`/`title`/`categories`/`keywords`
 * per widget, deliberately **no** `controls`; that's `/registry/snapshot`
 * (EMCP-017)'s job, which legitimately forces every widget's control-stack
 * init since its whole purpose is the full schema.
 */
export async function listWidgets(
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<Record<string, unknown>> {
  const url = new URL('/wp-json/emcp/v1/widgets', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString(
    'base64',
  );

  const response = await fetch(url, {
    headers: { authorization: `Basic ${credentials}` },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(`GET /widgets returned ${response.status}`, response.status, body);
  }

  if (!isRecord(body)) {
    throw new WordPressApiError('GET /widgets returned a non-object body.', response.status, body);
  }

  return body;
}

/**
 * `GET /wp-json/emcp/v1/widgets/{type}` (Blueprints.md §6, implemented
 * EMCP-028). Returns one widget's full, uncurated control list (forces
 * stack init) — curation, responsive collapsing, and detail-level
 * filtering all happen Node-side in `server/src/domain/curation.ts`, not
 * here.
 */
export async function getWidgetDetail(
  type: string,
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<Record<string, unknown>> {
  const url = new URL(`/wp-json/emcp/v1/widgets/${encodeURIComponent(type)}`, config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString(
    'base64',
  );

  const response = await fetch(url, {
    headers: { authorization: `Basic ${credentials}` },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(
      `GET /widgets/${type} returned ${response.status}`,
      response.status,
      body,
    );
  }

  if (!isRecord(body)) {
    throw new WordPressApiError(`GET /widgets/${type} returned a non-object body.`, response.status, body);
  }

  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
