import sharp from 'sharp';
import { deltaE76, rgbToLab, type RgbColor } from './colorDistance.js';

/**
 * solution.md §7.4/Blueprints.md §7.4: "`compare_to_reference` returns
 * numbers, not pictures — per-region deltas and ranked bounding boxes of
 * worst mismatches." A grid-based regional diff: both images are resized
 * to a shared canvas, divided into the same NxM grid, and each region's
 * average colour is compared via CIE76 delta-E (`colorDistance.ts`, the
 * same perceptual metric `extract_design_tokens`, EMCP-065, already
 * established) — not a raw pixel-difference count, which would conflate
 * "shifted by one pixel" with "genuinely different content."
 */

export interface RegionMismatch {
  x: number;
  y: number;
  width: number;
  height: number;
  deltaE: number;
}

export interface CompareResult {
  /**
   * 1.0 = perceptually identical average colours across every region,
   * 0.0 = maximally different. Derived from the mean per-region delta-E,
   * normalized against 100 — Lab delta-E has no fixed upper bound in
   * theory, but real sRGB-gamut colour pairs rarely exceed ~100, so this
   * keeps the reported score in the same intuitive 0–1 range every other
   * scored output in this project uses (`nativeness`, `raw_ratio`).
   */
  score: number;
  /** The worst-mismatched regions, ranked by delta-E descending — not every region, per solution.md's own "ranked bounding boxes of worst mismatches." */
  regions: RegionMismatch[];
}

const GRID_COLS = 6;
const GRID_ROWS = 6;
const MAX_REPORTED_REGIONS = 5;

/**
 * `screenshotBytes` is resized to `referenceBytes`' own dimensions
 * (`fit: 'fill'`, deliberately allowing aspect-ratio distortion rather
 * than cropping or padding) — the two are compared region-by-region
 * afterward, so what matters is that corresponding grid cells line up,
 * not that either image's original proportions survive. A real reference
 * design and a live page render are essentially never pixel-identical in
 * size; refusing to compare mismatched dimensions would make this tool
 * useless for its actual purpose.
 */
export async function compareImages(screenshotBytes: Buffer, referenceBytes: Buffer): Promise<CompareResult> {
  const referenceImage = sharp(referenceBytes);
  const { width, height } = await referenceImage.metadata();

  if (!width || !height) {
    throw new Error('Could not read the reference design\'s dimensions.');
  }

  const [screenshotRaw, referenceRaw] = await Promise.all([
    sharp(screenshotBytes).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(referenceBytes).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  const cellWidth = width / GRID_COLS;
  const cellHeight = height / GRID_ROWS;

  const regions: RegionMismatch[] = [];

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = Math.round(col * cellWidth);
      const y = Math.round(row * cellHeight);
      const w = Math.round((col + 1) * cellWidth) - x;
      const h = Math.round((row + 1) * cellHeight) - y;

      const screenshotAvg = averageColorInRegion(screenshotRaw.data, screenshotRaw.info.channels, width, x, y, w, h);
      const referenceAvg = averageColorInRegion(referenceRaw.data, referenceRaw.info.channels, width, x, y, w, h);

      const deltaE = deltaE76(rgbToLab(screenshotAvg), rgbToLab(referenceAvg));
      regions.push({ x, y, width: w, height: h, deltaE });
    }
  }

  const meanDeltaE = regions.reduce((sum, r) => sum + r.deltaE, 0) / regions.length;
  const score = Math.max(0, Math.min(1, 1 - meanDeltaE / 100));

  const worst = [...regions].sort((a, b) => b.deltaE - a.deltaE).slice(0, MAX_REPORTED_REGIONS);

  return { score, regions: worst };
}

function averageColorInRegion(
  data: Buffer,
  channels: number,
  imageWidth: number,
  x: number,
  y: number,
  w: number,
  h: number,
): RgbColor {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let n = 0;

  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const offset = (row * imageWidth + col) * channels;
      sumR += data[offset] as number;
      sumG += data[offset + 1] as number;
      sumB += data[offset + 2] as number;
      n += 1;
    }
  }

  return n === 0 ? { r: 0, g: 0, b: 0 } : { r: sumR / n, g: sumG / n, b: sumB / n };
}
