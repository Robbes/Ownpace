// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The appliance's half of the shared-FOLDER browse (workplan 0051).
 *
 * "Shared with me" is a view, not a folder: no walk from a mapping's root can
 * reach it, so a folder somebody shared with this account migrates by rooting
 * a SEPARATE mapping at the folder's own id. This script answers "which id?"
 * exactly as `list-shared-drives.ts` does for shared drives: the SAME factory,
 * the SAME environment variable names a pass reads, one read-only listing,
 * ids printed beside their names (and the sharer's address — two people can
 * each share a folder named "Administratie").
 *
 *   pnpm exec tsx scripts/list-shared-folders.ts
 *
 * Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN — the
 * refusal for a missing one names it, exactly as the first pass would.
 */

import { buildGoogleDriveSourceFrom, ENV_GOOGLE_CREDENTIAL_NAMES } from '@openmig/orchestration/drive-source-factory';

async function main(): Promise<void> {
  const source = buildGoogleDriveSourceFrom(
    {},
    {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    },
    ENV_GOOGLE_CREDENTIAL_NAMES,
  ) as {
    listSharedWithMeFolders?: () => Promise<
      ReadonlyArray<{ id: string; name: string; owner?: string }>
    >;
  };

  if (typeof source.listSharedWithMeFolders !== 'function') {
    throw new Error('This Drive source cannot enumerate shared folders (wiring gap).');
  }
  const folders = await source.listSharedWithMeFolders();
  if (folders.length === 0) {
    console.log(
      'No folders are shared with this credential. Loose shared FILES (not in a folder) ' +
        'cannot be migrated by rooting a mapping — see docs/feature-matrix.md.',
    );
    return;
  }
  console.log(`${folders.length} shared folder(s) visible to this credential:\n`);
  for (const f of folders) {
    console.log(`  ${f.id}  ${f.name}${f.owner ? `  (shared by ${f.owner})` : ''}`);
  }
  console.log(
    '\nPut the id in a mapping\'s "rootFolderId" to migrate that folder. One mapping per ' +
      'root: a shared folder is somebody else\'s data arriving in this account\'s target, ' +
      'so give it its own mapping (and usually a targetFolderPrefix).',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
