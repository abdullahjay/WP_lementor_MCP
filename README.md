# Elementor MCP

An MCP server that lets an AI model build and edit Elementor pages — reading a site's real widget vocabulary, writing through Elementor's Document API, and rendering back what it built. Hybrid architecture: a Node/TypeScript MCP server (`server/`) plus a thin WordPress companion plugin (`plugin/`), talking to two local WordPress sandboxes over Docker Compose.

**Why it's built this way:** `solution.md`. **The exact contract** (DSL, REST routes, error shapes): `Blueprints.md`. **What's done and what's next:** `prd.md` / `progress.md`. **Elementor/Docker gotchas that cost real time to find:** `CLAUDE.md` — read it before you hit the same wall.

If you're joining the team, read `ONBOARDING.md` first — it covers workflow (branching, PRs, task selection), not just environment setup. This file is the environment setup.

---

## Prerequisites

- **Docker Desktop**, running.
- Git.
- Node/PHP/Composer are **not** needed on your host — the `dev` container has them.
- (Optional, to connect an AI client) Claude Code CLI.

## First-time setup

```sh
git clone <repo-url>
cd WP_lementor_MCP
cp .env.example .env
docker compose up -d
```

First run builds the `mcp` and `dev` images and pulls the rest (the Playwright image for `renderer` is large) — give it a few minutes. `docker compose ps` should eventually show all services `healthy` (the two WordPress containers take longest).

**Elementor Pro** (optional, not blocking): the zip isn't publicly downloadable. If you have access to it, place it at `sandboxes/wp-v4-pro/elementor-pro.zip` before provisioning — otherwise `wp-v4-pro` runs Elementor Free, which is fine for most work.

Provision both sandboxes to a known state (WordPress core, Elementor, a baseline page, and the V4-vs-V3 generation split the sandboxes exist to cover):

```sh
sh scripts/provision.sh
```

Confirm it's real: `http://localhost:8081` (`wp-v4-pro`, V4/atomic default) and `http://localhost:8082` (`wp-v3-free`, V3 containers) should both load. Admin login is `WP_ADMIN_USER` / `WP_ADMIN_PASSWORD` from your `.env` (`admin` / `admin_dev_only` by default).

## Give the `mcp` server something to talk to

The `mcp` container runs the real server (`server/`), but it needs an Application Password for whichever WordPress site it should target — `WP_BASE_URL` in `.env` defaults to `wp-v4-pro`. Generate one and set it:

```sh
docker compose run --rm wpcli-v4-pro wp user application-password create admin emcp-dev --porcelain
```

Paste the output into `WP_AUTH_APP_PASSWORD` in `.env`, then recreate the container so it picks up the change:

```sh
docker compose up -d mcp
```

## Verify it's working

Two harnesses, matching `ralphloop.md`'s testing guidance — **green unit tests do not imply correct live behaviour**, run both.

```sh
# No network needed. Runs three independent projects: the repo-root fixture
# guard, server/'s TypeScript suite, plugin/'s PHPUnit suite.
docker compose exec dev npm run verify:unit

# Requires both sandboxes up. Checks container health, then calls the real
# plugin REST route on each — fails with a specific, actionable message if
# a sandbox is down, unhealthy, or its Application Password isn't set.
sh scripts/verify-live.sh
```

`verify-live.sh` runs from the **host**, not the `dev` container — it shells out to `docker compose ps`, and `dev` has no Docker socket.

## Confirm a working `get_site_info` call

This is the acceptance bar for this document: from a clean checkout, the steps above should get you here.

```sh
TOKEN=$(grep -oP '(?<=^MCP_HEADER_AUTH_TOKEN=).*' .env)
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2026-07-28" -H "Mcp-Method: tools/call" -H "Mcp-Name: elementor-mcp" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_site_info"},"_meta":{"protocolVersion":"2026-07-28","method":"tools/call","name":"elementor-mcp"}}'
```

A healthy response has `"isError":false` and a `structuredContent` block reporting the target site's Elementor version, generation default (`v4`/`v3`/`legacy`), breakpoints, and more (`Blueprints.md` §6 documents the exact shape). Point `WP_BASE_URL`/`WP_AUTH_USER`/`WP_AUTH_APP_PASSWORD` at `wp-v3-free` instead (and regenerate the Application Password there) to confirm against the other sandbox — the two are provisioned to genuinely differ, not just live on different ports.

## Connecting an AI client

The server speaks MCP over Streamable HTTP (revision `2026-07-28` — no session/`initialize` handshake; every request carries its own `MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name` headers, matching the `_meta` block in the JSON-RPC body). Locally, auth is a bearer token (`MCP_HEADER_AUTH_TOKEN` from `.env`) — OAuth 2.1 only applies against a deployed environment (`solution.md` §11.4), not this local stack.

Point your MCP client at `http://localhost:3000/mcp` with that token as a bearer `Authorization` header. The exact client-side configuration syntax depends on which Claude Code version you're running — the curl example above is the ground truth for what a correct request/response looks like if you need to debug a client-side connector config against it.

## Resetting a sandbox

```sh
sh scripts/reset.sh wp-v4-pro    # or wp-v3-free, or no argument for both
```

Restores database, uploads, and `uploads/elementor/css/`. Idempotent, and provably can't target anything but the sandbox containers (`scripts/test-reset-guard.sh`).

## Project layout

| Path | What it is |
|---|---|
| `server/` | The MCP server (TypeScript, Fastify) |
| `plugin/` | The WordPress companion plugin (PHP) |
| `tests/fixtures/` | Real `_elementor_data` captured from Elementor's editor — hash-guarded, never hand-edited |
| `tests/unit/` | Cross-cutting checks that aren't specific to `server/` or `plugin/` |
| `scripts/` | Provisioning, reset, and live-verification shell scripts |
| `docker/` | Dockerfiles for `mcp` and `dev` |
| `sandboxes/` | Per-sandbox assets (e.g. the Elementor Pro zip), not source |

## Troubleshooting

Check `CLAUDE.md`'s gotcha lists first — both the Elementor-specific one and the Docker/local-env one. Both exist because something in this exact stack already cost someone real time once; if you hit a wall, there's a decent chance it's already documented there. If it isn't, that's worth adding once you've solved it.
