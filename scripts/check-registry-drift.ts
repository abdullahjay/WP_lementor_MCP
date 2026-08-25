#!/usr/bin/env -S npx tsx
// EMCP-018 — re-pulls GET /registry/snapshot from both sandboxes and diffs
// against the committed tests/snapshots/*.json.
//
// Unlike scripts/verify-live.sh, this runs INSIDE the `dev` container, not
// the host: tsx's esbuild dependency ships a platform-native binary, and
// this repo's node_modules gets installed once, inside the Linux `dev`
// container — running tsx directly against that install from the Windows
// host fails ("esbuild for another platform"). `dev` is on the same
// wp_net as both sandboxes, so this targets them by docker-compose service
// name (`wp-v4-pro`/`wp-v3-free`, internal port 80) rather than
// `localhost:<host-mapped-port>` the way host-run scripts do.
//
// Usage: docker compose exec dev npx tsx scripts/check-registry-drift.ts [wp-v4-pro|wp-v3-free]

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diffRegistrySnapshots,
  formatDriftReport,
  type RegistrySnapshot,
} from '../tests/snapshots/diff.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(): Record<string, string> {
  const path = join(REPO_ROOT, '.env');
  const env: Record<string, string> = {};

  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }

  return env;
}

const ENV = loadEnv();

interface SandboxConfig {
  host: string;
  password: string | undefined;
  envVarName: string;
}

const SANDBOXES: Record<string, SandboxConfig> = {
  'wp-v4-pro': {
    host: 'wp-v4-pro',
    password: ENV['WP_V4_PRO_AUTH_APP_PASSWORD'],
    envVarName: 'WP_V4_PRO_AUTH_APP_PASSWORD',
  },
  'wp-v3-free': {
    host: 'wp-v3-free',
    password: ENV['WP_V3_FREE_AUTH_APP_PASSWORD'],
    envVarName: 'WP_V3_FREE_AUTH_APP_PASSWORD',
  },
};

async function checkSandbox(name: string): Promise<boolean> {
  const config = SANDBOXES[name];

  if (!config) {
    console.error(`Unknown sandbox '${name}'.`);
    return false;
  }

  if (!config.password) {
    console.error(`FAIL: ${name}: no Application Password configured (${config.envVarName} in .env).`);
    return false;
  }

  const committedPath = join(REPO_ROOT, 'tests', 'snapshots', `${name}.json`);
  const committed = JSON.parse(readFileSync(committedPath, 'utf-8')) as {
    snapshot: RegistrySnapshot;
  };

  const user = ENV['WP_ADMIN_USER'] ?? 'admin';
  const credentials = Buffer.from(`${user}:${config.password}`).toString('base64');
  const url = `http://${config.host}/wp-json/emcp/v1/registry/snapshot`;

  let current: RegistrySnapshot;
  try {
    const response = await fetch(url, { headers: { authorization: `Basic ${credentials}` } });

    if (!response.ok) {
      console.error(
        `FAIL: ${name}: GET /registry/snapshot returned HTTP ${response.status}. Is the sandbox up and provisioned?`,
      );
      return false;
    }

    current = (await response.json()) as RegistrySnapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL: ${name}: could not reach ${url} (${message}). Run 'docker compose up -d' first.`);
    return false;
  }

  const drift = diffRegistrySnapshots(committed.snapshot, current);
  console.log(formatDriftReport(name, drift));

  return drift.length === 0;
}

async function main(): Promise<void> {
  const target = process.argv[2];
  const names = target ? [target] : Object.keys(SANDBOXES);

  if (target && !SANDBOXES[target]) {
    console.error(`Unknown sandbox '${target}' (expected wp-v4-pro, wp-v3-free, or no argument for both).`);
    process.exitCode = 1;
    return;
  }

  const results = await Promise.all(names.map(checkSandbox));

  if (results.some((ok) => !ok)) {
    console.error('\nCHECK_REGISTRY_DRIFT=FAIL');
    process.exitCode = 1;
    return;
  }

  console.log('\nCHECK_REGISTRY_DRIFT=PASS');
}

await main();
