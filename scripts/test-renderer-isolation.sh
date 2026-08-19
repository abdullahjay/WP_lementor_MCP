#!/bin/sh
# EMCP-001 acceptance criterion: "renderer cannot reach db — verified, not assumed."
#
# Runs from the host against the already-running compose stack. Uses
# `docker compose exec renderer` to test connectivity from inside the
# renderer container itself, since that's the boundary that matters.
#
# A positive control (renderer -> wp-v4-pro) is included deliberately: without
# it, a passing test could mean "isolation works" or could mean "the renderer
# container's networking is broken entirely." Only the combination proves the
# topology is what docker-compose.yml claims.

set -eu

COMPOSE="docker compose"
FAIL=0

assert_unreachable() {
  host="$1"; port="$2"; label="$3"
  if $COMPOSE exec -T renderer node -e "
    const net = require('net');
    const s = net.createConnection({ host: '$host', port: $port, timeout: 3000 });
    s.on('connect', () => { console.log('CONNECTED'); process.exit(1); });
    s.on('timeout', () => { console.log('TIMEOUT'); process.exit(0); });
    s.on('error', () => { console.log('ERROR'); process.exit(0); });
  " 2>/dev/null | grep -q -E "TIMEOUT|ERROR"; then
    echo "PASS  renderer cannot reach $label ($host:$port)"
  else
    echo "FAIL  renderer CAN reach $label ($host:$port) — isolation is broken"
    FAIL=1
  fi
}

assert_reachable() {
  host="$1"; port="$2"; label="$3"
  if $COMPOSE exec -T renderer node -e "
    const net = require('net');
    const s = net.createConnection({ host: '$host', port: $port, timeout: 3000 });
    s.on('connect', () => { console.log('CONNECTED'); process.exit(0); });
    s.on('timeout', () => { console.log('TIMEOUT'); process.exit(1); });
    s.on('error', () => { console.log('ERROR'); process.exit(1); });
  " 2>/dev/null | grep -q "CONNECTED"; then
    echo "PASS  renderer can reach $label ($host:$port) — positive control OK"
  else
    echo "FAIL  renderer CANNOT reach $label ($host:$port) — positive control failed, test is not meaningful"
    FAIL=1
  fi
}

echo "--- Negative: renderer must NOT reach the credential/data layer ---"
assert_unreachable db 5432 "Postgres (credential store)"
assert_unreachable db-wp 3306 "MariaDB (db-wp)"

echo ""
echo "--- Positive control: renderer must still reach what it needs ---"
assert_reachable wp-v4-pro 80 "wp-v4-pro"
assert_reachable wp-v3-free 80 "wp-v3-free"

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "Renderer isolation verified."
  exit 0
else
  echo "Renderer isolation FAILED. See failures above."
  exit 1
fi
