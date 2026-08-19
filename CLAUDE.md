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
