/**
 * Content-derived MIME detection for reference-design bytes — solution.md
 * §9.7: "Content-derived MIME validation, not extension-based." No `finfo`
 * equivalent ships with Node, so recognized image formats are detected by
 * their real magic-byte signatures; anything else — including a markup/
 * script payload wearing an image extension or a spoofed `Content-Type` —
 * is denied by default rather than allowed by default. This mirrors
 * `MediaService::ingest()`'s PHP-side sniffing (EMCP-063) for the same
 * threat model, reimplemented here since reference designs never touch
 * WordPress (§6.11 vs. this module).
 */

const SIGNATURES: Array<{ mimeType: string; matches: (bytes: Buffer) => boolean }> = [
  {
    mimeType: 'image/png',
    matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/jpeg',
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/gif',
    matches: (b) => b.length >= 6 && (b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a'),
  },
  {
    mimeType: 'image/webp',
    matches: (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

/**
 * Returns the sniffed MIME type for a recognized image format, or `null`
 * for anything else — including SVG/HTML/XML/PDF and any other markup or
 * script-renderable content, which have no signature in `SIGNATURES` and
 * therefore always fall through to `null` (deny by default).
 */
export function sniffImageMimeType(bytes: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (signature.matches(bytes)) {
      return signature.mimeType;
    }
  }

  return null;
}
