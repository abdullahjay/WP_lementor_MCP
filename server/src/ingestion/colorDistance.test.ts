import { describe, expect, it } from 'vitest';
import { deltaE76, rgbToHex, rgbToLab } from './colorDistance.js';

describe('rgbToLab', () => {
  it('maps pure white to L=100, a=0, b=0', () => {
    const lab = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(lab.l).toBeCloseTo(100, 0);
    expect(lab.a).toBeCloseTo(0, 0);
    expect(lab.b).toBeCloseTo(0, 0);
  });

  it('maps pure black to L=0', () => {
    const lab = rgbToLab({ r: 0, g: 0, b: 0 });
    expect(lab.l).toBeCloseTo(0, 0);
  });

  it('maps a real red toward positive a* (the red-green axis)', () => {
    const lab = rgbToLab({ r: 255, g: 0, b: 0 });
    expect(lab.a).toBeGreaterThan(50);
  });
});

describe('deltaE76 — perceptual colour distance, not string/RGB comparison', () => {
  it('is zero for an identical colour', () => {
    const lab = rgbToLab({ r: 110, g: 193, b: 228 });
    expect(deltaE76(lab, lab)).toBe(0);
  });

  it('reports a small distance for two visually near-identical blues', () => {
    const a = rgbToLab({ r: 110, g: 193, b: 228 }); // Elementor's real "primary" from the live kit
    const b = rgbToLab({ r: 108, g: 190, b: 225 }); // A slightly compressed/re-encoded version
    expect(deltaE76(a, b)).toBeLessThan(5);
  });

  it('reports a large distance between genuinely different colours', () => {
    const red = rgbToLab({ r: 255, g: 0, b: 0 });
    const blue = rgbToLab({ r: 0, g: 0, b: 255 });
    expect(deltaE76(red, blue)).toBeGreaterThan(50);
  });

  it('is not simply RGB-Euclidean distance — the whole point of using Lab', () => {
    // Two colours can be RGB-close (small Euclidean RGB distance) yet
    // perceptually distinguishable, or vice versa. Confirm delta-E in Lab
    // does not just reproduce the same ordering as raw RGB distance for
    // an intentionally chosen pair.
    const yellowish = rgbToLab({ r: 230, g: 230, b: 0 });
    const greenish = rgbToLab({ r: 0, g: 230, b: 0 });
    const rgbEuclidean = Math.sqrt((230 - 0) ** 2 + (230 - 230) ** 2 + (0 - 0) ** 2);
    const labDelta = deltaE76(yellowish, greenish);
    expect(labDelta).not.toBeCloseTo(rgbEuclidean, 0);
  });
});

describe('rgbToHex', () => {
  it('formats a colour as an uppercase 6-digit hex string', () => {
    expect(rgbToHex({ r: 110, g: 193, b: 228 })).toBe('#6EC1E4');
  });

  it('rounds fractional channel values (from averaged bucket colours)', () => {
    expect(rgbToHex({ r: 110.6, g: 192.4, b: 228.0 })).toBe('#6FC0E4');
  });

  it('pads single-digit hex channels with a leading zero', () => {
    expect(rgbToHex({ r: 0, g: 5, b: 255 })).toBe('#0005FF');
  });
});
