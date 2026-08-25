# Committed registry snapshots (EMCP-018)

`GET /wp-json/emcp/v1/registry/snapshot` (EMCP-017), captured from each sandbox and committed here — this is validation's ground truth (Blueprints.md §9.2): does a widget exist, what controls does it have, without round-tripping to a live site for every check.

**The rule that matters:** a failing drift check means **Elementor changed on the sandbox**, not that this file is wrong. Never regenerate a committed snapshot to make a failing check pass — that silently deletes the signal this whole mechanism exists to raise (`ralphloop.md`). If a real Elementor/plugin upgrade is the reason for the drift, re-capturing is the right move, but it's a decision, not a reflex — the same standard `tests/fixtures/` holds fixtures to.

## Files

| File | What it is |
|---|---|
| `wp-v4-pro.json` | Committed snapshot from the V4/atomic-default sandbox |
| `wp-v3-free.json` | Committed snapshot from the V3-container-forced sandbox |
| `diff.ts` | Pure comparison logic (`diffRegistrySnapshots`, `formatDriftReport`) — no network, unit-tested in `tests/unit/registry-drift.test.ts` |

Format: `{ "_provenance": {...}, "snapshot": <the raw GET /registry/snapshot response> }`.

## Running the check

```sh
# From inside the dev container — tsx's esbuild binary is Linux-native and
# won't run directly against this repo's node_modules from the Windows host
# (see the comment at the top of the script itself).
docker compose exec dev npx tsx scripts/check-registry-drift.ts          # both sandboxes
docker compose exec dev npx tsx scripts/check-registry-drift.ts wp-v4-pro # one sandbox
```

Requires both sandboxes up and the per-sandbox Application Passwords in `.env` (`WP_V4_PRO_AUTH_APP_PASSWORD`/`WP_V3_FREE_AUTH_APP_PASSWORD` — same ones `scripts/verify-live.sh` uses). Prints a `CHECK_REGISTRY_DRIFT=PASS`/`FAIL` line for machine-readability and exits non-zero on drift or any other failure (sandbox down, credential missing).

## What's actually wired into CI right now

`.github/workflows/verify.yml` runs `npm run verify:unit` — which includes `registry-drift.test.ts`'s pure comparison-logic tests — on every push. It does **not** provision the Docker Compose sandboxes or run the live re-pull above; that would mean standing up two full WordPress+Elementor containers inside CI, which is real infrastructure work this task didn't build. Running `check-registry-drift.ts` today is a manual/local step, same as `verify-live.sh`. Wiring the live re-pull into actual CI is a real follow-up, not done here — don't assume it's covered just because a `verify.yml` file exists.
