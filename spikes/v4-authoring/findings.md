# EMCP-030 — V4 authoring spike

**Timeboxed investigation, not production code.** ~50 minutes of focused work against the live `wp-v4-pro` sandbox. Stopped at the timebox with one clear open unknown rather than chasing it to full resolution — see below.

**Question:** is Blueprints.md §3.2's v4 emission column (DSL → `elType: e-flexbox`/`e-heading`/`e-button` etc., typed nested props, local `styles` array) a real, buildable design, or does it only look plausible on paper?

**Answer: real design, one real gap found.** A hand-authored V4 page, built entirely outside Elementor's editor UI using nothing but the documented native shapes and Elementor's own `Document::save()` API, round-trips correctly through every read tool this project has built and renders correctly on the live front end — except one widget-level local style never compiled to CSS. That's a genuine, reproducible unknown, not a guess.

## What was built

`spikes/v4-authoring/author-spike-page.php` — a throwaway script (not wired into the plugin, run via `wp eval-file`) that:

1. Hand-authors a native V4 element tree matching Blueprints.md §3.2 exactly: one `e-flexbox` container (local style: `flex-direction: column`, `gap: 16px`) containing one `e-heading` ("V4 Authoring Spike", uncustomized — deliberately, to also exercise the `[]`-not-`{}` empty-settings shape) and one `e-button` ("Spike Button", local style with `padding` at desktop, plus a **second variant at `tablet`** — the one responsive override the AC asks for).
2. Calls `\Elementor\Plugin::$instance->documents->get( $post_id )->save( [ 'elements' => $elements ] )` — the real Document API (Blueprints.md §6.3), never a raw `_elementor_data` meta write.
3. Explicitly sets `_elementor_edit_mode = 'builder'` and `_elementor_template_type = 'wp-page'` afterward — see Unknown #1 below.

Run against `wp-v4-pro` post ID **38** ("EMCP V4 Authoring Spike", published, still live on the sandbox as evidence — not cleaned up, same as EMCP-008's fixture pages).

```
docker compose run --rm -v "$(pwd)/spikes:/spikes" wpcli-v4-pro \
  wp eval-file /spikes/v4-authoring/author-spike-page.php 38
```

(Windows/Git Bash needs `MSYS_NO_PATHCONV=1` prefixed, same as every other volume-mount gotcha this session hit.)

## What was verified, and how

- **The write landed exactly as authored.** `wp post meta get 38 _elementor_data` — byte-for-byte the same structure that was sent to `save()`, IDs preserved, no silent mutation.
- **Zero PHP warnings/notices.** `debug.log` before and after: identical (3 pre-existing, unrelated WP-Cron network warnings, timestamped before this spike ran).
- **The whole existing read pipeline works against it, unmodified.** `get_page_structure` (the real MCP tool, called over `/mcp` exactly as a client would) correctly detected the `e-flexbox` as `v4`/`layout`/`container`, both widgets as `v4`/`content`, and resolved real labels from the authored text ("V4 Authoring Spike", "Spike Button") — no code changed to make this work; EMCP-019 through EMCP-029's tools handled a page they'd never seen, built by a script, not the editor.
- **The page genuinely renders on the live front end.** `curl` against the real published URL (`http://localhost:8081/emcp-v4-authoring-spike/`) returns `200`, the authored text appears, and the container's authored class (`e-a1b2c3d-spike01`) appears in the rendered HTML alongside Elementor's own generated classes (`e-con`, `e-atomic-element`, `e-flexbox-base`).
- **The container's local style compiled to real CSS**, automatically, no manual cache invalidation needed: `wp-content/uploads/elementor/css/local-38-frontend-desktop.css` contains exactly `.elementor .e-a1b2c3d-spike01{flex-direction:column;gap:16px;}` — the authored values, correctly compiled by Elementor's real CSS pipeline.

## The one real gap found

**The button widget's local style (padding, desktop + tablet variants) never compiled to CSS at all.** `local-38-frontend-desktop.css` is 62 bytes — exactly the flexbox rule, nothing for `e-a1b2c3f-spike02`. No PHP error, no warning — it fails silently. No separate tablet CSS file for post 38 exists either (Elementor did generate other posts' tablet/preview CSS files during this session, so the mechanism itself works in general — it specifically didn't fire for this widget-level style).

Not root-caused within the timebox. Two live possibilities, unconfirmed:
1. Container-level and widget-level local styles may go through genuinely different registration/compilation code paths in Elementor's CSS builder, and the widget-level one needs something this script didn't provide (a hook, a different storage shape, an explicit trigger).
2. CSS regeneration may be more lazily triggered for widget-level styles specifically than container-level ones (Blueprints.md §6's "CSS regeneration is lazy and deferred" gotcha, but asymmetric between element kinds — not previously documented that way).

## Sizing estimate for a real v4-emission compiler path

Given what this spike confirmed works (and doesn't):

- **Core DSL→v4 emission** (§3.2's table: `container`→`e-flexbox`, `grid`→`e-grid`, `heading`/`text`/`image`/`button`→their `e-` widgets, typed-prop wrapping, ID generation) — **small, well-understood.** The shapes are exactly what the captured fixtures (EMCP-008) already show; this spike proves `Document::save()` accepts them without complaint. Rough estimate: **2-3 days** for a first working compiler pass covering the DSL's full v4 column, reusing the same typed-prop-building logic across all content types.
- **Local styles + responsive variants** (§2.5/§2.6, the `styles` array, breakpoint-suffixed variants) — **medium, one real unknown blocking full confidence.** The container case works cleanly; the widget case doesn't compile CSS at all yet, for reasons not yet diagnosed. Until Unknown-gap above is resolved, this piece can't be sized precisely — could be a one-line fix (a missing hook call) or a structural difference requiring separate code paths for container vs. widget style emission. **1-4 days**, wide range reflecting that uncertainty specifically.
- **`__globals__`/`__dynamic__` preservation, kit token resolution (`@primary` etc.)** — not spiked here at all; EMCP-029 confirmed the kit data exists and is readable, but nothing in this spike wrote a `__globals__` reference. Genuinely unestimated.
- **Nested-widget children emission** (Nested Tabs/Accordion) — irrelevant to sizing since `nested-widget` is EMCP-008's permanent, documented blocker on this Elementor build; can't spike what doesn't render in the editor.

**Overall: the v4 column of Blueprints.md §3.2 is a real, buildable plan, not just documentation-shaped hope** — but a real compiler implementation should budget explicit time to diagnose the widget-local-style CSS gap before assuming "local styles" is a solved sub-problem end to end.

## List of unknowns

1. **Does `Document::save()` set `_elementor_edit_mode`/`_elementor_template_type` itself, ever, under any code path?** This spike set both explicitly and never confirmed whether that was strictly necessary or just cautious — didn't test the negative case (omitting the explicit `update_post_meta` calls) within the timebox.
2. **Why didn't the widget-level local style compile to CSS?** The main open item — see above. Needs either deeper Elementor source reading (the CSS-file-generation trigger points, likely in `modules/atomic-widgets` or the widget's own `render`/`get_style_...` methods) or a second spike iteration specifically isolating container-vs-widget style compilation.
3. **Does authoring via `Document::save()` correctly handle an *update* to an existing V4 page (not just a fresh empty one)?** This spike only tested writing into a brand-new page. Blueprints.md §6.3's published-vs-unpublished autosave-revision split was not exercised at all.
4. **What does a validation/error path look like from `Document::save()`?** Not tested — this spike only exercised the happy path with well-formed input. A real compiler needs to know what `save()` returns/throws on malformed elements, to build the diagnostics contract Blueprints.md §3.4 describes.
5. **Kit token resolution and `__globals__` preservation** — entirely unspiked, flagged above, real unknown for sizing.

## Not cleaned up, by design

- `wp-v4-pro` post 38 remains published on the sandbox — the physical evidence of this spike, same treatment as EMCP-008's fixture pages.
- `spikes/v4-authoring/author-spike-page.php` is committed as-is: a spike script, explicitly not production code, not imported by anything in `server/` or `plugin/`.
