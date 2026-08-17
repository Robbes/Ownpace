// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The appliance's half of the Dropbox shared-folder browse (workplan 0055
 * follow-up).
 *
 * A Dropbox shared folder that is MOUNTED lives in the account's own tree, so
 * it migrates as ordinary content — the question this script answers is
 * "which path do I put in rootPath?", not "how do I reach it?". An unmounted
 * one is listed without a path: it exists, but only Dropbox itself can mount
 * it into the tree. Same factory, same environment variable names a pass
 * reads, one read-only listing.
 *
 *   pnpm exec tsx scripts/list-dropbox-shared-folders.ts
 *
 * Needs DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN — the
 * refusal for a missing one names it, exactly as the first pass would. The
 * app additionally needs the `sharing.read` scope; without it Dropbox's own
 * refusal is printed verbatim, naming the scope.
 */

import { buildDropboxSourceFrom, ENV_DROPBOX_CREDENTIAL_NAMES } from '@openmig/orchestration/dropbox-source-factory';

async function main(): Promise<void> {
  const source = buildDropboxSourceFrom(
    {},
    {
      appKey: process.env.DROPBOX_APP_KEY,
      appSecret: process.env.DROPBOX_APP_SECRET,
      refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
    },
    ENV_DROPBOX_CREDENTIAL_NAMES,
  ) as {
    listSharedFolders?: () => Promise<ReadonlyArray<{ id: string; name: string; path?: string }>>;
  };

  if (typeof source.listSharedFolders !== 'function') {
    throw new Error('This Dropbox source cannot enumerate shared folders (wiring gap).');
  }
  const folders = await source.listSharedFolders();
  if (folders.length === 0) {
    console.log('This account sees no shared folders.');
    return;
  }
  console.log(`${folders.length} shared folder(s) visible to this account:\n`);
  for (const f of folders) {
    console.log(
      f.path
        ? `  ${f.path}  (${f.name})`
        : `  (not mounted)  ${f.name} — add it to the Dropbox first; only then does it have a path`,
    );
  }
  console.log(
    '\nPut the path in a mapping\'s "rootPath" to root the migration at that folder. A ' +
      "shared folder is somebody else's data arriving in this account's target, so give it " +
      'its own mapping (and usually a targetFolderPrefix).',
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
