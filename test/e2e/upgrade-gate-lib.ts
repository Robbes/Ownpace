// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The upgrade gate's arithmetic (workplan 0179 T5), kept apart from its Docker
 * so that `upgrade-gate-lib.unit.test.ts` can hold it off the stack. Imports
 * nothing but Node's own modules, as every file of this directory does.
 */

/** The gate's mapping id: its own, so its rows are never the other gates'. */
export const UPGRADE_MAPPING_ID = '79797979-7979-4979-8979-797979797979';

/**
 * Where it writes on the target. Mail folders and files land under it; the
 * calendars and address books merge whatever the prefix (`MappingConfig`), so
 * the gate runs after every other gate has read the target.
 */
export const UPGRADE_PREFIX = 'upgrade-gate';

/** A mapping file as the workflow prepares it, read as JSON. */
export type MappingFile = Record<string, unknown> & { mappingId: string; targetFolderPrefix?: string };

/** The prepared mapping, under the gate's own id and folder. The input is not changed. */
export function upgradeMapping(prepared: MappingFile): MappingFile {
  if (prepared.targetFolderPrefix) {
    throw new Error(
      `the prepared mapping already writes under "${prepared.targetFolderPrefix}"; the upgrade gate ` +
        `needs a folder of its own, and will not replace one it was not told about`,
    );
  }
  return { ...structuredClone(prepared), mappingId: UPGRADE_MAPPING_ID, targetFolderPrefix: UPGRADE_PREFIX };
}

/**
 * `SELECT domain, status, count(*) … GROUP BY 1, 2` as `psql -At` prints it,
 * keyed `"<domain> <status>"`. An empty ledger is refused: comparing it after
 * an upgrade would compare nothing with nothing.
 */
export function ledgerCounts(psqlAt: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of psqlAt.split('\n')) {
    if (line.trim() === '') continue;
    const m = /^([a-z_]+)\|([a-z_]+)\|(\d+)$/.exec(line.trim());
    if (!m) throw new Error(`the ledger read gave a line this cannot read: ${JSON.stringify(line)}`);
    counts[`${m[1]} ${m[2]}`] = Number(m[3]);
  }
  if (Object.keys(counts).length === 0) {
    throw new Error('the ledger holds no item, so an upgrade would compare nothing with nothing');
  }
  return counts;
}

/**
 * What the new build applied on top of the released database: `before` and
 * `after` are `schema_migrations` as read on each side, `built` this build's
 * own chain (`packages/ledger/migrations`). Refused when the upgrade lost a
 * migration the released database had, or ends short of the build's newest.
 */
export function migrationsCrossed(
  before: readonly string[],
  after: readonly string[],
  built: readonly string[],
): { crossed: string[] } {
  const lost = before.filter((v) => !after.includes(v));
  if (lost.length > 0) throw new Error(`the upgraded database no longer records ${lost.join(', ')}`);
  const missing = built.filter((v) => !after.includes(v));
  if (missing.length > 0) throw new Error(`the upgraded database never applied ${missing.join(', ')}`);
  return { crossed: after.filter((v) => !before.includes(v)) };
}

/**
 * The gate's folder on the target, as a path under the target user's files.
 *
 * Made by the gate before the released appliance's first pass (E2E (self-hosted)
 * 45992857614): the WebDAV writer makes the prefix only on the way to a
 * subfolder, so a file at the root of the source, written before any subfolder,
 * is PUT into a collection that is not there, and Nextcloud answers 404. The
 * gate measures an upgrade, and the release it upgrades from keeps that gap.
 */
export function prefixFolderPath(targetUser: string): string {
  return `/remote.php/dav/files/${encodeURIComponent(targetUser)}/${UPGRADE_PREFIX}/`;
}

/** A MKCOL's answer: 201 made it, 405 found it there already; anything else is refused. */
export function folderMade(status: number): 'made' | 'there' {
  if (status === 201) return 'made';
  if (status === 405) return 'there';
  throw new Error(`MKCOL of the gate's folder on the target answered ${status}, so its files have nowhere to go`);
}

/** A DELETE's answer at teardown: 204 took it back, 404 found it gone; anything else is refused. */
export function folderTakenBack(status: number): true {
  if (status === 204 || status === 404) return true;
  throw new Error(`DELETE of the gate's folder on the target answered ${status}, so what it wrote there stays`);
}
