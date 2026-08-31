import sharp from 'sharp';
import type { RgbColor } from './colorDistance.js';

/**
 * Dominant-colour extraction via downsample + histogram binning — a
 * standard, lightweight technique, not a stub: shrinking the image first
 * (cheap, and irrelevant detail/noise washes out) makes per-pixel
 * histogram binning tractable without a full k-means clustering pass.
 * Each channel is quantized into `BUCKET_COUNT` levels; the most frequent
 * buckets become the reported colours, using the true average colour of
 * the pixels that fell into each bucket (not the bucket's own rounded
 * midpoint) so the reported hex is a real observed colour.
 */

const THUMBNAIL_SIZE = 64; // Small enough to be fast, large enough to be representative.
const BUCKET_COUNT = 16; // Levels per channel — 16^3 = 4096 buckets, plenty of resolution.
const BUCKET_WIDTH = 256 / BUCKET_COUNT;

export async function extractDominantColors(bytes: Buffer, count = 5): Promise<RgbColor[]> {
  const { data, info } = await sharp(bytes)
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  const buckets = new Map<string, { sumR: number; sumG: number; sumB: number; n: number }>();

  for (let i = 0; i + 2 < data.length; i += channels) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;

    const key = `${Math.floor(r / BUCKET_WIDTH)},${Math.floor(g / BUCKET_WIDTH)},${Math.floor(b / BUCKET_WIDTH)}`;
    const bucket = buckets.get(key) ?? { sumR: 0, sumG: 0, sumB: 0, n: 0 };
    bucket.sumR += r;
    bucket.sumG += g;
    bucket.sumB += b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }

  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, count);

  return ranked.map((bucket) => ({
    r: bucket.sumR / bucket.n,
    g: bucket.sumG / bucket.n,
    b: bucket.sumB / bucket.n,
  }));
}
