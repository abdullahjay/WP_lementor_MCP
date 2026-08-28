import { createHash, randomUUID } from 'node:crypto';
import type { ToolImplementation } from '../protocol/types.js';
import { getDb } from '../db/connection.js';
import { resolveCurrentSite } from '../registry/currentSite.js';
import type { SiteRecord } from '../registry/reader.js';
import { writeLedgerEntry } from '../ledger/writer.js';
import { redactArgs } from '../ledger/redact.js';
import { LEDGER_ARGS_ALLOWLIST } from '../ledger/allowlists.js';
import {
  ApprovalContentChangedError,
  ApprovalTokenInvalidError,
  captureSnapshot,
  invalidateCache,
  publishDraft as publishDraftRemote,
  WordPressApiError,
} from '../wp/client.js';

// No OAuth yet (solution.md's decision table) — matches every other
// mutating tool's placeholder subject until a real per-caller identity
// exists (D2).
const LOCAL_SUBJECT = 'local-header-auth';

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    published: { type: 'boolean' },
    status: { type: 'string' },
    url: { type: ['string', 'null'] },
    message: { type: 'string' },
    approval_url: { type: 'string' },
  },
  required: ['published'],
  additionalProperties: false,
} as const;

/**
 * EMCP-047 — Blueprints.md §7.5. `confirmation_token` is never a boolean —
 * omitting it returns `pending` plus the exact wp-admin URL a human needs
 * to visit (D3's answer: a cookie/nonce-authenticated approval screen the
 * model's Application-Password REST credential cannot reach — see
 * `plugin/src/Admin/PublishApprovalPage.php`). Passing a token this tool
 * itself minted, forged, or otherwise obtained through any in-band channel
 * always fails signature verification server-side; there is no path from
 * "the model wants to publish" to "publishing happens" that doesn't cross
 * a real human clicking Approve in wp-admin.
 */
export const publishDraftTool: ToolImplementation = {
  name: 'publish_draft',
  description:
    'Publishes a page — either transitioning a new draft to published, or ' +
    "promoting a published page's pending autosave edits (from edit_elements) " +
    'onto the live content. Requires human approval: call without ' +
    'confirmation_token first to get an approval_url; a human must open that ' +
    'URL in their own browser (logged into WordPress), review the content, ' +
    'and approve — this tool cannot obtain that token itself, by design. ' +
    'Call again with the confirmation_token the approval page shows. The ' +
    'token is single-use, expires in minutes, and is invalidated if the ' +
    'content changes after approval — get a fresh one if either happens.',
  inputSchema: {
    type: 'object',
    properties: {
      post_id: { type: 'integer', description: 'The post ID, from list_pages.' },
      confirmation_token: {
        type: 'string',
        description: 'The token from the wp-admin approval page. Omit to get the approval_url instead.',
      },
    },
    required: ['post_id'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },

  async handler(args, correlationId) {
    const postId = args?.['post_id'];

    if (typeof postId !== 'number' || !Number.isInteger(postId)) {
      return errorResult('publish_draft requires an integer "post_id".');
    }

    const confirmationToken =
      typeof args?.['confirmation_token'] === 'string' && args['confirmation_token'] !== ''
        ? args['confirmation_token']
        : undefined;

    try {
      if (!confirmationToken) {
        const pending = await publishDraftRemote(postId);
        const result = pending.published
          ? { published: true, status: pending.status, url: pending.url }
          : { published: false, status: pending.status, message: pending.message, approval_url: pending.approvalUrl };

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        };
      }

      const db = getDb();
      let site: SiteRecord | undefined;
      try {
        site = await resolveCurrentSite(db);
      } catch {
        site = undefined;
      }

      // Captured before the attempt, not after a success is known — this is
      // the same "snapshot the current state before a write that will
      // overwrite it" pattern rollback relies on (a bad publish is itself
      // rollback-able once Blueprints.md §7.6's own noted follow-up lands),
      // not the wasteful-on-a-doomed-request pattern EMCP-044 flagged in
      // edit_elements (a rejected token here still means nothing was
      // written, but the snapshot itself is cheap and the alternative —
      // capturing only after success — would need a second read of state
      // that already changed).
      const snapshot = await captureSnapshot(postId, 'parent');

      const published = await publishDraftRemote(postId, confirmationToken);

      if (!published.published) {
        // Shouldn't happen with a real token present, but the client's
        // return type still allows it — treat it the same as the no-token
        // path rather than assuming.
        const result = {
          published: false,
          status: published.status,
          message: published.message,
          approval_url: published.approvalUrl,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        };
      }

      await invalidateCache(postId);

      const result = { published: true, status: published.status, url: published.url };

      if (site) {
        try {
          await writeLedgerEntry(db, {
            siteId: site.id,
            subject: LOCAL_SUBJECT,
            tool: 'publish_draft',
            redactedArgs: redactArgs({ post_id: postId }, LEDGER_ARGS_ALLOWLIST['publish_draft'] ?? []),
            correlationId: correlationId ?? randomUUID(),
            snapshotPointer: String(snapshot.id),
            // Never the raw token — same "only the hash, never the
            // presentable secret" rule the plugin's own nonce tables follow.
            approvalTokenRef: createHash('sha256').update(confirmationToken).digest('hex'),
          });
        } catch {
          // A ledger-write failure never fails a call whose WordPress write
          // already succeeded — same reasoning as every other mutating
          // tool's ledger write.
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
      };
    } catch (error) {
      return { content: [{ type: 'text', text: describeError(error, postId) }], isError: true };
    }
  },
};

function errorResult(message: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function describeError(error: unknown, postId: number): string {
  if (error instanceof ApprovalContentChangedError) {
    return error.message;
  }

  if (error instanceof ApprovalTokenInvalidError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    if (error.status === 403) {
      return `The authenticated user is not permitted to publish post ${postId}.`;
    }
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `publish_draft failed: ${error instanceof Error ? error.message : String(error)}`;
}
