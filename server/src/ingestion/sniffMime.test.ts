import { describe, expect, it } from 'vitest';
import { sniffImageMimeType } from './sniffMime.js';

describe('sniffImageMimeType — content-derived, not extension-based', () => {
  it('detects a real PNG by its magic bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
    expect(sniffImageMimeType(png)).toBe('image/png');
  });

  it('detects a real JPEG by its magic bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(sniffImageMimeType(jpeg)).toBe('image/jpeg');
  });

  it('detects a real GIF by its magic bytes', () => {
    const gif = Buffer.from('GIF89a' + '\0\0\0\0', 'ascii');
    expect(sniffImageMimeType(gif)).toBe('image/gif');
  });

  it('detects a real WEBP by its RIFF/WEBP magic bytes', () => {
    const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii')]);
    expect(sniffImageMimeType(webp)).toBe('image/webp');
  });

  it('denies an SVG payload even with a spoofed image extension implied', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
    expect(sniffImageMimeType(svg)).toBeNull();
  });

  it('denies HTML content', () => {
    const html = Buffer.from('<html><body>hi</body></html>', 'utf8');
    expect(sniffImageMimeType(html)).toBeNull();
  });

  it('denies a PDF payload', () => {
    const pdf = Buffer.from('%PDF-1.4\n...', 'utf8');
    expect(sniffImageMimeType(pdf)).toBeNull();
  });

  it('denies arbitrary/unrecognized bytes rather than guessing', () => {
    expect(sniffImageMimeType(Buffer.from([1, 2, 3, 4, 5]))).toBeNull();
  });

  it('denies an empty buffer', () => {
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
  });
});
