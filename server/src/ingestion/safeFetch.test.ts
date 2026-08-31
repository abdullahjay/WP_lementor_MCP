import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dns from 'node:dns/promises';

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn() },
}));

const fetchMock = vi.fn();

describe('fetchUrlSafely — SSRF hardening (solution.md §9.5)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('rejects a non-http(s) scheme before ever calling fetch', async () => {
    const { fetchUrlSafely, InvalidUrlSchemeError } = await import('./safeFetch.js');

    await expect(fetchUrlSafely('file:///etc/passwd', 1000)).rejects.toThrow(InvalidUrlSchemeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed URL', async () => {
    const { fetchUrlSafely, InvalidUrlSchemeError } = await import('./safeFetch.js');

    await expect(fetchUrlSafely('not a url', 1000)).rejects.toThrow(InvalidUrlSchemeError);
  });

  it.each(['http://127.0.0.1/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/', 'http://0.0.0.0/'])(
    'rejects a literal private/loopback/link-local IP address: %s',
    async (url) => {
      const { fetchUrlSafely, SsrfBlockedError } = await import('./safeFetch.js');

      await expect(fetchUrlSafely(url, 1000)).rejects.toThrow(SsrfBlockedError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects an IPv6 loopback and link-local address', async () => {
    const { fetchUrlSafely, SsrfBlockedError } = await import('./safeFetch.js');

    await expect(fetchUrlSafely('http://[::1]/', 1000)).rejects.toThrow(SsrfBlockedError);
    await expect(fetchUrlSafely('http://[fe80::1]/', 1000)).rejects.toThrow(SsrfBlockedError);
  });

  it('rejects a hostname that resolves to a private address (DNS rebinding class)', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    const { fetchUrlSafely, SsrfBlockedError } = await import('./safeFetch.js');

    await expect(fetchUrlSafely('http://internal.example/', 1000)).rejects.toThrow(SsrfBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when DNS resolution fails, rather than allowing the fetch', async () => {
    vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));
    const { fetchUrlSafely, SsrfBlockedError } = await import('./safeFetch.js');

    await expect(fetchUrlSafely('http://nonexistent.example/', 1000)).rejects.toThrow(SsrfBlockedError);
  });

  it('allows a public IP/hostname and returns the fetched bytes', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }),
    );

    const { fetchUrlSafely } = await import('./safeFetch.js');
    const result = await fetchUrlSafely('http://public.example/img.png', 1000);

    expect(result.body).toEqual(Buffer.from([1, 2, 3]));
    expect(result.contentType).toBe('image/png');
  });

  it('re-validates every redirect hop — a redirect to a private address is caught, not followed', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }),
    );

    const { fetchUrlSafely, SsrfBlockedError } = await import('./safeFetch.js');

    await expect(fetchUrlSafely('http://public.example/redirect', 1000)).rejects.toThrow(SsrfBlockedError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never made the second (unsafe) request
  });

  it('follows a redirect chain through public hosts and returns the final body', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://public2.example/final' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'image/jpeg' } }));

    const { fetchUrlSafely } = await import('./safeFetch.js');
    const result = await fetchUrlSafely('http://public1.example/start', 1000);

    expect(result.body).toEqual(Buffer.from([9]));
    expect(result.url).toBe('http://public2.example/final');
  });

  it('gives up after too many redirects', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://public.example/loop' } }));

    const { fetchUrlSafely, TooManyRedirectsError } = await import('./safeFetch.js');

    await expect(fetchUrlSafely('http://public.example/loop', 1000)).rejects.toThrow(TooManyRedirectsError);
  });

  it('rejects a body larger than the byte limit', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    fetchMock.mockResolvedValue(new Response(new Uint8Array(2000), { status: 200 }));

    const { fetchUrlSafely } = await import('./safeFetch.js');

    await expect(fetchUrlSafely('http://public.example/big', 1000)).rejects.toThrow(/exceeds/);
  });

  it('surfaces a non-2xx status as a real failure', async () => {
    vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const { fetchUrlSafely, FetchFailedError } = await import('./safeFetch.js');

    await expect(fetchUrlSafely('http://public.example/missing', 1000)).rejects.toThrow(FetchFailedError);
  });
});
