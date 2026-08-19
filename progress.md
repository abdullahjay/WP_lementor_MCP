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
| EMCP-003 | Plugin skeleton | NOT STARTED | | | |
| EMCP-004 | `GET /site` endpoint | NOT STARTED | | | |
| EMCP-005 | Node server skeleton | NOT STARTED | | | |
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
- **Completed:** 2
- **In Progress:** 0
- **Not Started:** 64

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

---

## Session Handoff

**Next task:** EMCP-003 — Plugin skeleton.

EMCP-001 and EMCP-002 are both done; the stack is up, healthy, and both sandboxes are provisioned. EMCP-003 is the WordPress companion plugin itself — `plugin/emcp.php`, `plugin/composer.json`, `plugin/src/Plugin.php`, `plugin/uninstall.php`. Must activate clean on both sandboxes with `WP_DEBUG` on and zero notices, boot after Elementor's widget registration (priority matters — see `CLAUDE.md`'s note on `plugins_loaded`), and fail gracefully with a legible admin notice if Elementor is absent. The `dev` container has PHP 8.2 + Composer for this; it has no Docker socket, so anything needing `docker compose` (activating the plugin, checking for notices) still runs from the host.

**Outstanding, not blocking:** Elementor Pro zip still not supplied — `wp-v4-pro` runs Free for now. Supply it at `sandboxes/wp-v4-pro/elementor-pro.zip` whenever convenient and re-run `scripts/provision.sh wp-v4-pro`.

**Read first:** `ralphloop.md`, then `CLAUDE.md`, then the `Blueprints.md` sections your task touches.

**Most important thing to know:** every claim in the design documents about Elementor's data shapes is reasoned from documentation and **has not been verified against a real install**. EMCP-008 is where that changes. When captured fixtures disagree with `Blueprints.md` §3.2 or §5, the blueprint is probably wrong — record it and mark NEEDS-REVIEW. Do not change code to match a fixture until a human has ruled on which is correct.
