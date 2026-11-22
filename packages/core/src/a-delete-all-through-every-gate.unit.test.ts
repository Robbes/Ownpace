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
 *  - a run in which each gate that speaks for one row refuses one row, and
 *    the others are removed: the run goes on past each of them, and stops at
 *    a row whose evidence is only absence (`weak_evidence`);
 *  - evidence withdrawn during the run (a pass sees an item back while the
 *    run removes another) stops it: the next item, still reported only
 *    because the pass has not reached it, is not asked;
 *  - a removal the ledger could not record (`removed_not_recorded`) stops
 *    the whole run: the ledger changed under it, as when the owner restores
 *    a folder at the source mid-run, so its next items are not asked;
 *  - deleting by hand turned off during a run stops it;
 *  - the breaker stops the whole run, every data type, whether it trips on
 *    the first row or in the middle, even when the share has dropped by the
 *    time the next row is reached;
 *  - what one confirmation can remove is what gate 6 counts: a fifth of the
 *    items placed on the target, removed and adopted ones included, rows with
 *    no recorded collection not, asked afresh at every press, with no total;
 *  - a row somebody kept in another tab before its turn is refused as
 *    already kept, and the run goes on; a keep during that row's own
 *    removal cannot stop it (ADR-0024, amended 2026-11-22);
 *  - a press that throws stops the run, and nothing after it is asked;
 *  - nothing is removed that a gate refused: each target is asked only about
 *    the items the gates before the removal let through.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  applyEachInTurn,
  asMappingId,
  asTenantId,
  type ApplyEachItem,
  type ApplyEachResult,
  type DiscoveryDomain,
  type LedgerRecord,
  type RemovalResult,
} from '@openmig/shared';
import { applyDeletion, MASS_DELETION_MIN_ITEMS, type ApplyDeletionOutcome } from './apply-deletion.ts';
import { MemoryLedger } from './__testing__/memory.ts';

const TENANT = asTenantId('01643000-e29b-41d4-a716-4466554400a1');
const MAPPING = asMappingId('01643000-e29b-41d4-a716-4466554400b2');
const NOW = new Date().toISOString();
const reported = { deletionReportedAt: NOW };

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
  answers: Record<string, RemovalResult | Error> = {},
  before: Record<string, () => Promise<void>> = {},
) {
  const asked: string[] = [];
  return {
    asked,
    removeItem: vi.fn(async (targetId: string): Promise<RemovalResult> => {
      asked.push(targetId);
      await before[targetId]?.();
      const answer = answers[targetId] ?? { kind: 'deleted' };
      if (answer instanceof Error) throw answer;
      return answer;
    }),
  };
}


/** One press, as the page's press reaches it: the deps read afresh for each item. */
function pressWith(
  ledger: MemoryLedger,
  targets: Partial<Record<DiscoveryDomain, unknown>>,
  opts: { optIn?: { on: boolean }; pastCutover?: ReadonlySet<DiscoveryDomain> } = {},
) {
  return (item: ApplyEachItem) =>
    applyDeletion(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        domain: item.domain,
        ledger,
        target: targets[item.domain],
        allowApplyDeletions: opts.optIn ? opts.optIn.on : true,
        stillTheAuthority: async () => !(opts.pastCutover ?? new Set()).has(item.domain),
      },
      item.naturalKeyHash,
    );
}

const said = (results: ApplyEachResult<ApplyDeletionOutcome>[]) =>
  results.map((r) =>
    'answered' in r
      ? r.answered.ok
        ? 'removed'
        : r.answered.code
      : 'notTried' in r
        ? `not tried: ${r.notTried.by}${r.notTried.by === 'refusal' ? ` (${r.notTried.code})` : ''}`
        : 'failed',
  );

const statusOf = async (ledger: MemoryLedger, domain: DiscoveryDomain, hash: string) =>
  (await ledger.find(TENANT, MAPPING, domain, hash))?.status;

describe('a run in which each gate that speaks for one row refuses one row', () => {
  it('decides every row by itself, goes on past each refusal of that row alone, and stops where only absence is left', async () => {
    const ledger = new MemoryLedger();
    // Calendar: under MASS_DELETION_MIN_ITEMS, so its breaker never weighs in.
    await ledger.recordIfAbsent(row('calendar', 'cal-ok', reported));
    await ledger.recordIfAbsent(row('calendar', 'cal-inferred', { absentPasses: 3 }));
    await ledger.recordIfAbsent(row('calendar', 'cal-adopted', { ...reported, status: 'adopted' }));
    await ledger.recordIfAbsent(row('calendar', 'cal-edited', reported));
    await ledger.recordIfAbsent(row('calendar', 'cal-unversioned', reported));
    await ledger.recordIfAbsent(row('contact', 'con-ok', reported));
    await ledger.recordIfAbsent(row('task', 'task-1', reported));
    await ledger.recordIfAbsent(row('email', 'mail-1', reported));
    await ledger.recordIfAbsent(row('calendar', 'cal-after', reported));

    const targets = {
      calendar: remover({
        't-cal-edited': { conflicted: true },
        't-cal-unversioned': { unversioned: true },
      }),
      contact: remover(),
      task: { upsertTask: vi.fn() },
      email: remover(),
    };

    const results = await applyEachInTurn(
      [
        { domain: 'calendar', naturalKeyHash: 'cal-ok' },
        { domain: 'calendar', naturalKeyHash: 'cal-adopted' },
        { domain: 'calendar', naturalKeyHash: 'cal-edited' },
        { domain: 'calendar', naturalKeyHash: 'cal-unversioned' },
        { domain: 'task', naturalKeyHash: 'task-1' },
        { domain: 'email', naturalKeyHash: 'mail-1' },
        { domain: 'contact', naturalKeyHash: 'con-ok' },
        // The page never offers it (`mayOfferApply`); in a run its evidence
        // was withdrawn after the confirmation, and the run stops there.
        { domain: 'calendar', naturalKeyHash: 'cal-inferred' },
        { domain: 'calendar', naturalKeyHash: 'cal-after' },
      ],
      pressWith(ledger, targets, { pastCutover: new Set(['email']) }),
    );

    expect(said(results)).toEqual([
      'removed',
      'not_ours', // gate 4: the account owner's bytes
      'edited_on_target', // gate 5: changed on the new system since
      'version_unknown', // gate 5: nothing to compare
      'target_cannot_remove', // gate 2
      'after_cutover', // the old system no longer decides
      'removed',
      'weak_evidence', // gate 3: absence, however often repeated; it stops the run
      'not tried: refusal (weak_evidence)',
    ]);

    expect(await statusOf(ledger, 'calendar', 'cal-ok')).toBe('tombstoned');
    expect(await statusOf(ledger, 'contact', 'con-ok')).toBe('tombstoned');
    for (const [domain, hash] of [
      ['calendar', 'cal-inferred'],
      ['calendar', 'cal-adopted'],
      ['calendar', 'cal-edited'],
      ['calendar', 'cal-unversioned'],
      ['task', 'task-1'],
      ['email', 'mail-1'],
      ['calendar', 'cal-after'],
    ] as const) {
      expect(await statusOf(ledger, domain, hash), `${hash} was refused, so it stays`).not.toBe('tombstoned');
    }
    // Each target was asked only about what the gates before the removal let
    // through: never about an inferred, adopted or past-cutover row.
    expect(targets.calendar.asked).toEqual(['t-cal-ok', 't-cal-edited', 't-cal-unversioned']);
    expect(targets.contact.asked).toEqual(['t-con-ok']);
    expect(targets.email.asked).toEqual([]);
    for (const r of results) {
      if ('answered' in r && !r.answered.ok) expect(r.answered.reason.length).toBeGreaterThan(20);
    }
  });
});

/**
 * `removed_not_recorded`: the copy was removed, and the ledger's conditional
 * UPDATE (gate 7) would not record it, because the row changed under the
 * removal. It is the one answer that proves the ledger moved while the run
 * was deleting, so the list the person confirmed is not the one being
 * deleted from any more, and nothing after it is asked.
 */
describe('a removal the ledger could not record stops the whole run', () => {
  /** The server's reason is true of both causes, whichever one this is. */
  const namesBothCauses = (results: ApplyEachResult<ApplyDeletionOutcome>[]) => {
    const first = results[0];
    const reason = first && 'answered' in first && !first.answered.ok ? first.answered.reason : '';
    expect(reason).toMatch(/the row changed while it ran \(a pass saw the item again, or another removal recorded it first\)/);
    expect(reason).toMatch(/Unless another removal recorded it, Verification will report this item as missing/);
  };

  it('when another tab recorded it first: counted as removed, and nothing after it is asked', async () => {
    const ledger = new MemoryLedger();
    await ledger.recordIfAbsent(row('contact', 'con-raced', reported));
    await ledger.recordIfAbsent(row('contact', 'con-ok', reported));
    await ledger.recordIfAbsent(row('calendar', 'cal-ok', reported));
    const contact = remover(
      {},
      {
        // Gate 7: another press records this removal first.
        't-con-raced': async () => {
          expect(await ledger.applyDeletion(TENANT, MAPPING, 'contact', 'con-raced')).toBe(true);
        },
      },
    );
    const calendar = remover();

    const results = await applyEachInTurn(
      [
        { domain: 'contact', naturalKeyHash: 'con-raced' },
        { domain: 'contact', naturalKeyHash: 'con-ok' },
        { domain: 'calendar', naturalKeyHash: 'cal-ok' },
      ],
      pressWith(ledger, { contact, calendar }),
    );

    expect(said(results)).toEqual([
      'removed_not_recorded',
      'not tried: refusal (removed_not_recorded)',
      'not tried: refusal (removed_not_recorded)',
    ]);
    namesBothCauses(results);
    expect(contact.asked).toEqual(['t-con-raced']);
    expect(calendar.asked).toEqual([]);
    expect(await statusOf(ledger, 'contact', 'con-ok')).toBe('copied');
    expect(await statusOf(ledger, 'calendar', 'cal-ok')).toBe('copied');
  });

  it('when the owner restores a folder at the source mid-run: its next items, still reported, are not asked', async () => {
    const ledger = new MemoryLedger();
    for (const hash of ['a', 'b', 'c']) await ledger.recordIfAbsent(row('calendar', hash, reported));
    // The folder comes back at the source while a is being removed. A pass
    // sees a first, and has not reached b or c yet: they are still reported.
    const calendar = remover({}, { 't-a': () => ledger.clearAbsent(TENANT, MAPPING, 'calendar', 'a') });

    const results = await applyEachInTurn(
      ['a', 'b', 'c'].map((h) => ({ domain: 'calendar' as const, naturalKeyHash: h })),
      pressWith(ledger, { calendar }),
    );

    // a's copy went before the ledger could record it; b and c were never asked.
    expect(said(results)).toEqual([
      'removed_not_recorded',
      'not tried: refusal (removed_not_recorded)',
      'not tried: refusal (removed_not_recorded)',
    ]);
    namesBothCauses(results);
    expect(calendar.asked).toEqual(['t-a']);
    for (const hash of ['b', 'c']) {
      const left = await ledger.find(TENANT, MAPPING, 'calendar', hash);
      expect(left?.status, `${hash} was not asked`).toBe('copied');
      expect(left?.deletionReportedAt, `${hash} is still reported: the pass had not reached it`).toBeDefined();
    }
  });
});

/**
 * Every row of a run had positive evidence when the list was read again, so a
 * row refused `not_confirmed` (no evidence left) or `weak_evidence` (only
 * absence left) lost it after the confirmation: a pass saw it back on the old
 * system. That is the list changing under the run, and the rows after it,
 * still reported only because the pass has not reached them, are not asked
 * (the third review, R1).
 */
describe('evidence withdrawn during a run stops it', () => {
  it('when a pass sees the next row back while one is removed: [removed, not_confirmed, not tried]', async () => {
    const ledger = new MemoryLedger();
    for (const hash of ['a', 'b', 'c']) await ledger.recordIfAbsent(row('calendar', hash, reported));
    // While a is being removed, a pass sees b on the old system again and
    // clears its evidence; it has not reached c, which is still reported.
    const calendar = remover({}, { 't-a': () => ledger.clearAbsent(TENANT, MAPPING, 'calendar', 'b') });

    const results = await applyEachInTurn(
      ['a', 'b', 'c'].map((h) => ({ domain: 'calendar' as const, naturalKeyHash: h })),
      pressWith(ledger, { calendar }),
    );

    expect(said(results)).toEqual(['removed', 'not_confirmed', 'not tried: refusal (not_confirmed)']);
    expect(calendar.asked).toEqual(['t-a']);
    const c = await ledger.find(TENANT, MAPPING, 'calendar', 'c');
    expect(c?.status, 'c was not asked').toBe('copied');
    expect(c?.deletionReportedAt, 'c is still reported: the pass had not reached it').toBeDefined();
  });
});

describe('deleting by hand turned off during a run', () => {
  it('refuses the next row (gate 1, read afresh) and stops the run', async () => {
    const ledger = new MemoryLedger();
    for (const hash of ['a', 'b', 'c']) await ledger.recordIfAbsent(row('calendar', hash, reported));
    const optIn = { on: true };
    const calendar = remover({}, { 't-a': async () => void (optIn.on = false) });

    const results = await applyEachInTurn(
      ['a', 'b', 'c'].map((h) => ({ domain: 'calendar' as const, naturalKeyHash: h })),
      pressWith(ledger, { calendar }, { optIn }),
    );

    expect(said(results)).toEqual(['removed', 'not_enabled', 'not tried: refusal (not_enabled)']);
    expect(calendar.asked).toEqual(['t-a']);
    expect(await statusOf(ledger, 'calendar', 'c')).toBe('copied');
  });
});

describe('the breaker stops the whole run', () => {
  it('on the first row: nothing is removed, of any data type', async () => {
    const ledger = new MemoryLedger();
    // Files: a quarter of the corpus reported at once.
    for (let i = 0; i < MASS_DELETION_MIN_ITEMS; i++) {
      await ledger.recordIfAbsent(row('file', `file-${i}`, i < 5 ? reported : {}));
    }
    await ledger.recordIfAbsent(row('calendar', 'cal-1', reported));
    const targets = { file: remover(), calendar: remover() };

    const results = await applyEachInTurn(
      [
        { domain: 'file', naturalKeyHash: 'file-0' },
        { domain: 'file', naturalKeyHash: 'file-1' },
        { domain: 'calendar', naturalKeyHash: 'cal-1' },
      ],
      pressWith(ledger, targets),
    );

    expect(said(results)).toEqual([
      'mass_deletion_suspected',
      'not tried: refusal (mass_deletion_suspected)',
      'not tried: refusal (mass_deletion_suspected)',
    ]);
    expect(targets.file.asked).toEqual([]);
    expect(targets.calendar.asked).toEqual([]);
    expect(await statusOf(ledger, 'calendar', 'cal-1')).toBe('copied');
  });

  /**
   * In the middle: 25 calendar events, three of them reported (12%, under the
   * breaker). A pass running beside the run reports four more while the first
   * is being removed (24%), so the second is refused by the breaker. Then
   * somebody keeps those four, and the share drops to two events in 25: a
   * loop that went on would remove the third. The rule says no single item in
   * that queue is trustworthy once the breaker spoke, and what it suspects is
   * the whole account's, so the run orders nothing more, a contact included.
   */
  async function aRunTheBreakerStops() {
    const ledger = new MemoryLedger();
    for (let i = 0; i < 25; i++) {
      await ledger.recordIfAbsent(row('calendar', `c-${i}`, i < 3 ? reported : {}));
    }
    await ledger.recordIfAbsent(row('contact', 'k-1', reported));
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
    const press = pressWith(ledger, { calendar, contact });

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

  it('in the middle: refuses the row it trips on, and orders nothing after it', async () => {
    const { ledger, results, calendar, contact } = await aRunTheBreakerStops();

    expect(results[0]).toMatchObject({ answered: { ok: true } });
    expect(results[1]).toMatchObject({ answered: { ok: false, code: 'mass_deletion_suspected' } });
    const tripped = (results[1] as { answered: { reason: string } }).answered.reason;
    // c-1, c-2 and the four reported beside the run: c-0 is removed by now.
    expect(tripped).toContain('6 of 25');
    const notTried = { by: 'refusal', code: 'mass_deletion_suspected', reason: tripped };
    expect(results.slice(2)).toEqual([
      { item: { domain: 'calendar', naturalKeyHash: 'c-2' }, notTried },
      { item: { domain: 'contact', naturalKeyHash: 'k-1' }, notTried },
    ]);
    expect(calendar.asked).toEqual(['t-c-0']);
    expect(contact.asked).toEqual([]);
    expect(await statusOf(ledger, 'calendar', 'c-2')).toBe('copied');
    expect(await statusOf(ledger, 'contact', 'k-1')).toBe('copied');
  });

  it('stops only the run: the same rows pressed afresh afterwards are decided by the gates', async () => {
    // The share has dropped by now, and a person pressing again has seen the
    // breaker's sentence: the gates decide that press as any other.
    const { ledger, press } = await aRunTheBreakerStops();
    expect(await press({ domain: 'calendar', naturalKeyHash: 'c-2' })).toEqual({ ok: true, kind: 'deleted' });
    expect(await press({ domain: 'contact', naturalKeyHash: 'k-1' })).toEqual({ ok: true, kind: 'deleted' });
    expect(await statusOf(ledger, 'calendar', 'c-2')).toBe('tombstoned');
  });
});

/**
 * A keep pressed in another tab while a run is under way (ADR-0024, amended
 * 2026-11-22). The run's rows were read before its first press, so a row kept
 * after that is still in it: `applyDeletion` refuses it when its turn comes,
 * before anything is sent to the target, and the run goes on. A keep that
 * lands while that row's own removal is at the target is too late for it.
 */
describe('a keep in another tab during a run', () => {
  const decidedOf = async (ledger: MemoryLedger, hash: string) =>
    (await ledger.listDeletions(TENANT, MAPPING)).find((d) => d.naturalKeyHash === hash)?.decided;

  it('refuses the row kept before its turn as already kept, asks the target nothing for it, and goes on', async () => {
    const ledger = new MemoryLedger();
    for (const hash of ['a', 'b']) await ledger.recordIfAbsent(row('calendar', hash, reported));
    await ledger.recordIfAbsent(row('contact', 'k', reported));
    // While a is being removed, somebody keeps b.
    const calendar = remover(
      {},
      { 't-a': async () => void expect(await ledger.resolveDeletion(TENANT, MAPPING, 'b', 'keep')).toBe(true) },
    );
    const contact = remover();

    const results = await applyEachInTurn(
      [
        { domain: 'calendar', naturalKeyHash: 'a' },
        { domain: 'calendar', naturalKeyHash: 'b' },
        { domain: 'contact', naturalKeyHash: 'k' },
      ],
      pressWith(ledger, { calendar, contact }),
    );

    expect(said(results)).toEqual(['removed', 'already_kept', 'removed']);
    expect((results[1] as { answered: { reason: string } }).answered.reason).toMatch(/chose to keep the target's copy/);
    expect(calendar.asked).toEqual(['t-a']);
    expect(contact.asked).toEqual(['t-k']);
    expect(await statusOf(ledger, 'calendar', 'b')).toBe('copied');
    expect(await decidedOf(ledger, 'b')).toBe('kept');
  });

  it('cannot stop a removal already under way: that row is removed, and recorded as removed', async () => {
    const ledger = new MemoryLedger();
    for (const hash of ['a', 'b']) await ledger.recordIfAbsent(row('calendar', hash, reported));
    // The keep lands while b's own removal is at the target.
    const calendar = remover(
      {},
      { 't-b': async () => void expect(await ledger.resolveDeletion(TENANT, MAPPING, 'b', 'keep')).toBe(true) },
    );

    const results = await applyEachInTurn(
      ['a', 'b'].map((h) => ({ domain: 'calendar' as const, naturalKeyHash: h })),
      pressWith(ledger, { calendar }),
    );

    expect(said(results)).toEqual(['removed', 'removed']);
    expect(calendar.asked).toEqual(['t-a', 't-b']);
    expect(await statusOf(ledger, 'calendar', 'b')).toBe('tombstoned');
    expect(await decidedOf(ledger, 'b')).toBe('applied');
  });
});

describe('a press that throws', () => {
  it('is that row’s failure, and nothing after it is asked', async () => {
    const ledger = new MemoryLedger();
    for (const hash of ['a', 'b']) await ledger.recordIfAbsent(row('calendar', hash, reported));
    await ledger.recordIfAbsent(row('contact', 'k', reported));
    const calendar = remover({ 't-a': new Error('socket hang up') });
    const contact = remover();

    const results = await applyEachInTurn(
      [
        { domain: 'calendar', naturalKeyHash: 'a' },
        { domain: 'calendar', naturalKeyHash: 'b' },
        { domain: 'contact', naturalKeyHash: 'k' },
      ],
      pressWith(ledger, { calendar, contact }),
    );

    expect(results[0]).toEqual({ item: { domain: 'calendar', naturalKeyHash: 'a' }, failed: 'socket hang up' });
    expect(said(results).slice(1)).toEqual(['not tried: failure', 'not tried: failure']);
    expect(calendar.asked).toEqual(['t-a']);
    expect(contact.asked).toEqual([]);
    // Nothing recorded a removal the target never confirmed.
    expect(await statusOf(ledger, 'calendar', 'a')).toBe('copied');
  });
});

/**
 * What one confirmation can remove (ADR-0024's operative rules, the third
 * review's R3). Gate 6 counts `placedItems`: every item placed on the
 * target, those removed since and adopted ones included, rows with no
 * recorded collection not. It is asked afresh at every press, so it caps a
 * run at a fifth and caps no total.
 */
describe('what one confirmation can remove, as gate 6 counts it', () => {
  const calendarRun = async (ledger: MemoryLedger, hashes: string[]) =>
    said(
      await applyEachInTurn(
        hashes.map((h) => ({ domain: 'calendar' as const, naturalKeyHash: h })),
        pressWith(ledger, { calendar: remover() }),
      ),
    );
  const five = ['c-0', 'c-1', 'c-2', 'c-3', 'c-4'];

  it('counts the removed and the adopted: 5 waiting of 20 copied, 3 adopted and 2 removed is a fifth, and all 5 go', async () => {
    const ledger = new MemoryLedger();
    for (let i = 0; i < 20; i++) await ledger.recordIfAbsent(row('calendar', `c-${i}`, i < 5 ? reported : {}));
    for (let i = 0; i < 3; i++) await ledger.recordIfAbsent(row('calendar', `a-${i}`, { status: 'adopted' }));
    for (let i = 0; i < 2; i++) {
      await ledger.recordIfAbsent(
        row('calendar', `r-${i}`, {
          status: 'tombstoned',
          deletionReportedAt: NOW,
          deletionAppliedAt: NOW,
          deletionAcknowledgedAt: NOW,
        }),
      );
    }

    // 5 of 25 placed. Counted without the removed and the adopted, 5 of 20
    // would be a quarter, and the breaker would refuse the first.
    expect(await calendarRun(ledger, five)).toEqual(['removed', 'removed', 'removed', 'removed', 'removed']);
  });

  it('does not count a row with no recorded collection: 5 waiting of 20 copied and 5 with none is a quarter, and none goes', async () => {
    const ledger = new MemoryLedger();
    for (let i = 0; i < 20; i++) await ledger.recordIfAbsent(row('calendar', `c-${i}`, i < 5 ? reported : {}));
    for (let i = 0; i < 5; i++) await ledger.recordIfAbsent(row('calendar', `old-${i}`, { collection: '' }));

    expect(await calendarRun(ledger, five)).toEqual([
      'mass_deletion_suspected',
      ...Array(4).fill('not tried: refusal (mass_deletion_suspected)'),
    ]);
    for (const hash of five) expect(await statusOf(ledger, 'calendar', hash)).toBe('copied');
  });

  it('caps no total: once a run’s removals have left the queue, a second confirmation removes another fifth', async () => {
    const ledger = new MemoryLedger();
    for (let i = 0; i < 20; i++) await ledger.recordIfAbsent(row('calendar', `c-${i}`, i < 4 ? reported : {}));
    expect(await calendarRun(ledger, ['c-0', 'c-1', 'c-2', 'c-3'])).toEqual(Array(4).fill('removed'));

    // Four more are deleted at the source, and a later pass reports them.
    for (const hash of ['c-4', 'c-5', 'c-6', 'c-7']) {
      await ledger.recordReportedDeletion(TENANT, MAPPING, 'calendar', hash);
    }
    expect(await calendarRun(ledger, ['c-4', 'c-5', 'c-6', 'c-7'])).toEqual(Array(4).fill('removed'));

    const removed = (await ledger.placedItems(TENANT, MAPPING, 'calendar')).filter((p) => p.deletionAppliedAt);
    expect(removed, 'two confirmations, two fifths').toHaveLength(8);
  });
});
