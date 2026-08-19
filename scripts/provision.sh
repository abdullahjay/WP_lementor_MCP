#!/bin/sh
# EMCP-002 — provisions the two sandboxes to a known state: WordPress core
# installed, Elementor active, one baseline page created.
#
# Deliberately does NOT hand-write _elementor_data. That format is exactly
# what Blueprints.md flags as unverified until EMCP-008 captures real
# fixtures from a running Elementor editor — guessing at it here would defeat
# the point of that task. Provisioning creates a plain WordPress page as a
# starting point; Elementor content on top of it is EMCP-008's job.
#
# Usage:
#   scripts/provision.sh              # both sandboxes
#   scripts/provision.sh wp-v4-pro    # one sandbox
#   scripts/provision.sh wp-v3-free
#
# Idempotent: safe to run twice against an already-provisioned site.

set -eu

cd "$(dirname "$0")/.."
[ -f .env ] && . ./.env

WP_ADMIN_USER="${WP_ADMIN_USER:-admin}"
WP_ADMIN_PASSWORD="${WP_ADMIN_PASSWORD:-admin_dev_only}"
WP_V4_PRO_PORT="${WP_V4_PRO_PORT:-8081}"
WP_V3_FREE_PORT="${WP_V3_FREE_PORT:-8082}"

TARGET="${1:-}"
case "$TARGET" in
  wp-v4-pro|wp-v3-free) SITES="$TARGET" ;;
  "") SITES="wp-v4-pro wp-v3-free" ;;
  *) echo "provision.sh: unknown site '$TARGET' (expected wp-v4-pro, wp-v3-free, or no argument for both)" >&2; exit 1 ;;
esac

wp() {
  # $1 = wp-cli service name, rest = wp-cli arguments
  svc="$1"; shift
  docker compose run --rm "$svc" wp "$@"
}

wait_healthy() {
  svc="$1"
  echo "Waiting for $svc to be healthy..."
  tries=0
  while [ "$tries" -lt 60 ]; do
    status=$(docker compose ps --format "{{.Service}} {{.Health}}" | awk -v s="$svc" '$1==s {print $2}')
    [ "$status" = "healthy" ] && return 0
    tries=$((tries + 1))
    sleep 2
  done
  echo "provision.sh: $svc did not become healthy in time" >&2
  return 1
}

provision_site() {
  site="$1"

  case "$site" in
    wp-v4-pro)
      wpcli=wpcli-v4-pro
      port="$WP_V4_PRO_PORT"
      title="EMCP Sandbox — V4 / Pro"
      pro_zip="/sandbox-assets/elementor-pro.zip"
      ;;
    wp-v3-free)
      wpcli=wpcli-v3-free
      port="$WP_V3_FREE_PORT"
      title="EMCP Sandbox — V3 / Free"
      pro_zip=""
      ;;
  esac

  wait_healthy "$site"

  echo "--- $site: WordPress core ---"
  if wp "$wpcli" core is-installed 2>/dev/null; then
    echo "$site: WordPress already installed, skipping core install"
  else
    wp "$wpcli" core install \
      --url="http://localhost:${port}" \
      --title="${title}" \
      --admin_user="${WP_ADMIN_USER}" \
      --admin_password="${WP_ADMIN_PASSWORD}" \
      --admin_email="admin@emcp.test" \
      --skip-email
  fi

  echo "--- $site: Elementor (Free) ---"
  if wp "$wpcli" plugin is-installed elementor 2>/dev/null; then
    wp "$wpcli" plugin activate elementor
  else
    wp "$wpcli" plugin install elementor --activate
  fi

  if [ -n "$pro_zip" ]; then
    echo "--- $site: Elementor Pro ---"
    if wp "$wpcli" plugin is-installed elementor-pro 2>/dev/null; then
      wp "$wpcli" plugin activate elementor-pro
    elif [ -f "./sandboxes/wp-v4-pro/elementor-pro.zip" ]; then
      wp "$wpcli" plugin install "$pro_zip" --activate
    else
      echo "$site: elementor-pro.zip not found at sandboxes/wp-v4-pro/ — skipping Pro install." >&2
      echo "$site: this sandbox will run Elementor Free until the zip is supplied. See .env.example." >&2
    fi
  fi

  echo "--- $site: baseline page ---"
  existing=$(wp "$wpcli" post list --post_type=page --title="EMCP Sandbox Page" --field=ID 2>/dev/null || true)
  if [ -z "$existing" ]; then
    wp "$wpcli" post create --post_type=page --post_title="EMCP Sandbox Page" --post_status=publish --porcelain
  else
    echo "$site: baseline page already exists (ID $existing)"
  fi

  echo "--- $site: Elementor experiment state (informational — see Blueprints.md open item on V4 defaults) ---"
  wp "$wpcli" option list --search="elementor_experiment*" --format=table 2>/dev/null || echo "$site: no elementor_experiment* options set (defaults apply)"

  echo "$site: provisioned."
}

for site in $SITES; do
  provision_site "$site"
done
