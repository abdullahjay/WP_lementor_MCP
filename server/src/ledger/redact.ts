/**
 * Blueprints.md §10: "Args are **allowlisted in**, not denylisted out."
 * solution.md §9: "the ledger's `before` snapshots are a shadow copy of
 * client content — and Elementor Pro form widgets store webhook URLs and
 * integration API keys in widget settings, so those land in it. Allowlist
 * what enters `args`."
 *
 * Deliberately pure and tiny: an unknown key never leaks by default, which
 * is the safe direction to fail in — a tool given no allowlist at all logs
 * an empty object, not its full argument set. There is no denylist path
 * through this function at all; that asymmetry is the whole point.
 */
export function redactArgs(
  args: Record<string, unknown> | undefined,
  allowlist: readonly string[],
): Record<string, unknown> {
  if (!args) {
    return {};
  }

  const result: Record<string, unknown> = {};

  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      result[key] = args[key];
    }
  }

  return result;
}
