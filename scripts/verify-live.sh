#!/bin/sh
# EMCP-011 — verify:live. Requires both WordPress sandboxes up and
# provisioned; fails with a clear, specific message (not a generic timeout)
# when they aren't, and emits a machine-readable PASS/FAIL line so a caller
# doesn't have to parse prose.
#
# Scope: confirms each sandbox is reachable, provisioned, and its emcp
# plugin responds correctly through the real REST route — this is what
# every task's manual curl-based smoke test in progress.md has been proving
# by hand. It does not yet exercise the Node server itself (server/'s own
# tests already cover its logic against a mocked WordPress; there is no
# long-running `mcp` container serving real traffic yet — EMCP-001's
# placeholder is still what docker-compose.yml runs).
#
# Usage: scripts/verify-live.sh [wp-v4-pro|wp-v3-free]   (default: both)

set -eu

cd "$(dirname "$0")/.."
[ -f .env ] && . ./.env

WP_ADMIN_USER="${WP_ADMIN_USER:-admin}"
WP_V4_PRO_PORT="${WP_V4_PRO_PORT:-8081}"
WP_V3_FREE_PORT="${WP_V3_FREE_PORT:-8082}"

FAILURES=0

fail() {
	echo "FAIL: $1" >&2
	FAILURES=$((FAILURES + 1))
}

check_container_healthy() {
	service="$1"
	status=$(docker compose ps --format "{{.Service}} {{.Health}}" 2>/dev/null | awk -v s="$service" '$1==s {print $2}')

	if [ -z "$status" ]; then
		fail "$service: container not running at all. Run 'docker compose up -d' first."
		return 1
	fi

	if [ "$status" != "healthy" ]; then
		fail "$service: container is up but reports '$status', not healthy. Check 'docker compose logs $service'."
		return 1
	fi

	echo "OK: $service container is healthy"
	return 0
}

check_site() {
	service="$1"
	port="$2"
	app_password="$3"
	env_var_name="$4"

	if ! check_container_healthy "$service"; then
		return 1
	fi

	if [ -z "$app_password" ]; then
		fail "$service: no Application Password configured. Set $env_var_name in .env (see .env.example) — generate one with:"
		echo "      docker compose run --rm wpcli-${service#wp-} wp user application-password create $WP_ADMIN_USER emcp-dev-verify-live --porcelain" >&2
		return 1
	fi

	credentials=$(printf '%s:%s' "$WP_ADMIN_USER" "$app_password" | base64)
	http_code=$(curl -s -o /tmp/emcp-verify-live-body.json -w "%{http_code}" \
		-H "Authorization: Basic $credentials" \
		"http://localhost:${port}/wp-json/emcp/v1/site" 2>/dev/null || echo "000")

	if [ "$http_code" != "200" ]; then
		fail "$service: GET /wp-json/emcp/v1/site returned HTTP $http_code, expected 200. Body: $(cat /tmp/emcp-verify-live-body.json 2>/dev/null || echo '(no body)')"
		return 1
	fi

	if ! grep -q '"generation_default"' /tmp/emcp-verify-live-body.json 2>/dev/null; then
		fail "$service: GET /site returned 200 but the body doesn't look like the expected shape (missing generation_default). Plugin REST contract may have drifted — see Blueprints.md §6."
		return 1
	fi

	echo "OK: $service plugin REST route responded correctly"
	return 0
}

TARGET="${1:-}"

case "$TARGET" in
	wp-v4-pro)
		check_site "wp-v4-pro" "$WP_V4_PRO_PORT" "${WP_V4_PRO_AUTH_APP_PASSWORD:-}" "WP_V4_PRO_AUTH_APP_PASSWORD"
		;;
	wp-v3-free)
		check_site "wp-v3-free" "$WP_V3_FREE_PORT" "${WP_V3_FREE_AUTH_APP_PASSWORD:-}" "WP_V3_FREE_AUTH_APP_PASSWORD"
		;;
	"")
		check_site "wp-v4-pro" "$WP_V4_PRO_PORT" "${WP_V4_PRO_AUTH_APP_PASSWORD:-}" "WP_V4_PRO_AUTH_APP_PASSWORD" || true
		check_site "wp-v3-free" "$WP_V3_FREE_PORT" "${WP_V3_FREE_AUTH_APP_PASSWORD:-}" "WP_V3_FREE_AUTH_APP_PASSWORD" || true
		;;
	*)
		echo "verify-live.sh: unknown target '$TARGET' (expected wp-v4-pro, wp-v3-free, or no argument for both)" >&2
		exit 1
		;;
esac

rm -f /tmp/emcp-verify-live-body.json

if [ "$FAILURES" -gt 0 ]; then
	echo "VERIFY_LIVE=FAIL ($FAILURES check(s) failed)"
	exit 1
fi

echo "VERIFY_LIVE=PASS"
