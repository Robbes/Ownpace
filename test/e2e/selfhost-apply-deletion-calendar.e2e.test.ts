// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// `apply` (ADR-0024) against a REAL Nextcloud (CalDAV) — the calendar domain's
// third, alongside its file and mail siblings
// (selfhost-apply-deletion-{file,mail}.e2e.test.ts). Split into three FILES
// rather than three `describe` blocks in one so vitest's normal per-file
// thread pool runs them in parallel — see apply-deletion-lib.ts's header for
// why `describe.concurrent` was tried and rejected. e2e.yml invokes all three
// file paths in one `pnpm test:e2e` call.
//
// `dav-seed-event-2@dev.local` already exists on the target — the
// restart-resume gate that runs before this step put it there. Its evidence is
// `reported` (the `sync-collection` REPORT names it directly), and its removal
// is always `deleted` — the writer never claims `binned` for calendar objects,
// since whether a given Nextcloud version retains a deleted calendar object is
// not something this tool can detect from the outside (see ADR-0024).
//
// `-2` rather than `-1`: the restart-resume gate that runs first relocates
// `dav-seed-event-1@dev.local` (its own move-detection case), so `-2` is
// guaranteed untouched by anything upstream as long as SEED_COUNT >= 2 (the
// workflow's default is 5).
//
// Deletes the event on the source, waits for `GET /deletions` to confirm it as
// `reported`, `POST`s apply, then verifies DIRECTLY AGAINST THE REAL
// NEXTCLOUD — never just the appliance's own say-so — that the event is gone
// from its target href. Also proves apply's two safety properties for real,
// not just against MemoryLedger:
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
  calendarNaturalKeyHash,
  waitForConfirmedDeletion,
  applyDeletion,
  getDeletions,
  getDomainStatus,
  waitForNextPass,
  davAuthHeader,
} from './apply-deletion-lib';

describe('apply — calendar domain (CalDAV/Nextcloud)', () => {
  const EVENT_UID = 'dav-seed-event-2@dev.local';
  const EVENT_HASH = calendarNaturalKeyHash(EVENT_UID);
  const TARGET_HREF = `${NEXTCLOUD_URL}/remote.php/dav/calendars/${DAV_TARGET_USER}/personal/${EVENT_UID}.ics`;

  let mappingId = '';
  let lastSyncedAtBeforeApply: string | undefined;

  it(
    'deletes the event on the source and the appliance reports it as reported',
    async () => {
      execSync('node test/e2e/trash-caldav-source.mjs', {
        stdio: 'inherit',
        env: { ...process.env, TRASH_EVENT_UID: EVENT_UID },
      });
      const { mappingId: id, entry } = await waitForConfirmedDeletion(EVENT_HASH, PASS_WAIT_MS);
      mappingId = id;
      expect(entry.evidence).toBe('reported');
      lastSyncedAtBeforeApply = (await getDomainStatus('calendar'))?.lastSyncedAt;
    },
    PASS_WAIT_MS + 60000,
  );

  it('apply removes the target copy, verified directly against the real Nextcloud', async () => {
    const before = await fetch(TARGET_HREF, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
    expect(before.status, 'the event must still be live on the target before apply').toBe(200);

    const { status, body } = await applyDeletion(mappingId, EVENT_HASH);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.action).toBe('apply');
    // CalDAV/CardDAV removals always report `deleted` — see ADR-0024: whether a
    // given Nextcloud version retains a deleted calendar object is not
    // detectable from the outside, so recoverability is never claimed here.
    expect(body.kind).toBe('deleted');

    const after = await fetch(TARGET_HREF, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
    expect(after.status, 'the event must no longer exist at its target href').toBe(404);
  }, 30000);

  it('a second apply on the same item is refused, not a silent no-op', async () => {
    const { status, body } = await applyDeletion(mappingId, EVENT_HASH);
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe('already_applied');
  }, 15000);

  it(
    'the removal survives one more sync pass — no resurrection on the target',
    async () => {
      await waitForNextPass('calendar', lastSyncedAtBeforeApply, PASS_WAIT_MS);

      const after = await fetch(TARGET_HREF, { headers: davAuthHeader(DAV_TARGET_USER, TARGET_DAV_PASSWORD) });
      expect(after.status, 'apply must not be silently undone by the next pass').toBe(404);

      const q = await getDeletions();
      expect(q.confirmed.map((d) => d.naturalKeyHash)).not.toContain(EVENT_HASH);
      expect(q.acknowledged.map((d) => d.naturalKeyHash)).toContain(EVENT_HASH);
    },
    PASS_WAIT_MS + 60000,
  );
});
