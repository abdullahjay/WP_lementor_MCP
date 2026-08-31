import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * solution.md §9.5: "Allowlisting the initial URL is not an SSRF control —
 * enforce at connect time per request, after every redirect, rejecting
 * RFC1918/loopback/link-local and any IP not matching the registered site.
 * Block non-http(s) schemes and file://. ... The same egress policy applies
 * to every outbound fetch: upload_media by URL, upload_reference_design,
 * and the Node client calling WordPress."
 *
 * `upload_media`'s equivalent (EMCP-063) lives PHP-side
 * (`plugin/src/Media/MediaService.php`'s `fetch_url_safely()`/
 * `validate_url_safe()`) because that ingestion path writes into
 * WordPress's own media library. Reference designs (EMCP-064) are
 * Node/MinIO artifacts — the same object-storage system `render_preview`
 * already uses (Blueprints.md §11.2) — so this fetch genuinely happens
 * Node-side, never touching WordPress at all. The security *policy* is
 * identical to the PHP version; the *mechanism* has to be reimplemented in
 * TypeScript since there is no shared runtime between the two.
 */

export class SsrfBlockedError extends Error {
  constructor(url: string) {
    super(`URL "${url}" resolves to a private, loopback, link-local, or reserved address.`);
  }
}

export class InvalidUrlSchemeError extends Error {
  constructor(url: string) {
    super(`URL "${url}" must use http or https — got a different scheme.`);
  }
}

export class TooManyRedirectsError extends Error {
  constructor() {
    super('Too many redirects while fetching the URL.');
  }
}

export class FetchFailedError extends Error {
  constructor(
    url: string,
    public readonly status: number,
  ) {
    super(`Fetching "${url}" returned HTTP ${status}.`);
  }
}

const MAX_REDIRECTS = 5;

/**
 * `filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE |
 * FILTER_FLAG_NO_RES_RANGE)`'s TypeScript equivalent — there is no built-in
 * for this in Node, so the ranges are enumerated explicitly rather than
 * reached for a third-party package for something this contained.
 */
function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets as [number, number, number, number];

    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 0) return true; // 0.0.0.0/8
    if (a >= 224) return true; // multicast/reserved (224.0.0.0+)

    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();

    if (normalized === '::1') return true; // loopback
    if (normalized === '::') return true; // unspecified
    if (normalized.startsWith('fe80:') || normalized.startsWith('fe80::')) return true; // link-local
    if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 unique local
    if (normalized.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 — re-check the embedded IPv4 address.
      const embedded = normalized.slice('::ffff:'.length);
      return net.isIPv4(embedded) ? isPrivateOrReservedIp(embedded) : true;
    }

    return false;
  }

  // Not a recognizable IP literal at all — fail closed.
  return true;
}

async function validateUrlSafe(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidUrlSchemeError(url);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidUrlSchemeError(url);
  }

  const host = parsed.hostname;

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new SsrfBlockedError(url);
    }
    return;
  }

  let addresses: string[];
  try {
    const results = await dns.lookup(host, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new SsrfBlockedError(url); // Unresolvable — fail closed, not open.
  }

  if (addresses.length === 0 || addresses.some((ip) => isPrivateOrReservedIp(ip))) {
    throw new SsrfBlockedError(url);
  }
}

export interface SafeFetchResult {
  body: Buffer;
  url: string;
  contentType: string | null;
}

/**
 * Manual per-hop redirect loop — a native `fetch()`'s automatic redirect
 * following would land on a `Location` header's target without ever
 * re-validating it, exactly the SSRF gap this exists to close. Each hop is
 * independently re-validated before its own request is made.
 */
export async function fetchUrlSafely(startUrl: string, maxBytes: number): Promise<SafeFetchResult> {
  let url = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validateUrlSafe(url);

    const response = await fetch(url, { redirect: 'manual' });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new FetchFailedError(url, response.status);
      }
      url = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      throw new FetchFailedError(url, response.status);
    }

    const contentType = response.headers.get('content-type');
    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`Downloaded body exceeds the ${maxBytes} byte limit.`);
    }

    return { body: Buffer.from(arrayBuffer), url, contentType };
  }

  throw new TooManyRedirectsError();
}
