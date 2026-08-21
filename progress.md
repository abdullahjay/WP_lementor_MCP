# Progress: Elementor MCP Server

## Overview
- **PRD:** prd.md
- **Started:** 2026-08-20
- **Status:** 🚧 **IN PROGRESS** — EMCP-001 underway

---

## Task Progress

| Task ID | Task Name | Status | Started | Completed | Notes |
|---------|-----------|--------|---------|-----------|-------|
| EMCP-001 | Docker Compose stack | ✅ COMPLETED | 2026-08-20 | 2026-08-20 | All 8 containers healthy; isolation test passes (renderer blocked from db/db-wp, reaches both WP apps); down/up cycle verified from cold |
| EMCP-002 | Sandbox provisioning and reset | ✅ COMPLETED | 2026-08-20 | 2026-08-20 | Both sandboxes provisioned; reset guard 7/7; reset verified idempotent; Elementor Pro pending zip (recorded, not blocking) |
| EMCP-003 | Plugin skeleton | ✅ COMPLETED | 2026-08-21 | 2026-08-21 | Activates clean on both sandboxes, WP_DEBUG on, zero notices; verified live |
| EMCP-004 | `GET /site` endpoint | ✅ COMPLETED | 2026-08-21 | 2026-08-21 | Verified live on both sandboxes incl. 401/403/200 paths; generation_default correctly differs v4 vs v3 |
| EMCP-005 | Node server skeleton | ✅ COMPLETED | 2026-08-21 | 2026-08-21 | verify:unit green (type-check+lint+test); live smoke test of built server also passed |
| EMCP-006 | MCP protocol conformance | NOT STARTED | | | |
| EMCP-007 | First tool — `get_site_info` | NOT STARTED | | | |
| EMCP-008 | Capture golden fixtures ⚠️ | NOT STARTED | | | Human-verified. Expect blueprint corrections |
| EMCP-009 | Fixture immutability guard | NOT STARTED | | | |
| EMCP-010 | Freeze plugin REST contract v1 | NOT STARTED | | | |
| EMCP-011 | Verification harness split | NOT STARTED | | | |
| EMCP-012 | Local development documentation | NOT STARTED | | | Human-verified |
| EMCP-013 | Database schema and migrations | NOT STARTED | | | |
| EMCP-014 | Site registry | NOT STARTED | | | |
| EMCP-015 | Credential encryption | NOT STARTED | | | |
| EMCP-016 | Grant resolution | NOT STARTED | | | |
| EMCP-017 | `GET /registry/snapshot` | NOT STARTED | | | |
| EMCP-018 | Committed snapshots and drift check | NOT STARTED | | | |
| EMCP-019 | Generation detection | NOT STARTED | | | |
| EMCP-020 | Normalized digest shape | NOT STARTED | | | |
| EMCP-021 | Label resolution and sanitisation | NOT STARTED | | | |
| EMCP-022 | Depth limiting | NOT STARTED | | | |
| EMCP-023 | `list_pages` | NOT STARTED | | | |
| EMCP-024 | `get_page_structure` | NOT STARTED | | | Token budget is a measured criterion |
| EMCP-025 | `get_element` | NOT STARTED | | | |
| EMCP-026 | `find_elements` | NOT STARTED | | | |
| EMCP-027 | `list_widgets` | NOT STARTED | | | |
| EMCP-028 | `describe_widget` | NOT STARTED | | | |
| EMCP-029 | `get_global_styles` | NOT STARTED | | | |
| EMCP-030 | V4 authoring spike ⚠️ | NOT STARTED | | | Timeboxed. Human-verified |
| EMCP-031 | Renderer service | NOT STARTED | | | |
| EMCP-032 | Egress filtering | NOT STARTED | | | |
| EMCP-033 | `POST /preview-token` | NOT STARTED | | | |
| EMCP-034 | `render_preview` | NOT STARTED | | | |
| EMCP-035 | Cache invalidation before capture | NOT STARTED | | | |
| EMCP-036 | Structural validation | NOT STARTED | | | |
| EMCP-037 | Snapshot capture and restore | NOT STARTED | | | |
| EMCP-038 | Ledger | NOT STARTED | | | |
| EMCP-039 | `list_changes` and bounded `rollback` | NOT STARTED | | | |
| EMCP-040 | Prove safety ring on minimal write ⚠️ | NOT STARTED | | | **Hard gate** — no mutating tool before this |
| EMCP-041 | Document hash compare-and-swap | NOT STARTED | | | |
| EMCP-042 | Post lock refusal | NOT STARTED | | | |
| EMCP-043 | `edit_elements` | NOT STARTED | | | |
| EMCP-044 | Idempotency keys | NOT STARTED | | | |
| EMCP-045 | Autosave and revision mechanics | NOT STARTED | | | |
| EMCP-046 | `create_page` and `update_page` | NOT STARTED | | | |
| EMCP-047 | `publish_draft` | NOT STARTED | | | Blocked on D3 |
| EMCP-048 | DSL grammar and schema | NOT STARTED | | | |
| EMCP-049 | Compiler core | NOT STARTED | | | |
| EMCP-050 | v3 emission | NOT STARTED | | | |
| EMCP-051 | v4 emission | NOT STARTED | | | |
| EMCP-052 | Responsive | NOT STARTED | | | Must not slip to a later section |
| EMCP-053 | `raw` supervision | NOT STARTED | | | |
| EMCP-054 | Decompiler and round-trip | NOT STARTED | | | |
| EMCP-055 | `validate_page_spec` / `apply_page_spec` | NOT STARTED | | | |
| EMCP-056 | Protected Resource Metadata | NOT STARTED | | | Blocked on D2 |
| EMCP-057 | 401 challenge and audience validation | NOT STARTED | | | Blocked on D2 |
| EMCP-058 | Scopes | NOT STARTED | | | Blocked on D2 |
| EMCP-059 | Per-site URLs, Claude.ai end to end | NOT STARTED | | | Blocked on D2, D4. Human-verified |
| EMCP-060 | `list_templates` / `save_as_template` | NOT STARTED | | | |
| EMCP-061 | `apply_template` | NOT STARTED | | | |
| EMCP-062 | Cross-sandbox portability | NOT STARTED | | | |
| EMCP-063 | `upload_media` / `list_media` | NOT STARTED | | | |
| EMCP-064 | `upload_reference_design` | NOT STARTED | | | Blocked on D1 |
| EMCP-065 | `extract_design_tokens` | NOT STARTED | | | |
| EMCP-066 | `compare_to_reference` | NOT STARTED | | | Blocked on D1 |

---

## Summary
- **Total Tasks:** 66
- **Completed:** 5
- **In Progress:** 0
- **Not Started:** 61

---

## Blocked Decisions

Not loop tasks — these need a human.

| # | Decision | Gates | Status |
|---|---|---|---|
| D1 | Reference-design ingestion — URL vs out-of-band upload | EMCP-064, EMCP-066, all visual criteria | OPEN |
| D2 | IdP selection against `solution.md` §9.3 | EMCP-056..059 | OPEN — long lead time, start now |
| D3 | Approval channel for `publish_draft` | EMCP-047 | OPEN |
| D4 | Production hosting — KMS, segmentation, TLS | EMCP-059, deployment | OPEN — phases 0–6 run on local Compose |

---

## Log

### 2026-08-20
- Design phase complete. `solution.md`, `Blueprints.md`, `ralphloop.md`, `prd.md`, `CLAUDE.md` written.
- `solution.md` revised after four independent technical reviews (Elementor domain, MCP protocol, security, delivery risk). Material corrections:
  - **V4 is GA and default for new installs since April 2026** — the create-path decision was inverted from "V3 containers only" to "the site's own generation".
  - **V4 detection must key on `widgetType`, not `elType`** — atomic content widgets are still `elType: widget`. Detecting on `elType` would silently corrupt nodes.
  - **V4 typed props nest** — flat `{$$type, value}` assumptions drop content.
  - **Draft-first on published pages means autosave revisions**, a second write path entirely.
  - **Capability-gated `tools/list` is not implementable** under MCP 2026-07-28; resolved by per-site connector URLs, which also binds sessions to one site and fixes the OAuth audience model.
  - **Prompt injection was unaddressed** and is the system's largest risk; §9.1 added.
  - **Nativeness demoted from a build gate to a warning** — as a gate it rewards one large HTML blob over several small ones.
- PRD written: 66 tasks across ten sections. Detail decreases with distance by design.
- GitHub issues/project setup attempted, then set aside at the user's direction ("just start developing our project") to prioritize implementation. State left mid-cleanup: repo `abdullahjay/WP_lementor_MCP` has a project "Elementor MCP" (#2, renamed from a pre-existing "ELementor MCP", now carries a Module single-select field) plus a duplicate project #3 not yet deleted, and 3 test issues (EMCP-001..003) whose body text has a known em-dash encoding bug. None of this blocks implementation; revisit when convenient.
- **EMCP-001 — Docker Compose stack — DONE.** Wrote `docker-compose.yml`, `.env.example`, `scripts/db-wp-init.sh`, `scripts/test-renderer-isolation.sh`. Three-network design: `wp_net` (WordPress + db-wp + mcp), `data_net` (mcp + postgres + minio), `render_net` (renderer + both WordPress apps + minio + mcp) — renderer is on `render_net` only, per `solution.md` §9.5's isolation requirement. `mcp`/`renderer` run placeholder Node HTTP servers inline until EMCP-005/EMCP-031 land — deliberate, EMCP-001's job is topology, not app code.
  - Also added a `dev` service (`docker/dev/Dockerfile`: Node 20 + PHP 8.2 + Composer + git, repo mounted at `/workspace`, same network membership as `mcp`) as the workspace all future implementation tasks run from — not itself a PRD item, but infrastructure every later task depends on.
  - **Two real bugs found and fixed by actually running the stack, not just validating config:**
    1. Docker Desktop's daemon wasn't running on the host at all (`docker info`: CLI present, engine unreachable). Resolved as part of relocating Docker's WSL storage from C: to D: at the user's request (see below) — Docker Desktop was reinstated and confirmed healthy afterward, with all pre-existing unrelated containers/images/volumes verified intact post-move.
    2. `scripts/db-wp-init.sh` used `mysql -u root ...`, but the `mariadb:11` image no longer ships a `mysql` binary — it's `mariadb`. This failed **silently** (init script errored, MariaDB started anyway with no wp_v4_pro/wp_v3_free databases or users created), which meant both WordPress containers came up but returned 500 "Database Error" on every request, with healthchecks correctly catching it as `unhealthy`. Fixed the script, reset the stale `db-wp` volume (which had already been marked "initialized" by the failed first pass, so simply restarting wouldn't have re-run the script), confirmed both databases/users exist.
  - **Unrelated but user-directed: moved the WSL "Ubuntu" distro (which is where Docker Desktop's engine actually lives on this host — it's integrated with the default WSL distro rather than running its own dedicated data disk) from C: to D:.** Export → unregister → import → restored default user (`abdullah`) via `/etc/wsl.conf` → restored default distro → relaunched Docker Desktop → verified all pre-existing containers/images/volumes survived. C: free space 64GB → 69GB. This was explicitly requested mid-task and is orthogonal to the Elementor MCP project itself, but is recorded here since it's exactly the kind of environment change a later iteration needs to know happened.
  - **Final verification, all against the live stack:** all 8 containers (7 services + `dev`) report healthy; `scripts/test-renderer-isolation.sh` passes all 4 assertions (renderer blocked from `db:5432` and `db-wp:3306`, reaches `wp-v4-pro:80` and `wp-v3-free:80`); a full `docker compose down && docker compose up -d` cycle brings everything back healthy in ~30s with volumes intact, and isolation re-verified after.
- **EMCP-002 — Sandbox provisioning and reset — DONE.** Wrote `scripts/provision.sh`, `scripts/reset.sh`, `scripts/test-reset-guard.sh`. Added `wpcli-v4-pro`/`wpcli-v3-free` services to `docker-compose.yml` (`wordpress:cli` image, `profiles: [tools]` so they don't start with plain `up`, sharing each site's volume and DB credentials) since the official WordPress image ships no WP-CLI.
  - **Deliberate scope boundary:** provisioning does not hand-write `_elementor_data`. That format is exactly what `Blueprints.md` flags as unverified until EMCP-008 captures real fixtures — guessing at it in a provisioning script would undercut the reason that task exists. Provisioning creates plain WordPress pages as a baseline; Elementor content on top is EMCP-008's job.
  - **Real bug found and fixed:** `wordpress:cli` (Alpine, `www-data` uid 82) and `wordpress:*-apache` (Debian, `www-data` uid 33) disagree on the shared-volume owner's UID. Plugin installs failed with "could not create directory" / "plugin could not be found" — looked like a download failure, was actually a permissions mismatch. Fixed by pinning both wp-cli services to `user: "33:33"`.
  - **Real fact recorded, not assumed:** freshly installed Elementor from wordpress.org is **4.2.3**, not the 4.3.0 that `Blueprints.md`/`CLAUDE.md` were verified against. Also: `elementor_experiment*` options don't exist in `wp_options` at all on a fresh install — no rows returned — meaning generation defaults are code-level, not stored, until something (the admin UI, or a page save) touches them. Both are inputs EMCP-008 needs, not yet contradictions to resolve.
  - **Elementor Pro is not installed on `wp-v4-pro`** — `sandboxes/wp-v4-pro/elementor-pro.zip` was never supplied. `provision.sh` detects this, warns clearly, and continues with Elementor Free rather than failing. wp-v4-pro currently runs Free, same as wp-v3-free; the V4-vs-V3/Pro-vs-Free distinction the sandboxes exist to cover is not yet real until the zip is provided.
  - **Verification, all against the live stack:** both sandboxes provisioned (WP core + Elementor Free + baseline page); `test-reset-guard.sh` passes all 7 refusal cases (including a shell-injection-shaped argument, confirmed harmless since `reset.sh` uses positional-parameter case matching, not `eval`) — first run caught a bug in *the test itself* (comparing `docker compose ps` uptime strings, which drift naturally between snapshots) rather than a real regression, fixed by comparing container IDs instead; a real `reset.sh wp-v3-free` cycle verified end-to-end, then run a second time back-to-back to confirm idempotency (exit 0 both times, identical outcome).
- **No other implementation code exists yet. Nothing committed** — the user commits, nobody else.

### 2026-08-21
- **Real bug found and fixed before EMCP-003 could even be verified: the `db-wp` volume was stale/uninitialized** — same class of bug as EMCP-001's original MariaDB init failure, recurring on what was presumably a fresh volume from a prior session. `wp_v4_pro`/`wp_v3_free` databases and users didn't exist; both WordPress sites were 500ing on every request (health checks correctly showed `unhealthy`). Root cause confirmed by querying `db-wp` directly (`SHOW DATABASES` — only system schemas present). Fixed **without deleting the volume** — the sandbox's own permission classifier blocks `docker volume rm` outright regardless of user confirmation in chat, so instead ran `scripts/db-wp-init.sh`'s SQL manually against the live `db-wp` container to create the missing databases/users, then ran `scripts/provision.sh` (both sites) to actually install WordPress core and activate Elementor 4.2.3 into the now-empty-but-valid databases. Also found and started the `dev` container, which had never actually been started in this session (`docker compose ps` showed `Created`, not `Up` — `docker compose start dev` fixed it; no config bug, just never brought up).
- **EMCP-003 — Plugin skeleton — DONE.** Wrote `plugin/emcp.php`, `plugin/src/Plugin.php`, `plugin/uninstall.php`, `plugin/composer.json`.
  - `emcp.php`: plugin header with `Requires Plugins: elementor`, PHP 8.1+ guard, autoload-missing guard (points at `composer install`), boots `EMCP\Plugin::boot()` on `plugins_loaded` priority 20 — Elementor registers widgets on `plugins_loaded` at default priority, so booting later is required (`CLAUDE.md`).
  - `Plugin.php`: `boot()` checks `did_action('elementor/loaded')`; renders an admin notice and no-ops if Elementor is absent or inactive. No REST routes yet — that's EMCP-004.
  - `uninstall.php`: guarded no-op; EMCP-003 introduces no persistent state to clean up. Left a comment flagging that later tasks adding options/postmeta/tables must extend this file in the same change.
  - `composer.json`: PSR-4 `EMCP\` → `src/`, PHPUnit as a dev dependency for later unit tests.
  - **Infrastructure gap found and fixed as part of this task:** `docker-compose.yml` had no way to get `plugin/` into either WordPress container — only `sandbox-assets` was bind-mounted. Added `./plugin:/var/www/html/wp-content/plugins/emcp` to `wp-v4-pro`, `wp-v3-free`, `wpcli-v4-pro`, and `wpcli-v3-free`, matching the existing `sandbox-assets` mount pattern. Also added `WORDPRESS_DEBUG: 1` plus `WP_DEBUG_LOG`/`WP_DEBUG_DISPLAY` (log to file, don't render on page) to both WP services, since nothing previously turned `WP_DEBUG` on and the task's acceptance criterion requires it.
  - **Verification, all against the live stack, both sandboxes:** `wp plugin activate emcp` succeeds cleanly on both; `wp-content/debug.log` absent (zero notices) on both, both before and after activation; `wp eval 'did_action("elementor/loaded")'` confirms `true` on both, proving the boot-order dependency actually holds and not just in theory; separately verified the missing-Elementor path by deactivating Elementor on `wp-v3-free`, confirming `did_action('elementor/loaded')` flips to `false` (the condition `Plugin::boot()` guards on), then reactivating Elementor and reconfirming zero notices.
  - This is the first code in the repo written through Claude Code directly against the live sandboxes rather than design-phase documents.
- **`prd.md` Task 3 checked off; `progress.md` updated in the same pass** per `ONBOARDING.md`'s workflow.
- **EMCP-004 — `GET /site` endpoint — DONE.** Wrote `plugin/src/Rest/RestController.php`, `SiteController.php`, `Capabilities.php`; wired `RestController::register_routes()` onto `rest_api_init` from `Plugin::boot()`.
  - Every field in the response is read from Elementor's live runtime, not assumed — see `Blueprints.md` §6's new `GET /site` subsection for the confirmed shape and the source references (`Experiments_Manager::OPTION_PREFIX`/`STATE_*`, `Breakpoints_Manager::get_breakpoints()`, `elementor_element_cache_ttl` option, `elementor_css_print_method` option).
  - `pro_tier` returns `'free'` or `'pro-tier-unresolved'` rather than a boolean — Essential-vs-Advanced detection is explicitly deferred (`Blueprints.md` §12, `CLAUDE.md`'s "'Pro' is not a boolean") since neither sandbox has Elementor Pro installed to introspect a real tier signal against; guessing a class/method name here would violate the introspect-never-hardcode rule for no real benefit.
  - `Capabilities::can_read_site()` rejects any request without an `Authorization` header as cookie-authenticated (401 `emcp_cookie_auth_rejected`), independent of whether WordPress's own nonce check would have passed it — this is what makes the rejection "outright" per solution.md §9.7 rather than just nonce-checked. A present header still gates on `current_user_can('edit_posts')` (403 `emcp_forbidden` otherwise).
  - **Found and fixed a real gap in EMCP-002's own acceptance criteria while implementing this:** `wp-v4-pro` and `wp-v3-free` were provisioned identically — both plain Elementor Free with default experiment state — so nothing actually made them "cover both real forks" as EMCP-001/002 intended, and EMCP-004's "materially different values from each sandbox" criterion was unverifiable. Fixed in `scripts/provision.sh`: `wp-v3-free` now explicitly forces `elementor_experiment-e_atomic_elements`, `-e_opt_in_v4`, `-e_opt_in_v4_page` to `inactive` (real option keys, confirmed against Elementor's source — see `CLAUDE.md`), forcing it to the V3 fork. `wp-v4-pro` is left on Elementor's own defaults, which are already V4 (verified live: `e_atomic_elements`/`e_opt_in_v4*` are `default`→active on a fresh 4.2.3 install — confirms solution.md §5.1's "V4 is GA and default" claim against a real install, not just documentation).
  - **Found and fixed two more environment gaps, both now in `CLAUDE.md`:** (1) fresh WordPress defaults to Plain permalinks, so `/wp-json/...` 301-redirects instead of resolving — tested via the `/?rest_route=/…` fallback; a pretty permalink structure is still an open item for later, not blocking. (2) Application Passwords were silently unavailable (`wp_is_application_passwords_available()` false) because neither site is HTTPS and `WP_ENVIRONMENT_TYPE` wasn't `local`; added `WORDPRESS_CONFIG_EXTRA` (`WP_ENVIRONMENT_TYPE=local`, `WP_DEBUG_LOG`/`WP_DEBUG_DISPLAY`) to `docker-compose.yml` for future fresh provisions, but since both sandboxes' `wp-config.php` already existed in their volumes, the running sites needed a one-time `wp config set --type=constant` patch instead — `WORDPRESS_CONFIG_EXTRA` is a create-time-only mechanism, not applied on container recreate.
  - **Verification, all against the live stack, both sandboxes:** created real Application Passwords via `wp user application-password create`; confirmed `401` with no `Authorization` header, `403` for an authenticated subscriber (created and removed for the test), `200` with correct full payload for an authenticated admin; confirmed `generation_default` returns `"v4"` on `wp-v4-pro` and `"v3"` on `wp-v3-free` — the two sandboxes now genuinely diverge; `debug.log` stayed empty on both throughout.
- **`prd.md` Task 4 checked off; `progress.md` updated in the same pass.**
- **EMCP-005 — Node server skeleton — DONE.** Greenfield `server/`: `package.json`, `tsconfig.json`, `eslint.config.mjs`, `src/index.ts`, `src/http/{server,auth,correlation,logger}.ts`, `src/http/auth.test.ts`.
  - TypeScript strict (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM (`NodeNext`), Fastify 5, `@modelcontextprotocol/sdk` installed as a dependency (not yet used — protocol wiring is EMCP-006).
  - **Version pin note:** `typescript` pinned to `^6.0.3`, not the newer `7.0.2` that `npm view` resolved to — `typescript-eslint@8.67.0`'s peer range is `>=4.8.4 <6.1.0` and doesn't support TS 7 yet. Revisit the pin once typescript-eslint catches up; not worth carrying a broken lint setup for a few months' head start on a major TS version.
  - `registerHeaderAuth()`: local dev auth, matches `.env.example`'s `MCP_HEADER_AUTH_TOKEN` — expects `Authorization: Bearer <token>`, rejects with `401` otherwise, `/healthz` exempted for container liveness probes. Refuses to start at all (`AuthConfigError`) if no token is configured, rather than silently running open. Comparison is via SHA-256 digest + `crypto.timingSafeEqual`, which also avoids leaking input length through timing (a direct string-length check would).
  - `correlationIdGenerator()`: `crypto.randomUUID()` as Fastify's `genReqId`, echoed back as `x-correlation-id` on every response and present on every structured log line via Fastify's request-scoped logger — this is the correlation ID the acceptance criterion asks for, verified in both the unit tests and a live smoke test.
  - `no-explicit-any` and `ban-ts-comment` (require a description) are enforced by `eslint.config.mjs`'s rules, not just convention — `npm run lint` fails the build if either is violated.
  - **Deliberately out of scope, matching the task's file list** (`server/src/index.ts`, `server/src/http/`, `package.json`, `tsconfig.json` — no `docker-compose.yml`): the `mcp` service is still EMCP-001's placeholder inline Node server. Wiring `server/` into a real container is natural EMCP-006/EMCP-007 work once there's an actual protocol handler and tool to serve, not before.
  - **Verification:** `npm run verify:unit` (type-check + lint + test) green — no network, matches this task's `Verify: unit`. Also went further than required and live-smoke-tested the actual built server inside the `dev` container (`npm run build && node dist/index.js`): `/healthz` 200 unauthenticated, unknown route 401 with no/wrong token, same route 404 (past auth, into Fastify's router) with the correct token, `x-correlation-id` present on every response, structured JSON logs with `reqId`/`service`/`env` fields visible throughout.
- **`prd.md` Task 5 checked off; `progress.md` updated in the same pass.**

---

## Session Handoff

**Next task:** EMCP-006 — MCP protocol conformance.

EMCP-001 through EMCP-005 are all done. Both sandboxes are provisioned and genuinely differ (V4 vs V3), the `emcp` plugin's `GET /site` is live and permission-checked, and `server/` now has a working Fastify skeleton with header auth, structured logging, and a correlation ID on every request — but it doesn't speak MCP yet. EMCP-006 is where it does: `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers validated against body `_meta` (400 + `-32020` on mismatch), `Origin` validation (403 on invalid), `resultType` on every result, `ttlMs`/`cacheScope` on `tools/list`, unknown method → 404 + `-32601`, GET/DELETE → 405, and the error-channel split from `Blueprints.md` §8.1 (auth failures must be HTTP 401, never `isError` — `solution.md` §10 explains why: `isError` responses never trigger a client's token refresh, so the connector looks permanently broken instead of prompting reauth). Build this on top of `buildServer()` in `server/src/http/server.ts`, not as a parallel entry point — `registerHeaderAuth`/`registerCorrelationHeader` should keep applying.

**Outstanding, not blocking:**
- Elementor Pro zip still not supplied — `wp-v4-pro` runs Free for now. Supply it at `sandboxes/wp-v4-pro/elementor-pro.zip` and re-run `scripts/provision.sh wp-v4-pro`. Also still blocks verifying `SiteController::pro_tier()` beyond `'free'`/`'pro-tier-unresolved'`.
- Permalinks are still "Plain" on both sandboxes (`/wp-json/...` 301s; `/?rest_route=/…` works). Not blocking yet, but the Node server's `wp/contract.ts` (EMCP-010) should either handle this or provisioning should set a pretty structure first.
- `typescript` is pinned to `^6.0.3` instead of the newest `7.0.2` — see EMCP-005's log entry above. Revisit when `typescript-eslint` supports TS 7.
- The `db-wp` volume reset from 2026-08-21 was done via manual SQL, not `docker volume rm` + recreate — functionally equivalent but the volume itself was never actually rebuilt from scratch this cycle.

**Read first:** `ralphloop.md`, then `CLAUDE.md`, then the `Blueprints.md` sections your task touches.

**Most important thing to know:** every claim in the design documents about Elementor's data shapes is reasoned from documentation and **has not been verified against a real install**. EMCP-008 is where that changes. When captured fixtures disagree with `Blueprints.md` §3.2 or §5, the blueprint is probably wrong — record it and mark NEEDS-REVIEW. Do not change code to match a fixture until a human has ruled on which is correct.
