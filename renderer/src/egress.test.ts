import { describe, expect, it, vi } from 'vitest';
import { assertAllowedTarget, EgressBlockedError, isAllowedScheme, isBlockedAddress } from './egress.js';

describe('isAllowedScheme', () => {
  it('allows http and https', () => {
    expect(isAllowedScheme(new URL('http://example.com/'))).toBe(true);
    expect(isAllowedScheme(new URL('https://example.com/'))).toBe(true);
  });

  it('blocks file:// and other non-http(s) schemes', () => {
    expect(isAllowedScheme(new URL('file:///etc/passwd'))).toBe(false);
    expect(isAllowedScheme(new URL('javascript:alert(1)'))).toBe(false);
    expect(isAllowedScheme(new URL('ftp://example.com/'))).toBe(false);
    expect(isAllowedScheme(new URL('data:text/html,hi'))).toBe(false);
  });
});

describe('isBlockedAddress: IPv4', () => {
  it('blocks all three RFC1918 private ranges', () => {
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('10.255.255.255')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('192.168.0.1')).toBe(true);
    expect(isBlockedAddress('192.168.255.255')).toBe(true);
  });

  it('does not blur the 172.16.0.0/12 boundary — 172.15.x and 172.32.x are public', () => {
    expect(isBlockedAddress('172.15.255.255')).toBe(false);
    expect(isBlockedAddress('172.32.0.1')).toBe(false);
  });

  it('blocks loopback (127.0.0.0/8)', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('127.255.255.254')).toBe(true);
  });

  it('blocks link-local (169.254.0.0/16) — including the cloud metadata address', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  it('blocks 0.0.0.0/8', () => {
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
  });

  it('allows real public addresses', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
  });
});

describe('isBlockedAddress: IPv6', () => {
  it('blocks loopback (::1) and unspecified (::)', () => {
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('::')).toBe(true);
  });

  it('blocks link-local (fe80::/10)', () => {
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('fe80::a1b2:c3d4:e5f6:1234')).toBe(true);
  });

  it('blocks unique-local (fc00::/7 — the RFC1918 analogue)', () => {
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('fd12:3456:789a::1')).toBe(true);
  });

  it('blocks an IPv4-mapped IPv6 address whose embedded IPv4 is private', () => {
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('allows an IPv4-mapped IPv6 address whose embedded IPv4 is public', () => {
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('allows a real public IPv6 address', () => {
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false); // Google public DNS
  });
});

describe('isBlockedAddress: not an IP at all', () => {
  it('blocks rather than guesses when given something that is not a valid IP', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('example.com')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('assertAllowedTarget', () => {
  it('resolves without throwing for a public hostname resolving to a public address', async () => {
    const dnsLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(assertAllowedTarget('http://example.com/page', { dnsLookup })).resolves.toBeUndefined();
    expect(dnsLookup).toHaveBeenCalledWith('example.com');
  });

  it('rejects a blocked scheme before ever calling DNS', async () => {
    const dnsLookup = vi.fn();

    await expect(assertAllowedTarget('file:///etc/passwd', { dnsLookup })).rejects.toThrow(EgressBlockedError);
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL before calling DNS', async () => {
    const dnsLookup = vi.fn();

    await expect(assertAllowedTarget('not a url at all', { dnsLookup })).rejects.toThrow(EgressBlockedError);
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it('rejects when the hostname resolves to a private address', async () => {
    const dnsLookup = vi.fn().mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    await expect(assertAllowedTarget('http://internal.example.com/', { dnsLookup })).rejects.toThrow(
      EgressBlockedError,
    );
  });

  it('rejects a redirect target that resolves to link-local (the cloud metadata address)', async () => {
    const dnsLookup = vi.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);

    await expect(
      assertAllowedTarget('http://attacker.example.com/redirect-target', { dnsLookup }),
    ).rejects.toThrow(/blocked address/);
  });

  it('rejects when DNS returns multiple addresses and any one of them is blocked', async () => {
    const dnsLookup = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);

    await expect(assertAllowedTarget('http://mixed.example.com/', { dnsLookup })).rejects.toThrow(
      EgressBlockedError,
    );
  });

  it('rejects a bare private IP literal in the URL without needing a DNS lookup at all', async () => {
    const dnsLookup = vi.fn();

    await expect(assertAllowedTarget('http://127.0.0.1/', { dnsLookup })).rejects.toThrow(EgressBlockedError);
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it('allows a bare public IP literal without a DNS lookup', async () => {
    const dnsLookup = vi.fn();

    await expect(assertAllowedTarget('http://8.8.8.8/', { dnsLookup })).resolves.toBeUndefined();
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it('rejects when DNS resolution itself fails', async () => {
    const dnsLookup = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    await expect(assertAllowedTarget('http://does-not-resolve.invalid/', { dnsLookup })).rejects.toThrow(
      EgressBlockedError,
    );
  });

  it('is stateless — checking a blocked URL does not affect the next, independent check (re-checked per redirect hop)', async () => {
    const dnsLookup = vi
      .fn()
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);

    await expect(assertAllowedTarget('http://first-hop.example.com/', { dnsLookup })).rejects.toThrow(
      EgressBlockedError,
    );
    await expect(assertAllowedTarget('http://second-hop.example.com/', { dnsLookup })).resolves.toBeUndefined();
  });
});

describe('assertAllowedTarget: allowedHost exception (EMCP-034)', () => {
  it('allows a private-address target when its hostname matches allowedHost, without even calling DNS', async () => {
    const dnsLookup = vi.fn();

    await expect(
      assertAllowedTarget('http://wp-v4-pro/some-page/', { allowedHost: 'wp-v4-pro', dnsLookup }),
    ).resolves.toBeUndefined();
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it('the match is case-insensitive', async () => {
    await expect(
      assertAllowedTarget('http://WP-V4-PRO/', { allowedHost: 'wp-v4-pro' }),
    ).resolves.toBeUndefined();
  });

  it('still rejects a different private host even when an allowedHost is set for another one', async () => {
    const dnsLookup = vi.fn().mockResolvedValue([{ address: '10.0.0.9', family: 4 }]);

    await expect(
      assertAllowedTarget('http://some-other-internal-host/', { allowedHost: 'wp-v4-pro', dnsLookup }),
    ).rejects.toThrow(EgressBlockedError);
  });

  it('still rejects a redirect to a different host, even one resolving to a public address is fine but a private one is not — exemption is host-exact, not "anything goes once one host is allowed"', async () => {
    const dnsLookup = vi.fn().mockResolvedValue([{ address: '192.168.1.1', family: 4 }]);

    await expect(
      assertAllowedTarget('http://attacker-controlled-redirect-target/', { allowedHost: 'wp-v4-pro', dnsLookup }),
    ).rejects.toThrow(EgressBlockedError);
  });

  it('still rejects a non-http(s) scheme even for the allowed host', async () => {
    await expect(
      assertAllowedTarget('file:///etc/passwd', { allowedHost: 'wp-v4-pro' }),
    ).rejects.toThrow(EgressBlockedError);
  });

  it('with no allowedHost set, behaves exactly as before (private addresses blocked)', async () => {
    const dnsLookup = vi.fn().mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);

    await expect(assertAllowedTarget('http://wp-v4-pro/', { dnsLookup })).rejects.toThrow(EgressBlockedError);
  });
});
