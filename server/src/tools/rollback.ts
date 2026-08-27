import type { ToolImplementation } from '../protocol/types.js';
import { getDb } from '../db/connection.js';
import { CurrentSiteUnregisteredError, resolveCurrentSite } from '../registry/currentSite.js';
import type { Database } from '../registry/reader.js';
import { getChange } from '../ledger/query.js';
import {
  captureSnapshot,
  getDocument,
  invalidateCache,
  restoreSnapshot,
  WordPressApiError,
} from '../wp/client.js';

const MAX_CHANGE_IDS = 20;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          change_id: { type: 'string' },
          restored: { type: 'boolean' },
          post_id: { type: 'integer' },
          pre_rollback_snapshot_id: { type: 'integer' },
          hash: { type: 'string' },
          error: { type: 'string' },
        },
        required: ['change_id', 'restored'],
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

interface RollbackResult {
  change_id: string;
  restored: boolean;
  post_id?: number;
  pre_rollback_snapshot_id?: number;
  hash?: string;
  error?: string;
}

/**
 * EMCP-039: the "Safety" tool group's write half. Bounded (`change_ids`
 * capped at {@link MAX_CHANGE_IDS} — solution.md §8's "max N changes"),
 * never crossing a site boundary (`getChange`'s query is scoped to the
 * resolved site; a change id belonging to another site simply doesn't
 * resolve, same as if it never existed), and snapshotted before it runs
 * — every restore is preceded by its own fresh snapshot of the *current*
 * state, so a bad rollback is itself rollback-able.
 *
 * Each `change_ids` entry is processed independently: one failure doesn't
 * abort the rest, and the response reports per-change outcomes rather than
 * an all-or-nothing result, since these are typically unrelated posts.
 */
export const rollbackTool: ToolImplementation = {
  name: 'rollback',
  description:
    'Reverts one or more prior changes (by id, from list_changes) to the ' +
    'state captured in that change\'s snapshot. Bounded to ' +
    `${MAX_CHANGE_IDS} changes per call. Refuses a change whose target post ` +
    'is currently published — that needs the same out-of-band approval ' +
    'publish_draft does, which this build does not yet support. Always ' +
    'snapshots the current state before restoring, so the rollback itself ' +
    'can be undone.',
  inputSchema: {
    type: 'object',
    properties: {
      change_ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: MAX_CHANGE_IDS,
        description: 'Change ids from list_changes to revert.',
      },
    },
    required: ['change_ids'],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  cacheScope: 'private',
  ttlMs: 0,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },

  async handler(args) {
    const changeIds = args?.['change_ids'];

    if (!Array.isArray(changeIds) || changeIds.length === 0 || !changeIds.every((v) => typeof v === 'string')) {
      return {
        content: [{ type: 'text', text: 'rollback requires a non-empty array of string "change_ids".' }],
        isError: true,
      };
    }

    if (changeIds.length > MAX_CHANGE_IDS) {
      return {
        content: [
          { type: 'text', text: `rollback accepts at most ${MAX_CHANGE_IDS} change_ids per call; got ${changeIds.length}.` },
        ],
        isError: true,
      };
    }

    try {
      const db = getDb();
      const site = await resolveCurrentSite(db);

      const results: RollbackResult[] = [];
      for (const changeId of changeIds) {
        results.push(await rollbackOne(db, site.id, changeId));
      }

      const anySucceeded = results.some((r) => r.restored);

      return {
        content: [{ type: 'text', text: JSON.stringify({ results }) }],
        structuredContent: { results },
        isError: !anySucceeded,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: describeError(error) }],
        isError: true,
      };
    }
  },
};

async function rollbackOne(db: Database, siteId: string, changeId: string): Promise<RollbackResult> {
  const change = await getChange(db, siteId, changeId);

  if (!change) {
    return { change_id: changeId, restored: false, error: 'No such change on this site.' };
  }

  if (!change.snapshotPointer) {
    return { change_id: changeId, restored: false, error: 'This change has no recorded snapshot to roll back to.' };
  }

  const snapshotId = Number(change.snapshotPointer);
  if (!Number.isInteger(snapshotId)) {
    return { change_id: changeId, restored: false, error: 'This change\'s snapshot pointer is not a valid snapshot id.' };
  }

  const postIdRaw = change.redactedArgs['post_id'];
  if (typeof postIdRaw !== 'number' || !Number.isInteger(postIdRaw)) {
    return {
      change_id: changeId,
      restored: false,
      error: 'This change did not record a post_id in its ledger args, so rollback cannot determine what to restore.',
    };
  }

  try {
    const document = await getDocument(postIdRaw);

    if (document['status'] === 'publish') {
      return {
        change_id: changeId,
        restored: false,
        post_id: postIdRaw,
        error:
          'Refusing: this post is currently published. Rolling back a published post requires the same ' +
          'out-of-band approval publish_draft does, which is not yet implemented.',
      };
    }

    const preRollback = await captureSnapshot(postIdRaw, 'parent');
    const restored = await restoreSnapshot(snapshotId);
    await invalidateCache(postIdRaw);

    return {
      change_id: changeId,
      restored: true,
      post_id: postIdRaw,
      pre_rollback_snapshot_id: preRollback.id,
      hash: restored.hash,
    };
  } catch (error) {
    return { change_id: changeId, restored: false, post_id: postIdRaw, error: describeError(error) };
  }
}

function describeError(error: unknown): string {
  if (error instanceof CurrentSiteUnregisteredError) {
    return error.message;
  }

  if (error instanceof WordPressApiError) {
    return `WordPress returned ${error.status}: ${error.message}`;
  }

  return `rollback failed: ${error instanceof Error ? error.message : String(error)}`;
}
