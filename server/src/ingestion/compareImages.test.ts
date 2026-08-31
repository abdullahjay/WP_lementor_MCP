import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { compareImages } from './compareImages.js';

async function solidColorPng(width: number, height: number, r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

async function halfAndHalfPng(width: number, height: number): Promise<Buffer> {
  const top = await sharp({ create: { width, height: Math.floor(height / 2), channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .png()
    .toBuffer();
  const bottom = await sharp({
    create: { width, height: height - Math.floor(height / 2), channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .png()
    .toBuffer();

  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: top, top: 0, left: 0 },
      { input: bottom, top: Math.floor(height / 2), left: 0 },
    ])
    .png()
    .toBuffer();
}

describe('compareImages', () => {
  it('scores an identical screenshot and reference near 1.0 with no meaningful mismatches', async () => {
    const bytes = await solidColorPng(120, 120, 110, 193, 228);

    const result = await compareImages(bytes, bytes);

    expect(result.score).toBeGreaterThan(0.99);
    expect(result.regions.every((r) => r.deltaE < 1)).toBe(true);
  });

  it('scores two completely different solid colours low', async () => {
    const screenshot = await solidColorPng(120, 120, 255, 0, 0);
    const reference = await solidColorPng(120, 120, 0, 0, 255);

    const result = await compareImages(screenshot, reference);

    expect(result.score).toBeLessThan(0.5);
  });

  it('identifies which half of the image mismatches when only one half differs', async () => {
    const screenshot = await solidColorPng(120, 120, 255, 0, 0); // uniformly red
    const reference = await halfAndHalfPng(120, 120); // red on top, blue on bottom

    const result = await compareImages(screenshot, reference);

    // The worst-ranked region should come from the bottom half (blue vs red).
    const worst = result.regions[0]!;
    expect(worst.y).toBeGreaterThanOrEqual(60);
  });

  it('ranks regions worst-first', async () => {
    const screenshot = await solidColorPng(120, 120, 255, 0, 0);
    const reference = await halfAndHalfPng(120, 120);

    const result = await compareImages(screenshot, reference);

    for (let i = 1; i < result.regions.length; i++) {
      expect(result.regions[i - 1]!.deltaE).toBeGreaterThanOrEqual(result.regions[i]!.deltaE);
    }
  });

  it('caps the reported regions rather than returning every grid cell', async () => {
    const screenshot = await solidColorPng(120, 120, 255, 0, 0);
    const reference = await halfAndHalfPng(120, 120);

    const result = await compareImages(screenshot, reference);

    expect(result.regions.length).toBeLessThanOrEqual(5);
  });

  it('resizes a differently-sized screenshot to the reference design\'s own dimensions rather than refusing', async () => {
    const screenshot = await solidColorPng(400, 300, 110, 193, 228); // a much larger "render"
    const reference = await solidColorPng(120, 120, 110, 193, 228); // the reference design's real size

    const result = await compareImages(screenshot, reference);

    expect(result.score).toBeGreaterThan(0.99);
  });

  it('keeps the score within [0, 1]', async () => {
    const screenshot = await solidColorPng(120, 120, 0, 0, 0);
    const reference = await solidColorPng(120, 120, 255, 255, 255);

    const result = await compareImages(screenshot, reference);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
