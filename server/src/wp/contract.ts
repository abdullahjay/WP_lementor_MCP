/**
 * Blueprints.md §6: "the server declares a minimum plugin version and fails
 * loudly on mismatch at connect time." There is no persistent connection in
 * this architecture (MCP 2026-07-28 has no session/`initialize` handshake,
 * solution.md §3) — every tool call that reaches the plugin re-checks this,
 * which is the closest equivalent "connect time" this transport has.
 */
export const MINIMUM_PLUGIN_VERSION = '0.1.0';

export class PluginVersionMismatchError extends Error {
  constructor(
    public readonly installedVersion: string,
    public readonly minimumVersion: string,
  ) {
    super(
      `The emcp plugin on this site is version ${installedVersion}, but this server requires at least ${minimumVersion}. Update the emcp plugin on the WordPress site before continuing.`,
    );
  }
}

export function assertPluginVersionCompatible(installedVersion: unknown): void {
  const version = typeof installedVersion === 'string' ? installedVersion : '';

  if (!version || !isVersionAtLeast(version, MINIMUM_PLUGIN_VERSION)) {
    throw new PluginVersionMismatchError(version || 'unknown', MINIMUM_PLUGIN_VERSION);
  }
}

function isVersionAtLeast(version: string, minimum: string): boolean {
  const versionParts = parseVersion(version);
  const minimumParts = parseVersion(minimum);
  const length = Math.max(versionParts.length, minimumParts.length);

  for (let i = 0; i < length; i += 1) {
    const versionPart = versionParts[i] ?? 0;
    const minimumPart = minimumParts[i] ?? 0;

    if (versionPart > minimumPart) return true;
    if (versionPart < minimumPart) return false;
  }

  return true; // equal
}

function parseVersion(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}
