// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROOT FOLDER CHOSEN BEFORE THE FIRST ITEM (0153 open question 5, item 4;
 * the owner, 2026-10-04: *"go with the recommendations"*).
 *
 * `PUT /api/migrations/:mappingId` refused `rootFolderId` on every migration,
 * including one set up and not yet started, and dropped Dropbox's `rootPath`
 * without a word. The table's own reason is about items already copied, which
 * a migration that has copied nothing does not have. So the folder may change
 * until the ledger holds an item, and this module is the three things the
 * route needs for that:
 *
 * - `hasCopiedAnything`: whether the ledger holds an item, which is what
 *   `RevisionFacts.copiedAnything` asks;
 * - `rootRevision`: the folder a patch body sets, in the spelling it used;
 * - `revisedRoot`: that folder checked against the source it would apply to,
 *   through the parser a pass reads it with, as the override it becomes.
 */

import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import { ConfigError, parseDropboxSource, parseGoogleDriveSource } from '@openmig/shared';

/** Whether this migration's ledger holds an item: anything copied, adopted or begun. */
export async function hasCopiedAnything(db: PgDatabase, tenantId: string, mappingId: string): Promise<boolean> {
  const [one] = await db
    .select({ id: schema.item.id })
    .from(schema.item)
    .where(and(eq(schema.item.tenantId, tenantId), eq(schema.item.mappingId, mappingId)))
    .limit(1);
  return one !== undefined;
}

/** The two spellings of one setting: Drive and Box name a folder, Dropbox a path. */
export type RootKey = 'rootFolderId' | 'rootPath';

/** The key each source kind keeps its root folder under, where it has one. */
const ROOT_KEY_OF_KIND: Readonly<Record<string, RootKey>> = {
  google_drive: 'rootFolderId',
  box: 'rootFolderId',
  dropbox: 'rootPath',
};

/**
 * The folder a patch body sets, in the spelling it used; undefined where it
 * sets none. Trimmed, and empty means the whole account again.
 */
export function rootRevision(
  sourceConfig: { readonly rootFolderId?: string | undefined; readonly rootPath?: string | undefined } | undefined,
): { readonly key: RootKey; readonly value: string } | undefined {
  if (sourceConfig?.rootFolderId !== undefined) return { key: 'rootFolderId', value: sourceConfig.rootFolderId.trim() };
  if (sourceConfig?.rootPath !== undefined) return { key: 'rootPath', value: sourceConfig.rootPath.trim() };
  return undefined;
}

/** What `revisedRoot` answers: the override to write, or why not, in words for the person. */
export type RootOutcome =
  | { readonly ok: true; readonly override: Record<string, unknown> }
  | { readonly ok: false; readonly field: RootKey; readonly message: string };

/**
 * The folder checked against the source it would apply to, as the override it
 * becomes.
 *
 * - A source with no folder to start from is refused by name, as a format for
 *   another source is: stored, it would be read by nothing.
 * - The other spelling is refused with the one that works.
 * - A value goes through the parser a pass reads it with, so nothing is stored
 *   that the next pass would refuse.
 * - Empty takes the folder off THIS migration's override. Where the account
 *   itself holds one, that is refused rather than done: the override gone,
 *   the account's folder would still apply, and the whole account would not.
 */
export function revisedRoot(
  revision: { readonly key: RootKey; readonly value: string },
  source: { readonly kind: string; readonly config: unknown },
  currentOverride: Readonly<Record<string, unknown>>,
): RootOutcome {
  const key = ROOT_KEY_OF_KIND[source.kind];
  if (key === undefined) {
    return {
      ok: false,
      field: revision.key,
      message:
        'This migration copies from a source that has no folder to start from: it always reads the whole ' +
        'account, so there is no folder to choose.',
    };
  }
  if (key !== revision.key) {
    return {
      ok: false,
      field: revision.key,
      message:
        key === 'rootPath'
          ? 'A Dropbox migration starts from a folder PATH: send it as rootPath, such as "/Photos".'
          : 'This migration starts from a folder ID: send it as rootFolderId. rootPath is a Dropbox path.',
    };
  }
  if (revision.value === '') {
    const own = (source.config ?? {}) as Record<string, unknown>;
    if (typeof own[key] === 'string' && own[key] !== '') {
      return {
        ok: false,
        field: key,
        message:
          "This migration's folder was set on its account when the account was added, so it cannot be " +
          'taken off here. Start a new migration for the whole account.',
      };
    }
    const { [key]: _gone, ...rest } = currentOverride;
    return { ok: true, override: rest };
  }
  try {
    // Box's folder id is read by the same rule as Drive's, a non-empty
    // string, and shared exports Drive's parser for it.
    if (key === 'rootPath') parseDropboxSource({ rootPath: revision.value });
    else parseGoogleDriveSource({ rootFolderId: revision.value });
  } catch (error) {
    if (error instanceof ConfigError) return { ok: false, field: key, message: error.message };
    throw error;
  }
  return { ok: true, override: { ...currentOverride, [key]: revision.value } };
}
