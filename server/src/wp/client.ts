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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
