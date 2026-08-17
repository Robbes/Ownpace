// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Files a Google account owns that NO migration can reach by walking down from
 * a root (workplan 0058) — the coverage check.
 *
 * Drive is the one provider where a file genuinely floats. Delete a parent
 * folder without deleting its contents, or create a file through the API with
 * no `parents`, and the file stays in the account: owned, intact, and
 * reachable by search but by no path. Drive's own UI hides these (you find
 * them with `is:unorganized`), and every migration here enumerates by walking
 * DOWN from `rootFolderId` — so a pass never lists them, never copies them,
 * and without this never mentions them either.
 *
 *   pnpm exec tsx scripts/list-drive-orphans.ts
 *
 * Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN — the
 * refusal for a missing one names it, exactly as the first pass would.
 * Read-only: one `files.list` over the account's own files, asking for
 * `parents` and nothing else.
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
    listOrphanedFiles?: (options?: { maxItems?: number }) => Promise<{
      files: ReadonlyArray<{ id: string; name: string }>;
      capped: boolean;
    }>;
  };

  if (typeof source.listOrphanedFiles !== 'function') {
    throw new Error('This Drive source cannot report orphaned files (wiring gap).');
  }

  const { files, capped } = await source.listOrphanedFiles();
  if (files.length === 0) {
    console.log(
      'No orphaned files: everything this account owns hangs under a folder, so a migration ' +
        'rooted at My Drive can reach all of it.',
    );
    return;
  }

  console.log(
    `${files.length}${capped ? '+ (capped)' : ''} file(s) this account owns are not under ANY ` +
      'folder, so no migration will copy them:\n',
  );
  for (const f of files) {
    console.log(`  ${f.id}  ${f.name}`);
  }
  console.log(
    '\nThese are not lost and nothing here changes them. To migrate one, move it into a folder ' +
      'inside the migration root (Drive: open it by id, "Organise" → move) and it will be picked ' +
      'up by the next pass like any other file.',
  );
  if (capped) {
    console.log(
      '\nThe listing stopped at its cap, so this is NOT the whole set — re-run with a larger ' +
        'cap once the ones above are dealt with.',
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
