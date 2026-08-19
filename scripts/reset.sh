#!/bin/sh
# EMCP-002 — resets a sandbox to the known state provision.sh produces:
# wipes its WordPress volume (core files, plugins, uploads, and the
# uploads/elementor/css/ cache all live under the same /var/www/html volume,
# so wiping it clears all three) and its database, then re-provisions.
#
# The allowlist below is the actual safety mechanism this task exists to
# prove, not a formality — see scripts/test-reset-guard.sh, which asserts
# an unlisted target is refused AND that no docker command ran as a result.
#
# Usage:
#   scripts/reset.sh wp-v4-pro
#   scripts/reset.sh wp-v3-free
#   scripts/reset.sh all

set -eu

cd "$(dirname "$0")/.."
[ -f .env ] && . ./.env

WP_DB_ROOT_PASSWORD="${WP_DB_ROOT_PASSWORD:-root_dev_only}"

TARGET="${1:-}"

case "$TARGET" in
  wp-v4-pro) SITES="wp-v4-pro" ;;
  wp-v3-free) SITES="wp-v3-free" ;;
  all) SITES="wp-v4-pro wp-v3-free" ;;
  *)
    echo "reset.sh: refusing unknown target '$TARGET'" >&2
    echo "reset.sh: allowed targets are exactly: wp-v4-pro, wp-v3-free, all" >&2
    echo "reset.sh: no action taken." >&2
    exit 1
    ;;
esac

db_name_for() {
  case "$1" in
    wp-v4-pro) echo "wp_v4_pro" ;;
    wp-v3-free) echo "wp_v3_free" ;;
  esac
}

reset_site() {
  site="$1"
  db="$(db_name_for "$site")"
  volume="wp_lementor_mcp_${site}-data"

  echo "=== Resetting $site ==="

  echo "--- stopping and removing container ---"
  docker compose stop "$site"
  docker compose rm -f "$site"

  echo "--- dropping and recreating database $db ---"
  docker compose exec -T db-wp mariadb -u root -p"${WP_DB_ROOT_PASSWORD}" -e \
    "DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

  echo "--- removing volume $volume (core files, plugins, uploads, elementor CSS cache) ---"
  docker volume rm -f "$volume" >/dev/null

  echo "--- recreating $site ---"
  docker compose up -d "$site"

  echo "--- re-provisioning $site ---"
  ./scripts/provision.sh "$site"

  echo "$site: reset complete."
}

for site in $SITES; do
  reset_site "$site"
done
