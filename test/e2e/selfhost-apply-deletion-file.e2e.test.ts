// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// `apply` (ADR-0024) against a REAL Nextcloud — the file domain's third, since
// the mail and calendar domains each have their own sibling file
// (selfhost-apply-deletion-{mail,calendar}.e2e.test.ts). Split into three FILES
// rather than three `describe` blocks in one so vitest's normal per-file
// thread pool runs them in parallel — see apply-deletion-lib.ts's header for
// why `describe.concurrent` was tried and rejected. e2e.yml invokes all three
// file paths in one `pnpm test:e2e` call.
//
// `dav-seed-file-2.txt` (WebDAV/Nextcloud) already exists on the target — the
// restart-resume gate that runs before this step put it there. Its evidence is
// `trashed` (the account's own trashbin), and its removal is always `binned`
// (a Nextcloud files DELETE lands in that account's own trashbin too).
//
// `-2` rather than `-1`: the restart-resume gate that runs first relocates
// `dav-seed-event-1@dev.local` (its move-detection case, in the calendar
// sibling here) and the runbook script's default deletes `dav-seed-file-1.txt`
// by hand, so `-2` is guaranteed untouched by anything upstream as long as
// SEED_COUNT >= 2 (the workflow's default is 5).
//
// Deletes the file on the source, waits for `GET /deletions` to confirm it as
// `trashed`, `POST`s apply, then verifies DIRECTLY AGAINST THE REAL NEXTCLOUD —
// never just the appliance's own say-so — that the copy is gone from its live
// path and sitting in the target account's own trashbin. Also proves apply's
// two safety properties for real, not just against MemoryLedger:
//   - a second `apply` on the same item is refused (`already_applied`), not a
//     silently-successful no-op.
//   - the tombstone survives a further real sync pass: the item is not
//     resurrected on the target — the exact self-introduced bug ADR-0024
//     documents catching before it ever reached a test run.
//
// PREREQUISITES: same running stack as selfhost-restart-resume.e2e.test.ts,
// which MUST have run to completion first, and `allowApplyDeletions: true` on
// the mapping (e2e.yml's config-generation step sets this).

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import {
  NEXTCLOUD_URL,
  DAV_TARGET_USER,
  TARGET_DAV_PASSWORD,
  PASS_WAIT_MS,
  fileNaturalKeyHash,
  waitForConfirmedDeletion,
  applyDeletion,
  getDeletions,
  getDomainStatus,
  waitForNextPass,
  davAuthHeader,
  readTargetTrashbin,
} from './apply-deletion-lib.ts';

describe('apply — file domain (WebDAV/Nextcloud)', () => {
  const FILE_NAME = 'dav-seed-file-2.txt';
  const FILE_HASH = fileNaturalKeyHash(FILE_NAME);
  const LIVE_URL = `${NEXTCLOUD_URL}/remote.php/dav/files/${DAV_TARGET_USER}/${encodeURIComponent(FILE_NAME)}`;

  let mappingId = '';
  let lastSyncedAtBeforeApply: string | undefined;

  it(
    'deletes the file on the source and the appliance reports it as trashed',
    async () => {
      execSync('node test/e2e/trash-dav-file-source.mjs', {
        stdio: 'inherit',
        env: { ...process.env, TRASH_FILE_NAME: FILE_NAME },
      });
      const { mappingId: id, entry } = await waitForConfirmedDeletion(FILE_HASH, PASS_WAIT_MS);
      mappingId = id;
      expect(entry.evidence).toBe('trashed');
      lastSyncedAtBeforeApply = (await getDomainStatus('file'))?.lastSyncedAt;
    },
    PASS_WAIT_MS + 60000,
  );

  it('apply removes the target copy, verified directly against the real Nextcloud', async () => {
    const before = await fetch(LIVE_URL, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
    expect(before.status, 'the file must still be live on the target before apply').toBe(200);

    const { status, body } = await applyDeletion(mappingId, FILE_HASH);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.action).toBe('apply');
    // A Nextcloud files DELETE always lands in that account's own trashbin.
    expect(body.kind).toBe('binned');

    const afterLive = await fetch(LIVE_URL, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
    expect(afterLive.status, 'the file must no longer be at its live target path').toBe(404);

    const bin = await readTargetTrashbin();
    expect(bin, `target trashbin does not list ${FILE_NAME}: ${JSON.stringify(bin)}`).toContain(FILE_NAME);
  }, 30000);

  it('a second apply on the same item is refused, not a silent no-op', async () => {
    const { status, body } = await applyDeletion(mappingId, FILE_HASH);
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe('already_applied');
  }, 15000);

  it(
    'the removal survives one more sync pass — no resurrection on the target',
    async () => {
      await waitForNextPass('file', lastSyncedAtBeforeApply, PASS_WAIT_MS);

      const afterLive = await fetch(LIVE_URL, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
      expect(afterLive.status, 'apply must not be silently undone by the next pass').toBe(404);

      const q = await getDeletions();
      expect(q.confirmed.map((d) => d.naturalKeyHash)).not.toContain(FILE_HASH);
      expect(q.acknowledged.map((d) => d.naturalKeyHash)).toContain(FILE_HASH);
    },
    PASS_WAIT_MS + 60000,
  );
});
