import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { extractDominantColors } from './extractColors.js';
import { rgbToHex } from './colorDistance.js';

async function solidColorPng(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 40, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

async function twoColorPng(): Promise<Buffer> {
  // A 40x30 red block stacked on a 40x10 blue block — red should dominate
  // by pixel count.
  const red = sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 220, g: 20, b: 20 } } }).png();
  const blue = sharp({ create: { width: 40, height: 10, channels: 3, background: { r: 20, g: 20, b: 220 } } }).png();

  return sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: await red.toBuffer(), top: 0, left: 0 },
      { input: await blue.toBuffer(), top: 30, left: 0 },
    ])
    .png()
    .toBuffer();
}

describe('extractDominantColors', () => {
  it('extracts the one true colour of a solid-colour image', async () => {
    const bytes = await solidColorPng(110, 193, 228);
    const colors = await extractDominantColors(bytes, 5);

    expect(colors.length).toBeGreaterThan(0);
    const hex = rgbToHex(colors[0]!);
    expect(hex).toBe('#6EC1E4');
  });

  it('ranks colours by pixel frequency — the larger region comes first', async () => {
    const bytes = await twoColorPng();
    const colors = await extractDominantColors(bytes, 5);

    expect(colors.length).toBeGreaterThanOrEqual(2);
    // Red (220,20,20) covers 75% of pixels, blue (20,20,220) covers 25%.
    expect(colors[0]!.r).toBeGreaterThan(colors[0]!.b);
    expect(colors[1]!.b).toBeGreaterThan(colors[1]!.r);
  });

  it('respects the requested count', async () => {
    const bytes = await twoColorPng();
    const colors = await extractDominantColors(bytes, 1);

    expect(colors).toHaveLength(1);
  });
});
