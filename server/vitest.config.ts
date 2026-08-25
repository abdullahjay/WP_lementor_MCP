import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Without this, vitest's default glob picks up compiled test files left
    // in dist/ by `npm run build`, running every test twice — once as
    // source, once as a stale copy of whatever the last build captured.
    exclude: ['dist/**', 'node_modules/**'],
    // The default 5000ms is too tight for this environment (a Windows
    // bind-mounted workspace under Docker Desktop is slow for the many
    // small file reads ESM/ts-node-style transforms do) — observed module
    // import alone taking 20s+ under load, even though the same assertions
    // run in single-digit milliseconds once loaded. Raised, not removed:
    // a test that's actually hung should still fail eventually.
    testTimeout: 20_000,
  },
});
