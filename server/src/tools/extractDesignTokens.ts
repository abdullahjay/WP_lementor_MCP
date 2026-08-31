import type { ToolImplementation } from '../protocol/types.js';
import { deltaE76, KIT_TOKEN_MATCH_THRESHOLD, rgbToHex, rgbToLab, type LabColor, type RgbColor } from '../ingestion/colorDistance.js';
import { extractDominantColors } from '../ingestion/extractColors.js';
import { sniffImageMimeType } from '../ingestion/sniffMime.js';
import { downloadObject, ObjectNotFoundError } from '../storage/objectStorage.js';
import { getGlobalStyles, WordPressApiError } from '../wp/client.js';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    colors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          hex: { type: 'string' },
          matched_token: {
            type: ['object', 'null'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              delta_e: { type: 'number' },
            },
            required: ['id', 'title', 'delta_e'],
          },
        },
        required: ['hex', 'matched_token'],
        additionalProperties: false,
      },
    },
  },
  required: ['colors'],
  additionalProperties: false,
} as const;

/**
 * EMCP-065 — prd.md Task 65: "Perceptual colour distance, not string
 * comparison; reconciles against existing kit tokens." Reads a reference
 * design back from object storage (`upload_reference_design`, EMCP-064),
 * extracts its dominant colours by downsample-and-histogram (
 * `server/src/ingestion/extractColors.ts`), and reconciles each against
 * the connected site's real kit colours (`get_global_styles`, EMCP-029)
 * using CIE76 delta-E in Lab space — not RGB/hex comparison, which does not
 * track human colour perception.
 *
 * Deliberately colour-only, not typography — extracting font identity from
 * a raster image (OCR plus font recognition) is a different, much larger
 * problem prd.md's own wording for this task never asks for ("perceptual
 * colour distance... reconciles against existing kit tokens" says nothing
 * about fonts); typography extraction is not attempted here.
 *
 * Re-sniffs the downloaded bytes before decoding them as an image
 * (`sniffImageMimeType`) — `upload_reference_design`'s out-of-band path is
 * documented as completely unvalidated (Blueprints.md §7.12), so every
 * object read back from `reference-designs/` is treated as untrusted
 * input regardless of which ingestion path produced it.
 */
export const extractDesignTokensTool: ToolImplementation = {
  name: 'extract_design_tokens',
  description:
    "Extracts a reference design's dominant colours and reconciles them " +
    "against the connected site's real kit colours (get_global_styles), " +
    'using perceptual colour distance rather than hex/string comparison — ' +
    'so a design colour that is basically the same as an existing @primary ' +
    'or custom kit colour is reported as matching it, not as new. Colours ' +
    'only; does not extract typography. Requires a reference_id from ' +
    'upload_reference_design.',
  inputSchema: {
    type: 'object',
    properties: {
      reference_id: { type: 'string', description: 'The reference_id from upload_reference_design.' },
    },
    required: ['reference_id'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },

  async handler(args) {
    const referenceId = args?.['reference_id'];

    if (typeof referenceId !== 'string' || referenceId.trim() === '') {
      return errorResult('extract_design_tokens requires a non-empty string "reference_id".');
    }

    try {
      const bytes = await downloadObject(referenceId);
      const mimeType = sniffImageMimeType(bytes);

      if (!mimeType) {
        return errorResult(
          `The object at "${referenceId}" is not a recognized image format (PNG, JPEG, GIF, or WEBP) — content-derived, not based on any stored metadata.`,
        );
      }

      const [dominantColors, kit] = await Promise.all([extractDominantColors(bytes, 5), getGlobalStyles()]);
      const kitColors = parseKitColors(kit);

      const colors = dominantColors.map((rgb) => ({
        hex: rgbToHex(rgb),
        matched_token: nearestKitToken(rgb, kitColors),
      }));

      const result = { colors };

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      };
    } catch (error) {
      return { content: [{ type: 'text', text: describeError(error, referenceId) }], isError: true };
    }
  },
};

interface KitColor {
  id: string;
  title: string;
  lab: LabColor;
}

function parseKitColors(kit: Record<string, unknown>): KitColor[] {
  const colors = kit['colors'];
  if (!isRecord(colors)) return [];

  const entries = [...toArray(colors['system']), ...toArray(colors['custom'])];

  return entries
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const id = entry['_id'];
      const title = entry['title'];
      const hex = entry['color'];
      if (typeof id !== 'string' || typeof title !== 'string' || typeof hex !== 'string') return null;

      const rgb = hexToRgb(hex);
      if (!rgb) return null;

      return { id, title, lab: rgbToLab(rgb) };
    })
    .filter((c): c is KitColor => c !== null);
}

function nearestKitToken(rgb: RgbColor, kitColors: KitColor[]): { id: string; title: string; delta_e: number } | null {
  if (kitColors.length === 0) return null;

  const lab = rgbToLab(rgb);
  let best: { id: string; title: string; delta_e: number } | null = null;

  for (const token of kitColors) {
    const deltaE = deltaE76(lab, token.lab);
    if (best === null || deltaE < best.delta_e) {
      best = { id: token.id, title: token.title, delta_e: deltaE };
    }
  }

  return best !== null && best.delta_e <= KIT_TOKEN_MATCH_THRESHOLD ? best : null;
}

function hexToRgb(hex: string): RgbColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  const value = match[1] as string;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorResult(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function describeError(error: unknown, referenceId: string): string {
  if (error instanceof ObjectNotFoundError) {
    return `No reference design exists with reference_id "${referenceId}".`;
  }

  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `extract_design_tokens failed: ${error instanceof Error ? error.message : String(error)}`;
}
