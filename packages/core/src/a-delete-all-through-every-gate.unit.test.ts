// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * DELETE ALL OF THESE HERE TOO, THROUGH EVERY GATE (workplan 0164 T3; ADR-0024,
 * amended 2026-11-21: "per item" reads as "each item decided by itself").
 *
 * The page orders a run with `applyEachInTurn` (`@openmig/shared`), and each
 * order is the press a single *Delete it here too* makes, which reaches
 * `applyDeletion`. Here the loop is wired straight to the real
 * `applyDeletion`, over a real `MemoryLedger`, with a target per data type,
 * so what is held is the product's own decision per item rather than a fake
 * of it:
 *
 *  - a run in which each gate refuses one item, and the others are removed;
 *  - a breaker that trips in the middle of a run stops the rest of its data
 *    type, as its rule says, even when the share has dropped by the time the
 *    next item is reached, while another data type goes on;
 *  - nothing is removed that a gate refused: each target is asked only about
 *    the items the gates before the removal let through.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  applyEachInTurn,
  asMappingId,
  asTenantId,
  type ApplyEachItem,
  type DiscoveryDomain,
  type LedgerRecord,
  type RemovalResult,
} from '@openmig/shared';
import { applyDeletion, MASS_DELETION_MIN_ITEMS, type ApplyDeletionOutcome } from './apply-deletion.ts';
import { MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('01643000-e29b-41d4-a716-4466554400a1');
const MAPPING = asMappingId('01643000-e29b-41d4-a716-4466554400b2');
const NOW = new Date().toISOString();

function row(domain: DiscoveryDomain, hash: string, over: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    itemType: domain,
    naturalKeyHash: hash,
    contentHash: `content-${hash}`,
    targetId: `t-${hash}`,
    targetVersion: `"v-${hash}"`,
    createdAt: NOW,
    sizeBytes: 10,
    status: 'copied',
    collection: 'Personal',
    ...over,
  };
}

/** A target that removes, answering per target id; `before` runs first, as a concurrent change would. */
function remover(
  answers: Record<string, RemovalResult> = {},
  before: Record<string, () => Promise<void>> = {},
) {
  const asked: string[] = [];
  return {
    asked,
    removeItem: vi.fn(async (targetId: string): Promise<RemovalResult> => {
      asked.push(targetId);
      await before[targetId]?.();
      return answers[targetId] ?? { kind: 'deleted' };
    }),
  };
}

const codeOf = (outcome: ApplyDeletionOutcome): string => (outcome.ok ? 'removed' : outcome.code);

describe('a run in which each gate refuses one item, and the others are removed', () => {
  it('decides every item by itself, through every gate, and removes only what they all let through', async () => {
    const ledger = new MemoryLedger();
    const reported = { deletionReportedAt: NOW };

    // Calendar: under MASS_DELETION_MIN_ITEMS, so its breaker never weighs in.
    await ledger.recordIfAbsent(row('calendar', 'cal-ok', reported));
    await ledger.recordIfAbsent(row('calendar', 'cal-inferred', { absentPasses: 3 }));
    await ledger.recordIfAbsent(row('calendar', 'cal-adopted', { ...reported, status: 'adopted' }));
    await ledger.recordIfAbsent(row('calendar', 'cal-edited', reported));
    await ledger.recordIfAbsent(row('calendar', 'cal-unversioned', reported));
    await ledger.recordIfAbsent(row('calendar', 'cal-switched-off', reported));
    // Contacts: one that another press removes first, one that is removed.
    await ledger.recordIfAbsent(row('contact', 'con-raced', reported));
    await ledger.recordIfAbsent(row('contact', 'con-ok', reported));
    // Tasks: a target that cannot remove.
    await ledger.recordIfAbsent(row('task', 'task-1', reported));
    // Mail: past its cutover.
    await ledger.recordIfAbsent(row('email', 'mail-1', reported));
    // Files: a quarter of the corpus reported at once, so its breaker refuses.
    for (let i = 0; i < MASS_DELETION_MIN_ITEMS; i++) {
      await ledger.recordIfAbsent(row('file', `file-${i}`, i < 5 ? reported : {}));
    }

    // Deleting by hand, read afresh for each item as each press reads it; the
    // owner turns it off in another tab while `con-ok` is being removed.
    const optIn = { on: true };
    const targets: Record<DiscoveryDomain, unknown> = {
      calendar: remover({
        't-cal-edited': { conflicted: true },
        't-cal-unversioned': { unversioned: true },
      }),
      contact: remover(
        {},
        {
          // Gate 7: another press records this removal first, so the ledger's
          // conditional UPDATE refuses ours.
          't-con-raced': async () => {
            expect(await ledger.applyDeletion(TENANT, MAPPING, 'contact', 'con-raced')).toBe(true);
          },
          't-con-ok': async () => {
            optIn.on = false;
          },
        },
      ),
      task: { upsertTask: vi.fn() },
      email: remover(),
      file: remover(),
    };
    const pastCutover = new Set<DiscoveryDomain>(['email']);

    const run: ApplyEachItem[] = [
      { domain: 'calendar', naturalKeyHash: 'cal-ok' },
      { domain: 'calendar', naturalKeyHash: 'cal-inferred' },
      { domain: 'calendar', naturalKeyHash: 'cal-adopted' },
      { domain: 'calendar', naturalKeyHash: 'cal-edited' },
      { domain: 'calendar', naturalKeyHash: 'cal-unversioned' },
      { domain: 'task', naturalKeyHash: 'task-1' },
      { domain: 'file', naturalKeyHash: 'file-0' },
      { domain: 'file', naturalKeyHash: 'file-1' },
      { domain: 'email', naturalKeyHash: 'mail-1' },
      { domain: 'contact', naturalKeyHash: 'con-raced' },
      { domain: 'contact', naturalKeyHash: 'con-ok' },
      { domain: 'calendar', naturalKeyHash: 'cal-switched-off' },
    ];

    const results = await applyEachInTurn(run, (item) =>
      applyDeletion(
        {
          tenantId: TENANT,
          mappingId: MAPPING,
          domain: item.domain,
          ledger,
          target: targets[item.domain],
          allowApplyDeletions: optIn.on,
          stillTheAuthority: async () => !pastCutover.has(item.domain),
        },
        item.naturalKeyHash,
      ),
    );

    const said = results.map((r) =>
      'answered' in r ? codeOf(r.answered) : 'notTried' in r ? `not tried: ${r.notTried.by}` : 'failed',
    );
    expect(said).toEqual([
      'removed',
      'weak_evidence', // gate 3: absence, however often repeated
      'not_ours', // gate 4: the account owner's bytes
      'edited_on_target', // gate 5: changed on the new system since
      'version_unknown', // gate 5: nothing to compare
      'target_cannot_remove', // gate 2
      'mass_deletion_suspected', // gate 6
      'not tried: breaker', // gate 6's rule: the rest of the data type stop
      'after_cutover', // the old system no longer decides
      'removed_not_recorded', // gate 7: two applies cannot both be recorded
      'removed',
      'not_enabled', // gate 1, read afresh: turned off during the run
    ]);

    // Removed: the two the gates let through, and the raced one, once.
    const status = async (domain: DiscoveryDomain, hash: string) =>
      (await ledger.find(TENANT, MAPPING, domain, hash))?.status;
    expect(await status('calendar', 'cal-ok')).toBe('tombstoned');
    expect(await status('contact', 'con-ok')).toBe('tombstoned');
    for (const [domain, hash] of [
      ['calendar', 'cal-inferred'],
      ['calendar', 'cal-adopted'],
      ['calendar', 'cal-edited'],
      ['calendar', 'cal-unversioned'],
      ['calendar', 'cal-switched-off'],
      ['task', 'task-1'],
      ['file', 'file-0'],
      ['file', 'file-1'],
      ['email', 'mail-1'],
    ] as const) {
      expect(await status(domain, hash), `${hash} was refused, so it stays`).not.toBe('tombstoned');
    }

    // Each target was asked only about what the gates before the removal let
    // through: never about an inferred, adopted, past-cutover, switched-off
    // or breaker-refused item.
    expect((targets.calendar as ReturnType<typeof remover>).asked).toEqual([
      't-cal-ok',
      't-cal-edited',
      't-cal-unversioned',
    ]);
    expect((targets.contact as ReturnType<typeof remover>).asked).toEqual(['t-con-raced', 't-con-ok']);
    expect((targets.file as ReturnType<typeof remover>).asked).toEqual([]);
    expect((targets.email as ReturnType<typeof remover>).asked).toEqual([]);

    // Every refusal says why, in the gate's own words.
    for (const r of results) {
      if ('answered' in r && !r.answered.ok) expect(r.answered.reason.length).toBeGreaterThan(20);
    }
  });
});

describe('a breaker that trips in the middle of a run', () => {
  /**
   * 25 calendar events, three of them reported (12%, under the breaker). A
   * pass running beside the run reports four more while the first is being
   * removed (24%), so the second is refused by the breaker. Then somebody
   * keeps those four, and the share drops to one event in 25: a loop that
   * went on would remove the third. The rule says no single item in that
   * queue is trustworthy once the breaker spoke, so the run orders none of
   * the calendar's after it. Contacts have a breaker of their own, and go on.
   */
  async function aRunTheBreakerStops() {
    const ledger = new MemoryLedger();
    for (let i = 0; i < 25; i++) {
      await ledger.recordIfAbsent(row('calendar', `c-${i}`, i < 3 ? { deletionReportedAt: NOW } : {}));
    }
    await ledger.recordIfAbsent(row('contact', 'k-1', { deletionReportedAt: NOW }));
    const lateReports = ['c-10', 'c-11', 'c-12', 'c-13'];

    const calendar = remover(
      {},
      {
        't-c-0': async () => {
          for (const hash of lateReports) await ledger.recordReportedDeletion(TENANT, MAPPING, 'calendar', hash);
        },
      },
    );
    const contact = remover();
    const target = (domain: DiscoveryDomain) => (domain === 'calendar' ? calendar : contact);
    const press = (item: ApplyEachItem) =>
      applyDeletion(
        {
          tenantId: TENANT,
          mappingId: MAPPING,
          domain: item.domain,
          ledger,
          target: target(item.domain),
          allowApplyDeletions: true,
          stillTheAuthority: async () => true,
        },
        item.naturalKeyHash,
      );

    const results = await applyEachInTurn(
      [
        { domain: 'calendar', naturalKeyHash: 'c-0' },
        { domain: 'calendar', naturalKeyHash: 'c-1' },
        { domain: 'calendar', naturalKeyHash: 'c-2' },
        { domain: 'contact', naturalKeyHash: 'k-1' },
      ],
      async (item) => {
        const answer = await press(item);
        if (item.naturalKeyHash === 'c-1') {
          for (const hash of lateReports) await ledger.resolveDeletion(TENANT, MAPPING, hash, 'keep');
        }
        return answer;
      },
    );
    return { ledger, results, calendar, contact, press };
  }

  it('refuses the item it trips on and orders none of that data type after it', async () => {
    const { ledger, results, calendar } = await aRunTheBreakerStops();

    expect(results[0]).toMatchObject({ answered: { ok: true } });
    expect(results[1]).toMatchObject({ answered: { ok: false, code: 'mass_deletion_suspected' } });
    const tripped = (results[1] as { answered: { reason: string } }).answered.reason;
    // c-1, c-2 and the four reported beside the run: c-0 is removed by now.
    expect(tripped).toContain('6 of 25');
    // Not asked, not removed, and said with the breaker's own words.
    expect(results[2]).toEqual({
      item: { domain: 'calendar', naturalKeyHash: 'c-2' },
      notTried: { by: 'breaker', code: 'mass_deletion_suspected', reason: tripped },
    });
    expect(calendar.asked).toEqual(['t-c-0']);
    expect((await ledger.find(TENANT, MAPPING, 'calendar', 'c-2'))?.status).toBe('copied');
  });

  it('lets another data type go on, behind its own breaker', async () => {
    const { ledger, results, contact } = await aRunTheBreakerStops();
    expect(results[3]).toMatchObject({ item: { naturalKeyHash: 'k-1' }, answered: { ok: true, kind: 'deleted' } });
    expect(contact.asked).toEqual(['t-k-1']);
    expect((await ledger.find(TENANT, MAPPING, 'contact', 'k-1'))?.status).toBe('tombstoned');
  });

  it('stops only the run: the same item pressed by itself afterwards is decided afresh', async () => {
    // The share has dropped by now, and a person pressing it alone has seen
    // the breaker's sentence: the gates decide that press as any other.
    const { ledger, press } = await aRunTheBreakerStops();
    expect(await press({ domain: 'calendar', naturalKeyHash: 'c-2' })).toEqual({ ok: true, kind: 'deleted' });
    expect((await ledger.find(TENANT, MAPPING, 'calendar', 'c-2'))?.status).toBe('tombstoned');
  });
});
