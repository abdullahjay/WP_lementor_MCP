# Elementor MCP — Solution Design

**Goal:** Let an AI model reproduce a provided design in Elementor accurately, and automate the team's day-to-day Elementor page work.

**Audience:** Internal dev team first. Commercialization is not built now, but nothing here should need rewriting to get there.

**Unit of work:** A **page**, built into an existing site — not a whole theme.

**Scope boundary:** This is an **Elementor** MCP, not a WordPress one. Pages, media and later menus — only as much WordPress as Elementor work needs. Administration (users, plugins, themes, settings, taxonomies) is out of scope; MCP clients connect to several servers at once, so a general WordPress MCP covers that alongside this one. Revisit after real usage.

**Verified against:** Elementor **4.3.0** and MCP spec revision **2026-07-28**, as of 20 Aug 2026. Both move fast; §17 says how to re-check.

**Status:** Solution design, revised after four independent technical reviews. Feeds `Blueprints.md` → `ralphloop.md` → `prd.md` → `progress.md`.

---

## 1. The framing that drives everything

This is not "an API for Elementor." It is **eyes, hands, and memory for a model that already knows how to read a design.**

| The model provides | The server provides |
|---|---|
| Reads the target design | The site's actual widget vocabulary and settings |
| Decides structure, styling, copy | The ability to write that into Elementor correctly |
| Judges whether output matches | A rendered screenshot, and a measured diff |
| Decides what to fix | A way to undo everything if it went wrong |

Tools are organised around **the loop the model runs**, not Elementor's object model:

```
orient → learn the site's vocabulary → build → look at the result → correct → undo if wrong
```

---

## 2. Design principles

### P1 — Native widgets first. Custom HTML is a last resort.

The reason to build *in* Elementor is that a non-technical person can edit it afterward. A page of HTML widgets fails that entirely: the client can't edit it, responsive controls don't apply, it ignores the kit so brand changes don't propagate, and it's invisible in the Navigator. An HTML-widget-heavy page is a screenshot with extra steps.

**Fallback ladder:** `native widget → native + custom CSS → shortcode → HTML widget`

**The ladder is site-dependent.** Custom CSS is Pro-only, so on Free it collapses to three rungs. And **the bottom rung is partly disabled by our own security posture**: Elementor applies `wp_kses_post()` to element data when the saving user lacks `unfiltered_html`, which our least-privilege role (§10) deliberately does not have. So `<script>` and iframes are stripped at save. This is a deliberate trade — accepted, not discovered in phase 5.

Enforced by: a widget-shaped DSL vocabulary (native is the easy path), a mandatory `reason` on **both** the HTML fallback and `raw`, and a **nativeness metric that warns and itemises — it does not gate**. See §14 for why gating fails.

### P2 — Introspect, never hardcode.

Widget availability and control schemas come from Elementor's registry at call time. New releases, newly activated Pro, third-party packs — all work with no code change.

**Two honest limits.** Introspection gives *availability*, not *ranking* — which of a widget's 200 controls matter needs a hand-maintained curation map (§7). And V4 atomic elements don't use the controls stack at all; they use prop-type schemas, requiring a second introspection path.

### P3 — Digest, never dump. Budget in tokens, not tools.

Every read returns a depth-limited digest. Acceptance criteria are **measured token counts**, not adjectives (§12).

### P4 — The model must be able to see its own work.

Without a render-back loop the model builds blindfolded. But comparison should be **server-side and numeric** wherever possible — returning two images per iteration for the model to eyeball is the single largest avoidable context cost in this design.

### P5 — Respect the site that already exists.

We add pages to live sites with an established design system. Global styles are **read-only in v1**; changing a global colour silently restyles every other page.

### P6 — Nothing is unreachable, but escape hatches are supervised.

`raw` exists so the DSL can stay small. It is **not** merged untouched: it passes value-level sanitisation and the same `__globals__`/`__dynamic__` preservation as compiled settings, requires a `reason`, and is reported as a separate `raw_ratio`.

### P7 — Content read from WordPress is untrusted input to the model.

Page copy, widget settings, media filenames and template names all flow into model context, in a session that holds write authority. This is the system's largest risk and §10 addresses it structurally.

---

## 3. Architecture

**Hybrid** — a thin WordPress companion plugin plus an external MCP server, with the renderer as a **separate isolated service**.

```
Claude.ai ──OAuth 2.1 / Streamable HTTP──▶  MCP Server (Node/TS)
   (one connector URL per site)               ├── Protocol    MCP 2026-07-28
                                              ├── Compiler    DSL → Elementor (V3/V4)
                                              ├── Safety      validate, ledger index
                                              └── Registry    sites, grants, credentials
                                                    │
                                    ──scoped tokens / REST──▶  WP Companion Plugin (PHP)
                                                                 └── Elementor runtime
                                              │
                     ──render request──▶  Renderer service (isolated: no credentials,
                                          egress-filtered, own network segment)
```

**Why the split falls here** — the reasons that actually hold:

1. The headless renderer cannot live inside WordPress PHP.
2. **One connector serving many sites.** A per-site plugin-only design means N connectors in Claude.ai, no cross-site templates, no unified ledger.
3. **Reachability.** Anthropic must reach the MCP endpoint from its egress range; internet-exposing every client WordPress install to satisfy that is unacceptable.
4. **Central credential custody** and one-action revocation.

*Not* "the logic is testable without WordPress" — that reason is partly false and §12 explains why.

**Alternative considered and rejected:** MCP implemented directly in the PHP plugin plus a dumb screenshot microservice. Genuinely simpler, and it fails only on (2) and (3) — which are decisive here, but would not be for a single-site product.

### Decisions on record

| Decision | Choice | Reason |
|---|---|---|
| Topology | Hybrid; renderer isolated | Above |
| MCP server | Node / TypeScript | First-class MCP SDK |
| Protocol | **Streamable HTTP, revision 2026-07-28** | Sessions and the `initialize` handshake no longer exist; per-request `_meta` and headers instead |
| Connector shape | **One URL per site** (`/sites/{slug}`) | Binds a session to one site — kills the cross-tenant pivot (§10), makes OAuth audience per-site, and resolves the `tools/list` problem (§13) |
| Client auth | OAuth 2.1 — IdP bought, **resource-server obligations built** | §10.2. "Buy an IdP" does not discharge PRM, the 401 challenge, or audience validation |
| Server → WP | Plugin-issued scoped short-lived tokens; Application Passwords only for bootstrap | An application password authenticates the *entire* WP REST API and never expires |
| Element model | **Read all four shapes; create in the site's own generation** — V4 on V4-enabled sites, V3 containers otherwise | §5 |
| Global styles | Read-only in v1 | P5 |
| Write posture | Draft-first — **which means autosave/revision on published pages** | §5.4 |
| Concurrency | Server-side compare-and-swap on document hash, **plus `wp_check_post_lock()`** | WordPress *does* have locking; ignoring it overwrites a human actively editing |
| Approval | Out-of-band confirmation tokens | An in-band boolean is not a human gate |
| Ledger | Snapshot payloads in WP; index rows in Node | Content stays with the site; rollback survives a Node outage; metering still works |
| Ordering rule | No write ships before validation + snapshot + rollback are proven on a real mutation | §9 |

**Not in v1:** `import_html`, multi-tenant control plane, billing, Theme Builder, popups, WooCommerce, ChatGPT adapter.

---

## 4. Tool surface — 25 in v1

| Group | Tools | # |
|---|---|---|
| Orient | `get_site_info` | 1 |
| Read | `list_pages`, `get_page_structure`, `get_element`, `find_elements` | 4 |
| Vocabulary | `list_widgets`, `describe_widget` | 2 |
| Design tokens | `get_global_styles` | 1 |
| Media | `upload_media`, `list_media` | 2 |
| Ingestion | `upload_reference_design`, `extract_design_tokens` | 2 |
| Build | `apply_page_spec`, `edit_elements`, `validate_page_spec` | 3 |
| Templates | `list_templates`, `save_as_template`, `apply_template` | 3 |
| Verify | `render_preview`, `compare_to_reference` | 2 |
| Safety | `list_changes`, `rollback` | 2 |
| Page | `create_page`, `update_page`, `publish_draft` | 3 |

`list_sites` is gone — one connector URL per site makes it meaningless. `import_html` is cut from v1 (§6).

**The real budget is tool-definition tokens, not tool count.** With honest descriptions this surface plausibly reaches 6–12k tokens, past the threshold where clients begin deferring tool loading. Track it with `count_tokens` as a first-class metric.

### Notes on specific tools

**`get_site_info`** must report: Elementor version, **whether V4/atomic is enabled**, **Pro tier** (Essential vs Advanced — "Pro" is not a boolean; Popup Builder is Advanced-only), configured breakpoints, active performance experiments (**Element Caching**, Optimized Markup), and CSS print method. Prefer deriving capability from the **registered widget list** rather than any edition flag — P2 gives that for free and it covers third-party packs.

**`describe_widget` is the sleeper context bomb.** A faithful dump of a Pro widget's controls is plausibly 5–20k tokens; a page needs 8–15 widgets. It requires a `detail` parameter (`common` | `full` | `section:<tab>`) defaulting to `common`, a curated allowlist per widget type, responsive variants stated once rather than enumerated, and a hard output cap with a "call again for the rest" affordance. Also: it must force control-stack initialisation per widget, and `list_widgets` must **never** call `get_controls()` across the registry.

**`edit_elements`** batches insert/update/move/remove/duplicate into one document save. Keep the batch — not for tool count (26 vs 30 is noise) but because **one save is the only shape compatible with optimistic concurrency**; five primitives would each need their own hash round-trip. Schema notes: use a flat item object with `op` as a required enum rather than `oneOf` at item level (models malform discriminated unions), cap with `maxItems`, put a worked multi-op example in the description, validate every op before applying any, and state transaction semantics **in the error text** — otherwise a batch failing at op 19 gets retried as ops 1–19 and duplicates content.

**`validate_page_spec`** is standalone and read-only, for checking a spec before a target page exists. `dry_run` on `apply_page_spec`/`apply_template` covers the rest, validating against the *target* site so a Pro-authored spec fails legibly on a Free one.

**`upload_reference_design` has a hard constraint:** MCP tool *inputs* are JSON — there is no image argument type, and **a model cannot re-emit an image it was shown**. So a mockup pasted into chat cannot reach the server. It accepts a URL (egress-filtered) or an out-of-band upload. Without one of those, `compare_to_reference` has no reference and visual criteria stay human-judged.

**`render_preview`** returns a signed `resource_link` by default and an inline image only on request; supports **region-scoped capture** (`element_id`) so correction iterations cost a fraction of a full page; captures the document wrapper (`.elementor-{post_id}`) rather than a viewport; one image per call, never three breakpoints in one result; always paired with a compact text summary. Never returns SVG.

**`compare_to_reference`** returns **numbers, not pictures** — per-region deltas and ranked bounding boxes of worst mismatches.

**`update_page`** sets the Elementor page template (`elementor_canvas` / `elementor_header_footer` / `elementor_theme` / `default`). Identical trees render completely differently under each.

---

## 5. Element models

### 5.1 The landscape has moved — this is now a V3-vs-V4 fork

Elementor 4.0 shipped **19 March 2026**, and **all new installations have defaulted to the Atomic (V4) editor since April 2026**. V4 is not an experiment. Current release is 4.3.0.

This inverts the earlier plan. "Create in V3 containers only" would write the *previous* generation's format into V4-default editors on every new client site — the same technical-debt argument that rules out creating legacy sections now applies to containers on those sites.

| Shape | Detection | Read | Edit | Create |
|---|---|---|---|---|
| Legacy | `elType: section` / `column` | Yes | Yes | No |
| V3 container | `elType: container` | Yes | Yes | **Yes — on V3 sites** |
| V4 layout | `elType: e-div-block` / `e-flexbox` / `e-grid` | Yes | Yes | **Yes — on V4 sites** |
| V4 content | `elType: widget`, `widgetType` prefixed `e-` | Yes | Yes | **Yes — on V4 sites** |

### 5.2 Detection keys on `widgetType`, not `elType`

**Atomic content widgets are still `elType: widget`.** An `e-heading` presents as `{elType: "widget", widgetType: "e-heading"}`. Routing on `elType` alone sends it into the V3 widget path, where its typed settings are misread and a "safe" text edit destroys it.

The discriminator is the **`e-` prefix on `widgetType`, plus the presence of `styles` / `version` fields**. Detection stays **per-node** — documents genuinely mix shapes.

Disambiguation rules for mixed documents:
- New top-level content → the site's own generation (V4 layout on V4 sites, container on V3)
- Content inserted inside an existing legacy section/column → stays legacy
- Never nest a container inside a column

### 5.3 What V4 actually stores

Three corrections that a compiler gets silently wrong otherwise:

**Styling is per-element by default.** V4 elements carry a local `styles` array including responsive and pseudo-state variants. Global classes are the *opt-in reuse layer* — and they do **not** live in the kit. They are a separate post type (`e_global_class`) with its own meta and REST surface, capped at 1000 per context, with **separate frontend and preview meta keys**. That split matters directly for draft rendering.

*Consequence worth noting:* because local styles are the default, we can create V4 content **without** writing global classes — so P5's read-only-globals stance does not block V4 authoring.

**Typed props nest.** `{"$$type": "string", "value": "…"}` is the easy case. A heading title is `{"$$type": "html-v3", "value": {"content": {"$$type": "string", "value": "…"}, "children": []}}`. A compiler assuming flat scalars silently drops content — this is a live bug in at least one existing Elementor MCP server.

**Elements carry a `version`**, implying per-element schema migration. We need a concept for that; currently we have none.

### 5.4 Draft-first is two different write paths

**Saving a published page as a draft in Elementor does not create a draft — it creates an autosave revision.** `_elementor_data` on the live post is untouched; draft content lives on the autosave post.

| | New page | Existing published page |
|---|---|---|
| Write | post with `draft` status | **autosave revision** |
| `render_preview` | renders the post | must render **the autosave** |
| `publish_draft` | `wp_publish_post` | **promote autosave onto the parent** |
| snapshot / `rollback` | the post | must record *which* it captured |

Since editing existing published pages is routine client work, this is a first-class mechanic, not an edge case. It also makes "the document" ambiguous for hashing — the hash must state which it covers.

### 5.5 Other structural facts the compiler must honour

- **Widgets are not always leaves.** Nested Tabs / Accordion / Carousel are `elType: widget` carrying `elements` arrays of containers. Digest, `find_elements`, insert/move and the nativeness metric all need this.
- **`_elementor_edit_mode = 'builder'`** is required or the page renders as empty theme content — a blank page indistinguishable from a corrupt write. Plus `_elementor_template_type`, `_elementor_version`, `_elementor_page_settings`.
- **Element IDs** must be unique across the whole tree including nested widget children, and `apply_template` / duplicate **must regenerate them** — shared IDs share CSS selectors and produce style bleed that looks like a rendering bug.
- **The widescreen breakpoint is `min-width`**, unlike every other breakpoint. Responsive mapping inverts there.
- **Slashing.** `update_post_meta()` unslashes, so `_elementor_data` needs `wp_slash( wp_json_encode( … ) )`. The Document API covers the main path, but **snapshot/restore writes prior state back directly** and will hit this. Named fixture required: em-dashes, curly quotes, Arabic/CJK, round-tripped through snapshot → rollback → re-read.

---

## 6. The build interface — a compiled DSL

Elementor's native format is hostile to a model: 7-char per-document-unique IDs, `{unit, top, right, bottom, left, isLinked}` dimension objects, per-breakpoint key suffixes, `__globals__`/`__dynamic__` siblings destroyed by naive merges, and now nested typed props. Each is a place a model produces *plausible* output that silently corrupts a live page.

**The decisive argument is failure-mode elimination**, not ergonomics: native emission produces §9's "silent page destruction" at scale. The token argument reinforces it — native JSON for one heading with responsive padding is 15–25× the DSL equivalent, and output tokens are the expensive ones.

```jsonc
{
  "type": "container",
  "layout": { "direction": "row", "gap": 24, "padding": [80, 20] },
  "responsive": { "mobile": { "direction": "column", "padding": [40, 16] } },
  "children": [
    { "type": "heading", "text": "Build faster", "style": { "size": "h1", "color": "@primary" } },
    { "type": "button",  "text": "Get started", "link": "/signup", "style": { "variant": "@accent" } }
  ]
}
```

The compiler owns: ID generation, unit objects, breakpoint suffixing (inverted for widescreen), `__globals__`/`__dynamic__` preservation, kit resolution, and **emitting either V3 or V4 shapes from the same spec**.

**Keep the vocabulary CSS-shaped.** A DSL is out-of-distribution for the model; every keyword that mirrors CSS reduces that cost. Put a complete worked example in the *tool description*, not just the schema. The DSL carries a version field.

**`raw` is supervised, not raw** (P6). It is deep-merged with a reserved-key denylist, sanitised at value level, preserves `__globals__`/`__dynamic__`, requires a `reason`, and is reported as `raw_ratio` — because a page whose every setting arrived via `raw` scores 100% native and is unmaintainable.

**`import_html` is cut from v1.** It is a second compiler in the opposite direction, needs a headless browser for computed CSS, and is 4–6 weeks competing for the same scarce expertise as the primary path. The HTML-as-authoring-format question stays genuinely open and should be settled with a **measured head-to-head on fixture designs** — nativeness and iteration count — not by assertion.

---

## 7. The verification loop

1. Model receives the target design
2. `get_site_info` + `get_global_styles` + `list_widgets`
3. `get_page_structure` on an existing page — learn the site's conventions
4. `upload_reference_design` (URL/out-of-band), `extract_design_tokens`, `upload_media`
5. `apply_page_spec` into a draft (or autosave — §5.4)
6. `compare_to_reference` → **numbers**; `render_preview` region-scoped when the model needs to look
7. `edit_elements` to correct
8. Repeat 6–7
9. Check tablet and mobile
10. `publish_draft` with an out-of-band approval token

**Three mechanics this depends on.** Preview tokens must be signed, single-post, short-TTL, non-enumerable and revocable — necessary because Application Passwords only authenticate requests WordPress classifies as API requests, so the renderer cannot simply send Basic auth at a front-end URL, and core's `preview_nonce` is session-bound. The renderer must **have the site's fonts** and wait for lazy images. And **Element Caching (default since 3.32) stores rendered HTML in the database** — if invalidation misfires, the loop screenshots and grades a page it did not build.

---

## 8. Safety model

```
site grant check (does this identity hold this site?)
  → capability check, per-post
    → post-lock check (is a human editing?)
      → document-hash compare-and-swap
        → DSL/schema validation with a JSON path
          → structural validation (widget exists here; settings keys real; control conditions honoured)
            → nativeness + raw_ratio report (warn, itemised)
              → snapshot
                → write via Document API
                  → cache invalidation + warm-up
                    → ledger entry
```

Failure modes this exists to prevent:

- **Silent page destruction** — a malformed `_elementor_data` write yields a blank page with no PHP error.
- **Lost globals and dynamic tags** — naive merges strip `__globals__`/`__dynamic__`. Regression fixture from day one.
- **Wrote it, nothing changed** — settings that pass key validation but are ignored because a control `condition` isn't met.
- **Stale render** — the correct-mechanism version: a direct meta write leaves content **visible but unstyled**, and Element Caching can leave it entirely stale. CSS regeneration is lazy and deferred, so "CSS regenerated" needs explicit invalidation and warm-up, not trust in the save call.

**Ordering rule: no write tool ships before validation, snapshot and rollback are proven against a real mutation.** The chicken-and-egg is resolved by naming a deliberately minimal test vehicle — `update_element` on one text field.

`rollback` is bounded: max N changes, never crossing a site boundary, snapshotted before it runs, and requiring the same out-of-band approval as `publish_draft` when the target is published.

---

## 9. Security model

### 9.1 Untrusted content and model manipulation

Page copy, widget settings, media filenames and template names flow into model context in a session holding write authority. A compromised client page — routine in agency work — becomes an instruction channel. Our own workflow makes it worse: step 3 tells the model to read an existing page first.

Structural mitigations, in order of strength:

1. **Session bound to one site** by connector URL and token audience (§3). This alone removes cross-tenant pivot.
2. **Provenance-tag every read** — site-derived text returned in an explicit envelope marked untrusted, with tool descriptions stating content is data, never instruction.
3. **Neutralise on ingest** — strip markup, zero-width characters and newlines from labels, filenames and template names.
4. **Out-of-band approval** for anything irreversible, so an injection that "obtains approval" in-band gains nothing.
5. **Egress flagging** — any node introducing an external URL, script, iframe or `__dynamic__` tag is flagged for human review regardless of nativeness.
6. **Ledger anomaly alerts** on writes outside declared task scope.

### 9.2 Authorization chain

Replaces the earlier "checked twice", which did not deliver: `current_user_can('edit_post')` returns true for *every* post for an Editor — the role we need — so it never was a per-post control.

```
oauth_subject → grant on this site → credential selection → WP capability check → declared working set
```

No fallback credential; a missing grant is a 403 before any outbound request. Site slugs are unguessable. The **working set** — the post IDs a session may mutate — is what makes "not a key to every page" true.

### 9.3 OAuth: what buying does and does not cover

Buying an IdP is right. It does **not** discharge the resource-server work, all of which we build:

- **Protected Resource Metadata (RFC 9728)** — MCP servers MUST implement it; the IdP does not publish ours. The `resource` value must match the URL exactly as typed, path included.
- **401 + `WWW-Authenticate: Bearer resource_metadata="…"`.** Claude does not honour the header on a 200.
- **Audience validation** (RFC 8707) — tokens must be issued for this server; no other token accepted or transited.
- **Scope challenges** — 403 + `insufficient_scope` with all needed scopes in one challenge.

Scopes must exist at all: `pages:read`, `pages:write`, `pages:publish`, `media:write`. Without them every token is full-authority.

**IdP selection is a gate, not a detail.** DCR is now deprecated in favour of Client ID Metadata Documents, and Claude selects CIMD only when AS metadata advertises both `client_id_metadata_document_supported` and `none` in `token_endpoint_auth_methods_supported`. Hard criteria: CIMD-with-`none` or DCR; RFC 8707 `resource`; RFC 9207 `iss`; S256 PKCE. Operational: Anthropic's egress must reach **both** the MCP server and the AS; 10-second discovery/token timeouts.

### 9.4 Credentials

Application Passwords authenticate the **entire** WP REST API, never expire, and cannot be scoped — so they are bootstrap-only. The plugin issues its own **audience-scoped, short-lived, refreshable tokens** for ongoing use.

Revocation must be a *tested code path* that calls each site and deletes the credential, with verification and alerting — deleting registry rows leaves working credentials in backups, dumps and laptops. Envelope encryption, per-site DEK, KEK in a KMS, scheduled rotation, and a written compromise runbook.

The WP user is least-privilege and **must not hold `unfiltered_html`** (verified at enrolment) — with P1's stated consequence.

### 9.5 Renderer isolation

Colocation is a **blast-radius decision, not a performance one**: a renderer on the credential host means one compromised client site yields every client's credentials.

Separate host and network segment, no credential store, no KMS grant. Allowlisting the initial URL is not an SSRF control — enforce at **connect time per request**, after every redirect, rejecting RFC1918/loopback/link-local and any IP not matching the registered site. Block non-`http(s)` schemes and `file://`. Fresh browser context per render. Screenshots stored outside the web root. The same egress policy applies to every outbound fetch: `upload_media` by URL, `upload_reference_design`, and the Node client calling WordPress — a compromised site can redirect it inward.

### 9.6 Data handling

The ledger's `before` snapshots are a shadow copy of client content — and **Elementor Pro form widgets store webhook URLs and integration API keys in widget settings**, so those land in it. Allowlist what enters `args`; scrub by key pattern and value shape; encrypt at rest; define retention and pruning; make deletion-on-offboarding an explicit operation. Log reads as well as writes — without that, "what did the attacker see?" is unanswerable.

### 9.7 Other controls

Content-derived MIME validation, not extension-based. Deny anything a browser may render as markup or script — SVG, `.svgz`, HTML, XML, PDF — not SVG alone. Cap decoded pixel dimensions against decompression bombs. Strip EXIF. Force unique filenames. Verify `uploads/` does not execute PHP at enrolment.

Reject cookie-authenticated requests to plugin routes outright (CSRF), use an explicit CORS origin allowlist, enforce TLS with certificate validation on both ends, and never expose `_elementor_data` via `show_in_rest` meta — CVE-2026-6127 was exactly that, bypassing Elementor's sanitiser with a form-encoded body.

Per-site rate limits, not just per-user: a runaway loop hammering a client's shared host is an incident we caused for a client.

---

## 10. Error handling

Errors are the model's only self-correction channel, and the channel matters as much as the message.

| Failure | Channel |
|---|---|
| Validation failure, missing widget, stale hash, capability denial, nativeness warning | **`isError: true`** — clients feed these to the model |
| Unknown tool, arguments failing `inputSchema`, internal error | JSON-RPC error |
| Expired or insufficient token | **HTTP 401/403 + `WWW-Authenticate`** |

That last row is the dangerous one: auth failures returned as `isError` never trigger refresh, and the connector appears permanently broken.

Every error carries a JSON path, what was wrong, allowed values, and a suggested fix — as `structuredContent` against a declared `outputSchema`. A stale hash returns the *new* hash and a summary of what changed. A nativeness warning enumerates offending nodes with the widget that should have been used — that list is also the compiler-coverage backlog.

Long operations (render with font settling, full-page compile-and-save) need the Tasks extension or progress streaming; client patience is a protocol problem, not a scaling one.

---

## 11. Testing

Absent from the previous draft entirely, and the Ralph loop cannot converge without it.

**Golden fixtures, captured in phase 0** — legacy, V3 container, V4 atomic, mixed, nested-widget, and the unicode/slashing round-trip. Captured from **real Elementor**, carrying provenance headers.

**Fixtures are agent-immutable.** An agent told "make the tests pass," with no memory of why, will regenerate a fixture from its own compiler output — every test greens and you have verified the compiler agrees with itself. Hash-check fixtures; fail the run on unsigned changes.

**The registry snapshot closes the biggest verification gap.** Validation's ground truth — does this widget exist, are these settings keys real — lives in PHP. So Node either round-trips per validation or caches. Add `get_registry_snapshot` to the plugin contract, commit one snapshot per sandbox configuration with provenance, and run a CI job that re-pulls and **fails loudly on drift**. Roughly two days, and it converts an untestable dependency into a tested one.

Split the harness: `verify:unit` (no network) and `verify:live` (requires sandbox), both emitting machine-readable pass/fail. **Green unit tests do not imply correct live behaviour** — say so in `ralphloop.md`.

---

## 12. Observability and operations

A two-process system whose caller is a model, so there will be no human describing what they did.

**Correlation IDs** generated in Node, propagated into every WP REST call, written to ledger rows, echoed in every result and error. A failed `apply_page_spec` can be a DSL error, a compiler bug, a bridge failure, a PHP fatal, an Elementor rejection or a cache no-op — without traces crossing the boundary that is a three-hour debug, daily.

**Token budget as a tracked metric:** tool-definition tokens, per-iteration cost, digest sizes. Phase acceptance uses measured numbers.

**Deployment:** the Node server needs public TLS reachable from Anthropic's egress, secrets management, and a container for the renderer. **Plugin distribution** to N client sites needs a self-hosted update channel, signed artifacts, server-declared minimum version, `get_site_info` reporting installed version, loud failure on mismatch, and an emergency kill switch.

**Local dev must be specified**, or every iteration re-derives it: local WordPress, local Node, renderer, and **Claude Code with header auth locally — Claude.ai and OAuth only against the deployed environment**.

---

## 13. Extensibility

**Tools are declarative registry entries** — name, schema, handler, required scope, `mutates` flag. The safety ring wraps mutating handlers generically.

**Most new tools never touch PHP** — new capability is usually new composition over existing plugin primitives.

**Widget coverage extends itself** (P2), which is why 25 tools cover Free, Pro and third-party packs alike.

**Do not filter `tools/list`.** The earlier plan is not implementable: with sessions removed there is no "connected site" at list time, and the only spec-legal axis is the authorization presented — which per-site connector URLs now give us anyway. Ship a stable, deterministically-ordered list with `cacheScope: "private"`; make unavailability a **tool execution error** naming the missing capability and the substitute. That generalises the `dry_run` pattern instead of adding a weaker second mechanism. Client-side tool search handles scale better than server-side filtering.

**Naming convention is chosen now** — renaming to `theme.*` later breaks caches and saved workflows.

**The element-model seam:** everything above the document layer speaks the normalized shape from §5, so a future generation means implementing one interface.

**Growth path:** Theme Builder with display conditions (a header without conditions is invisible and looks exactly like a failed write) and WP menus → `set_global_styles` behind confirmation → global classes and components as first-class → popups, custom CSS, custom fonts → template export → `import_html` if the head-to-head justifies it → WooCommerce → ChatGPT adapter.

---

## 14. The nativeness metric warns; it does not gate

As a build gate it fails before it ships: containers aren't widgets so the denominator is undefined and nesting distorts it; one giant HTML blob scores better than five small ones, rewarding the worst outcome; the `shortcode` widget is native, making rung 3 indistinguishable from rung 1; thresholds would be invented with no data; and it fails at the most expensive moment, after all the work.

v1 **warns and itemises**, at `dry_run` time, weighted by content nodes, reported alongside `raw_ratio`. Collect data for 4–6 weeks before considering any threshold. Keep a hard gate only inside the loop's own acceptance harness against fixed reference designs, where a *regression* is meaningful and an absolute number is not.

---

## 15. Phasing

Roughly **30–40 dev-weeks, ~2 developers, 5–6 months** to §7's loop working well. Sized honestly because the previous cut read as a 3-month plan.

| # | Deliverable |
|---|---|
| 0 | Plugin + server skeleton; **header auth via Claude Code**; one trivial tool; **golden fixtures captured**; plugin REST contract v1 frozen; local dev documented |
| 1 | Site registry, grants, credentials; registry snapshot + drift check |
| 2 | Read layer — digest, normalization across all shapes, curated `describe_widget`. **Timeboxed V4 write spike** |
| 3 | `render_preview` + preview tokens + renderer isolation and egress filtering |
| 4 | Safety ring, proven on one deliberately minimal write |
| 5 | Write layer; hash CAS + post locks; idempotency; **autosave/revision mechanics** |
| 6 | DSL compiler + `apply_page_spec`, **including responsive** |
| 7 | OAuth 2.1 + Claude.ai remote connector |
| 8 | Templates |
| 9 | Ingestion + `compare_to_reference` |

Two ordering notes. **Responsive cannot be split from the DSL** — splitting it means every phase-6 fixture is rewritten in phase 7. And **OAuth moved off the critical path**: it carries a procurement dependency, and phase 0 runs fine on header auth, so Elementor work proceeds while the IdP decision is open.

---

## 16. Operating rules for autonomous runs

Workflow rules live in `ralphloop.md`. These are constraints the *system* enforces regardless.

**Sandbox reachability is a capability, not a flag.** Autonomous loops run as a separate deployment holding **only sandbox credentials**, with an identity granted only sandbox sites. There is no flag to bypass because the secrets are absent.

**Reads are restricted too.** Restricting only writes leaves an unattended agent free to read every client site and write the contents somewhere else.

**Sandboxes must cover the real forks** — V4-enabled and V3, Pro and Free, carrying legacy/container/V4/mixed fixture pages. V4-vs-V3 is now the more significant axis.

**Resettable** — database, uploads, and `uploads/elementor/css/`, scripted, with the reset path unable to target a non-sandbox site.

**Sandbox fixture pages are attacker-writable by design** — the loop writes to them, so injected text can accumulate across iterations. §9.1 applies to sandboxes too.

**Publishing stays human-gated**, out-of-band.

---

## 17. Commercialization, and what to re-verify

Kept in mind, not built: per-site connector URLs and per-site token audiences are already the tenant boundary; ledger index rows carry site and user for metering; the plugin is the separable artifact. **`site_id` must be part of every cache key, storage path and index** — post ID 42 exists on every WordPress site, and a cache keyed without it is a cross-tenant leak that is easy to write and hard to notice.

Before `Blueprints.md`, re-verify — both ecosystems move monthly:

1. **Elementor version and V4 status.** Written against 4.3.0. Date-stamp every version-dependent claim.
2. **MCP revision.** Written against 2026-07-28, which removed sessions and the `initialize` handshake.
3. **Elementor 4.1 shipped a "Website Markdown" alpha exposing content as markdown for AI consumption** — potentially a shortcut for P3, and a signal Elementor is moving into this space.
4. Existing open-source Elementor MCP servers: their issue trackers are a free bug list for this design.

**Defaults open to tuning:** renderer placement (isolated, per §9.5 — not negotiable, but sizing is), IdP selection against §9.3's criteria, nativeness reporting weights.

**Pending from the team:** the workflow rules for `ralphloop.md`.
