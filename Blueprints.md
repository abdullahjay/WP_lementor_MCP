# Elementor MCP — Blueprints

**Relationship to `solution.md`:** that document says *why*. This one says *what exactly* — the DSL grammar, the compiler contract, the normalized read shape, the plugin REST surface, the error taxonomy, and the fixture set. Where the two disagree, `solution.md` wins on intent and this document wins on shape.

**Consumers:** `prd.md` derives tasks from this. `ralphloop.md` points an agent at both.

**Verified against:** Elementor 4.3.0, MCP revision 2026-07-28, as of 20 Aug 2026.

**Status:** First cut. §11 lists what is deliberately unresolved.

---

## 1. Vocabulary

| Term | Meaning |
|---|---|
| **Spec** | A DSL document describing a page or a fragment |
| **Node** | One element in a spec |
| **Generation** | `legacy` \| `v3` \| `v4` — which Elementor data shape a node is stored in |
| **Native** | The Elementor JSON a spec compiles to |
| **Digest** | The normalized, depth-limited read shape (§5) |
| **Document hash** | Server-computed fingerprint used for compare-and-swap (§6.4) |
| **Working set** | The post IDs a session is permitted to mutate |

---

## 2. The DSL

### 2.1 Spec root

```jsonc
{
  "dslVersion": 1,
  "page": {
    "title": "Pricing",
    "template": "elementor_canvas",   // elementor_canvas | elementor_header_footer | elementor_theme | default
    "status": "draft"                  // draft only; publishing is a separate tool
  },
  "elements": [ /* nodes */ ]
}
```

`dslVersion` is mandatory and integer. The compiler refuses unknown versions rather than guessing — a spec authored against a later grammar must fail loudly, not partially apply.

### 2.2 Node shape

```jsonc
{
  "type": "container",
  "ref": "hero",                 // optional, spec-local stable handle (NOT an Elementor id)
  "label": "Hero",               // optional, becomes the Navigator title
  "layout":   { /* §2.4 */ },
  "style":    { /* §2.5 */ },
  "responsive": { "tablet": {}, "mobile": {}, "widescreen": {} },
  "children": [ /* nodes */ ],
  "raw":      { /* §2.8 */ },
  "reason":   "…"                // REQUIRED when `raw` is present or type is `html`
}
```

`ref` exists so a spec can be re-applied and diffed without knowing Elementor's generated IDs. It is spec-local, never written into Elementor, and is how `apply_page_spec` matches existing nodes on re-application.

### 2.3 Node types

Deliberately small and CSS/HTML-shaped, because every keyword that mirrors CSS is one the model already knows.

**Layout**

| `type` | Purpose |
|---|---|
| `container` | Flex layout. The default structural node |
| `grid` | Grid layout |

**Content**

| `type` | Fields |
|---|---|
| `heading` | `text`, `level` (1–6) |
| `text` | `html` (restricted inline markup) |
| `image` | `src` (media id or URL), `alt`, `link` |
| `button` | `text`, `link`, `icon` |
| `icon` | `name`, `link` |
| `list` | `items[]`, `ordered` |
| `video` | `src`, `poster`, `autoplay` |
| `divider` | — |
| `spacer` | `size` |

**Escape rungs** — these mirror P1's fallback ladder, and the DSL makes the ladder structural rather than advisory:

| `type` | Nativeness | Use when |
|---|---|---|
| `widget` | **Native** | Any registry widget the DSL doesn't model: `{ "type": "widget", "widgetType": "testimonial-carousel", "settings": { … } }` |
| `shortcode` | Native wrapper | A third-party plugin provides the capability |
| `html` | **Non-native** | Nothing above works. Requires `reason` |

**`widget` is the important one.** It reaches the entire installed registry — Free, Pro, third-party — at full nativeness, without the DSL modelling every widget. Most "the DSL can't express this" cases resolve here, not at `html`. `describe_widget` is its paired lookup tool.

### 2.4 Layout properties

```jsonc
"layout": {
  "direction": "row" | "column",
  "wrap": true,
  "justify": "start" | "center" | "end" | "between" | "around",
  "align": "start" | "center" | "end" | "stretch",
  "gap": 24,
  "padding": [80, 20],
  "margin": [0],
  "width": "full" | "boxed" | "1200px" | "50%",
  "minHeight": "100vh",
  "columns": 3            // grid only
}
```

### 2.5 Style properties

```jsonc
"style": {
  "color": "@primary",
  "background": { "color": "@surface", "image": 42, "position": "center", "size": "cover" },
  "border": { "width": 1, "color": "@border", "style": "solid" },
  "radius": 8,
  "shadow": "0 2px 8px rgba(0,0,0,.08)",
  "opacity": 0.9,
  "typography": {
    "size": "h1" | 32,
    "weight": 600,
    "lineHeight": 1.2,
    "letterSpacing": "-0.02em",
    "family": "@font/heading",
    "transform": "uppercase",
    "align": "center"
  }
}
```

### 2.6 Values and units

- Bare numbers are **px**.
- Strings carry their own unit: `"2rem"`, `"50%"`, `"auto"`, `"100vh"`.
- Box shorthands follow CSS: `[all]`, `[vertical, horizontal]`, `[top, right, bottom, left]`.
- Colors: hex, `rgb()`, or a **token reference**.

### 2.7 Token references

`@name` resolves against the site's design system. Built-in kit IDs: `@primary`, `@secondary`, `@text`, `@accent`. Custom kit colors resolve by their generated ID. Fonts use `@font/<id>`.

**Resolution is generation-dependent** and is the compiler's job:

| Generation | Emission |
|---|---|
| legacy / v3 | `__globals__: { "<control>": "globals/colors?id=primary" }` |
| v4 | A variable/global-class reference in the node's typed settings |

**An unresolvable token is an error, never a silent fallback to a literal.** Falling back produces a page that looks right and is disconnected from the design system — exactly the outcome P1 and P5 exist to prevent. The error names the token and lists what the site actually defines.

### 2.8 `raw` — supervised, not raw

`raw` merges into compiled settings under four constraints (P6):

1. **Deep merge**, never replace, so sibling structures survive.
2. **Reserved-key denylist:** `__globals__`, `__dynamic__`, `_element_id`, and anything the compiler owns. Setting a global or dynamic tag is done through dedicated DSL keys, not by hand.
3. **Value-level sanitisation** — see §8.3. Key-exists validation is not value validation.
4. **`reason` is mandatory**, and every use is counted into `raw_ratio` and written to the ledger as a reviewable event.

Emitting `raw` requires knowing native control names, which is what `describe_widget` is for. This is deliberate friction: `raw` is the rung below `widget`, not a shortcut past the grammar.

### 2.9 Responsive

```jsonc
"responsive": {
  "widescreen": { "layout": { "padding": [120, 40] } },
  "tablet":     { "layout": { "direction": "column" } },
  "mobile":     { "style": { "typography": { "size": 28 } } }
}
```

Keys are breakpoint names **as configured on the target site**, read from `get_site_info`. Unknown breakpoint names are an error.

**`widescreen` is `min-width`; every other breakpoint is `max-width`.** The compiler inverts there. Getting this backwards lands overrides on the wrong side of the boundary and is close to invisible in review — it needs a dedicated fixture.

Responsive is part of the grammar from v1, not a later addition. Splitting it means re-authoring every fixture.

---

## 3. Compiler contract

### 3.1 Signature

```
compile(spec, siteProfile) → { elements, diagnostics, nativeness, rawRatio }
```

`siteProfile` comes from `get_site_info` and carries: generation to emit, breakpoints, kit tokens, registered widget list, Pro tier, active experiments.

The compiler is **pure and synchronous** — no network. Everything it needs about the site arrives in `siteProfile`, which is what makes it unit-testable against fixtures (§9).

### 3.2 Emission by generation

| DSL | v3 | v4 |
|---|---|---|
| `container` | `elType: container` | `elType: e-flexbox` |
| `grid` | `elType: container` + grid settings | `elType: e-grid` |
| `heading` | `widget` / `widgetType: heading` | `widget` / `widgetType: e-heading` |
| `text` | `widgetType: text-editor` | `widgetType: e-paragraph` |
| `image` | `widgetType: image` | `widgetType: e-image` |
| `button` | `widgetType: button` | `widgetType: e-button` |
| `widget` | passthrough `widgetType` | passthrough `widgetType` |

**Settings shape differs fundamentally, not cosmetically:**

- **v3:** flat `key → value`, responsive via `_tablet` / `_mobile` key suffixes, styling inline in `settings`.
- **v4:** typed props, **which nest** — a heading title is `{"$$type":"html-v3","value":{"content":{"$$type":"string","value":"…"},"children":[]}}`, not a flat scalar. Styling goes in the node's local `styles` array with responsive and pseudo-state variants. Nodes carry `version`.
- **Empty is `[]`, not `{}`.** An element or widget with no customized `settings`, `styles`, `interactions`, or `editor_settings` yet serializes those fields as an empty array — JSON `[]`, not `{}`. PHP's array-vs-associative-array-to-JSON behavior leaking through. A parser that assumes these fields are always objects (e.g. `Object.keys(node.settings)`) throws or misbehaves on any freshly-inserted, uncustomized element — which is the common case for a widget just dragged in, not an edge case. Confirmed live (EMCP-008, `v4-atomic` fixture) on a freshly-placed `e-heading`/`e-button` before any content or styling was set.

A compiler that assumes flat `{$$type, value}` scalars drops content silently. This is the single most likely v4 bug and gets its own fixture.

### 3.3 Invariants

Every compile must guarantee:

- Element IDs are 7-char hex, unique across the **whole** tree including nested widget children.
- `apply_template` and duplicate operations **regenerate IDs** — shared IDs share CSS selectors and produce style bleed that reads as a rendering bug.
- `__globals__` and `__dynamic__` on existing nodes survive a partial update unless explicitly cleared.
- Required document meta is set: `_elementor_edit_mode = 'builder'`, `_elementor_template_type`, `_elementor_version`, `_elementor_page_settings`.
- Nested-widget children (Nested Tabs / Accordion / Carousel) are emitted and traversed correctly — widgets are **not** always leaves.

### 3.4 Diagnostics

Every compile returns diagnostics regardless of success, each carrying a JSON path into the spec:

```jsonc
{
  "path": "elements[2].children[0].style.color",
  "severity": "error" | "warning" | "info",
  "code": "TOKEN_UNRESOLVED",
  "message": "Token @brand is not defined on this site.",
  "allowed": ["@primary", "@secondary", "@text", "@accent"],
  "suggestion": "@primary"
}
```

`nativeness` and `rawRatio` are reported here — **warnings, never gates** (`solution.md` §14). The itemised list of non-native nodes, each naming the widget that should have been used, is also the compiler-coverage backlog.

---

## 4. Decompiler

`decompile(nativeElements, siteProfile) → spec` is required for three things: `save_as_template` storing specs rather than frozen native JSON, round-trip fixture testing, and letting the model edit a page it did not author.

**It is lossy by design.** Anything without a DSL representation decompiles to `widget` with native settings, or `raw`. Round-trip tests assert **semantic** equivalence — `compile(decompile(x)) ≈ x` after normalization — never byte equality.

---

## 5. Normalized read shape

One shape for all four generations, so the model never learns the difference.

```jsonc
{
  "id": "a1b2c3d",
  "ref": "hero",
  "kind": "layout" | "content",
  "type": "container",
  "generation": "v4",
  "native": { "elType": "e-flexbox", "widgetType": null },
  "label": "Hero",
  "childCount": 3,
  "children": [ /* … */ ]
}
```

At the depth limit a node emits `{ "id": …, "type": …, "truncated": 5 }`.

**Label resolution**, in order: the Navigator title if set; else the first text-bearing setting stripped of markup and truncated to 40 characters; else the type name. Labels are **sanitised** — markup, newlines and zero-width characters removed (`solution.md` §9.1).

**Digest budget** is a measured acceptance criterion, not prose: **≤ 4,000 tokens at depth 3 across the fixture set**, measured with `count_tokens`.

---

## 6. Plugin REST contract

Base: `/wp-json/emcp/v1`. Versioned in the path; the server declares a minimum plugin version and fails loudly on mismatch at connect time. **Implemented (EMCP-010):** `server/src/wp/contract.ts`'s `MINIMUM_PLUGIN_VERSION` (currently `0.1.0`), checked against `GET /site`'s `plugin_version` on every call that reaches the plugin — there's no persistent connection to gate once under MCP 2026-07-28 (§3), so this is the closest equivalent "connect time" this transport has. A mismatch throws `PluginVersionMismatchError`, surfaced by tools as `isError: true` with both versions named in the message.

Every route has a real permission callback. Cookie-authenticated requests are rejected outright (CSRF). JSON content type enforced.

| Method | Route | Purpose |
|---|---|---|
| GET | `/site` | Version, generation default, Pro tier, breakpoints, experiments, CSS print method, plugin version |
| GET | `/registry/snapshot` | Full curated widget + control schema (§9.2) |
| GET | `/widgets` | List — **never** calls `get_controls()` across the registry |
| GET | `/widgets/{type}` | Controls, with `detail` and forced stack init |
| GET | `/documents` | List pages |
| GET | `/documents/{id}` | Native elements, meta, generation, document hash |
| PUT | `/documents/{id}` | Write via Document API — draft/autosave aware (§6.3) |
| GET | `/documents/{id}/lock` | `wp_check_post_lock()` state |
| POST | `/documents/{id}/publish` | Promote autosave onto parent |
| GET | `/kit` | Global styles |
| GET | `/global-classes` | v4 classes and variables |
| GET/POST | `/media` | List / upload |
| GET/POST | `/templates` | List / save |
| POST | `/preview-token` | Signed single-post token (§6.5) |
| POST | `/snapshots` | Capture prior state |
| POST | `/snapshots/{id}/restore` | Rollback |
| POST | `/cache/invalidate` | Element cache + CSS, with warm-up |

**`GET /site` — implemented (EMCP-004).** Response shape, all fields read from Elementor's runtime at call time, never hardcoded:

```jsonc
{
  "elementor_version": "4.2.3",
  "generation_default": "v4" | "v3" | "legacy",   // Experiments_Manager::is_feature_active('e_atomic_elements' | 'container')
  "pro_tier": "free" | "pro-tier-unresolved",       // Essential/Advanced split deferred — no Pro install to introspect yet (§12)
  "breakpoints": {
    "<name>": { "enabled": bool, "direction": "min" | "max", "value": number }
    // one entry per Elementor::$instance->breakpoints->get_breakpoints(), disabled ones included
  },
  "experiments": { "element_caching": bool, "optimized_markup": bool },
  "css_print_method": "external" | "internal",
  "plugin_version": "0.1.0"
}
```

Auth: `Authorization` header required — absence is treated as cookie authentication and rejected with `401 emcp_cookie_auth_rejected` regardless of whether a valid nonce would otherwise pass WordPress's own cookie-auth check (solution.md §9.7's "rejected outright"). A present-but-insufficient-capability user gets `403 emcp_forbidden`. Verified live against both sandboxes with Application Passwords over HTTP + `WP_ENVIRONMENT_TYPE=local` (`CLAUDE.md`).

**`GET /registry/snapshot` — implemented (EMCP-017).** Same auth as `GET /site` (`Capabilities::can_read`, shared between both routes). Response shape:

```jsonc
{
  "elementor_version": "4.2.3",
  "plugin_version": "0.1.0",
  "widget_count": 149,
  "widgets": [
    {
      "name": "e-heading",
      "title": "Heading",
      "categories": ["v4-elements"],
      "keywords": ["heading", "title", "text"],
      "controls": {
        "<control_name>": { "type": "…", "label": "…", "default": …, "options": {…}, "condition": {…}, "conditions": {…} }
        // layout-only control types (section/tab/divider/heading/popover_toggle)
        // are omitted — they carry no settable value
      }
    }
    // sorted by name — deterministic, not registration order
  ]
}
```

Forces each returned widget's control stack via `get_controls()` (§6.2) — this endpoint's whole job is the full schema, unlike `list_widgets` (§7, EMCP-027), which must never do this across the registry. Registration itself is Elementor's own lazy `get_widget_types()` → `init_widgets()` path (verified against Elementor 4.2.3's actual source, not assumed) — confirmed live to correctly reach 149 widgets on `wp-v4-pro` vs. 141 on `wp-v3-free`, the difference being exactly the eight V4 atomic (`e-`-prefixed) widgets, matching the `e-` detection rule in §5.2/`CLAUDE.md`. **Open item, not yet resolved:** whether Elementor Pro's *own* widget registration needs anything beyond this is unverified — neither sandbox has Pro installed. Revisit once the zip is supplied rather than guessing now.

### 6.1 Why the plugin stays thin

It owns only what must run in PHP: registry introspection, Document API writes, kit and global-class reads, media, preview tokens, cache invalidation, and snapshot storage. No DSL, no compilation, no MCP awareness.

### 6.2 Registry introspection caveats

- Controls are **lazily built** — `describe_widget` must force stack initialisation per widget.
- Registration is **context-sensitive**: many Pro and third-party widgets register only during editor/frontend bootstrap, so a plain REST request can see a smaller registry than the editor does. The endpoint must bootstrap Elementor's context explicitly, or the server under-reports vocabulary and then rejects valid specs.
- Validation must honour control `condition` / `conditions`, or settings that Elementor ignores at render time pass validation — producing "wrote it, nothing changed".

### 6.3 Write paths

`PUT /documents/{id}` behaves differently by target state, and the response says which path it took:

| Target | Behaviour |
|---|---|
| New / unpublished | Write post, status `draft` |
| Published | Write **autosave revision**; parent untouched |

`GET /documents/{id}` accepts `?source=autosave|parent`. `render_preview` on a published page must request the autosave, or the loop grades the wrong content.

### 6.4 Document hash

Covers the element tree **and** page settings, computed server-side over a canonical serialization. `PUT` requires the caller's hash and performs compare-and-swap **inside the same request**; a client-supplied hash is never trusted as authoritative. On mismatch: `409`, returning the new hash and a summary of what changed. The write response returns the **new** hash, so an edit costs one round trip rather than two.

`PUT` also refuses when `wp_check_post_lock()` reports a human editing, unless explicitly overridden.

### 6.5 Preview tokens

Signed, single post ID, TTL in minutes, single-use via a nonce table, non-enumerable, revocable, bound to a `renderer` audience. Sent as a header where possible; if a query parameter is unavoidable, responses set `Referrer-Policy: no-referrer` and `Cache-Control: no-store, private`. The endpoint does its own `read_post` gating rather than leaning on WordPress's preview path. Issuance and redemption are both logged.

### 6.6 Slashing

`_elementor_data` written directly requires `wp_slash( wp_json_encode( … ) )`. The Document API covers the main write path, but **snapshot restore writes prior state back directly** and will hit this. Fixture: `unicode-roundtrip` (§9.1).

---

## 7. Tool contracts

All 25 tools share conventions:

- `outputSchema` on every tool; results also carry serialized JSON in a text block for compatibility.
- Deterministic ordering in `tools/list`; `cacheScope: "private"`; `ttlMs` long for `list_widgets` / `get_site_info` / `get_global_styles`, `0` for anything page-derived.
- Annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) set on all — as UX hints only. **No safety control depends on them.**
- No `site_id` argument. The connector URL binds the session to one site (`solution.md` §3).
- Descriptions state *when to use and when not to*, especially for the confusable pairs: `apply_page_spec` vs `edit_elements`, `get_page_structure` vs `get_element` vs `find_elements`, `update_page` vs `publish_draft`.

### 7.1 `apply_page_spec`

```
in:  { post_id, spec, dry_run?, idempotency_key? }
out: { document_hash, diagnostics[], nativeness, raw_ratio, applied: bool, path: "draft"|"autosave" }
```

`dry_run` is a **structurally separate code path** that cannot write — not a late branch in the write path.

### 7.2 `edit_elements`

```
in:  { post_id, document_hash, operations[], idempotency_key? }
out: { document_hash, results[], diagnostics[] }
```

Operation items are a **flat object** with `op` as a required enum — not a JSON Schema `oneOf` at item level, which is where models reliably produce malformed input. Combination validity is enforced server-side with precise errors. `maxItems` is set and stated. The description carries a worked multi-operation example.

**Transaction semantics, stated in the tool description *and* in every error:** all operations validate before any apply; the batch is one document save; a failure applies nothing. Without that in the error text, a model re-issues the earlier operations and duplicates content.

### 7.3 `get_page_structure` / `get_element` / `find_elements`

`find_elements` returns enough per match to skip a follow-up `get_element` in the common case — otherwise the model pays one round trip per match. `get_element` is for full native settings.

All three return the element IDs and the `document_hash` that `edit_elements` consumes, and IDs are stable across saves.

### 7.4 `render_preview` / `compare_to_reference`

```
render_preview:       { post_id, breakpoint?, element_id?, return_image?: false } → { resource_link | image, summary }
compare_to_reference: { post_id, reference_id, breakpoint? } → { score, regions[] }
```

Defaults to a signed `resource_link`, inline image only on request. One image per call. Region-scoped capture via `element_id`. Captures `.elementor-{post_id}`. Never returns SVG.

`compare_to_reference` returns **numbers** — ranked regions with bounding boxes — not pictures.

### 7.5 `publish_draft`

```
in:  { post_id, confirmation_token }
out: { published: bool, url }
```

Called without a token, it returns `pending` plus instructions for obtaining one out-of-band. The token is bound to `(site, post_id, content_hash)`, single-use, minutes-long TTL, and **obtainable only through a channel the model cannot write to**. A boolean argument is not a human gate.

---

## 8. Error taxonomy

### 8.1 Channels

| Class | Channel |
|---|---|
| Validation, missing widget, stale hash, post locked, capability denial, nativeness warning, unresolved token | `isError: true` |
| Unknown tool, arguments failing `inputSchema`, internal error | JSON-RPC error |
| Expired / insufficient token | **HTTP 401/403 + `WWW-Authenticate`** |

Auth failures returned as `isError` never trigger refresh — the connector then appears permanently broken.

### 8.2 Codes

`TOKEN_UNRESOLVED`, `WIDGET_NOT_AVAILABLE`, `CONTROL_NOT_FOUND`, `CONTROL_CONDITION_UNMET`, `BREAKPOINT_UNKNOWN`, `DSL_VERSION_UNSUPPORTED`, `RAW_DENIED_KEY`, `RAW_SANITISED`, `HASH_STALE`, `POST_LOCKED`, `WORKING_SET_VIOLATION`, `APPROVAL_REQUIRED`, `NATIVENESS_LOW` (warning), `GENERATION_MISMATCH`.

Every code carries `path`, `message`, `allowed[]` where applicable, and `suggestion`.

### 8.3 Sanitisation rules

Applied to `raw` values, `html` node content, and `import_html` output if that ever lands:

- Reject `<script>`, `<iframe>`, `<object>`, `<embed>`
- Reject `on*` attributes
- Reject `javascript:`, `vbscript:`, and top-level `data:` URLs
- Reject reserved keys (§2.8)
- Flag any node introducing an external URL for human review

Note that Elementor additionally applies `wp_kses_post()` because our WP user lacks `unfiltered_html`. Our sanitiser runs **first and independently** — defence in depth, and it produces a legible error instead of silent stripping.

---

## 9. Fixtures and verification

### 9.1 The fixture set

Captured from **real Elementor** in phase 0, each carrying a provenance header (Elementor version, plugin list, capture date). **Hash-checked and agent-immutable** — an agent told "make the tests pass" will otherwise regenerate a fixture from its own compiler output, greening the suite while verifying only that the compiler agrees with itself.

| Fixture | Covers |
|---|---|
| `legacy-section-column` | Pre-container structure |
| `v3-container` | Modern flexbox |
| `v4-atomic` | `e-flexbox` / `e-grid`, nested typed props, local `styles` |
| `mixed-v3-v4` | Per-node detection |
| `mixed-legacy-v3` | Containers added to a legacy page |
| `nested-widget` | Nested Tabs — widget with `elements` children |
| `pro-globals-dynamic` | `__globals__` / `__dynamic__` preservation |
| `unicode-roundtrip` | Em-dashes, curly quotes, Arabic/CJK through snapshot → rollback → re-read |
| `responsive-widescreen` | `min-width` inversion |
| `deep-nested` | Depth limiting and truncation |

### 9.2 The registry snapshot

Validation's ground truth lives in PHP. Rather than round-tripping per validation or trusting an untested cache:

1. `GET /registry/snapshot` returns the full curated schema.
2. One snapshot per sandbox configuration is committed, with provenance.
3. A CI job re-pulls and diffs, **failing loudly on drift**.

Roughly two days of work, and it is what makes the compiler genuinely testable offline.

### 9.3 Harness split

- `verify:unit` — no network. Compiler, decompiler, digest, validation, sanitisation, against fixtures and the registry snapshot.
- `verify:live` — requires a sandbox. Write paths, cache invalidation, preview tokens, locks, rendering.

Both emit machine-readable pass/fail. **`ralphloop.md` must state that green unit tests do not imply correct live behaviour.**

---

## 10. Data shapes

**Site record:** slug (unguessable), URL, generation default, credentials ref, environment (`sandbox` | `client`), plugin version, min supported version.

**Grant:** `(oauth_subject, site_slug, scopes[])`. No fallback credential; a missing grant is 403 before any outbound request.

**Ledger index row (Node):** id, site, subject, tool, redacted args, correlation id, timestamp, snapshot pointer, `raw_ratio`, nativeness, approval token ref. Args are **allowlisted in**, not denylisted out.

**Snapshot (WordPress):** prior `_elementor_data`, which path it captured (parent or autosave), meta, hash. Stored site-side so content stays with the site and rollback survives a Node outage.

**Cache keys** include the site slug in every path, prefix and index. Post ID 42 exists on every WordPress site.

---

## 11. Stack and infrastructure

### 11.1 Scope boundary

**This is an Elementor MCP, not a WordPress MCP.** It covers pages, media, and (later) menus — only as much WordPress as Elementor work requires. Site administration (users, roles, plugins, themes, settings, taxonomies, comments, arbitrary post types) is **out of scope** and stays out.

The composition model is that MCP clients connect to several servers at once: a general WordPress MCP handles administration, this one handles Elementor. Building WP admin tooling here would mean maintaining a worse version of something that already exists.

**Consequence to design for:** if both servers are connected, tool counts add up and some tools overlap by name (`create_page` exists in both). Every tool description must state the boundary explicitly — *"use this for Elementor-built pages"* — or model selection degrades. Revisit after real usage if the team hits WordPress-level gaps often.

### 11.2 Stack

| Layer | Choice | Note |
|---|---|---|
| MCP server | TypeScript (strict) + `@modelcontextprotocol/sdk` | |
| HTTP | Fastify | Native JSON Schema handling matches the tool schemas |
| Validation | Zod + `zod-to-json-schema` | One source for tool schemas and runtime validation |
| Renderer | Playwright + headless Chromium | Separate service, containerized |
| Plugin | PHP 8.1+, Composer, PSR-4 | |
| Database | PostgreSQL | §11.3 |
| Migrations | Drizzle | TypeScript-first, SQL-shaped |
| Object storage | S3-compatible | Screenshots, reference designs |
| Tests | Vitest (Node), PHPUnit (plugin) | Split per §9.3 |

### 11.3 What the database holds

Smaller than expected, because snapshot payloads live in WordPress (`solution.md` §3):

- Site registry, grants, encrypted credential references
- Ledger **index** rows — redacted args, correlation IDs, snapshot pointers
- Idempotency keys, approval tokens, preview-token nonces

PostgreSQL over SQLite because the commercialization path wants row-level security for tenant isolation, and retrofitting that is worse than starting with it. JSONB suits the redacted-args column.

Blobs never go in Postgres. The credential KEK lives in a KMS that **the renderer has no grant to** (`solution.md` §9.5).

Deferred but likely: a job queue (BullMQ + Redis) once renders and large builds outgrow request timeouts. The Tasks extension may cover v1 without it.

### 11.4 Development environment — Docker Compose

| Service | Purpose |
|---|---|
| `wp-v4-pro` | WordPress + Elementor Pro, **V4/atomic default** |
| `wp-v3-free` | WordPress + Elementor Free, V3 containers, carrying legacy fixture pages |
| `db-wp` | MariaDB for both WordPress instances |
| `mcp` | Node MCP server |
| `db` | PostgreSQL |
| `renderer` | Playwright service |
| `minio` | S3-compatible object storage |

Two WordPress containers, not one — they cover both real forks (V4-vs-V3 and Pro-vs-Free) with two services, and they are the sandboxes `solution.md` §16 requires.

**Segment the renderer in development too.** Put it on its own Compose network with no route to `db` or the credential store. The isolation requirement is a production control, but making it habitual locally means the topology is exercised continuously rather than discovered at deployment.

Reset tooling is part of this: database plus uploads plus `uploads/elementor/css/`, scripted, unable to target anything but the sandbox containers.

Auth locally is **header-based via Claude Code**. Claude.ai and OAuth only run against a deployed environment.

### 11.5 Production hosting — open

Docker Compose is the development answer. Production is not decided, and it determines three things already specified as requirements: the KMS backing the credential KEK, real network segmentation for the renderer, and public TLS reachable from Anthropic's egress range. Decide before phase 7; phases 0–6 run entirely on the local Compose stack.

---

## 12. Deliberately unresolved

These need a decision or a measurement before the phases that depend on them. None block phase 0.

1. **V4 authoring size.** The typed-prop and local-`styles` emission path is a timeboxed spike in phase 2. Until it runs, the v4 half of §3.2 is a design, not an estimate.
2. **Reference design ingestion.** MCP tool inputs are JSON and a model cannot re-emit an image it was shown, so a mockup pasted into chat cannot reach the server. Until URL or out-of-band upload is chosen, `compare_to_reference` has no input and visual criteria stay human-judged.
3. **IdP selection**, against `solution.md` §9.3's criteria. Gates phase 7, and procurement lead time starts now.
4. **Per-element `version` migration.** V4 nodes carry a schema version and we have no migration concept.
5. **Global classes and components as first-class DSL citizens.** v1 emits local styles only, which is sufficient to author V4 but does not participate in a site's existing V4 design system.
6. **DSL vs HTML authoring**, to be settled by measured head-to-head on fixture designs — nativeness and iteration count — not assertion.
