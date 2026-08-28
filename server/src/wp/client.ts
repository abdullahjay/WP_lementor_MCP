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
 * Blueprints.md §6.4: `PUT /documents/{id}` returns `409` when the caller's
 * `document_hash` doesn't match the document's current one — a real
 * concurrent-write conflict, not a generic HTTP error. Carries the
 * `currentHash` the plugin actually computed, so a caller can re-fetch,
 * confirm what changed, and retry with the right hash rather than having
 * to make a second round trip just to learn what it already got told.
 */
export class DocumentHashMismatchError extends Error {
  constructor(
    public readonly postId: number,
    public readonly currentHash: string,
  ) {
    super(`Document ${postId} has changed since the given hash was read; current hash is "${currentHash}".`);
  }
}

/**
 * Blueprints.md §6.3 / prd.md EMCP-042: `PUT /documents/{id}` returns `423`
 * (Locked) when `wp_check_post_lock()` reports a different user actively
 * editing the post right now — a real WordPress editor-lock conflict, not a
 * hash mismatch and not a generic HTTP error. Carries who holds the lock so
 * a caller can report *who* is editing, not just that someone is.
 */
export class DocumentLockedError extends Error {
  constructor(
    public readonly postId: number,
    public readonly lockedByUserId: number,
    public readonly lockedByName: string | null,
  ) {
    super(
      `Document ${postId} is locked — ${lockedByName ?? `user ${lockedByUserId}`} is currently editing it.`,
    );
  }
}

export interface Diagnostic {
  path: string;
  code: string;
  message: string;
}

/**
 * Blueprints.md §7.2: `PUT /documents/{id}` returns `400` when one or more
 * operations are malformed (bad `op`, missing `element_id`/`settings`) —
 * validated before anything else runs, nothing applied.
 */
export class InvalidOperationsError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    super(`One or more operations are malformed: ${diagnostics.map((d) => d.message).join('; ')}`);
  }
}

/**
 * Blueprints.md §7.2's "all operations validate before any apply": every
 * operation's target element must exist *before* any merge happens — this
 * carries every missing element as its own diagnostic, not just the first,
 * so a caller sees the whole batch's problems in one round trip.
 */
export class ElementsNotFoundError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    super(`One or more operations target elements that don't exist: ${diagnostics.map((d) => d.message).join('; ')}`);
  }
}

export interface EditOperation {
  op: 'set_settings';
  elementId: string;
  settings: Record<string, unknown>;
}

/**
 * `PUT /wp-json/emcp/v1/documents/{id}` (Blueprints.md §7.2). Started as
 * EMCP-040's minimal single-element vehicle (one element, one flat settings
 * merge), then gained document-hash CAS (EMCP-041, §6.4) and post-lock
 * refusal (EMCP-042, §6.3); EMCP-043 generalized it into the real
 * `operations[]` batch contract §7.2 documents — every operation validated
 * before any is applied, one `Document::save()` for the whole batch. Not
 * wired into any registered MCP tool until now — `edit_elements`
 * (`server/src/tools/editElements.ts`) is the first real client.
 */
export async function editElements(
  postId: number,
  operations: EditOperation[],
  expectedHash: string,
  options: { overrideLock?: boolean } = {},
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{
  id: number;
  documentHash: string;
  results: Array<{ elementId: string; applied: boolean }>;
  source: 'parent' | 'autosave';
}> {
  const url = new URL(`/wp-json/emcp/v1/documents/${postId}`, config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      operations: operations.map((op) => ({ op: op.op, element_id: op.elementId, settings: op.settings })),
      document_hash: expectedHash,
      ...(options.overrideLock !== undefined && { override_lock: options.overrideLock }),
    }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (423 === response.status) {
    const lockedBy = isRecord(body) ? body['locked_by'] : undefined;
    if (!isRecord(lockedBy) || typeof lockedBy['id'] !== 'number') {
      throw new WordPressApiError(
        `PUT /documents/${postId} returned a 423 with an unexpected body shape.`,
        response.status,
        body,
      );
    }
    const name = typeof lockedBy['name'] === 'string' ? lockedBy['name'] : null;
    throw new DocumentLockedError(postId, lockedBy['id'], name);
  }

  if (409 === response.status) {
    if (!isRecord(body) || typeof body['document_hash'] !== 'string') {
      throw new WordPressApiError(
        `PUT /documents/${postId} returned a 409 with an unexpected body shape.`,
        response.status,
        body,
      );
    }
    throw new DocumentHashMismatchError(postId, body['document_hash']);
  }

  const diagnostics = extractDiagnostics(body);

  if (400 === response.status && diagnostics) {
    throw new InvalidOperationsError(diagnostics);
  }

  if (404 === response.status && diagnostics) {
    throw new ElementsNotFoundError(diagnostics);
  }

  if (!response.ok) {
    throw new WordPressApiError(
      `PUT /documents/${postId} returned ${response.status}`,
      response.status,
      body,
    );
  }

  if (
    !isRecord(body) ||
    typeof body['id'] !== 'number' ||
    typeof body['document_hash'] !== 'string' ||
    !Array.isArray(body['results'])
  ) {
    throw new WordPressApiError(
      `PUT /documents/${postId} returned an unexpected body shape.`,
      response.status,
      body,
    );
  }

  const results = body['results'].map((r: unknown) => {
    if (!isRecord(r) || typeof r['element_id'] !== 'string' || typeof r['applied'] !== 'boolean') {
      throw new WordPressApiError(
        `PUT /documents/${postId} returned a malformed result entry.`,
        response.status,
        body,
      );
    }
    return { elementId: r['element_id'], applied: r['applied'] };
  });

  const source = 'autosave' === body['source'] ? 'autosave' : 'parent';

  return { id: body['id'], documentHash: body['document_hash'], results, source };
}

/**
 * `PUT /wp-json/emcp/v1/documents/{id}` with `op: "replace_tree"`
 * (Blueprints.md §6.3, EMCP-055) — `apply_page_spec`'s write path. Shares
 * the same route, lock check, hash CAS, and autosave branching
 * `editElements()` already exercises via `op: "set_settings"`; the only
 * difference is the operation shape itself, since `compile()`'s output is
 * a full element tree, not a per-element settings patch.
 */
export async function replaceDocumentTree(
  postId: number,
  elements: unknown[],
  expectedHash: string,
  options: { overrideLock?: boolean } = {},
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{ id: number; documentHash: string; source: 'parent' | 'autosave' }> {
  const url = new URL(`/wp-json/emcp/v1/documents/${postId}`, config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      operations: [{ op: 'replace_tree', elements }],
      document_hash: expectedHash,
      ...(options.overrideLock !== undefined && { override_lock: options.overrideLock }),
    }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (423 === response.status) {
    const lockedBy = isRecord(body) ? body['locked_by'] : undefined;
    if (!isRecord(lockedBy) || typeof lockedBy['id'] !== 'number') {
      throw new WordPressApiError(
        `PUT /documents/${postId} returned a 423 with an unexpected body shape.`,
        response.status,
        body,
      );
    }
    const name = typeof lockedBy['name'] === 'string' ? lockedBy['name'] : null;
    throw new DocumentLockedError(postId, lockedBy['id'], name);
  }

  if (409 === response.status) {
    if (!isRecord(body) || typeof body['document_hash'] !== 'string') {
      throw new WordPressApiError(
        `PUT /documents/${postId} returned a 409 with an unexpected body shape.`,
        response.status,
        body,
      );
    }
    throw new DocumentHashMismatchError(postId, body['document_hash']);
  }

  const diagnostics = extractDiagnostics(body);

  if (400 === response.status && diagnostics) {
    throw new InvalidOperationsError(diagnostics);
  }

  if (!response.ok) {
    throw new WordPressApiError(`PUT /documents/${postId} returned ${response.status}`, response.status, body);
  }

  if (!isRecord(body) || typeof body['id'] !== 'number' || typeof body['document_hash'] !== 'string') {
    throw new WordPressApiError(
      `PUT /documents/${postId} returned an unexpected body shape.`,
      response.status,
      body,
    );
  }

  const source = 'autosave' === body['source'] ? 'autosave' : 'parent';

  return { id: body['id'], documentHash: body['document_hash'], source };
}

/**
 * `POST /wp-json/emcp/v1/documents` (Blueprints.md §6.9, EMCP-046). Always
 * creates a `draft` — there is no `status` input, matching solution.md §5.4's
 * write posture table ("New page → post with `draft` status"); publishing is
 * `publish_draft`'s job (EMCP-047), not this route's.
 */
export class InvalidPostTypeError extends Error {
  constructor(public readonly postType: string) {
    super(`Post type "${postType}" does not exist or does not support Elementor.`);
  }
}

export class InvalidPageTemplateError extends Error {
  constructor(public readonly pageTemplate: string) {
    super(`"${pageTemplate}" is not a valid page template for this post type.`);
  }
}

export async function createDocument(
  title: string,
  options: { postType?: string | undefined; pageTemplate?: string | undefined } = {},
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{
  id: number;
  status: string;
  type: string;
  link: string;
  editUrl: string;
  pageTemplate: string;
  documentHash: string;
}> {
  const url = new URL('/wp-json/emcp/v1/documents', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      title,
      ...(options.postType !== undefined && { post_type: options.postType }),
      ...(options.pageTemplate !== undefined && { page_template: options.pageTemplate }),
    }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (400 === response.status && isRecord(body) && 'emcp_invalid_post_type' === body['code']) {
    throw new InvalidPostTypeError(options.postType ?? 'page');
  }

  if (400 === response.status && isRecord(body) && 'emcp_invalid_page_template' === body['code']) {
    throw new InvalidPageTemplateError(options.pageTemplate ?? 'default');
  }

  if (!response.ok) {
    throw new WordPressApiError(`POST /documents returned ${response.status}`, response.status, body);
  }

  if (
    !isRecord(body) ||
    typeof body['id'] !== 'number' ||
    typeof body['status'] !== 'string' ||
    typeof body['type'] !== 'string' ||
    typeof body['link'] !== 'string' ||
    typeof body['edit_url'] !== 'string' ||
    typeof body['page_template'] !== 'string' ||
    typeof body['document_hash'] !== 'string'
  ) {
    throw new WordPressApiError('POST /documents returned an unexpected body shape.', response.status, body);
  }

  return {
    id: body['id'],
    status: body['status'],
    type: body['type'],
    link: body['link'],
    editUrl: body['edit_url'],
    pageTemplate: body['page_template'],
    documentHash: body['document_hash'],
  };
}

/**
 * `PUT /wp-json/emcp/v1/documents/{id}/page` (Blueprints.md §6.9, EMCP-046).
 * Deliberately a separate route from `PUT /documents/{id}` (`editElements`
 * above) — title/page-template are real post attributes with no autosave
 * concept, unlike the element tree `edit_elements` writes; no document-hash
 * CAS applies here for the same reason.
 */
export async function updateDocumentAttributes(
  postId: number,
  attributes: { title?: string | undefined; pageTemplate?: string | undefined },
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{ id: number; title: string; pageTemplate: string; status: string; link: string }> {
  const url = new URL(`/wp-json/emcp/v1/documents/${postId}/page`, config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(attributes.title !== undefined && { title: attributes.title }),
      ...(attributes.pageTemplate !== undefined && { page_template: attributes.pageTemplate }),
    }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (400 === response.status && isRecord(body) && 'emcp_invalid_page_template' === body['code']) {
    throw new InvalidPageTemplateError(attributes.pageTemplate ?? '');
  }

  if (404 === response.status && isRecord(body) && 'emcp_document_not_found' === body['code']) {
    throw new WordPressApiError(`No document exists with id ${postId}.`, response.status, body);
  }

  if (!response.ok) {
    throw new WordPressApiError(
      `PUT /documents/${postId}/page returned ${response.status}`,
      response.status,
      body,
    );
  }

  if (
    !isRecord(body) ||
    typeof body['id'] !== 'number' ||
    typeof body['title'] !== 'string' ||
    typeof body['page_template'] !== 'string' ||
    typeof body['status'] !== 'string' ||
    typeof body['link'] !== 'string'
  ) {
    throw new WordPressApiError(
      `PUT /documents/${postId}/page returned an unexpected body shape.`,
      response.status,
      body,
    );
  }

  return {
    id: body['id'],
    title: body['title'],
    pageTemplate: body['page_template'],
    status: body['status'],
    link: body['link'],
  };
}

/**
 * Blueprints.md §7.5: `publish_draft`'s confirmation token is bound to
 * `(site, post_id, content_hash)` and obtainable "only through a channel
 * the model cannot write to" — the plugin's wp-admin approval screen
 * (EMCP-047 / D3), never this REST route. A stale approval (content
 * changed since it was issued) is a distinct failure from an
 * invalid/expired/reused one — surfaced as its own error class so a caller
 * can tell "get a fresh approval" apart from "you never had one."
 */
export class ApprovalTokenInvalidError extends Error {
  constructor(public readonly reason: string) {
    super(`Approval token rejected: ${reason}`);
  }
}

export class ApprovalContentChangedError extends Error {
  constructor(public readonly postId: number) {
    super(`Post ${postId}'s content has changed since this approval was issued. Get a fresh approval.`);
  }
}

/**
 * `POST /wp-json/emcp/v1/documents/{id}/publish` (Blueprints.md §7.5,
 * EMCP-047). Omitting `confirmationToken` is the normal first call — the
 * plugin responds with a `pending` state and the approval URL rather than
 * an error, which this function surfaces as `{ published: false, ... }`,
 * not a thrown error (a caller checks `.published`, same shape either way).
 * A rejected/expired/reused/wrong-post token, or a token whose bound
 * content hash no longer matches, throws instead — those are genuine
 * failures a retry-without-fixing-the-input won't resolve.
 */
export async function publishDraft(
  postId: number,
  confirmationToken?: string,
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<
  | { published: true; status: string; url: string }
  | { published: false; status: 'pending'; message: string; approvalUrl: string }
> {
  const url = new URL(`/wp-json/emcp/v1/documents/${postId}/publish`, config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...(confirmationToken !== undefined && { confirmation_token: confirmationToken }) }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (409 === response.status && isRecord(body) && 'emcp_approval_content_changed' === body['code']) {
    throw new ApprovalContentChangedError(postId);
  }

  if (403 === response.status && isRecord(body) && typeof body['code'] === 'string' && body['code'].startsWith('emcp_approval')) {
    throw new ApprovalTokenInvalidError(typeof body['message'] === 'string' ? body['message'] : 'invalid token');
  }

  if (!response.ok) {
    throw new WordPressApiError(
      `POST /documents/${postId}/publish returned ${response.status}`,
      response.status,
      body,
    );
  }

  if (!isRecord(body) || typeof body['published'] !== 'boolean') {
    throw new WordPressApiError(
      `POST /documents/${postId}/publish returned an unexpected body shape.`,
      response.status,
      body,
    );
  }

  if (false === body['published']) {
    if (typeof body['message'] !== 'string' || typeof body['approval_url'] !== 'string') {
      throw new WordPressApiError(
        `POST /documents/${postId}/publish returned an unexpected pending-state body shape.`,
        response.status,
        body,
      );
    }
    return { published: false, status: 'pending', message: body['message'], approvalUrl: body['approval_url'] };
  }

  if (typeof body['status'] !== 'string' || typeof body['url'] !== 'string') {
    throw new WordPressApiError(
      `POST /documents/${postId}/publish returned an unexpected published-state body shape.`,
      response.status,
      body,
    );
  }

  return { published: true, status: body['status'], url: body['url'] };
}

/**
 * `WP_Error`'s `data` becomes `body.data` in the serialized REST response
 * (`{ code, message, data: { status, diagnostics? } }`) — this codebase's
 * other error paths (403/404 without diagnostics) don't carry this, so its
 * presence is exactly the signal that distinguishes a diagnostics-bearing
 * validation failure from a plain not-found/forbidden.
 */
function extractDiagnostics(body: unknown): Diagnostic[] | null {
  if (!isRecord(body)) return null;
  const data = body['data'];
  if (!isRecord(data) || !Array.isArray(data['diagnostics'])) return null;

  const diagnostics: Diagnostic[] = [];
  for (const entry of data['diagnostics']) {
    if (
      isRecord(entry) &&
      typeof entry['path'] === 'string' &&
      typeof entry['code'] === 'string' &&
      typeof entry['message'] === 'string'
    ) {
      diagnostics.push({ path: entry['path'], code: entry['code'], message: entry['message'] });
    }
  }

  return diagnostics.length > 0 ? diagnostics : null;
}

/**
 * `GET /wp-json/emcp/v1/documents/{id}/lock` (Blueprints.md §6, EMCP-042).
 * Read-only lock check — lets a caller decide whether to attempt a write
 * at all, rather than finding out via a refused `PUT`.
 */
export async function getLockStatus(
  postId: number,
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{ id: number; locked: boolean; lockedBy: { id: number; name: string | null } | null }> {
  const url = new URL(`/wp-json/emcp/v1/documents/${postId}/lock`, config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, { headers: { authorization: `Basic ${credentials}` } });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(
      `GET /documents/${postId}/lock returned ${response.status}`,
      response.status,
      body,
    );
  }

  if (!isRecord(body) || typeof body['id'] !== 'number' || typeof body['locked'] !== 'boolean') {
    throw new WordPressApiError(
      `GET /documents/${postId}/lock returned an unexpected body shape.`,
      response.status,
      body,
    );
  }

  const lockedByRaw = body['locked_by'];
  const lockedBy =
    isRecord(lockedByRaw) && typeof lockedByRaw['id'] === 'number'
      ? { id: lockedByRaw['id'], name: typeof lockedByRaw['name'] === 'string' ? lockedByRaw['name'] : null }
      : null;

  return { id: body['id'], locked: body['locked'], lockedBy };
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

/**
 * `GET /wp-json/emcp/v1/kit` (Blueprints.md §6, implemented EMCP-029).
 * Kit colours/typography/fonts always; `global_classes`/`variables` only
 * when the plugin reports `generation_default: "v4"` — the plugin decides
 * that (same experiment check as `GET /site`), this client just passes the
 * response through.
 */
export async function getGlobalStyles(
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<Record<string, unknown>> {
  const url = new URL('/wp-json/emcp/v1/kit', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString(
    'base64',
  );

  const response = await fetch(url, {
    headers: { authorization: `Basic ${credentials}` },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(`GET /kit returned ${response.status}`, response.status, body);
  }

  if (!isRecord(body)) {
    throw new WordPressApiError('GET /kit returned a non-object body.', response.status, body);
  }

  return body;
}

/**
 * `POST /wp-json/emcp/v1/preview-token` (Blueprints.md §6.5, implemented
 * EMCP-033). Returns a signed, single-use, `renderer`-audience token bound
 * to one post — `render_preview` (EMCP-034) sends it to the renderer as a
 * header, never verifies it itself (this server has no reason to hold the
 * plugin's signing secret).
 */
export async function issuePreviewToken(
  postId: number,
  ttlMinutes?: number,
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{ token: string; expiresAt: string; postId: number }> {
  const url = new URL('/wp-json/emcp/v1/preview-token', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString(
    'base64',
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ post_id: postId, ...(ttlMinutes !== undefined && { ttl_minutes: ttlMinutes }) }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(
      `POST /preview-token returned ${response.status}`,
      response.status,
      body,
    );
  }

  if (
    !isRecord(body) ||
    typeof body['token'] !== 'string' ||
    typeof body['expires_at'] !== 'string' ||
    typeof body['post_id'] !== 'number'
  ) {
    throw new WordPressApiError(
      'POST /preview-token returned an unexpected body shape.',
      response.status,
      body,
    );
  }

  return { token: body['token'], expiresAt: body['expires_at'], postId: body['post_id'] };
}

/**
 * `POST /wp-json/emcp/v1/snapshots` (Blueprints.md §6.8, EMCP-037).
 */
export async function captureSnapshot(
  postId: number,
  source: 'parent' | 'autosave' = 'parent',
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{ id: number; postId: number; source: string; hash: string; createdAt: string }> {
  const url = new URL('/wp-json/emcp/v1/snapshots', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
    body: JSON.stringify({ post_id: postId, source }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(`POST /snapshots returned ${response.status}`, response.status, body);
  }

  if (
    !isRecord(body) ||
    typeof body['id'] !== 'number' ||
    typeof body['post_id'] !== 'number' ||
    typeof body['source'] !== 'string' ||
    typeof body['hash'] !== 'string' ||
    typeof body['created_at'] !== 'string'
  ) {
    throw new WordPressApiError('POST /snapshots returned an unexpected body shape.', response.status, body);
  }

  return { id: body['id'], postId: body['post_id'], source: body['source'], hash: body['hash'], createdAt: body['created_at'] };
}

/**
 * `POST /wp-json/emcp/v1/snapshots/{id}/restore` (Blueprints.md §6.8, EMCP-037).
 */
export async function restoreSnapshot(
  snapshotId: number,
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{ postId: number; restored: boolean; hash: string }> {
  const url = new URL(`/wp-json/emcp/v1/snapshots/${snapshotId}/restore`, config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(
      `POST /snapshots/${snapshotId}/restore returned ${response.status}`,
      response.status,
      body,
    );
  }

  if (
    !isRecord(body) ||
    typeof body['post_id'] !== 'number' ||
    typeof body['restored'] !== 'boolean' ||
    typeof body['hash'] !== 'string'
  ) {
    throw new WordPressApiError(
      `POST /snapshots/${snapshotId}/restore returned an unexpected body shape.`,
      response.status,
      body,
    );
  }

  return { postId: body['post_id'], restored: body['restored'], hash: body['hash'] };
}

/**
 * `POST /wp-json/emcp/v1/cache/invalidate` (Blueprints.md §6.7, EMCP-035).
 */
export async function invalidateCache(
  postId: number,
  warm = true,
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{ postId: number; invalidated: boolean; warmed: boolean }> {
  const url = new URL('/wp-json/emcp/v1/cache/invalidate', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
    body: JSON.stringify({ post_id: postId, warm }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(`POST /cache/invalidate returned ${response.status}`, response.status, body);
  }

  if (
    !isRecord(body) ||
    typeof body['post_id'] !== 'number' ||
    typeof body['invalidated'] !== 'boolean' ||
    typeof body['warmed'] !== 'boolean'
  ) {
    throw new WordPressApiError(
      'POST /cache/invalidate returned an unexpected body shape.',
      response.status,
      body,
    );
  }

  return { postId: body['post_id'], invalidated: body['invalidated'], warmed: body['warmed'] };
}

/**
 * `GET /wp-json/emcp/v1/templates` (Blueprints.md §6, EMCP-060).
 */
export async function listTemplates(
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<Record<string, unknown>> {
  const url = new URL('/wp-json/emcp/v1/templates', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    headers: { authorization: `Basic ${credentials}` },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(`GET /templates returned ${response.status}`, response.status, body);
  }

  if (!isRecord(body)) {
    throw new WordPressApiError('GET /templates returned a non-object body.', response.status, body);
  }

  return body;
}

/**
 * `POST /wp-json/emcp/v1/templates` (Blueprints.md §6, EMCP-060). The
 * plugin stores `spec` opaquely — validation/compilation both already
 * happened Node-side (`decompile()`/`parseSpec()`) before this is called.
 */
export async function saveTemplate(
  name: string,
  spec: unknown,
  sourcePostId: number | undefined,
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{ id: number; name: string; createdAt: string }> {
  const url = new URL('/wp-json/emcp/v1/templates', config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, spec, ...(sourcePostId !== undefined && { source_post_id: sourcePostId }) }),
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new WordPressApiError(`POST /templates returned ${response.status}`, response.status, body);
  }

  if (
    !isRecord(body) ||
    typeof body['id'] !== 'number' ||
    typeof body['name'] !== 'string' ||
    typeof body['created_at'] !== 'string'
  ) {
    throw new WordPressApiError('POST /templates returned an unexpected body shape.', response.status, body);
  }

  return { id: body['id'], name: body['name'], createdAt: body['created_at'] };
}

export class TemplateNotFoundError extends Error {
  constructor(public readonly templateId: number) {
    super(`No template exists with id ${templateId}.`);
  }
}

/**
 * `GET /wp-json/emcp/v1/templates/{id}` (Blueprints.md §6.10, EMCP-061) —
 * the one route that returns a template's full stored `spec`, needed by
 * `apply_template` to `compile()` it. `listTemplates()` deliberately omits
 * `spec` (a lightweight listing).
 */
export async function getTemplate(
  templateId: number,
  config: WordPressSiteConfig = loadWordPressSiteConfig(),
): Promise<{ id: number; name: string; spec: unknown; createdAt: string }> {
  const url = new URL(`/wp-json/emcp/v1/templates/${templateId}`, config.baseUrl);
  const credentials = Buffer.from(`${config.username}:${config.applicationPassword}`).toString('base64');

  const response = await fetch(url, {
    headers: { authorization: `Basic ${credentials}` },
  });

  const body: unknown = await response.json().catch(() => null);

  if (404 === response.status) {
    throw new TemplateNotFoundError(templateId);
  }

  if (!response.ok) {
    throw new WordPressApiError(`GET /templates/${templateId} returned ${response.status}`, response.status, body);
  }

  if (
    !isRecord(body) ||
    typeof body['id'] !== 'number' ||
    typeof body['name'] !== 'string' ||
    typeof body['created_at'] !== 'string'
  ) {
    throw new WordPressApiError(
      `GET /templates/${templateId} returned an unexpected body shape.`,
      response.status,
      body,
    );
  }

  return { id: body['id'], name: body['name'], spec: body['spec'], createdAt: body['created_at'] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
