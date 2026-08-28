/**
 * Blueprints.md §10: ledger args are "allowlisted in, not denylisted out"
 * (EMCP-038). Deliberately a side table, not a field on `ToolDescriptor` —
 * `registry.ts`'s `listTools()` spreads a tool's whole descriptor (minus
 * `handler`) straight into the public `tools/list` wire response, so
 * anything added there needs remembering to strip everywhere that matters.
 * A separate map has no such leak surface at all.
 *
 * A tool with no entry here logs no args — the safe default, not an
 * oversight to fix later. Every current tool is read-only with nothing
 * ledger-worthy in its arguments (`post_id`/`element_id` aren't secrets and
 * aren't especially reviewable either); this starts empty on purpose and
 * grows when a mutating tool (EMCP-043+) actually needs specific argument
 * names reviewable in the ledger.
 *
 * Any future mutating tool's entry here **must include `post_id`** if the
 * tool touches exactly one post — `rollback` (EMCP-039) reads
 * `redactedArgs.post_id` off a ledger row to know which post a change's
 * snapshot belongs to, since the ledger schema itself (Blueprints.md §10)
 * has no dedicated `post_id` column. Omitting it silently breaks rollback
 * for that tool's changes, not loudly.
 */
export const LEDGER_ARGS_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  // EMCP-043: the first real, registered mutating MCP tool. A batch can
  // touch several elements, but `rollback` only ever needs `post_id` — one
  // `edit_elements` call is one document save on one post.
  edit_elements: ['post_id'],
  // EMCP-047: same reasoning — `publish_draft` mutates exactly one post per
  // call, and a ledgered publish is what a future rollback-on-published-
  // content mechanism (Blueprints.md §7.6's own noted follow-up) would need
  // `post_id` for.
  publish_draft: ['post_id'],
};
