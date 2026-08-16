// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The appliance's half of the shared-drive browse (workplan 0049).
 *
 * The managed wizard answers "which id goes in rootFolderId?" with a button;
 * the appliance's create path is a config file, so its answer is this script:
 * the SAME factory, the SAME environment variable names a pass reads, one
 * read-only `drives.list`, and the ids printed beside their names ready to be
 * pasted into the mapping.
 *
 *   pnpm exec tsx scripts/list-shared-drives.ts
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
  ) as { listSharedDrives?: () => Promise<ReadonlyArray<{ id: string; name: string }>> };

  if (typeof source.listSharedDrives !== 'function') {
    throw new Error('This Drive source cannot enumerate shared drives (wiring gap).');
  }
  const drives = await source.listSharedDrives();
  if (drives.length === 0) {
    console.log(
      'This credential sees no shared drives. Leaving rootFolderId unset migrates My Drive.',
    );
    return;
  }
  console.log(`${drives.length} shared drive(s) visible to this credential:\n`);
  for (const d of drives) {
    console.log(`  ${d.id}  ${d.name}`);
  }
  console.log('\nPut the id in the mapping\'s "rootFolderId" to migrate that drive.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
