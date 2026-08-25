# Elementor MCP — Working Notes

An MCP server that lets an AI model build and edit Elementor pages, including reproducing a supplied design. Elementor-only scope: pages, media, later menus. WordPress administration is out of scope.

## Documents

| File | Role |
|---|---|
| `solution.md` | Why — architecture, principles, security, phasing |
| `Blueprints.md` | What exactly — DSL grammar, compiler contract, REST surface, errors, fixtures |
| `ralphloop.md` | How the autonomous loop operates |
| `prd.md` | Task backlog |
| `progress.md` | Loop state — the only memory between iterations |

## Standing rules

- **Never commit or push.** The user commits, nobody else. Leave work as uncommitted changes and say what's pending.
- **Never run `git checkout` / `restore` / `reset` / `clean` / `stash`** — uncommitted work is the only copy of everything since the last human commit.
- Prefer `widget` → `raw` → `html`, in that order. Never reach for `html` when a registry widget exists.
- Introspect Elementor; never hardcode widget names, control names or breakpoints.
- Changing the plugin REST contract means changing `Blueprints.md` §6 in the same edit.

## Stack

TypeScript + Fastify + `@modelcontextprotocol/sdk` · Zod · PostgreSQL + Drizzle · Playwright renderer (isolated) · PHP 8.1+ plugin · Vitest + PHPUnit · Docker Compose for dev.

Verified against **Elementor 4.3.0** and **MCP revision 2026-07-28** (20 Aug 2026). Both move fast — re-check before relying on version-specific behaviour.

## Elementor gotchas

Costly to discover, cheap to read. Add to this list whenever an iteration pays for a new one.

- **V4 atomic content widgets are still `elType: widget`.** An `e-heading` is `{elType: "widget", widgetType: "e-heading"}`. Detect generation on the `e-` prefix of `widgetType` plus the presence of `styles`/`version` — never on `elType` alone, or a "safe" text edit destroys the node.
- **Detection is per-node, not per-document.** Pages genuinely mix legacy, V3 and V4 shapes.
- **V4 typed props nest.** A heading title is `{"$$type":"html-v3","value":{"content":{"$$type":"string","value":"…"},"children":[]}}`, not a flat scalar. Assuming flat drops content silently.
- **V4 styling is a per-element local `styles` array.** Global classes are an opt-in reuse layer in a separate post type (`e_global_class`), not in the kit, and have separate frontend and preview meta keys.
- **Saving a published page as a draft creates an autosave revision**, not a draft. `_elementor_data` on the parent is untouched. Preview must read the autosave; publish promotes it onto the parent.
- **Elementor's control stack is lazy.** `describe_widget` must force stack initialisation or returns empty controls. Never call `get_controls()` across the whole registry.
- **Widget registration is context-sensitive.** Many Pro and third-party widgets register only during editor/frontend bootstrap, so a plain REST request sees a smaller registry than the editor does. Bootstrap Elementor's context explicitly.
- **Widgets are not always leaves.** Nested Tabs / Accordion / Carousel are `elType: widget` carrying `elements` children.
- **`_elementor_edit_mode = 'builder'` is required** or the page renders as empty theme content — a blank page that looks exactly like a corrupt write.
- **`update_post_meta()` unslashes.** Direct `_elementor_data` writes need `wp_slash( wp_json_encode( … ) )`. Only snapshot restore should ever write directly.
- **The widescreen breakpoint is `min-width`;** every other breakpoint is `max-width`. Responsive mapping inverts there.
- **Element Caching stores rendered HTML in the database** and is default-on since 3.32. A stale cache means `render_preview` screenshots a page you did not build.
- **CSS regeneration is lazy and deferred.** "Saved successfully" does not mean the front end reflects it; invalidate and warm explicitly.
- **Element IDs are 7-char hex, unique across the whole tree** including nested widget children. `apply_template` and duplicate must regenerate them, or shared CSS selectors cause style bleed.
- **`__globals__` and `__dynamic__` are siblings inside `settings`** and a naive merge destroys them. This is the bug most likely to reach production unnoticed.
- **Elementor Pro form widgets store integration secrets in widget settings** — webhook URLs, API keys. Never let raw settings into logs or ledger arguments.
- **"Pro" is not a boolean.** Essential and Advanced tiers differ; Popup Builder is Advanced-only. Derive capability from the registered widget list instead.
- **Elementor's real experiment option key is `elementor_experiment-<name>`**, value `active` / `inactive` / `default` (`Experiments_Manager::OPTION_PREFIX`, `STATE_*` constants). Verified live on 4.2.3: `e_atomic_elements` and `e_opt_in_v4`/`e_opt_in_v4_page` are `default` (→ active) on a fresh install — confirms V4 is genuinely the out-of-box default, not just a documentation claim. `container` covers V3 containers; forcing a site to V3-only means setting the atomic/opt-in-v4 trio `inactive`, not touching `container`.
- **Fresh WordPress installs default to "Plain" permalinks**, under which `/wp-json/...` 301-redirects to the homepage instead of resolving. Either set a pretty `permalink_structure` during provisioning or use the `/?rest_route=/…` fallback when testing before that's done.
- **A fresh install's "Add New Section" only offers Flexbox/Grid — there is no UI path to a legacy `section`/`column` while the `container` experiment is active**, which is every fresh install's default. Deactivate `elementor_experiment-container` to unlock the old layout picker, build what's needed, then reactivate it — don't leave a sandbox stuck in legacy mode for later work.
- **A widget being registered server-side does not mean it's reachable in the live editor.** Confirmed on 4.2.3: `nested-tabs`/`nested-accordion` are in `widgets_manager->get_widget_types()`, report `show_in_panel(): true`, and their `nested-elements` experiment is active — yet neither appears in the editor's widget panel, via search or manual scroll. Don't infer editor availability from `describe_widget`-style PHP introspection alone; it can be wrong in the optimistic direction.
- **V4 atomic elements' empty `settings`/`styles`/`interactions`/`editor_settings` serialize as `[]` (an array), not `{}`.** Confirmed on a freshly-inserted, uncustomized `e-heading`/`e-button`. A compiler or digest reader that assumes these are always objects will throw or misbehave on any element nobody has touched yet — which is the common case for a widget just dragged in. Now documented in `Blueprints.md` §3.2 and `solution.md` §5.3.
- **V4 atomic widgets don't populate `get_controls()` at all — confirmed live (EMCP-028), not assumed.** `Widget_Base::get_controls()` on `e-heading` returns an empty array even when forced (stack init has nothing to yield), at both `common` and `full` detail. Elementor's source confirms why: atomic widgets (`modules/atomic-widgets/elements/atomic-heading/atomic-heading.php` etc.) define `protected static function define_props_schema(): array` instead — a completely separate schema mechanism from the legacy `Controls_Stack` every other widget (including `e-heading`'s own legacy-shaped sibling controls elsewhere) uses. `describe_widget` (and `/registry/snapshot`, EMCP-017, which has the same blind spot) currently only introspects the legacy path — a V4 atomic widget's *settings shape* is separately documented (Blueprints.md §3.2's typed-props nesting), but its *schema* (what fields exist, their types, defaults, conditions) is not introspectable through anything built so far. A future task needs a `define_props_schema()`-based reader before `describe_widget` can honestly answer "what settings does `e-heading` have" — until then, an empty `controls: []` for any `e-`-prefixed widget means "not introspectable yet," not "this widget has no settings."

## Docker / local-env gotchas

- **Application Passwords require HTTPS, or `WP_ENVIRONMENT_TYPE` set to `local`/`development`** (`wp_is_application_passwords_available()`). Without it every Basic-auth call silently resolves to an anonymous user — no error, just `403`/`401` from *our own* capability check, which looks identical to a real permission bug and wastes time in the wrong place.
- **`WORDPRESS_CONFIG_EXTRA` (and `WORDPRESS_DEBUG`) only get baked into `wp-config.php` the first time the official image generates that file.** Recreating the container after adding/changing these env vars does nothing if `wp-config.php` already exists in the volume — silent no-op, not an error. Fix an already-provisioned site with `wp config set <NAME> <value> --type=constant` (add `--raw` for booleans) rather than expecting a container recreate to pick it up.
- **A Dockerfile build with `context: .` at the repo root sends everything under it, including every `node_modules`, unless `.dockerignore` says otherwise.** Hit a hard build failure (`invalid file request server/node_modules/.bin/acorn`) from a 125MB+ context transfer choking on a `node_modules/.bin` symlink — not a flaky error, a real one, and it recurs on any repo-root-context build until `.dockerignore` excludes `node_modules`/`dist`/`vendor`/`.git`. The image doesn't need any of that anyway; each Dockerfile runs its own `npm ci`/`composer install` against the copied manifest.
- **The `db-wp` MariaDB volume can end up stale/uninitialized** (init script never ran, or ran before a fix landed) — both WordPress sites then 500 on every request with no obvious cause beyond `healthcheck.sh` reporting `unhealthy`. Diagnose with `SHOW DATABASES` against `db-wp` directly. This sandbox's permission classifier blocks `docker volume rm` even with explicit user confirmation — don't fight it; instead re-run `scripts/db-wp-init.sh`'s SQL directly against the live container (non-destructive, same end state) and follow with `scripts/provision.sh`.
