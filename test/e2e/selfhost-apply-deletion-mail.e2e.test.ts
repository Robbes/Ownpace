// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// `apply` (ADR-0024) against a REAL Stalwart (JMAP + IMAP) — the mail domain's
// third, alongside its file and calendar siblings
// (selfhost-apply-deletion-{file,calendar}.e2e.test.ts). Split into three FILES
// rather than three `describe` blocks in one so vitest's normal per-file
// thread pool runs them in parallel — see apply-deletion-lib.ts's header for
// why `describe.concurrent` was tried and rejected. e2e.yml invokes all three
// file paths in one `pnpm test:e2e` call.
//
// `<seed-2@dev.local>` already exists on the target — the restart-resume gate
// that runs before this step put it there. Its evidence is `trashed` (mail's
// only signal: the source's own `\Trash`-role mailbox), and its removal `kind`
// depends on whether the TARGET account has a `\Trash`-role mailbox of its
// own, so this is verified rather than assumed.
//
// `-2` rather than `-1`: the runbook script's default deletes
// `<seed-1@dev.local>` by hand, so `-2` is guaranteed untouched by anything
// upstream as long as SEED_COUNT >= 2 (the workflow's default is 5).
//
// Moves the message into the source's bin, waits for `GET /deletions` to
// confirm it as `trashed`, `POST`s apply, then verifies DIRECTLY OVER IMAP
// AGAINST THE REAL TARGET ACCOUNT — never just the appliance's own say-so —
// that the copy is gone from its original mailbox (and, if binned, sitting in
// the target's own Trash). Also proves apply's two safety properties for
// real, not just against MemoryLedger:
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
  STALWART_IMAPS_PORT,
  SOURCE_IMAP_PASSWORD,
  PASS_WAIT_MS,
  mailNaturalKeyHash,
  waitForConfirmedDeletion,
  applyDeletion,
  getDeletions,
  getDomainStatus,
  waitForNextPass,
  messageLocations,
  isBin,
  describeLocations,
} from './apply-deletion-lib.ts';

describe('apply — mail domain (JMAP/Stalwart)', () => {
  const MESSAGE_ID = '<seed-2@dev.local>';
  const MESSAGE_HASH = mailNaturalKeyHash(MESSAGE_ID);

  let mappingId = '';
  let lastSyncedAtBeforeApply: string | undefined;

  it(
    'moves the message into the source bin and the appliance reports it as trashed',
    async () => {
      execSync('node test/e2e/trash-imap-source.mjs', {
        stdio: 'inherit',
        env: {
          ...process.env,
          SEED_IMAP_HOST: '127.0.0.1',
          SEED_IMAP_PORT: STALWART_IMAPS_PORT,
          SEED_IMAP_TLS: 'true',
          SEED_IMAP_USER: 'source@dev.local',
          SEED_IMAP_PASSWORD: SOURCE_IMAP_PASSWORD,
          TRASH_MESSAGE_ID: MESSAGE_ID,
        },
      });
      const { mappingId: id, entry } = await waitForConfirmedDeletion(MESSAGE_HASH, PASS_WAIT_MS);
      mappingId = id;
      expect(entry.evidence).toBe('trashed');
      lastSyncedAtBeforeApply = (await getDomainStatus('email'))?.lastSyncedAt;
    },
    PASS_WAIT_MS + 60000,
  );

  it('apply removes the target copy, verified directly over IMAP against the real account', async () => {
    // "Live" and "binned" are decided BY FLAG throughout — see `isBin`. Matching
    // the mailbox NAME is what made an earlier version of this test fail a
    // perfectly correct removal, because Stalwart's `\Trash` mailbox is called
    // "Deleted Items" and the assertion was looking for /trash/i.
    const before = messageLocations(MESSAGE_ID);
    expect(
      before.filter((m) => !isBin(m)).length,
      `message must still be live on the target before apply (found in: ${describeLocations(before)})`,
    ).toBeGreaterThan(0);

    const { status, body } = await applyDeletion(mappingId, MESSAGE_HASH);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.action).toBe('apply');
    expect(['binned', 'deleted']).toContain(body.kind);

    const after = messageLocations(MESSAGE_ID);

    // The property that actually matters, and it is stronger than "gone from
    // INBOX": after a removal the message must sit in NO live mailbox at all.
    // Leaving a copy in Archive while Inbox was cleared would satisfy the old
    // assertion and still leave the item visible in the new system.
    expect(
      after.filter((m) => !isBin(m)).map((m) => m.path),
      `message must be gone from every live mailbox, still found in: ${describeLocations(after)}`,
    ).toEqual([]);

    // Verified against what actually happened rather than assumed: whether the
    // Stalwart target account provisions a \Trash-role mailbox is a property of
    // the server, and jmap-target.ts's trashMailboxId() decides `kind` at
    // runtime from exactly that — see ADR-0024.
    if (body.kind === 'binned') {
      expect(
        after.some((m) => isBin(m)),
        `kind=binned promises the message is recoverable from the account's own bin, but it ` +
          `is in no \\Trash-flagged mailbox: ${describeLocations(after)}`,
      ).toBe(true);
    } else {
      expect(
        after,
        `kind=deleted promises no recovery path, so the message must be gone from every ` +
          `mailbox including the bin: ${describeLocations(after)}`,
      ).toHaveLength(0);
    }
  }, 30000);

  it('a second apply on the same item is refused, not a silent no-op', async () => {
    const { status, body } = await applyDeletion(mappingId, MESSAGE_HASH);
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe('already_applied');
  }, 15000);

  it(
    'the removal survives one more sync pass — no resurrection on the target',
    async () => {
      await waitForNextPass('email', lastSyncedAtBeforeApply, PASS_WAIT_MS);

      const after = messageLocations(MESSAGE_ID);
      expect(
        after.filter((m) => !isBin(m)).map((m) => m.path),
        `apply must not be silently undone by the next pass, but the message is live again in: ` +
          describeLocations(after),
      ).toEqual([]);

      const q = await getDeletions();
      expect(q.confirmed.map((d) => d.naturalKeyHash)).not.toContain(MESSAGE_HASH);
      expect(q.acknowledged.map((d) => d.naturalKeyHash)).toContain(MESSAGE_HASH);
    },
    PASS_WAIT_MS + 60000,
  );
});
