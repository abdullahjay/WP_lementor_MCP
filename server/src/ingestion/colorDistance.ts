/**
 * prd.md Task 65: "Perceptual colour distance, not string comparison" —
 * reconciling an extracted colour against the site's real kit tokens
 * (`get_global_styles`, EMCP-029) needs to answer "is this basically the
 * same blue", which hex-string or raw-RGB-Euclidean comparison cannot: two
 * colours can be RGB-close yet perceptually very different (or vice versa).
 * CIE L*a*b* space is designed so that Euclidean distance within it tracks
 * human colour perception far better than RGB does — this is the standard
 * "delta-E" concept.
 *
 * Deliberately CIE76 (plain Euclidean distance in Lab), not the fuller
 * CIEDE2000 — CIE76 is a complete, correct, well-defined distance metric on
 * its own terms (not a stub), just a simpler one than CIEDE2000's extra
 * weighting terms for hue/chroma non-uniformity. Reasonable for "does this
 * design colour already exist in the kit," which doesn't need CIEDE2000's
 * precision for edge-of-gamut hues.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB (D65) → CIE XYZ, via the standard sRGB-to-XYZ matrix. */
function rgbToXyz({ r, g, b }: RgbColor): { x: number; y: number; z: number } {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);

  return {
    x: rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375,
    y: rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175,
    z: rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041,
  };
}

// CIE standard illuminant D65 reference white.
const D65 = { x: 0.95047, y: 1.0, z: 1.08883 };

function xyzToLabChannel(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

export function rgbToLab(rgb: RgbColor): LabColor {
  const { x, y, z } = rgbToXyz(rgb);
  const fx = xyzToLabChannel(x / D65.x);
  const fy = xyzToLabChannel(y / D65.y);
  const fz = xyzToLabChannel(z / D65.z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** CIE76 delta-E: plain Euclidean distance in Lab space. */
export function deltaE76(a: LabColor, b: LabColor): number {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  const toHex = (c: number) => Math.round(c).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * A commonly cited rule of thumb (not a formal standard): below ~2.3,
 * two colours are indistinguishable to the average human eye; below ~10,
 * they read as "the same colour family" even if distinguishable side by
 * side. 10 is the threshold used here for "matches an existing kit
 * token" — generous enough to catch a design's blue matching the kit's
 * @primary blue despite lighting/compression differences in the source
 * image, tight enough not to conflate genuinely different colours.
 */
export const KIT_TOKEN_MATCH_THRESHOLD = 10;
