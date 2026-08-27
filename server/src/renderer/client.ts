import { loadRendererUrl } from './config.js';

/**
 * A non-2xx response from the renderer's `POST /render` (solution.md §9.5).
 * Distinct from a network-level failure so `render_preview`'s handler can
 * report "the renderer rejected this" (bad target, blocked egress, timeout)
 * separately from "couldn't reach the renderer at all".
 */
export class RendererApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

export interface RenderRequest {
  url: string;
  selector?: string;
  allowedHost?: string;
  extraHeaders?: Record<string, string>;
}

/**
 * Calls the isolated renderer service (render_net only, no credential
 * store — solution.md §9.5) to capture a screenshot. The renderer's own
 * egress filter decides whether `url`/`allowedHost` are safe to reach;
 * this client just relays the request and returns the PNG bytes.
 */
export async function renderScreenshot(
  request: RenderRequest,
  rendererUrl: string = loadRendererUrl(),
): Promise<Buffer> {
  const url = new URL('/render', rendererUrl);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: request.url,
      ...(request.selector !== undefined && { selector: request.selector }),
      ...(request.allowedHost !== undefined && { allowedHost: request.allowedHost }),
      ...(request.extraHeaders !== undefined && { extraHeaders: request.extraHeaders }),
    }),
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new RendererApiError(`POST /render returned ${response.status}`, response.status, body);
  }

  return Buffer.from(await response.arrayBuffer());
}
