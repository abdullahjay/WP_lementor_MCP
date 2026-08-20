# Onboarding — Elementor MCP

Welcome. This gets you from a clean machine to a working dev environment, and explains how we work day to day.

**Read this once, fully, before touching code.** It's short on purpose.

---

## The one thing that determines your setup

**This project needs Docker running locally.** The stack is two WordPress sandboxes, MariaDB, Postgres, MinIO, and a Playwright renderer — eight containers.

**Claude Code on the web cannot run this.** Its sandbox has no Docker support (confirmed against Anthropic's own docs — see `progress.md`'s log for the sourcing). If most of your work touches the WordPress sandboxes — which right now is almost everything — **use Claude Code CLI locally**, not the web version. Web is fine later for pure code/doc edits once server logic doesn't need the live containers, but that's not where the project is yet.

---

## First-time setup

1. **Get repo access.** Ask to be added as a collaborator on `abdullahjay/WP_lementor_MCP` (it's public, so you can also fork+PR without one, but direct access is simpler for a small team).
2. **Install:** Docker Desktop, git, Claude Code CLI. (Node/PHP/Composer you do *not* need locally — the `dev` container has them.)
3. **Clone and configure:**
   ```
   git clone https://github.com/abdullahjay/WP_lementor_MCP.git
   cd WP_lementor_MCP
   cp .env.example .env
   ```
4. **Bring up the stack:**
   ```
   docker compose up -d
   ```
   First run pulls several images (the Playwright one is large) — give it a few minutes. `docker compose ps` should show all 8 containers `healthy` (WordPress containers take longest).
5. **Get the Elementor Pro zip** (needed for `wp-v4-pro` — the V4/Pro sandbox). It's licensed content, **never committed to git** (`.gitignore` excludes it). Ask abdullah for the current distribution channel, place it at:
   ```
   sandboxes/wp-v4-pro/elementor-pro.zip
   ```
6. **Provision both sandboxes:**
   ```
   sh scripts/provision.sh
   ```
   Installs WordPress + Elementor on both. If the Pro zip wasn't in place yet, `wp-v4-pro` provisions on Free instead and says so clearly — re-run `sh scripts/provision.sh wp-v4-pro` once you have it.
7. **Confirm it's real:** open `http://localhost:8081` (V4/Pro) and `http://localhost:8082` (V3/Free) in a browser. Admin login is `WP_ADMIN_USER`/`WP_ADMIN_PASSWORD` from your `.env`.

If anything here fails, it's a bug in the setup, not you — check `CLAUDE.md` for known gotchas (there are already two real Docker bugs documented there that cost real time to find), then ask.

---

## The document chain — read in this order

| File | What it's for |
|---|---|
| `solution.md` | Architecture and *why* — read this first, once |
| `Blueprints.md` | The technical contract — DSL grammar, REST surface, error shapes. Read the sections your task touches, not the whole thing every time |
| `CLAUDE.md` | Accumulated Elementor/Docker gotchas. Short, factual, read every session |
| `prd.md` | The 66-task backlog. This is where you find your next task |
| `progress.md` | Current state — what's done, in flight, blocked, and recent learnings |

`ralphloop.md` is **not for you** — it governs an unattended autonomous agent mode, not normal interactive work. You commit and push like a normal developer; see the note at the top of that file if you want the details.

---

## How we work

1. **Pick the next task from `prd.md`.** Tasks are ordered for a reason — dependencies are real, not just organizational. Don't jump ahead of an unmet dependency, and note the one hard gate: **no task that writes to an Elementor document ships before EMCP-040 is done** (it's the safety-ring proof; see `prd.md`'s Notes).
2. **Branch:** `git checkout -b emcp-XXX-short-description`
3. **Work normally with Claude Code CLI.** Point it at `CLAUDE.md` and the relevant `Blueprints.md` section — that's the same context this session builds from.
4. **Verify before you're done:**
   - `docker compose exec dev npm run verify:unit` (or your task's equivalent) — no network needed
   - Anything touching Elementor's runtime needs `verify:live` against the actual sandboxes — **green unit tests alone don't prove a live task is correct**, see `CLAUDE.md`
5. **Update `prd.md` and `progress.md` in the same commit:** check the task's box in `prd.md`, fill in its row and append a Log entry in `progress.md`. **Pull/rebase first** — `progress.md` is shared state and multiple people editing it is the one place conflicts are likely. Keep your edits additive (your row, your log entry) rather than reformatting others'.
6. **Open a PR** referencing the EMCP task ID. Normal review before merge.

---

## Two things worth knowing before you hit them

- **Both WordPress sandboxes exist on purpose** — `wp-v4-pro` (V4/atomic, Pro) and `wp-v3-free` (V3/containers, Free). They cover the two real forks in Elementor's data model and licensing tier. If your task is generation- or edition-dependent, test against both, not just one.
- **Don't guess at Elementor's internal data shapes.** If you're not sure how something is actually stored (`_elementor_data`, experiment flags, whatever), that uncertainty is real — `Blueprints.md` §12 lists what's still unverified. Capture evidence (EMCP-008 exists for exactly this) rather than assuming the docs are right; they've already been wrong twice this week (see `progress.md`'s log for both).

---

Questions, or something in here doesn't match reality anymore: ping abdullah, and update this file — it's meant to stay accurate, not archival.
