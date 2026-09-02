import { chromium, type Browser, type Page } from 'playwright-core';
import { assertAllowedTarget, EgressBlockedError } from './egress.js';

let browserPromise: Promise<Browser> | null = null;

/**
 * One shared browser process, launched lazily on first use — matches the
 * base image's own bundled Chromium (`mcr.microsoft.com/playwright`, its
 * env vars point `playwright-core` at the pre-installed browser without
 * needing the full `playwright` package's own download step).
 */
function getBrowser(): Promise<Browser> {
  // `--no-sandbox` is Playwright's own documented recommendation for
  // running Chromium inside Docker (the container doesn't grant the
  // namespace/seccomp capabilities Chromium's sandbox process expects) —
  // without it, hit live here as ERR_CONNECTION_REFUSED on every
  // navigation despite the exact same host being reachable via a plain
  // TCP socket from the same container.
  browserPromise ??= chromium.launch({ headless: true, args: ['--no-sandbox'] });
  return browserPromise;
}

export interface RenderOptions {
  /** CSS selector to capture instead of the full page. */
  selector?: string;
  /** The one hostname exempted from the egress filter's private-address block for this render (EMCP-034 — "any IP not matching the registered site"). */
  allowedHost?: string;
  /** Extra headers sent with every request this render makes — e.g. a preview token (Blueprints.md §6.5: "sent as a header where possible"). */
  extraHeaders?: Record<string, string>;
  /**
   * Both required together (a viewport needs both dimensions) —
   * `compare_to_reference` (EMCP-066) is this option's first caller,
   * resolving a real breakpoint width from `GET /site`'s own breakpoints
   * map (never hardcoded — CLAUDE.md's "introspect Elementor" discipline)
   * rather than assuming a fixed device size. Omitted, Playwright's own
   * default viewport applies, matching every render before this option
   * existed.
   */
  viewportWidth?: number;
  viewportHeight?: number;
  /**
   * Rewrites every request whose origin matches `from` to `to` before the
   * egress check runs. Closes a real gap found live (EMCP-034 rewrote only
   * the top-level navigation URL to the renderer-reachable internal host —
   * CLAUDE.md's WP_HOME/siteurl gotcha — but WordPress still emits every
   * CSS/JS/font asset URL using its own configured `siteurl`
   * (`http://localhost:8081` in this sandbox), which is unreachable from
   * inside the renderer's Docker network. Confirmed live: every single
   * asset request failed `net::ERR_CONNECTION_REFUSED`, so a rendered page
   * loaded zero of its own stylesheets — every "screenshot" taken before
   * this fix was of unstyled HTML, not the real page). The caller supplies
   * both origins (`from` = the post's own public link's origin, `to` =
   * `WP_BASE_URL`'s origin) — never guessed or hardcoded here.
   */
  assetOriginRewrite?: { from: string; to: string };
}

const SETTLE_TIMEOUT_MS = 5_000;

/**
 * Fresh browser **context** per render (solution.md §9.5) — no cookies,
 * storage or session state carried between renders, even for the same
 * target site, while the underlying browser process itself is reused for
 * cost.
 *
 * EMCP-032's egress filter is wired via `context.route('**\/*', ...)` —
 * Playwright intercepts **every** request the context makes this way,
 * including each hop of a redirect chain (a redirect target is its own
 * freshly-intercepted request, not something that bypasses this handler)
 * and every subresource (images, fonts, scripts), not just the top-level
 * navigation — matching solution.md §9.5's "the same egress policy applies
 * to every outbound fetch." Each request is checked at connect time
 * (`assertAllowedTarget` re-resolves DNS itself, never trusts the URL's
 * literal text) before `route.continue()` is even called.
 */
export async function renderScreenshot(url: string, options: RenderOptions = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext(
    options.viewportWidth !== undefined && options.viewportHeight !== undefined
      ? { viewport: { width: options.viewportWidth, height: options.viewportHeight } }
      : {},
  );

  await context.route('**/*', async (route) => {
    try {
      const requestUrl = route.request().url();
      const rewrite = options.assetOriginRewrite;
      const rewrittenUrl =
        rewrite && requestUrl.startsWith(rewrite.from) ? rewrite.to + requestUrl.slice(rewrite.from.length) : undefined;

      await assertAllowedTarget(rewrittenUrl ?? requestUrl, {
        ...(options.allowedHost !== undefined && { allowedHost: options.allowedHost }),
      });
      await route.continue(rewrittenUrl !== undefined ? { url: rewrittenUrl } : {});
    } catch (error) {
      if (error instanceof EgressBlockedError) {
        await route.abort('blockedbyclient');
        return;
      }
      throw error;
    }
  });

  if (options.extraHeaders) {
    await context.setExtraHTTPHeaders(options.extraHeaders);
  }

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await settle(page);

    if (options.selector) {
      const locator = page.locator(options.selector);
      await locator.waitFor({ state: 'visible', timeout: SETTLE_TIMEOUT_MS });
      return await locator.screenshot({ type: 'png' });
    }

    return await page.screenshot({ type: 'png' });
  } finally {
    await context.close();
  }
}

/**
 * EMCP-034's AC: "font and lazy-image settling." A bare `waitUntil: 'load'`
 * (all this did before) fires once the load event fires — before web
 * fonts have necessarily finished painting and before lazy-loaded images
 * below the fold have triggered their IntersectionObserver swap. Neither
 * failure mode throws or shows up in `page.goto()`'s result; a screenshot
 * taken immediately after `load` can silently capture fallback-font text
 * or blank/placeholder image boxes.
 */
/**
 * `page.evaluate()`'s callback runs inside the browser, not this Node
 * process — `document`/`window` are real there. Typed against the DOM lib
 * (`tsconfig.json`'s `lib` includes `"DOM"` for exactly this reason,
 * scoped to this file's evaluate callbacks; nothing else here touches the
 * DOM at all).
 */
async function settle(page: Page): Promise<void> {
  await Promise.race([
    page.evaluate(() => document.fonts.ready),
    new Promise((resolve) => setTimeout(resolve, SETTLE_TIMEOUT_MS)),
  ]);

  // Scroll the full document height to trigger lazy-loading intersection
  // observers, then back to the top before capture — a screenshot mid-scroll
  // would just show the empty state one step later, not the settled one.
  await page.evaluate(async () => {
    const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const step = window.innerHeight || 800;

    for (let y = 0; y < height; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    window.scrollTo(0, 0);
  });

  await new Promise((resolve) => setTimeout(resolve, 300));
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) {
    return;
  }

  const browser = await browserPromise;
  await browser.close();
  browserPromise = null;
}
