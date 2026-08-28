# PRD: Elementor MCP Server

## Project Overview

An MCP server that lets an AI model build and edit Elementor pages, including reproducing a supplied design (prompt, screenshot, or HTML). Hybrid architecture: a thin WordPress companion plugin plus an external Node/TypeScript MCP server, with an isolated Playwright renderer.

Scope is Elementor only — pages, media, later menus. WordPress administration is out of scope.

Architecture and rationale: `solution.md`. Technical contract: `Blueprints.md`. Loop rules: `ralphloop.md`.

## Created

- **Date:** 2026-08-20
- **Author:** Claude (Sonnet 5), from design review with abdullah.shahid

---

## Blocking Decisions

Not loop tasks. These need a human and gate the tasks named.

| # | Decision | Gates |
|---|---|---|
| D1 | Reference-design ingestion — URL vs out-of-band upload (`Blueprints.md` §12.2) | EMCP-063..066, and every visual criterion until settled |
| D2 | IdP selection against `solution.md` §9.3 | EMCP-056..059. Long lead time — start now |
| D3 | ~~Approval channel for `publish_draft` (Slack recommended)~~ **RESOLVED 2026-08-28: a wp-admin approval screen** (`plugin/src/Admin/PublishApprovalPage.php`), not Slack/email — needs no new external service/credentials and satisfies "a channel the model cannot write to" for free, since this server only ever holds an Application Password, never a WordPress cookie session. See EMCP-047. | EMCP-047 (unblocked) |
| D4 | Production hosting — KMS, network segmentation, TLS | EMCP-056..059, deployment |

---

## Tasks

Detail decreases with distance. FOUNDATION through READ LAYER are specified to task level; later sections are deliberately coarse, because EMCP-008 is expected to correct assumptions about Elementor's data shapes. **Refine the next section when the current one completes.**

`Verify` is one of `unit`, `live`, or `human`. A `human` task can never be closed by the loop — see `ralphloop.md`.

### FOUNDATION

#### [x] Task 1: Docker Compose stack
- **ID:** EMCP-001
- **Depends:** —
- **Verify:** live
- **Description:** Development stack with two WordPress sandboxes covering both real forks (V4/V3 and Pro/Free).
- **File:** `docker-compose.yml`, `.env.example`
- **Acceptance Criteria:**
  - Services up: `wp-v4-pro`, `wp-v3-free`, `db-wp`, `mcp`, `db`, `renderer`, `minio`
  - `wp-v4-pro` runs Elementor Pro with V4/atomic default; `wp-v3-free` runs Elementor Free on V3 containers
  - `renderer` sits on its own network with no route to `db` or the credential store
  - A test asserts the renderer cannot reach `db` — verified, not assumed
  - One command brings the stack up from cold

#### [x] Task 2: Sandbox provisioning and reset
- **ID:** EMCP-002
- **Depends:** EMCP-001
- **Verify:** live
- **Description:** Known-state provisioning and a reset path the loop can call safely.
- **File:** `scripts/provision.sh`, `scripts/reset.sh`
- **Acceptance Criteria:**
  - Both WordPress instances provisioned with a known page set
  - Reset restores database, uploads, and `uploads/elementor/css/`
  - Reset cannot target anything but sandbox containers, proven by a test that attempts it and fails
  - Reset is idempotent

#### [x] Task 3: Plugin skeleton
- **ID:** EMCP-003
- **Depends:** EMCP-001
- **Verify:** live
- **Description:** WordPress companion plugin that activates cleanly and boots after Elementor.
- **File:** `plugin/emcp.php`, `plugin/composer.json`, `plugin/src/Plugin.php`, `plugin/uninstall.php`
- **Acceptance Criteria:**
  - Activates clean on both sandboxes with `WP_DEBUG` on, zero notices
  - PSR-4 autoload via Composer; uninstall handler removes plugin data
  - Boots after Elementor's widget registration
  - Fails gracefully with a legible admin notice when Elementor is absent

#### [x] Task 4: `GET /site` endpoint
- **ID:** EMCP-004
- **Depends:** EMCP-003
- **Verify:** live
- **Description:** Site capability reporting, which drives the compiler, renderer and fallback ladder.
- **File:** `plugin/src/Rest/SiteController.php`
- **Acceptance Criteria:**
  - Returns Elementor version, generation default, **Pro tier** (not a boolean), breakpoints, active experiments (Element Caching, Optimized Markup), CSS print method, plugin version
  - Real permission callback; cookie-authenticated requests rejected
  - Returns correct and materially different values from each sandbox

#### [x] Task 5: Node server skeleton
- **ID:** EMCP-005
- **Depends:** EMCP-001
- **Verify:** unit
- **Description:** MCP server foundation with local header auth.
- **File:** `server/src/index.ts`, `server/src/http/`, `package.json`, `tsconfig.json`
- **Acceptance Criteria:**
  - TypeScript strict, Fastify, `@modelcontextprotocol/sdk`
  - Header auth sufficient for local Claude Code
  - Structured logging with a correlation ID generated per request
  - No `any`, no `@ts-ignore`

#### [x] Task 6: MCP protocol conformance
- **ID:** EMCP-006
- **Depends:** EMCP-005
- **Verify:** unit
- **Description:** Conformance to MCP revision 2026-07-28, which removed sessions and the `initialize` handshake.
- **File:** `server/src/protocol/`
- **Acceptance Criteria:**
  - `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` headers required and validated against body `_meta`; mismatch returns `400` + `-32020`
  - `Origin` validated; `403` on invalid
  - `resultType` on every result; `ttlMs` and `cacheScope` on `tools/list`
  - Unknown method returns `404` + `-32601`; GET/DELETE return `405`
  - Error channels per `Blueprints.md` §8.1, including auth failures as **HTTP 401**, never `isError`

#### [x] Task 7: First tool — `get_site_info`
- **ID:** EMCP-007
- **Depends:** EMCP-004, EMCP-006
- **Verify:** live
- **Description:** First end-to-end tool proving the whole path.
- **File:** `server/src/tools/getSiteInfo.ts`
- **Acceptance Criteria:**
  - Works end-to-end from Claude Code against both sandboxes
  - `outputSchema` declared; deterministic ordering; `cacheScope: private`
  - Description states when to use and when not to

#### [x] Task 8: Capture golden fixtures ⚠️
- **ID:** EMCP-008
- **Depends:** EMCP-002
- **Verify:** human
- **Description:** The first point where the design meets evidence. Everything in the design documents so far is reasoned from Elementor's documentation, not verified against a real install.
- **File:** `tests/fixtures/*.json`, `tests/fixtures/README.md`
- **Acceptance Criteria:**
  - All ten fixtures from `Blueprints.md` §9.1 captured from real Elementor, each with a provenance header (Elementor version, plugin list, capture date)
  - Captured shapes compared against `Blueprints.md` §3.2 and §5
  - **Any discrepancy is a blueprint bug** — record it in `progress.md` and mark NEEDS-REVIEW. Corrections mean this task succeeded, not failed
  - Do not adjust code to match a fixture until a human has confirmed which is wrong

#### [x] Task 9: Fixture immutability guard
- **ID:** EMCP-009
- **Depends:** EMCP-008
- **Verify:** unit
- **Description:** Prevents the loop from silently regenerating fixtures from its own compiler output.
- **File:** `tests/fixtures/hashes.json`, `tests/unit/fixtures.test.ts`
- **Acceptance Criteria:**
  - Fixtures hash-checked; suite fails if any changed without a signed update
  - A test proves the guard actually fires on a modified fixture

#### [x] Task 10: Freeze plugin REST contract v1
- **ID:** EMCP-010
- **Depends:** EMCP-004
- **Verify:** unit
- **Description:** Version negotiation so server and plugin can deploy independently.
- **File:** `plugin/src/Rest/`, `server/src/wp/contract.ts`, `Blueprints.md` §6
- **Acceptance Criteria:**
  - Routes versioned in path (`/wp-json/emcp/v1`)
  - Server declares a minimum plugin version; `get_site_info` reports the installed version
  - Mismatch fails loudly at connect time with an actionable message

#### [x] Task 11: Verification harness split
- **ID:** EMCP-011
- **Depends:** EMCP-005
- **Verify:** unit
- **Description:** The two harnesses the loop depends on for its definition of done.
- **File:** `package.json`, `vitest.config.ts`, `scripts/verify-live.sh`
- **Acceptance Criteria:**
  - `verify:unit` runs with no network access
  - `verify:live` requires sandboxes and fails with a clear message when they are down
  - Both emit machine-readable pass/fail
  - PHP tests runnable via PHPUnit

#### [x] Task 12: Local development documentation
- **ID:** EMCP-012
- **Depends:** EMCP-001, EMCP-011
- **Verify:** human
- **Description:** `README.md` as the entry point a fresh loop iteration can follow with no prior context.
- **File:** `README.md`
- **Acceptance Criteria:**
  - Covers bring-up, provisioning, reset, both harnesses, and connecting Claude Code
  - A person following it from a clean checkout reaches a working `get_site_info` call

### REGISTRY AND CREDENTIALS

#### [x] Task 13: Database schema and migrations
- **ID:** EMCP-013
- **Depends:** EMCP-005
- **Verify:** unit
- **File:** `server/src/db/schema.ts`, `server/drizzle/`
- **Acceptance Criteria:**
  - Tables: sites, grants, credentials, ledger index, idempotency keys, approval tokens, preview nonces
  - Every table holding site-scoped data carries the site in its index
  - Migrations run forward and are reversible

#### [x] Task 14: Site registry
- **ID:** EMCP-014
- **Depends:** EMCP-013
- **Verify:** unit
- **File:** `server/src/registry/`
- **Acceptance Criteria:**
  - Site record: unguessable slug, URL, generation default, environment (`sandbox` | `client`), plugin version
  - No tool can mutate the registry
  - Slugs are not sequential or guessable

#### [x] Task 15: Credential encryption
- **ID:** EMCP-015
- **Depends:** EMCP-013
- **Verify:** unit
- **File:** `server/src/credentials/`
- **Acceptance Criteria:**
  - Envelope encryption, per-site DEK, KEK sourced from outside the database
  - Credentials never logged, never in tool output, never in ledger arguments
  - A test asserts a credential value cannot reach any log sink

#### [x] Task 16: Grant resolution
- **ID:** EMCP-016
- **Depends:** EMCP-014
- **Verify:** unit
- **File:** `server/src/auth/grants.ts`
- **Acceptance Criteria:**
  - Credentials resolved from `(subject, site)` with **no fallback credential**
  - Missing grant returns 403 before any outbound request
  - A test requests a site the subject lacks and asserts no outbound call is made

#### [x] Task 17: `GET /registry/snapshot`
- **ID:** EMCP-017
- **Depends:** EMCP-003
- **Verify:** live
- **File:** `plugin/src/Rest/RegistryController.php`
- **Acceptance Criteria:**
  - Returns the full curated widget and control schema
  - Forces control-stack initialisation; bootstraps Elementor context explicitly so Pro and third-party widgets are visible
  - Reports the materially different registries of the two sandboxes

#### [x] Task 18: Committed snapshots and drift check
- **ID:** EMCP-018
- **Depends:** EMCP-017, EMCP-011
- **Verify:** unit
- **File:** `tests/snapshots/`, CI config
- **Acceptance Criteria:**
  - One snapshot committed per sandbox configuration, with provenance
  - A job re-pulls and diffs, failing loudly on drift
  - Failure message states that drift means Elementor changed and must be investigated, never re-pulled away

### READ LAYER

#### [x] Task 19: Generation detection
- **ID:** EMCP-019
- **Depends:** EMCP-009
- **Verify:** unit
- **File:** `server/src/domain/detect.ts`
- **Acceptance Criteria:**
  - Per-node detection keyed on `widgetType` `e-` prefix plus presence of `styles`/`version` — never `elType` alone
  - Correct across all fixtures including both mixed ones
  - A test proves an `e-heading` is not misrouted into the V3 widget path

#### [x] Task 20: Normalized digest shape
- **ID:** EMCP-020
- **Depends:** EMCP-019
- **Verify:** unit
- **File:** `server/src/domain/digest.ts`
- **Acceptance Criteria:**
  - One shape across all generations per `Blueprints.md` §5
  - Nested-widget children (Nested Tabs) traversed correctly
  - Fixture assertions for legacy, v3, v4 and both mixed cases

#### [x] Task 21: Label resolution and sanitisation
- **ID:** EMCP-021
- **Depends:** EMCP-020
- **Verify:** unit
- **File:** `server/src/domain/label.ts`
- **Acceptance Criteria:**
  - Navigator title → first text-bearing setting → type name
  - Markup, newlines and zero-width characters stripped; truncated to 40 characters
  - A fixture containing instruction-shaped text is neutralised rather than passed through

#### [x] Task 22: Depth limiting
- **ID:** EMCP-022
- **Depends:** EMCP-020
- **Verify:** unit
- **File:** `server/src/domain/digest.ts`
- **Acceptance Criteria:**
  - `truncated` counts correct against the `deep-nested` fixture
  - Depth limit configurable per call with a sane default

#### [x] Task 23: `list_pages`
- **ID:** EMCP-023
- **Depends:** EMCP-007
- **Verify:** live
- **File:** `server/src/tools/listPages.ts`, `plugin/src/Rest/DocumentsController.php`

#### [x] Task 24: `get_page_structure`
- **ID:** EMCP-024
- **Depends:** EMCP-022, EMCP-023
- **Verify:** live
- **File:** `server/src/tools/getPageStructure.ts`
- **Acceptance Criteria:**
  - **≤ 4,000 tokens at depth 3 across the fixture set, measured with `count_tokens`** — a number, not a judgement
  - Returns element IDs and `document_hash`
  - Element IDs are stable across saves

#### [x] Task 25: `get_element`
- **ID:** EMCP-025
- **Depends:** EMCP-024
- **Verify:** live
- **File:** `server/src/tools/getElement.ts`

#### [x] Task 26: `find_elements`
- **ID:** EMCP-026
- **Depends:** EMCP-024
- **Verify:** live
- **File:** `server/src/tools/findElements.ts`
- **Acceptance Criteria:**
  - Search by widget type and by text content
  - Returns enough per match to skip a follow-up `get_element` in the common case

#### [x] Task 27: `list_widgets`
- **ID:** EMCP-027
- **Depends:** EMCP-017
- **Verify:** live
- **File:** `server/src/tools/listWidgets.ts`
- **Acceptance Criteria:**
  - Never calls `get_controls()` across the registry — a test asserts the cost
  - Returns different vocabularies from the two sandboxes

#### [x] Task 28: `describe_widget`
- **ID:** EMCP-028
- **Depends:** EMCP-027
- **Verify:** live
- **File:** `server/src/tools/describeWidget.ts`, `server/src/domain/curation.ts`
- **Acceptance Criteria:**
  - `detail` parameter (`common` | `full` | `section:<tab>`) defaulting to `common`
  - Curated allowlist per widget type; responsive variants stated once, never enumerated
  - Hard output cap with a "call again for the rest" affordance
  - Honours control `condition` / `conditions`
  - `common` output for a Pro widget stays within a stated token budget

#### [x] Task 29: `get_global_styles`
- **ID:** EMCP-029
- **Depends:** EMCP-004
- **Verify:** live
- **File:** `server/src/tools/getGlobalStyles.ts`, `plugin/src/Rest/KitController.php`
- **Acceptance Criteria:**
  - Kit colours, fonts, typography presets. Read-only
  - V4 sandbox additionally reports global classes and variables

#### [x] Task 30: V4 authoring spike ⚠️
- **ID:** EMCP-030
- **Depends:** EMCP-008
- **Verify:** human
- **Description:** Timeboxed investigation, not production code. Determines whether `Blueprints.md` §3.2's v4 column is a design or a plan.
- **File:** `spikes/v4-authoring/`, `progress.md`
- **Acceptance Criteria:**
  - One V4 page produced programmatically: `e-flexbox`, one `e-heading`, one `e-button`, local `styles`, one responsive override
  - Deliverable is a written sizing estimate and a list of unknowns
  - Stop at the timebox regardless of completeness and record what was learned

### RENDERING

Coarse until READ LAYER completes.

#### [x] Task 31: Renderer service
- **ID:** EMCP-031 · **Depends:** EMCP-001 · **Verify:** live
- Playwright service, isolated network, no credential or KMS access

#### [x] Task 32: Egress filtering
- **ID:** EMCP-032 · **Depends:** EMCP-031 · **Verify:** unit
- Connect-time filtering, re-checked after every redirect; RFC1918/loopback/link-local rejected; non-http(s) schemes blocked; fresh browser context per render

#### [x] Task 33: `POST /preview-token`
- **ID:** EMCP-033 · **Depends:** EMCP-003 · **Verify:** live
- Signed, single-post, single-use, short TTL, own `read_post` gating, issuance and redemption logged

#### [x] Task 34: `render_preview`
- **ID:** EMCP-034 · **Depends:** EMCP-032, EMCP-033 · **Verify:** live
- `resource_link` by default, region-scoped capture, `.elementor-{post_id}`, font and lazy-image settling, one image per call, never SVG

#### [x] Task 35: Cache invalidation before capture
- **ID:** EMCP-035 · **Depends:** EMCP-034 · **Verify:** live
- Element Cache and CSS invalidated and warmed, or the loop grades stale HTML

### SAFETY RING

#### [x] Task 36: Structural validation
- **ID:** EMCP-036 · **Depends:** EMCP-018 · **Verify:** unit
- Widget exists on this site, settings keys real, control conditions honoured, errors carry a JSON path

#### [x] Task 37: Snapshot capture and restore
- **ID:** EMCP-037 · **Depends:** EMCP-003 · **Verify:** live
- Records whether it captured parent or autosave; restore uses `wp_slash( wp_json_encode( … ) )`; passes the unicode round-trip fixture

#### [x] Task 38: Ledger
- **ID:** EMCP-038 · **Depends:** EMCP-013, EMCP-037 · **Verify:** unit
- Index rows in Node, snapshot payloads in WordPress; args allowlisted in, never denylisted out; correlation IDs recorded

#### [x] Task 39: `list_changes` and bounded `rollback`
- **ID:** EMCP-039 · **Depends:** EMCP-038 · **Verify:** live
- Bounded ranges, never crossing a site boundary, snapshotted before running

#### [x] Task 40: Prove the safety ring on a minimal write ⚠️
- **ID:** EMCP-040 · **Depends:** EMCP-036..039 · **Verify:** live
- `update_element` on a single text field, end to end, with a verified rollback. This is the test vehicle that resolves the ordering rule. **No task after this may ship a mutating tool until this is DONE.**

### WRITE LAYER

#### [x] Task 41: Document hash compare-and-swap
- **ID:** EMCP-041 · **Depends:** EMCP-040 · **Verify:** live
- Computed server-side over element tree plus page settings; CAS inside the write request; write returns the new hash

#### [x] Task 42: Post lock refusal
- **ID:** EMCP-042 · **Depends:** EMCP-041 · **Verify:** live
- `wp_check_post_lock()` consulted; refuses when a human is editing

#### [x] Task 43: `edit_elements`
- **ID:** EMCP-043 · **Depends:** EMCP-041 · **Verify:** live
- Flat operation items with `op` enum, not `oneOf`; `maxItems`; validate-all-then-apply; one document save; transaction semantics stated in the error text

#### [x] Task 44: Idempotency keys
- **ID:** EMCP-044 · **Depends:** EMCP-043 · **Verify:** unit
- Scoped to `(subject, site)`, expiring; a repeat key returns the prior result

#### [x] Task 45: Autosave and revision mechanics
- **ID:** EMCP-045 · **Depends:** EMCP-043 · **Verify:** live
- Published pages write an autosave revision; `?source=autosave|parent`; preview reads the autosave
- Done: `PUT /documents/{id}` resolves a published post's target to its live autosave (creating one via `Document::get_autosave(0, true)` if needed) before hashing/merging/saving, and returns `source`; `edit_elements` (Node) determines the same source for its structural-validation read and pre-write snapshot. `SnapshotService::capture()`/`restore()` are both fully autosave-aware — capture creates an autosave on demand and reads `page_settings` from the right owner; restore resolves its write target from the snapshot's own recorded `source`. Found and fixed a real WP-core gotcha along the way: `update_post_meta()` silently redirects a revision (autosave) post id to its parent, so `restore()` now writes via `update_metadata()` directly — added to `CLAUDE.md`. Live-verified end to end on `wp-v4-pro` (edit → autosave created, parent untouched → second edit reuses the same autosave → snapshot capture/restore round-trips correctly on the autosave alone). `render_preview` reading the autosave for a published page remains explicitly out of scope, same as EMCP-034 already flagged.

#### [x] Task 46: `create_page` and `update_page`
- **ID:** EMCP-046 · **Depends:** EMCP-045 · **Verify:** live
- Sets `_elementor_edit_mode` and required meta; page template explicit
- Done: `POST /documents` (new route, `DocumentsController::create()`) always creates a `draft`, modelled on Elementor's own `modules/mcp/abilities/create-page-ability.php` — introspects `post_type_supports($type,'elementor')` and `get_post_type_object($type)->cap->create_posts`, calls `Document::set_is_built_with_elementor(true)` + `save(['elements'=>[]])` so all required meta (`_elementor_edit_mode`/`_elementor_template_type`/`_elementor_version`) is real immediately, and writes `_wp_page_template` explicitly, validated against the live-introspected `wp_get_theme()->get_page_templates()`. `PUT /documents/{id}/page` (new route, `update_attributes()`) updates title/page_template on an existing document — deliberately separate from `edit_elements`'s `PUT /documents/{id}` contract and never autosave-branched, since a page template is a live post attribute with no draft concept, unlike element content. Node: `create_page`/`update_page` MCP tools (`server/src/tools/{createPage,updatePage}.ts`), `wp/client.ts`'s `createDocument()`/`updateDocumentAttributes()`. `create_page` supports `idempotency_key` (reusing EMCP-044's store) since, unlike `edit_elements`, a repeat call is a real duplicate, not a no-op. Live-verified end to end through the real `/mcp` endpoint: created a page and fed its `post_id` straight into `get_page_structure`; confirmed idempotency-key replay returns the same page id via `list_pages`; `update_page` changed title+template on a *published* post with `document_hash`/elements unaffected; template/post_type validation rejected bad values. 273/273 unit tests (up from 246), PHPUnit unchanged 17/17.

#### [x] Task 47: `publish_draft`
- **ID:** EMCP-047 · **Depends:** EMCP-045, **D3** · **Verify:** live
- Promotes autosave onto parent; requires an out-of-band confirmation token bound to `(site, post_id, content_hash)`
- Done: D3 resolved (wp-admin approval screen, see decision table). New `plugin/src/Approvals/{ApprovalTokenSigner,ApprovalTokenService}.php` (mirrors `PreviewTokenService`'s HMAC+nonce-table pattern, plus a `chash` content-binding claim `redeem()` enforces as a 409 on mismatch), `plugin/src/Admin/PublishApprovalPage.php` (the one cookie/nonce-auth-only page in the plugin — unreachable via the Application Password this server's own REST calls use), `plugin/src/Documents/PublishService.php` (shared source-resolution + the two-branch promote: `wp_publish_post()` for a never-published draft, `copy_elementor_meta()` autosave→parent for an already-published page's pending edits). New route `POST /documents/{id}/publish`. Node: `publish_draft` MCP tool (`server/src/tools/publishDraft.ts`), `wp/client.ts`'s `publishDraft()`, ledger-wired (`approvalTokenRef` is a SHA-256 of the token, never the raw value). Live-verified end to end through the real `/mcp` endpoint with a genuine wp-admin cookie login (not just the REST API): both promote branches, single-use enforcement, and the content-hash binding correctly rejecting a token whose target content changed after approval. Found and fixed a real gotcha along the way: a plugin's `register_activation_hook()` doesn't re-run just from editing files on an already-active install — added to `CLAUDE.md`. 290/290 unit tests (up from 273), PHPUnit 27/27 (up from 17).

### DSL AND COMPILER

#### [x] Task 48: Grammar and schema
- **ID:** EMCP-048 · **Depends:** EMCP-030 · **Verify:** unit
- `Blueprints.md` §2; `dslVersion` enforced; unknown versions refused
- Done: `server/src/dsl/types.ts` (pure TS types for the whole §2 grammar) + `server/src/dsl/validate.ts`'s `parseSpec()` (hand-rolled, not Zod — see Blueprints.md §3's note on why, matching this codebase's actual established practice over the stack table). `dslVersion` enforced (missing/non-integer/unsupported all refused with `DSL_VERSION_UNSUPPORTED`), every node type checked against §2.3's real set (`NODE_TYPE_UNKNOWN`), every type's required fields per §2.3's table (`NODE_FIELD_MISSING`), §2.8's `reason`-required rule for `raw`/`html` enforced once (`REASON_REQUIRED`). Reuses `domain/validate.ts`'s `Diagnostic` shape — one diagnostic vocabulary end to end. Deliberately does not validate anything requiring `siteProfile` (widget existence, breakpoint names, token resolution) — that's the compiler's job (EMCP-049+), stated as an explicit scope boundary in the module docblock and Blueprints.md §3. New error codes (`SPEC_MALFORMED`, `NODE_TYPE_UNKNOWN`, `NODE_FIELD_MISSING`, `REASON_REQUIRED`) added to Blueprints.md §8.2 in the same pass. 36 new unit tests, `verify:unit` unaffected elsewhere (no live dependency — this task never touches WordPress).

#### [x] Task 49: Compiler core
- **ID:** EMCP-049 · **Depends:** EMCP-048 · **Verify:** unit
- Pure and synchronous with `siteProfile` injected; invariants from §3.3
- Done: `server/src/dsl/compile.ts`'s `compile(spec, siteProfile)`. Owns the orchestration §3.3's invariants require — whole-tree unique 7-char-hex ID generation, recursive walk, diagnostic aggregation, `nativeness`/`rawRatio`, required `docMeta` — via a pluggable `registerEmitter(nodeType, generation, emitter)` registry that EMCP-050/051 populate with the real v3/v4 DSL→native mapping tables (deliberately not this task's job). Ships one real, working emitter itself: `widget` (§2.3's escape rung, §3.2's own "generation-agnostic passthrough" case), with a genuine `WIDGET_NOT_AVAILABLE` check against `siteProfile.widgetRegistry`. Every other node type currently reports `EMISSION_NOT_IMPLEMENTED` (new code, added to Blueprints.md §8.2) until EMCP-050/051 register real emitters — expected, not a gap. `siteProfile.generation` typed `'v3'|'v4'` only (never `'legacy'` — §5.1: legacy is create-never). All-or-nothing, matching EMCP-048's `parseSpec()`: any node's failure empties the whole result. 15 new unit tests.

#### [x] Task 50: v3 emission
- **ID:** EMCP-050 · **Depends:** EMCP-049 · **Verify:** unit
- Done: `server/src/dsl/v3.ts` registers real emitters (`container`, `heading`, `text`, `button`, `icon`, `image`, `spacer`, `divider`, `shortcode`, `html`) against `compile.ts`'s registry. Every setting key/value shape confirmed against live-introspected control names (`GET /widgets/{type}` on `wp-v4-pro`) and the committed fixtures — never guessed. `grid`/`list`/`video` deliberately left `EMISSION_NOT_IMPLEMENTED`, each for a specific, documented reason (no introspectable control names / repeater-shape mismatch / URL-type detection needed). `layout.width` (non-full/boxed) and `image.alt` warn rather than silently drop when no confirmed mapping exists. 23 new unit tests, several asserting exact equality against real fixture values.

#### [x] Task 51: v4 emission
- **ID:** EMCP-051 · **Depends:** EMCP-049, EMCP-030 · **Verify:** unit
- Nested typed props, local `styles` array, per-element `version`
- Done: `server/src/dsl/v4.ts` registers emitters for `container`(→e-flexbox), `heading`, `text`(→e-paragraph), `button`, `image`, `divider`. Ground truth via direct PHP source reads (atomic widgets' `define_props_schema()`, `style-schema.php`) since `GET /widgets/{type}` doesn't introspect atomic widgets (CLAUDE.md gotcha) — never inferred from v3. Recursive `$$type`/`value` wrapping confirmed from `Plain_Prop_Type`/`Object_Prop_Type`'s own validate() source. Found and fixed a real design gap in `compile.ts` (EMCP-049): v4's local-class name needs the element's own id, but core generated ids *after* calling the emitter — fixed by generating first, passing via new `EmitContext.elementId`. Local styles (desktop-only, no responsive — EMCP-052's job) built for `layout`'s flex/spacing properties. `grid`/`icon`/`list`/`spacer`/`shortcode`/`html`/`video`/`style` object/`link` all deliberately deferred, each for a specific documented reason (confirmed live: v4 has no icon/spacer widget at all). `image.alt` **is** supported on v4, unlike v3. 22 new unit tests caught one real bug (an early `container` emitter draft always emitted `classes` even when unneeded) before it shipped.

#### [x] Task 52: Responsive
- **ID:** EMCP-052 · **Depends:** EMCP-050, EMCP-051 · **Verify:** unit
- **In this section, not later.** Widescreen `min-width` inversion covered by its own fixture
- Done: `compile.ts`'s new `validateBreakpoint()` (exported, shared by both generations) checks `responsive` keys against the real `siteProfile.breakpoints` shape (confirmed live: `desktop` absent — never itself configurable; a real-but-disabled breakpoint treated as unknown too). v3 (`container` only, matching its existing `layout`-only scope) emits `_<breakpoint>`-suffixed settings keys; v4 (every emitter) appends one more `{meta,props,custom_css}` entry to the same flat `variants` array. Confirmed against `responsive-widescreen.json`'s own provenance note: `min`-vs-`max` direction is Elementor's own CSS-generation concern, not something the compiler's *output shape* needs to branch on — widescreen needs no special-casing in either generation. 13 new unit tests.

#### [x] Task 53: `raw` supervision
- **ID:** EMCP-053 · **Depends:** EMCP-049 · **Verify:** unit
- Deep merge, reserved-key denylist, value sanitisation, mandatory `reason`, `raw_ratio` reported
- Done: `server/src/dsl/raw.ts`'s `mergeRaw()`, wired centrally into `compile.ts` after every emitter runs (mechanics don't vary by generation, only where the result lands — `settings`). Real recursive deep merge (raw wins on conflicts); denylist (`__globals__`/`__dynamic__`/`_element_id` universal, plus v4-only `classes` since `v4.ts` owns that key for style linkage) checked at every nesting depth; all five §8.3 sanitisation rules applied to every string value in the tree. Every violation is a hard error (all-or-nothing, matching `dslVersion`/`parseSpec`) except the external-URL rule, genuinely a warning per the spec's own wording. `reason`/`raw_ratio` were already done (EMCP-048/049) and untouched here. 27 new unit tests, including end-to-end `compile()` tests through the real v3/v4 emitters.

#### [x] Task 54: Decompiler and round-trip
- **ID:** EMCP-054 · **Depends:** EMCP-050, EMCP-051 · **Verify:** unit
- Semantic equivalence, never byte equality
- Done: `server/src/dsl/decompile.ts`'s `decompile(nativeElements, siteProfile) → {elements, diagnostics}` inverts the exact same confirmed shapes v3.ts/v4.ts already forward-map — no new research needed. Reuses `domain/detect.ts`'s `detectNodeGeneration()` for dispatch. Never hard-fails (every diagnostic warning/info, never error) — unrecognized widgetType falls back to the lossless `widget` escape rung; legacy sections/unrecognized elTypes fall back to `container`+`raw` (still denylist/sanitisation-checked going back through `compile()`). Unconsumed settings on a recognized node preserved via `raw`, not dropped. 24 unit tests, including 3 genuine round-trip tests through the real committed fixture set (v3-container, deep-nested's 5-level depth, unicode-roundtrip's exact Arabic/CJK content) — not just hand-crafted data.

#### [ ] Task 55: `validate_page_spec` and `apply_page_spec`
- **ID:** EMCP-055 · **Depends:** EMCP-052, EMCP-053 · **Verify:** live
- `dry_run` a structurally separate code path incapable of writing; nativeness and `raw_ratio` reported as warnings with itemised offending nodes

### OAUTH AND REMOTE CONNECTOR

Gated on D2 and D4.

#### [ ] Task 56: Protected Resource Metadata
- **ID:** EMCP-056 · **Depends:** D2 · **Verify:** unit
#### [ ] Task 57: 401 challenge and audience validation
- **ID:** EMCP-057 · **Depends:** EMCP-056 · **Verify:** unit
#### [ ] Task 58: Scopes
- **ID:** EMCP-058 · **Depends:** EMCP-057 · **Verify:** unit
- `pages:read`, `pages:write`, `pages:publish`, `media:write`
#### [ ] Task 59: Per-site connector URLs, Claude.ai end to end
- **ID:** EMCP-059 · **Depends:** EMCP-058, D4 · **Verify:** human

### TEMPLATES

#### [ ] Task 60: `list_templates` and `save_as_template`
- **ID:** EMCP-060 · **Depends:** EMCP-054 · **Verify:** live
- Stores specs, not frozen native JSON
#### [ ] Task 61: `apply_template`
- **ID:** EMCP-061 · **Depends:** EMCP-060 · **Verify:** live
- Regenerates element IDs
#### [ ] Task 62: Cross-sandbox portability
- **ID:** EMCP-062 · **Depends:** EMCP-061 · **Verify:** live
- `dry_run` reports missing widgets when a Pro-authored template targets the Free sandbox

### INGESTION AND COMPARISON

Gated on D1.

#### [ ] Task 63: `upload_media` and `list_media`
- **ID:** EMCP-063 · **Depends:** EMCP-004 · **Verify:** live
- Content-derived MIME validation; category-based denial, not SVG alone; decoded pixel caps; EXIF stripped; unique filenames
#### [ ] Task 64: `upload_reference_design`
- **ID:** EMCP-064 · **Depends:** D1 · **Verify:** live
#### [ ] Task 65: `extract_design_tokens`
- **ID:** EMCP-065 · **Depends:** EMCP-029 · **Verify:** live
- Perceptual colour distance, not string comparison; reconciles against existing kit tokens
#### [ ] Task 66: `compare_to_reference`
- **ID:** EMCP-066 · **Depends:** EMCP-064, EMCP-035 · **Verify:** live
- Returns ranked regions and numbers, not pictures

---

## Success Metrics

- A real Elementor page of any generation is fully described in **≤ 4,000 tokens at depth 3**, measured with `count_tokens`
- Every write is reversible: read → mutate → rollback → re-read matches the original byte for byte, including unicode
- `verify:unit` runs green with no network; `verify:live` runs green against both sandboxes
- A malformed spec is rejected with a JSON path, the allowed values, and a suggested fix — never a partial write
- A page built by the model scores **≥ 90% nativeness** on the Pro sandbox with no `html` nodes
- A Pro-authored template applied to the Free sandbox fails in `dry_run` naming every missing widget
- Elementor's own editor opens any page this server wrote without warnings or visual corruption
- No credential, integration secret, or client content ever appears in logs or ledger arguments

---

## Notes

- **`ralphloop.md` governs execution.** Read it before starting. In particular: never commit, never run destructive git commands, and never mark a `human` task complete.
- **EMCP-008 is the project's first contact with reality.** Every claim in `solution.md` and `Blueprints.md` about Elementor's data shapes is reasoned from documentation. Expect corrections there and treat them as the task succeeding.
- **EMCP-040 is a hard gate.** No mutating tool ships before it is DONE. This ordering exists because a malformed `_elementor_data` write produces a blank page with no PHP error, and debugging every later task against a corrupted database is the failure mode this plan is built to avoid.
- **Elementor gotchas live in `CLAUDE.md`.** Read it every iteration; add to it whenever an iteration pays for a new lesson.
- Later sections are deliberately coarse. Refine the next section when the current one completes, using what EMCP-008 and EMCP-030 taught.
