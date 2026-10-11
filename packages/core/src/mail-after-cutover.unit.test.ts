// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MAIL PASS THAT STARTS AFTER CUTOVER (0117 D4; the owner, 2026-10-05).
 *
 * Mail's deletion evidence is the bin, and since 0026 also Microsoft's own
 * `@removed` reports. Both reach `runDomainSync` through the mail wrapper,
 * `runShadowPass`, and the only thing that keeps them away after cutover is
 * the answer the wrapper carries down verbatim,
 * `sourceIsAuthorityOnExistence`. The rule itself is pinned per producer in
 * `a-lane-that-runs-with-the-detector-present.unit.test.ts`, but that suite
 * calls `runDomainSync` directly, so a mail wrapper that lost the answer on
 * its way down (a literal `true`, a default) left every test green. A
 * reviewer of the after-cutover findings checked: no unit test caught it.
 *
 * The owner, 2026-10-05: *"after cross over the bin reading and deleting on
 * target should stop, because perhaps source-leavers clean up ALL after the
 * cross over."* So the case here is that leaver: a message thrown in the
 * bin, and another deleted outright, after the switch. The pass still runs,
 * and still copies what is new (0128 D1); it reads nothing from the bin,
 * resolves no removal, and leaves the bin's scan cursor where the last pass
 * before the cutover put it.
 *
 * Run once before the cutover as well, so that a fixture that cannot produce
 * the two signals cannot pass by saying nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runShadowPass } from './reconcile.ts';
import { MemorySource, MemoryTarget, MemoryLedger, MemoryCursorStore } from './__testing__/memory.ts';
import {
  asTenantId,
  asMappingId,
  setLogLevel,
  resetLogLevel,
  discardedScanCursorKey,
  naturalKeyHash,
} from '@openmig/shared';

const TENANT = asTenantId('c0060000-e29b-41d4-a716-4466554410aa');
const MAPPING = asMappingId('c0060000-e29b-41d4-a716-4466554410bb');

beforeEach(() => setLogLevel('error'));
afterEach(() => {
  resetLogLevel();
  vi.restoreAllMocks();
});

/**
 * A mailbox copied once before the cutover, then cleaned up by its leaver:
 * `<a>` thrown in the bin, `<b>` deleted outright (Graph's `@removed`), and a
 * new message arriving in a folder nothing had listed yet.
 */
async function aLeaverCleansUp(afterCutover: boolean) {
  const source = new MemorySource();
  source.add({ folderPath: 'INBOX', messageId: '<a@dev.local>', rfc822: 'Subject: a\r\n\r\nbody' });
  source.add({ folderPath: 'INBOX', messageId: '<b@dev.local>', rfc822: 'Subject: b\r\n\r\nbody' });
  source.add({ folderPath: 'Trash', specialUse: 'trash', messageId: '<old@dev.local>', rfc822: 'Subject: old\r\n\r\nbody' });
  const target = new MemoryTarget();
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();

  // Before the cutover: the old system decides what exists.
  const first = await runShadowPass({
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
    tenantId: TENANT,
    mappingId: MAPPING,
    source,
    target,
    ledger,
    cursors,
  });
  expect(first.created, 'the fixture copied nothing, so nothing below can be lost').toBe(2);
  const binCursorBefore = await cursors.get(TENANT, MAPPING, discardedScanCursorKey('Trash'));
  expect(binCursorBefore, 'the first pass read no bin, so nothing below could be held still').toBeDefined();

  // The leaver cleans up.
  expect(source.move('<a@dev.local>', 'INBOX', 'Trash')).toBe(true);
  expect(source.reportRemoved('<b@dev.local>', 'INBOX')).toBe(true);
  source.add({ folderPath: 'Projects', messageId: '<new@dev.local>', rfc822: 'Subject: new\r\n\r\nbody' });

  const listed: string[] = [];
  const listSince = source.listSince.bind(source);
  vi.spyOn(source, 'listSince').mockImplementation(async (folder, cursor) => {
    listed.push(folder.path);
    return listSince(folder, cursor);
  });
  const reported = vi.spyOn(ledger, 'recordReportedDeletion');
  const trashed = vi.spyOn(ledger, 'recordTrashedDeletion');
  // The phase as the database answers it, the same before the pass as at its
  // end: nobody presses anything while this pass runs.
  const stillTheAuthority = vi.fn(async () => !afterCutover);

  const result = await runShadowPass({
    sourceIsAuthorityOnExistence: !afterCutover,
    stillTheAuthority,
    tenantId: TENANT,
    mappingId: MAPPING,
    source,
    target,
    ledger,
    cursors,
  });
  return {
    result,
    listed,
    reported,
    trashed,
    stillTheAuthority,
    target,
    queue: await ledger.listDeletions(TENANT, MAPPING, 'email'),
    binCursorBefore,
    binCursorAfter: await cursors.get(TENANT, MAPPING, discardedScanCursorKey('Trash')),
  };
}

describe('a mail pass that starts after cutover', () => {
  it('reads nothing from the bin, resolves no removal, and keeps every copy', async () => {
    // Before the cutover the same two clean-ups are heard: the bin is read and
    // the report resolved. Without this half, a fixture that produced neither
    // signal would pass the half that matters.
    const before = await aLeaverCleansUp(false);
    expect(before.listed).toContain('Trash');
    expect(before.result.deletions?.map((d) => [d.naturalKeyHash, d.evidence]).sort()).toEqual(
      [
        [naturalKeyHash('<a@dev.local>'), 'trashed'],
        [naturalKeyHash('<b@dev.local>'), 'reported'],
      ].sort(),
    );

    const after = await aLeaverCleansUp(true);
    // The pass ran, and copied what is new: after cutover we add, and never take away.
    expect(after.listed).toContain('INBOX');
    expect(after.result.created).toBe(1);

    expect(after.listed, 'Trash was listed after cutover').not.toContain('Trash');
    expect(after.result.deletions ?? [], 'a deletion was concluded after cutover').toEqual([]);
    expect(after.reported, "Microsoft's removal was resolved after cutover").not.toHaveBeenCalled();
    expect(after.trashed, 'the bin was read as deletions after cutover').not.toHaveBeenCalled();
    expect(after.queue, 'the Deletions queue gained an entry after cutover').toEqual([]);
    expect(after.binCursorAfter, "the bin's scan cursor moved after cutover").toEqual(after.binCursorBefore);
    // Both copied messages, and the new one.
    expect(after.target.size(), 'the target lost a copy').toBe(3);

    // Asked again only by a pass that started as the authority
    // (`stillTheAuthority`, 2026-10-05). Asked here, it means the mail
    // wrapper handed `runDomainSync` an answer the deps builder never gave:
    // the bin and the reports were carried into this pass, and only the second
    // question kept them out.
    expect(
      after.stillTheAuthority,
      'a pass that started after cutover was carried down as one that started before it',
    ).not.toHaveBeenCalled();
  });
});
