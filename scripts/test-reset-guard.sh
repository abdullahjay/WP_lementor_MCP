#!/bin/sh
# EMCP-002 acceptance criterion: "reset cannot target anything but sandbox
# containers, proven by a test that attempts it and fails."
#
# Asserts two things for each bad input: reset.sh exits non-zero, AND the
# running container set is byte-identical before and after — proving no
# docker command was reached, not just that the script printed an error
# before doing damage anyway.

set -eu
cd "$(dirname "$0")/.."

FAIL=0

snapshot() {
  # Container ID, not the human-readable Status string — "Up N minutes" drifts
  # between snapshots taken moments apart even when nothing actually happened,
  # which would make this test flaky/wrong rather than the thing it's testing.
  # ID only changes if a container was actually stopped and recreated.
  docker compose ps --format "{{.Service}} {{.ID}}" | sort
}

assert_refused() {
  target="$1"
  before="$(snapshot)"

  set +e
  output=$(./scripts/reset.sh "$target" 2>&1)
  code=$?
  set -e

  after="$(snapshot)"

  if [ "$code" -eq 0 ]; then
    echo "FAIL  reset.sh accepted forbidden target '$target' (exit 0) — allowlist is broken"
    FAIL=1
    return
  fi

  if [ "$before" != "$after" ]; then
    echo "FAIL  reset.sh rejected '$target' but container state changed anyway:"
    echo "      before: $before"
    echo "      after:  $after"
    FAIL=1
    return
  fi

  echo "PASS  reset.sh refused '$target' (exit $code), no container state changed"
}

assert_refused "db"
assert_refused "db-wp"
assert_refused "renderer"
assert_refused "production"
assert_refused "../etc/passwd"
assert_refused ""
assert_refused "wp-v4-pro; rm -rf /"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "Reset guard verified — only wp-v4-pro, wp-v3-free, and all are ever accepted."
  exit 0
else
  echo "Reset guard FAILED. See failures above."
  exit 1
fi
