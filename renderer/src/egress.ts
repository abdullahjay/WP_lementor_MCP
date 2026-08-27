import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * EMCP-032 — solution.md §9.5's real SSRF control, distinct from EMCP-031's
 * baseline scheme check: "Allowlisting the initial URL is not an SSRF
 * control — enforce at connect time per request, after every redirect,
 * rejecting RFC1918/loopback/link-local and any IP not matching the
 * registered site. Block non-`http(s)` schemes and `file://`."
 *
 * "Any IP not matching the registered site" (EMCP-034): this module still
 * has no site-registry access and never will — the caller (`render.ts`,
 * ultimately `render_preview`'s tool handler, which already knows which
 * site it's rendering for from its own trusted `WP_BASE_URL` config, not
 * from anything a request body supplied) passes down the **one** hostname
 * exempted from the private-address block for this render, via
 * `allowedHost`. This is a narrow, per-call exception, not a bypass: the
 * scheme check still applies, DNS is still resolved and still checked
 * against every *other* address, and a redirect to any host other than
 * the exact exempted one is still blocked exactly as before — only
 * requests to that one specific hostname skip the RFC1918/loopback/
 * link-local rejection.
 */

export const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export function isAllowedScheme(url: URL): boolean {
  return ALLOWED_SCHEMES.has(url.protocol);
}

/** RFC1918 private ranges, loopback (127.0.0.0/8), link-local (169.254.0.0/16), and 0.0.0.0/8 ("this network"). */
function isBlockedIPv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;

  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0) return true; // 0.0.0.0/8

  return false;
}

/** IPv6 loopback (::1), link-local (fe80::/10), and unique-local (fc00::/7 — the RFC1918 analogue) — plus IPv4-mapped addresses, checked against the IPv4 rule. */
function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified

  const firstGroup = lower.split(':')[0] ?? '';
  if (firstGroup.length === 4 && /^fe[89ab]/.test(firstGroup)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(firstGroup)) return true; // fc00::/7 unique local

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1] && isIP(mapped[1]) === 4) {
    return isBlockedIPv4(mapped[1]);
  }

  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);

  // Not a syntactically valid IP at all — refuse to guess, treat as blocked.
  return true;
}

export class EgressBlockedError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`Egress blocked for "${url}": ${reason}`);
  }
}

export interface DnsLookup {
  (hostname: string): Promise<{ address: string; family: number }[]>;
}

const defaultLookup: DnsLookup = (hostname) => lookup(hostname, { all: true });

export interface AssertAllowedTargetOptions {
  /** The one hostname (case-insensitive) exempted from the private-address block for this render — see the module docblock. */
  allowedHost?: string;
  dnsLookup?: DnsLookup;
}

/**
 * Connect-time check for one URL — called for the initial navigation and
 * for **every redirect hop** (`render.ts` wires this into
 * `context.route()`, which intercepts every request Chromium makes,
 * redirects included, before it connects). Resolves the hostname itself
 * rather than trusting the URL's literal text, since a hostname allowed at
 * request-construction time can still resolve to a blocked address — the
 * DNS-rebinding class of gap solution.md §9.5 exists to close.
 */
export async function assertAllowedTarget(rawUrl: string, options: AssertAllowedTargetOptions = {}): Promise<void> {
  const dnsLookup = options.dnsLookup ?? defaultLookup;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new EgressBlockedError(rawUrl, 'not a valid URL');
  }

  if (!isAllowedScheme(parsed)) {
    throw new EgressBlockedError(rawUrl, `scheme "${parsed.protocol}" is not allowed`);
  }

  if (options.allowedHost && parsed.hostname.toLowerCase() === options.allowedHost.toLowerCase()) {
    return;
  }

  // A bare IP literal in the URL still needs the same address check — a
  // redirect can point straight at an IP with no hostname to resolve.
  if (isIP(parsed.hostname)) {
    if (isBlockedAddress(parsed.hostname)) {
      throw new EgressBlockedError(rawUrl, `"${parsed.hostname}" is a blocked address`);
    }
    return;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dnsLookup(parsed.hostname);
  } catch {
    throw new EgressBlockedError(rawUrl, `DNS resolution failed for "${parsed.hostname}"`);
  }

  if (addresses.length === 0) {
    throw new EgressBlockedError(rawUrl, `DNS resolution returned no addresses for "${parsed.hostname}"`);
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new EgressBlockedError(rawUrl, `"${parsed.hostname}" resolves to a blocked address (${address})`);
    }
  }
}
