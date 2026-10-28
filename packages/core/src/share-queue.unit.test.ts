// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The sharing queue (ADR-0032, workplan 0052) — what these hold, in order of
 * what it would cost an owner if wrong:
 *
 *  1. A decision survives a rescan. The checklist's whole value is that a
 *     ticked item stays ticked; a refresh that reset rows to open would turn
 *     the queue back into a report.
 *  2. Every gate in front of `apply` answers with its own sentence — cutover,
 *     link shares, manual verdicts, missing share API — because the invite
 *     the target sends on apply is outward-facing, and the wrong one cannot
 *     be unsent.
 *  3. A target refusal leaves the row OPEN and travels verbatim: nothing was
 *     carried over, so the checklist must keep saying so.
 */

import { describe, it, expect } from 'vitest';
import type { MappingId, PermissionGrant, ShareGrantRow, TenantId } from '@openmig/shared';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  NOT_CUT_OVER_REASON,
  notCutOverReason,
  applyAllOpenShareGrants,
  applyShareGrant,
  applyShareGrantsInFolder,
  markShareGrant,
  refreshShareGrants,
  shareGrantHash,
  summariseShareGrants,
  verdictTargetFor,
} from './share-queue.ts';

const TENANT = 'tenant-1' as TenantId;
const MAPPING = 'mapping-1' as MappingId;

/** The one blind spot every source has, in this fixture's words. */
const DELEGATION = 'mailbox delegation was not read';

const PERSON_GRANT: PermissionGrant = {
  subject: 'drive_item',
  on: 'Projects/budget.xlsx',
  grantee: 'anna@example.nl',
  role: 'writer',
  raw: '{"type":"user","role":"writer","emailAddress":"anna@example.nl"}',
};

const LINK_GRANT: PermissionGrant = {
  subject: 'drive_item',
  on: 'Projects/budget.xlsx',
  role: 'reader',
  viaLink: true,
  raw: '{"type":"anyone","role":"reader"}',
};

function deps(ledger: MemoryLedger) {
  return { tenantId: TENANT, mappingId: MAPPING, ledger, decidedBy: 'owner@example.nl' };
}

async function refreshed(ledger: MemoryLedger, grants: PermissionGrant[] = [PERSON_GRANT, LINK_GRANT]) {
  return refreshShareGrants({
    tenantId: TENANT,
    mappingId: MAPPING,
    ledger,
    delegationReason: DELEGATION,
    scans: [async () => ({ kind: 'listed' as const, grants })],
  });
}

describe('refreshShareGrants', () => {
  it('turns listed grants into rows with mapGrant verdicts; blind spots stay sentences', async () => {
    const ledger = new MemoryLedger();
    const result = await refreshShareGrants({
      tenantId: TENANT,
      mappingId: MAPPING,
      ledger,
      delegationReason: DELEGATION,
      scans: [
        async () => ({ kind: 'listed' as const, grants: [PERSON_GRANT, LINK_GRANT] }),
        async () => ({ kind: 'not_discoverable' as const, reason: 'nothing was looked at' }),
      ],
    });

    expect(result.open).toBe(2);
    // Delegation first and always, then what the scans could not read.
    expect(result.blindSpots).toEqual([DELEGATION, 'nothing was looked at']);
    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    expect(rows).toHaveLength(2);
    // A per-person file share maps clean; a link is a decision, not a
    // translation (0029 T2) — the queue inherits exactly those verdicts.
    expect(rows.find((r) => r.grantee === 'anna@example.nl')!.verdict).toBe('clean');
    expect(rows.find((r) => r.viaLink)!.verdict).toBe('manual');
  });

  it('says each blind spot in Dutch too where it has Dutch, in the same order (the owner, 2026-10-16)', async () => {
    // A Dutch tester read the Sharing checklist's blind spots in English. A
    // sentence of ours carries its Dutch beside it; one that has none (a
    // provider's own words) is said as it came, so the two lists never
    // differ in length or order.
    const ledger = new MemoryLedger();
    const result = await refreshShareGrants({
      tenantId: TENANT,
      mappingId: MAPPING,
      ledger,
      delegationReason: DELEGATION,
      delegationReasonNl: 'gemachtigden zijn niet gelezen',
      scans: [
        async () => ({ kind: 'not_discoverable' as const, reason: 'calendars unread', reasonNl: 'agenda’s niet gelezen' }),
        async () => ({ kind: 'not_discoverable' as const, reason: 'Graph said 403' }),
      ],
    });
    expect(result.blindSpots).toEqual([DELEGATION, 'calendars unread', 'Graph said 403']);
    expect(result.blindSpotsNl).toEqual(['gemachtigden zijn niet gelezen', 'agenda’s niet gelezen', 'Graph said 403']);
  });

  it('says mailbox delegation was not read even when every scan listed cleanly', async () => {
    // THE CASE THE OWNER FOUND. Both scans succeed, so nothing was
    // `not_discoverable` and the old code produced an EMPTY blind-spot list —
    // on a checklist whose whole job is telling "nobody looked" apart from
    // "nothing to find". No connector emits a `mailbox` grant on any
    // provider, so a clean scan is exactly when the sentence matters most.
    const ledger = new MemoryLedger();
    const result = await refreshShareGrants({
      tenantId: TENANT,
      mappingId: MAPPING,
      ledger,
      delegationReason: DELEGATION,
      scans: [async () => ({ kind: 'listed' as const, grants: [PERSON_GRANT] })],
    });

    expect(result.open).toBe(1);
    expect(result.blindSpots).toEqual([DELEGATION]);
  });

  it('says it with no scans at all, which is the emptiest a checklist gets', async () => {
    const ledger = new MemoryLedger();
    const result = await refreshShareGrants({
      tenantId: TENANT,
      mappingId: MAPPING,
      ledger,
      delegationReason: DELEGATION,
      scans: [],
    });

    expect(result.open).toBe(0);
    expect(result.blindSpots).toEqual([DELEGATION]);
  });

  it('a rescan never resets a decision — the ticked item stays ticked', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger);
    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    const linkRow = rows.find((r) => r.viaLink)!;
    await markShareGrant(deps(ledger), linkRow.id, 'done_manual', 'made a new link by hand');

    await refreshed(ledger);

    const after = await ledger.listShareGrants(TENANT, MAPPING);
    const link = after.find((r) => r.viaLink)!;
    expect(link.state).toBe('done_manual');
    expect(link.decidedBy).toBe('owner@example.nl');
    expect(after).toHaveLength(2);
  });

  it('identity ignores raw re-serialisation but a changed role is a NEW open row', () => {
    expect(shareGrantHash(PERSON_GRANT)).toBe(
      shareGrantHash({ ...PERSON_GRANT, raw: '{"reordered":true}' }),
    );
    expect(shareGrantHash(PERSON_GRANT)).not.toBe(
      shareGrantHash({ ...PERSON_GRANT, role: 'reader' }),
    );
  });
});

describe('the checklist summary', () => {
  it('counts what is settled and what still waits, manual rows called out', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger);
    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    await markShareGrant(deps(ledger), rows.find((r) => r.viaLink)!.id, 'skipped');

    const summary = summariseShareGrants(await ledger.listShareGrants(TENANT, MAPPING));

    expect(summary).toEqual({
      total: 2,
      open: 1,
      applied: 0,
      doneManual: 0,
      skipped: 1,
      openManual: 0,
    });
  });
});

describe('applyShareGrant — every gate answers with its own sentence', () => {
  async function openCleanRow(ledger: MemoryLedger) {
    await refreshed(ledger);
    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    return rows.find((r) => r.verdict === 'clean')!;
  }

  it('refuses before cutover: the invite is an announcement the new system is live', async () => {
    const ledger = new MemoryLedger();
    const row = await openCleanRow(ledger);

    const outcome = await applyShareGrant(
      { ...deps(ledger), isCutOver: () => false, createShare: async () => ({ ok: true }) },
      row.id,
    );

    expect(outcome).toMatchObject({ ok: false, code: 'not_cut_over', reason: notCutOverReason(['drive_item']) });
  });

  it('refuses a link share with the unknown-audience sentence (ADR-0032 §7)', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger);
    const link = (await ledger.listShareGrants(TENANT, MAPPING)).find((r) => r.viaLink)!;

    const outcome = await applyShareGrant(
      { ...deps(ledger), isCutOver: () => true, createShare: async () => ({ ok: true }) },
      link.id,
    );

    expect(outcome).toMatchObject({ ok: false, code: 'link_share' });
  });

  it('refuses a manual verdict, quoting what to do instead', async () => {
    const ledger = new MemoryLedger();
    await refreshShareGrants({
      tenantId: TENANT,
      mappingId: MAPPING,
      ledger,
      delegationReason: DELEGATION,
      scans: [
        async () => ({
          kind: 'listed' as const,
          grants: [
            { subject: 'mailbox', on: 'shared@example.nl', grantee: 'anna@example.nl', role: 'FullAccess', raw: 'FullAccess' },
          ],
        }),
      ],
    });
    const row = (await ledger.listShareGrants(TENANT, MAPPING))[0]!;

    const outcome = await applyShareGrant(
      { ...deps(ledger), isCutOver: () => true, createShare: async () => ({ ok: true }) },
      row.id,
    );

    expect(outcome).toMatchObject({ ok: false, code: 'manual_only' });
    if (!outcome.ok) expect(outcome.reason).toContain(row.verdictTarget);
  });

  it('refuses when the target has no share API, naming the protocol gap', async () => {
    const ledger = new MemoryLedger();
    const row = await openCleanRow(ledger);

    const outcome = await applyShareGrant({ ...deps(ledger), isCutOver: () => true }, row.id);

    expect(outcome).toMatchObject({ ok: false, code: 'no_share_api' });
  });

  it('applies through the target, settles the row attributed, writes the audit row', async () => {
    const ledger = new MemoryLedger();
    const row = await openCleanRow(ledger);
    const created: string[] = [];

    const outcome = await applyShareGrant(
      {
        ...deps(ledger),
        isCutOver: () => true,
        createShare: async (r) => {
          created.push(`${r.onLabel}→${r.grantee}`);
          return { ok: true };
        },
      },
      row.id,
    );

    expect(outcome.ok).toBe(true);
    expect(created).toEqual(['Projects/budget.xlsx→anna@example.nl']);
    const settled = (await ledger.listShareGrants(TENANT, MAPPING)).find((r) => r.id === row.id)!;
    expect(settled.state).toBe('applied');
    expect(settled.decidedBy).toBe('owner@example.nl');
    expect(
      ledger.auditEvents.filter((e) => e.action === 'share.applied'),
    ).toHaveLength(1);

    // Second apply: a settled checklist item stays settled.
    const again = await applyShareGrant(
      { ...deps(ledger), isCutOver: () => true, createShare: async () => ({ ok: true }) },
      row.id,
    );
    expect(again).toMatchObject({ ok: false, code: 'already_settled' });
  });

  it("a target refusal travels verbatim and leaves the row OPEN — nothing was carried over", async () => {
    const ledger = new MemoryLedger();
    const row = await openCleanRow(ledger);

    const outcome = await applyShareGrant(
      {
        ...deps(ledger),
        isCutOver: () => true,
        createShare: async () => ({ ok: false, reason: 'OCS answered 404: user unknown' }),
      },
      row.id,
    );

    expect(outcome).toMatchObject({
      ok: false,
      code: 'target_refused',
      reason: 'OCS answered 404: user unknown',
    });
    const still = (await ledger.listShareGrants(TENANT, MAPPING)).find((r) => r.id === row.id)!;
    expect(still.state).toBe('open');
    expect(ledger.auditEvents).toHaveLength(0);
  });
});

describe('markShareGrant — the by-hand tick', () => {
  it('settles any verdict with attribution and an audit row; a second tick refuses', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger);
    const link = (await ledger.listShareGrants(TENANT, MAPPING)).find((r) => r.viaLink)!;

    const outcome = await markShareGrant(deps(ledger), link.id, 'done_manual', 'new link created');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.row.state).toBe('done_manual');
      expect(outcome.row.stateReason).toBe('new link created');
    }
    expect(ledger.auditEvents.filter((e) => e.action === 'share.done_manual')).toHaveLength(1);

    const again = await markShareGrant(deps(ledger), link.id, 'skipped');
    expect(again).toMatchObject({ ok: false, code: 'already_settled' });
  });
});

describe('applyAllOpenShareGrants — the one-go press (0104 T1)', () => {
  // The press batches the DECISION, never the rules: every row still walks
  // through applyShareGrant's gates, links and manual verdicts stay on the
  // checklist (the fallback digest's audience), and one target refusal never
  // costs the grantees whose shares succeeded their announcement.
  const SECOND_PERSON: PermissionGrant = {
    subject: 'drive_item',
    on: 'Plans/q4.docx',
    grantee: 'bram@example.nl',
    role: 'reader',
    raw: '{"type":"user","role":"reader","emailAddress":"bram@example.nl"}',
  };
  const MANUAL_GRANT: PermissionGrant = {
    subject: 'mailbox',
    on: 'shared@example.nl',
    grantee: 'anna@example.nl',
    role: 'FullAccess',
    raw: 'FullAccess',
  };

  async function pressReady(ledger: MemoryLedger) {
    await refreshed(ledger, [PERSON_GRANT, SECOND_PERSON, LINK_GRANT, MANUAL_GRANT]);
  }

  it('refuses before cutover with the SAME sentence the per-row apply uses — one source, proved', async () => {
    const ledger = new MemoryLedger();
    await pressReady(ledger);
    const row = (await ledger.listShareGrants(TENANT, MAPPING)).find(
      (r) => r.verdict === 'clean' && !r.viaLink,
    )!;

    const press = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => false,
      createShare: async () => ({ ok: true }),
    });
    const perRow = await applyShareGrant(
      { ...deps(ledger), isCutOver: () => false, createShare: async () => ({ ok: true }) },
      row.id,
    );

    expect(press).toMatchObject({ ok: false, code: 'not_cut_over', reason: notCutOverReason(['drive_item']) });
    if (!press.ok && !perRow.ok) expect(press.reason).toBe(perRow.reason);
  });

  it('applies every open clean addressable row; links and manual stay for the checklist', async () => {
    const ledger = new MemoryLedger();
    await pressReady(ledger);
    const shared: string[] = [];

    const outcome = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => true,
      createShare: async (row) => {
        shared.push(row.grantee ?? '');
        return { ok: true };
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.applied).toHaveLength(2);
    expect(outcome.refused).toHaveLength(0);
    expect(outcome.leftForChecklist).toEqual({ links: 1, manual: 1 });
    expect(shared.sort()).toEqual(['anna@example.nl', 'bram@example.nl']);

    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    expect(rows.filter((r) => r.state === 'applied')).toHaveLength(2);
    // The link and the manual verdict are still OPEN — the press left the
    // checklist's own work exactly where it was.
    expect(rows.filter((r) => r.state === 'open')).toHaveLength(2);
  });

  it('one refusal never stops the next: the refused row stays open, verbatim', async () => {
    const ledger = new MemoryLedger();
    await pressReady(ledger);

    const outcome = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => true,
      createShare: async (row) =>
        row.grantee === 'anna@example.nl'
          ? { ok: false, reason: 'OCS answered 403: Sharing is disabled for this folder' }
          : { ok: true },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.applied).toHaveLength(1);
    expect(outcome.refused).toHaveLength(1);
    expect(outcome.refused[0]).toMatchObject({
      grantee: 'anna@example.nl',
      code: 'target_refused',
    });
    expect(outcome.refused[0]!.reason).toContain('Sharing is disabled');

    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    expect(rows.find((r) => r.grantee === 'anna@example.nl' && r.verdict === 'clean' && !r.viaLink)!.state).toBe('open');
  });

  it('a second press retries exactly the refused rows — settled ones are never re-mailed', async () => {
    const ledger = new MemoryLedger();
    await pressReady(ledger);

    await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => true,
      createShare: async (row) =>
        row.grantee === 'anna@example.nl'
          ? { ok: false, reason: 'temporarily unavailable' }
          : { ok: true },
    });

    const secondPressShared: string[] = [];
    const retry = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => true,
      createShare: async (row) => {
        secondPressShared.push(row.grantee ?? '');
        return { ok: true };
      },
    });

    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    // Only the row the target refused last time — bram's applied share must
    // not produce a SECOND platform notification.
    expect(secondPressShared).toEqual(['anna@example.nl']);
    expect(retry.applied).toHaveLength(1);
  });

  it('the press lands once in the audit log, counted and attributed', async () => {
    const ledger = new MemoryLedger();
    await pressReady(ledger);

    await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => true,
      createShare: async () => ({ ok: true }),
    });

    const presses = ledger.auditEvents.filter((e) => e.action === 'share.apply_all');
    expect(presses).toHaveLength(1);
    expect(presses[0]).toMatchObject({
      actor: 'owner@example.nl',
      entity: 'share_grant',
      detail: {
        attempted: 2,
        applied: 2,
        refused: 0,
        leftForChecklist: { links: 1, manual: 1 },
      },
    });
  });
});

/**
 * ONE PRESS OVER ONE FOLDER, and not one address further (owner's call,
 * 2026-09-19: "folder-level with a confirm-first gate").
 *
 * The fold (0123 T4) turned 482 rows into about twenty on the owner's live
 * page, which made a per-folder press the one that matches what the screen
 * shows. It is NOT the one-go press with a filter: the one-go press is the
 * cutover moment, deliberately everything; this reaches one folder's worth of
 * people, so it carries ADR-0032 §6 at folder scale.
 *
 * What these hold, in the order it would cost somebody:
 *
 *  1. **Nothing is sent until every grantee is confirmed.** All of them,
 *     before the first invitation — a press that sent eight of eleven and then
 *     refused would already have done the thing the gate exists to prevent.
 *  2. **It sends where a person said, not where the source pointed.** The
 *     confirmed address is what reaches the target, and the audit records it.
 *  3. **A deviating row is never in the press.** It left the fold precisely
 *     because it is shared with somebody its siblings are not.
 *  4. **A folder with nobody to confirm still presses.** A folder shared only
 *     by link has no grantee to ask about; refusing it would read as a broken
 *     button rather than a gate.
 */
describe('applyShareGrantsInFolder — one press over one folder (2026-09-19)', () => {
  const inFolder = (over: Partial<PermissionGrant> & { on: string }): PermissionGrant => ({
    subject: 'drive_item',
    grantee: 'anna@example.nl',
    role: 'writer',
    raw: '{"type":"user","role":"writer","emailAddress":"anna@example.nl"}',
    parentKey: 'F',
    isContainer: false,
    ...over,
  });

  /** A shared folder, two children that agree with it, one that does not. */
  const FOLDER: PermissionGrant[] = [
    inFolder({ on: 'Foto shoot Emma', itemKey: 'F', parentKey: 'root', isContainer: true }),
    inFolder({ on: 'IMG_1.jpg', itemKey: 'c1' }),
    inFolder({ on: 'IMG_2.jpg', itemKey: 'c2' }),
    // Shared with somebody the folder is not, so it deviates, sits above the
    // fold, and is NOT what this press is for.
    inFolder({ on: 'Contract.pdf', itemKey: 'c9' }),
    inFolder({
      on: 'Contract.pdf',
      itemKey: 'c9',
      grantee: 'bram@example.nl',
      role: 'reader',
      raw: '{"type":"user","role":"reader","emailAddress":"bram@example.nl"}',
    }),
  ];

  const CONFIRMED = { 'anna@example.nl': 'anna@new-domain.nl' };

  it('applies the folder, to the address a person confirmed', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, FOLDER);
    const sentTo: string[] = [];

    const press = await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        isCutOver: () => true,
        confirmed: CONFIRMED,
        createShare: async (_row, shareWith) => {
          sentTo.push(shareWith ?? '(the source\u2019s own)');
          return { ok: true };
        },
      },
      'F',
    );

    expect(press.ok).toBe(true);
    if (!press.ok) return;
    // The folder itself and the two children that agree with it.
    expect(press.applied).toHaveLength(3);
    expect(sentTo).toEqual([
      'anna@new-domain.nl',
      'anna@new-domain.nl',
      'anna@new-domain.nl',
    ]);

    // AND THE DEVIATION IS UNTOUCHED. It is the row somebody has to look at.
    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    expect(rows.filter((r) => r.onLabel === 'Contract.pdf').every((r) => r.state === 'open')).toBe(
      true,
    );
  });

  it('sends NOTHING until every grantee in the folder is confirmed, and names who is not', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, FOLDER);
    let asked = 0;

    const press = await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        isCutOver: () => true,
        confirmed: {},
        createShare: async () => {
          asked += 1;
          return { ok: true };
        },
      },
      'F',
    );

    expect(press).toMatchObject({ ok: false, code: 'unconfirmed_grantees' });
    if (press.ok || press.code !== 'unconfirmed_grantees') return;
    expect(press.grantees).toEqual(['anna@example.nl']);
    expect(press.reason).toContain('anna@example.nl');
    // All-or-nothing: the target was never asked, so nobody was invited.
    expect(asked).toBe(0);
    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    expect(rows.every((r) => r.state === 'open')).toBe(true);
  });

  it('treats an empty address as no confirmation at all', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, FOLDER);

    const press = await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        isCutOver: () => true,
        confirmed: { 'anna@example.nl': '   ' },
        createShare: async () => ({ ok: true }),
      },
      'F',
    );

    expect(press).toMatchObject({ ok: false, code: 'unconfirmed_grantees' });
  });

  it('refuses before cutover with the SAME sentence the per-row apply uses', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, FOLDER);

    const press = await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        isCutOver: () => false,
        confirmed: CONFIRMED,
        createShare: async () => ({ ok: true }),
      },
      'F',
    );

    expect(press).toMatchObject({ ok: false, code: 'not_cut_over', reason: notCutOverReason(['drive_item']) });
  });

  it('waits for the files, whatever else is cut over (0128 T5, slice 6)', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, FOLDER);
    const sent: string[] = [];

    const press = await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        isCutOver: (subject) => subject === 'calendar',
        confirmed: CONFIRMED,
        createShare: async (row) => {
          sent.push(row.onLabel);
          return { ok: true };
        },
      },
      'F',
    );

    expect(press).toEqual({ ok: false, code: 'not_cut_over', reason: notCutOverReason(['drive_item']) });
    expect(sent).toEqual([]);
  });

  it('refuses a container that heads no group, rather than pressing nothing quietly', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, FOLDER);

    const press = await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        isCutOver: () => true,
        confirmed: CONFIRMED,
        createShare: async () => ({ ok: true }),
      },
      'a-folder-that-is-not-in-this-migration',
    );

    expect(press).toMatchObject({ ok: false, code: 'no_such_folder' });
  });

  it('presses a folder with nobody to confirm, applies nothing, and counts the links', async () => {
    // A LINK HAS NO ADDRESSABLE AUDIENCE, so there is nobody to ask about —
    // and a gate that refused for want of a confirmation it could never
    // obtain would read as a broken button rather than as a gate.
    const ledger = new MemoryLedger();
    const byLink = (on: string, itemKey: string, over: Partial<PermissionGrant> = {}) => ({
      subject: 'drive_item' as const,
      on,
      role: 'reader',
      viaLink: true,
      raw: '{"type":"anyone","role":"reader"}',
      itemKey,
      parentKey: 'P',
      isContainer: false,
      ...over,
    });
    await refreshed(ledger, [
      byLink('Public', 'P', { parentKey: 'root', isContainer: true }),
      byLink('Poster.pdf', 'p1'),
    ]);

    const press = await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        isCutOver: () => true,
        confirmed: {},
        createShare: async () => ({ ok: true }),
      },
      'P',
    );

    expect(press.ok).toBe(true);
    if (!press.ok) return;
    expect(press.applied).toHaveLength(0);
    expect(press.leftForChecklist).toEqual({ links: 2, manual: 0 });
  });

  it('records the press against the folder, and each row against where it went', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, FOLDER);

    await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        isCutOver: () => true,
        confirmed: CONFIRMED,
        createShare: async () => ({ ok: true }),
      },
      'F',
    );

    const press = ledger.auditEvents.find((e) => e.action === 'share.apply_folder');
    expect(press?.detail).toMatchObject({
      parentKey: 'F',
      folder: 'Foto shoot Emma',
      attempted: 3,
      applied: 3,
      refused: 0,
      grantees: 1,
    });

    // A CORRECTED ADDRESS USED TO LEAVE THE OLD ONE IN THE LOG. The invitation
    // landed at anna@new-domain.nl and the record said anna@example.nl — a
    // record of an act that names the wrong recipient is worse than one that
    // names none.
    const row = ledger.auditEvents.find((e) => e.action === 'share.applied');
    expect(row?.detail).toMatchObject({
      grantee: 'anna@example.nl',
      sentTo: 'anna@new-domain.nl',
    });
  });
});

describe('each share waits for its own data type\u2019s cutover (0128 T5, slice 6, D8)', () => {
  // Calendars cut over on their own while the files keep running: the
  // calendar's share is announced now, the files' at their own cutover.
  const CALENDAR_GRANT: PermissionGrant = {
    subject: 'calendar',
    on: 'Team planning',
    grantee: 'cas@example.nl',
    role: 'read',
    raw: '{"type":"user","role":"read","emailAddress":"cas@example.nl"}',
  };
  const SECOND_FILE: PermissionGrant = {
    subject: 'drive_item',
    on: 'Plans/q4.docx',
    grantee: 'bram@example.nl',
    role: 'reader',
    raw: '{"type":"user","role":"reader","emailAddress":"bram@example.nl"}',
  };
  const calendarsCutOver = (subject: string) => subject === 'calendar';

  async function rowsOf(ledger: MemoryLedger) {
    await refreshed(ledger, [PERSON_GRANT, SECOND_FILE, CALENDAR_GRANT, LINK_GRANT]);
    return ledger.listShareGrants(TENANT, MAPPING);
  }

  it('one row: a calendar share is applied once the calendars are cut over, a file share is not', async () => {
    const ledger = new MemoryLedger();
    const rows = await rowsOf(ledger);
    const created: string[] = [];
    const gated = {
      ...deps(ledger),
      isCutOver: calendarsCutOver,
      createShare: async (row: { onLabel: string }) => {
        created.push(row.onLabel);
        return { ok: true as const };
      },
    };

    const calendar = await applyShareGrant(gated, rows.find((r) => r.subject === 'calendar')!.id);
    const file = await applyShareGrant(gated, rows.find((r) => r.onLabel === 'Plans/q4.docx')!.id);

    expect(calendar.ok).toBe(true);
    expect(file).toEqual({ ok: false, code: 'not_cut_over', reason: notCutOverReason(['drive_item']) });
    expect(created).toEqual(['Team planning']);
  });

  it('the one-go press applies the data types that are cut over and leaves the rest open for their own', async () => {
    const ledger = new MemoryLedger();
    await rowsOf(ledger);

    const press = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: calendarsCutOver,
      createShare: async () => ({ ok: true }),
    });

    expect(press).toMatchObject({ ok: true, refused: [], waitingForCutover: 2 });
    if (press.ok) expect(press.applied.map((r) => r.onLabel)).toEqual(['Team planning']);
    const after = await ledger.listShareGrants(TENANT, MAPPING);
    expect(after.filter((r) => r.subject === 'drive_item' && !r.viaLink).map((r) => r.state)).toEqual(['open', 'open']);
    const receipt = ledger.auditEvents.find((e) => e.action === 'share.apply_all')!;
    expect(receipt.detail).toMatchObject({ attempted: 1, applied: 1, waitingForCutover: 2 });

    // And at the files' own cutover, the next press announces them: once each.
    const next = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => true,
      createShare: async () => ({ ok: true }),
    });
    expect(next).toMatchObject({ ok: true, waitingForCutover: 0 });
    if (next.ok) expect(next.applied.map((r) => r.onLabel).sort()).toEqual(['Plans/q4.docx', 'Projects/budget.xlsx']);
  });

  it('with none of them cut over, the press is refused whole, naming each data type that waits', async () => {
    const ledger = new MemoryLedger();
    await rowsOf(ledger);

    const press = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => false,
      createShare: async () => ({ ok: true }),
    });

    expect(press).toEqual({ ok: false, code: 'not_cut_over', reason: notCutOverReason(['drive_item', 'calendar']) });
    if (!press.ok) expect(press.reason).toContain("this migration's calendars and files are applied once each is cut over");
    expect(ledger.auditEvents.filter((e) => e.action === 'share.apply_all')).toEqual([]);
  });

  it('says which data type waits, in its own words; one it cannot place waits for the whole migration', () => {
    expect(notCutOverReason(['calendar'])).toBe(
      "Shares on this migration's calendars are applied once the calendars are cut over, not before: " +
        'the share invite is an announcement that the new system is live, and the calendars are not ' +
        'cut over yet. Work these rows once they are (ADR-0032).',
    );
    expect(notCutOverReason(['mailbox'])).toContain('once the mail is cut over');
    expect(notCutOverReason(['mailbox'])).toContain('Work these rows once it is');
    expect(notCutOverReason(['drive_item', 'drive_item'])).toBe(notCutOverReason(['drive_item']));
    expect(notCutOverReason(['calendar', 'something_new'])).toBe(NOT_CUT_OVER_REASON);
    expect(notCutOverReason([])).toBe(NOT_CUT_OVER_REASON);
  });
});

/**
 * THE SHARING CHECKLIST IN THE READER'S LANGUAGE (UX sweep, 2026-10-17). A
 * Dutch tester read an English line under every row of the *Deel-checklist*:
 * the stored verdict is English, with the developer's note glued on. The line
 * for a Dutch reader is said again from the row's own facts; the stored
 * English stays, because a refusal quotes it.
 */
describe('verdictTargetFor — the line under a row, in the reader\u2019s language', () => {
  it('says the Dutch target, without the English developer note', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger);
    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    const person = rows.find((r) => r.grantee === 'anna@example.nl')!;
    const link = rows.find((r) => r.viaLink)!;

    expect(verdictTargetFor(person, 'nl')).toBe('een Nextcloud-deling met bewerkrechten');
    expect(verdictTargetFor(link, 'nl')).toMatch(/^beslis of deze link na de migratie nog moet bestaan/);
    for (const row of [person, link]) {
      expect(verdictTargetFor(row, 'nl')).not.toContain(' \u2014 ');
    }
  });

  it('says the English target too, and leaves the stored verdict as it was', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger);
    const person = (await ledger.listShareGrants(TENANT, MAPPING)).find((r) => r.grantee === 'anna@example.nl')!;

    expect(verdictTargetFor(person, 'en')).toBe('a Nextcloud share with edit permission');
    // The stored line still carries the note: the manual-only refusal quotes it.
    expect(person.verdictTarget).toBe(
      'a Nextcloud share with edit permission \u2014 A per-person file or folder share exists on both sides.',
    );
  });
});

/**
 * THE TARGET'S LIMIT ON NEW SHARES (workplan 0104, Status of 2026-10-25).
 *
 * Nextcloud 31 to 35 let one account create 20 shares in 10 minutes, failed
 * attempts included, and answer the next one 429; a 429 itself is not
 * counted. A press asks for a user share first and by mail after a 404, so an
 * outsider's row costs two. E2E (managed) #277 met it: apply-all went on past
 * the first 429, and every row after it came back refused under the generic
 * sentence, with nothing to say that waiting was the remedy.
 *
 * What these hold: a 429 is `target_limited`, never `target_refused`; both
 * presses stop at the first one, leave that row and every row after it open
 * and untried, and report them apart from the refusals with the edition's
 * sentence saying when to apply again; a press after the window tries those
 * rows and no others.
 */
describe("the target's limit on new shares (0104, 2026-10-25)", () => {
  /** Six people the target has no account for, one item each. */
  const OUTSIDERS: PermissionGrant[] = [1, 2, 3, 4, 5, 6].map((n) => ({
    subject: 'drive_item',
    on: `Projects/item-${n}.xlsx`,
    grantee: `outsider-${n}@example.nl`,
    role: 'reader',
    raw: `{"type":"user","role":"reader","emailAddress":"outsider-${n}@example.nl"}`,
  }));

  /**
   * The target, as `createNextcloudShare` meets it: each outsider's row is a
   * user attempt and a share by mail, two calls against `allowance`, and a
   * call past it is the limit. The sentence is the edition's; these only need
   * to see it travel.
   */
  function nextcloudWithALimit(allowance: number, retryAfterSeconds?: number) {
    let calls = 0;
    const tried: string[] = [];
    const createShare = async (row: ShareGrantRow) => {
      tried.push(row.onLabel);
      for (const _attempt of ['user', 'mail']) {
        if (calls >= allowance) {
          return {
            ok: false as const,
            reason: 'The new system limits how many shares one account may create (status 429).',
            reasonNl: 'Het nieuwe systeem beperkt hoeveel deelrechten één account mag aanmaken (status 429).',
            limited: retryAfterSeconds === undefined ? {} : { retryAfterSeconds },
          };
        }
        calls++;
      }
      return { ok: true as const };
    };
    return { createShare, tried, calls: () => calls, reset: (more: number) => ((calls = 0), (allowance = more)) };
  }

  const openClean = async (ledger: MemoryLedger) =>
    (await ledger.listShareGrants(TENANT, MAPPING)).filter((r) => r.state === 'open' && r.verdict === 'clean' && !r.viaLink);

  it('one row: the limit is target_limited, the row stays open, and nothing is recorded as applied', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, OUTSIDERS.slice(0, 1));
    const [row] = await openClean(ledger);
    const target = nextcloudWithALimit(0, 120);

    const outcome = await applyShareGrant({ ...deps(ledger), isCutOver: () => true, createShare: target.createShare }, row!.id);

    expect(outcome).toEqual({
      ok: false,
      code: 'target_limited',
      reason: 'The new system limits how many shares one account may create (status 429).',
      reasonNl: 'Het nieuwe systeem beperkt hoeveel deelrechten één account mag aanmaken (status 429).',
      limited: { retryAfterSeconds: 120 },
    });
    expect((await ledger.listShareGrants(TENANT, MAPPING))[0]!.state).toBe('open');
    expect(ledger.auditEvents.filter((e) => e.action === 'share.applied')).toHaveLength(0);
  });

  it('the one-go press stops at the first limit and leaves that row and the rest open and untried', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, OUTSIDERS);
    const order = (await openClean(ledger)).map((r) => r.onLabel);
    // Room for three outsiders: six calls.
    const target = nextcloudWithALimit(6);

    const press = await applyAllOpenShareGrants({ ...deps(ledger), isCutOver: () => true, createShare: target.createShare });

    expect(press.ok).toBe(true);
    if (!press.ok) return;
    expect(press.applied).toHaveLength(3);
    // Not refused: none of them was.
    expect(press.refused).toEqual([]);
    expect(press.waitingForLimit).toHaveLength(3);
    // The rows in the order the press would have tried them, the one that met
    // the limit first.
    expect([...press.applied.map((r) => r.onLabel), ...press.waitingForLimit.map((r) => r.on)]).toEqual(order);
    expect(press.waitingForLimit[0]).toMatchObject({ on: order[3], grantee: expect.stringMatching(/^outsider-/) });
    expect(press.limit).toEqual({
      reason: 'The new system limits how many shares one account may create (status 429).',
      reasonNl: 'Het nieuwe systeem beperkt hoeveel deelrechten één account mag aanmaken (status 429).',
    });
    // It stopped: the fourth row met the limit, the fifth and sixth were never asked.
    expect(target.tried).toEqual(order.slice(0, 4));
    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    expect(rows.filter((r) => r.state === 'applied')).toHaveLength(3);
    expect(rows.filter((r) => r.state === 'open').map((r) => r.id).sort()).toEqual(
      press.waitingForLimit.map((r) => r.id).sort(),
    );

    const recorded = ledger.auditEvents.filter((e) => e.action === 'share.apply_all');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.detail).toMatchObject({ attempted: 6, applied: 3, refused: 0, waitingForLimit: 3 });
  });

  it('a refusal before the limit stays a refusal, and the wait the server asked for travels', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, OUTSIDERS.slice(0, 3));
    const order = (await openClean(ledger)).map((r) => r.onLabel);
    const target = nextcloudWithALimit(0, 300);
    let first = true;

    const press = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => true,
      createShare: async (row) => {
        if (first) {
          first = false;
          return { ok: false, reason: 'OCS answered 403: Sharing is disabled for this folder' };
        }
        return target.createShare(row);
      },
    });

    expect(press.ok).toBe(true);
    if (!press.ok) return;
    expect(press.refused.map((r) => [r.on, r.code])).toEqual([[order[0], 'target_refused']]);
    expect(press.waitingForLimit.map((r) => r.on)).toEqual(order.slice(1));
    expect(press.limit?.retryAfterSeconds).toBe(300);
  });

  it('a press after the window tries the rows that waited, and nobody is asked twice', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, OUTSIDERS);
    const target = nextcloudWithALimit(6);
    const first = await applyAllOpenShareGrants({ ...deps(ledger), isCutOver: () => true, createShare: target.createShare });
    if (!first.ok) throw new Error('the first press was refused');
    const waited = first.waitingForLimit.map((r) => r.on);

    target.tried.length = 0;
    target.reset(20);
    const second = await applyAllOpenShareGrants({ ...deps(ledger), isCutOver: () => true, createShare: target.createShare });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(target.tried).toEqual(waited);
    expect(second.applied.map((r) => r.onLabel)).toEqual(waited);
    expect(second.waitingForLimit).toEqual([]);
    expect(second).not.toHaveProperty('limit');
    expect((await ledger.listShareGrants(TENANT, MAPPING)).every((r) => r.state === 'applied')).toBe(true);
  });

  /**
   * THE REFUSED ROWS COME FIRST AGAIN (review of #1704, R1-1). A refused row
   * stays open and unchanged, and the rows come in the same order on every
   * press, so the rows refused before the limit are asked for again first,
   * each attempt counted. Fifteen outsiders, the first ten refused: those ten
   * spend the twenty calls on every press, and the last five are never tried.
   * The press cannot reorder that (a refusal leaves no mark on its row); its
   * sentence says to settle the refused rows first.
   */
  it('a press that meets the limit after refusals says those rows come first again and count toward it', async () => {
    const ledger = new MemoryLedger();
    const fifteen: PermissionGrant[] = Array.from({ length: 15 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return {
        subject: 'drive_item',
        on: `Projects/item-${n}.xlsx`,
        grantee: `outsider-${n}@example.nl`,
        role: 'reader',
        raw: `{"type":"user","role":"reader","emailAddress":"outsider-${n}@example.nl"}`,
      };
    });
    await refreshed(ledger, fifteen);
    const order = (await openClean(ledger)).map((r) => r.onLabel);
    const refusedOnes = new Set(order.slice(0, 10));
    let calls = 0;
    const tried: string[] = [];
    const createShare = async (row: ShareGrantRow) => {
      tried.push(row.onLabel);
      for (const _attempt of ['user', 'mail']) {
        if (calls >= 20) {
          return {
            ok: false as const,
            reason: 'The new system limits how many shares one account may create (status 429).',
            reasonNl: 'Het nieuwe systeem beperkt hoeveel deelrechten één account mag aanmaken (status 429).',
            limited: {},
          };
        }
        calls++;
      }
      return refusedOnes.has(row.onLabel)
        ? { ok: false as const, reason: 'OCS answered 403: no', reasonNl: 'geweigerd', refusedAs: 'noAccountNoMail' as const }
        : { ok: true as const };
    };

    for (const press of [1, 2, 3]) {
      calls = 0;
      tried.length = 0;
      const outcome = await applyAllOpenShareGrants({ ...deps(ledger), isCutOver: () => true, createShare });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      // The same every time: ten refused, five waiting, none of those five asked.
      expect(outcome.applied, `press ${press}`).toEqual([]);
      expect(outcome.refused.map((r) => r.on)).toEqual(order.slice(0, 10));
      expect(outcome.waitingForLimit.map((r) => r.on)).toEqual(order.slice(10));
      expect(tried).toEqual(order.slice(0, 11));
      // And its sentence says why, and what to do, in both languages.
      expect(outcome.limit?.reason).toMatch(/^The new system limits how many shares one account may create \(status 429\)\. /);
      expect(outcome.limit?.reason).toContain('refused 10 shares this press asked for, and those attempts count toward the same limit');
      expect(outcome.limit?.reason).toContain('before the rows that wait');
      expect(outcome.limit?.reason).toContain('correct those rows, skip them or mark them done before applying again');
      expect(outcome.limit?.reasonNl).toMatch(/^Het nieuwe systeem beperkt .*\(status 429\)\. Vóór de limiet weigerde het nieuwe systeem 10 deelrechten/);
      expect(outcome.limit?.reason).not.toContain('password');
    }

    // Settling the refused rows is what lets the rows that waited through.
    for (const row of (await openClean(ledger)).filter((r) => refusedOnes.has(r.onLabel))) {
      await markShareGrant(deps(ledger), row.id, 'skipped');
    }
    calls = 0;
    const after = await applyAllOpenShareGrants({ ...deps(ledger), isCutOver: () => true, createShare });
    if (!after.ok) throw new Error('the press after settling was refused');
    expect(after.applied.map((r) => r.onLabel)).toEqual(order.slice(10));
    expect(after.waitingForLimit).toEqual([]);
  });

  it('a refused sign-in before the limit says to check the password first; a refusal the target never answered counts nothing', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, OUTSIDERS.slice(0, 4));
    const order = (await openClean(ledger)).map((r) => r.onLabel);
    const answers = new Map<string, Awaited<ReturnType<NonNullable<Parameters<typeof applyAllOpenShareGrants>[0]['createShare']>>>>([
      [order[0]!, { ok: false, reason: 'OCS answered 401', reasonNl: 'aanmelding', refusedAs: 'signIn' }],
      [order[1]!, { ok: false, reason: 'connect ECONNREFUSED', reasonNl: 'onbereikbaar', refusedAs: 'unreachable' }],
      [order[2]!, { ok: false, reason: 'nobody to share with' }],
    ]);
    const press = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => true,
      createShare: async (row) =>
        answers.get(row.onLabel) ?? {
          ok: false,
          reason: 'The new system limits how many shares (status 429).',
          reasonNl: 'Het nieuwe systeem beperkt (status 429).',
          limited: {},
        },
    });
    if (!press.ok) throw new Error('the press was refused');
    expect(press.refused).toHaveLength(3);
    expect(press.limit?.reason).toContain('also refused the sign-in');
    expect(press.limit?.reason).toContain('check the password of the destination account on the Accounts page first');
    expect(press.limit?.reasonNl).toContain('controleer eerst het wachtwoord');
    // The sign-in, the address nothing answered at and the row with nobody to
    // share with spent nothing of the limit, so no count is claimed for them.
    expect(press.limit?.reason).not.toMatch(/refused \d+ shares? this press asked for/);
  });

  it('the folder press stops at the limit the same way, and records how many wait', async () => {
    const ledger = new MemoryLedger();
    const folder: PermissionGrant[] = [
      { ...OUTSIDERS[0]!, on: 'Shared', itemKey: 'F', parentKey: 'root', isContainer: true },
      { ...OUTSIDERS[0]!, on: 'Shared/one.jpg', itemKey: 'c1', parentKey: 'F', isContainer: false },
      { ...OUTSIDERS[0]!, on: 'Shared/two.jpg', itemKey: 'c2', parentKey: 'F', isContainer: false },
    ];
    await refreshed(ledger, folder);
    const target = nextcloudWithALimit(3);

    const press = await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        isCutOver: () => true,
        confirmed: { 'outsider-1@example.nl': 'outsider-1@example.nl' },
        createShare: target.createShare,
      },
      'F',
    );

    expect(press.ok).toBe(true);
    if (!press.ok) return;
    // Two calls for the first row, then the second row's share by mail met the limit.
    expect(press.applied).toHaveLength(1);
    expect(press.refused).toEqual([]);
    expect(press.waitingForLimit).toHaveLength(2);
    expect(press.waitingForCutover).toBe(0);
    expect(press.limit?.reason).toContain('status 429');
    expect(target.tried).toHaveLength(2);
    const recorded = ledger.auditEvents.filter((e) => e.action === 'share.apply_folder');
    expect(recorded[0]!.detail).toMatchObject({ attempted: 3, applied: 1, refused: 0, waitingForLimit: 2 });
  });

  it('a press that meets no limit says so: nothing waits, and no limit is named', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, OUTSIDERS.slice(0, 2));
    const press = await applyAllOpenShareGrants({
      ...deps(ledger),
      isCutOver: () => true,
      createShare: nextcloudWithALimit(20).createShare,
    });
    expect(press).toMatchObject({ ok: true, waitingForLimit: [] });
    expect(press).not.toHaveProperty('limit');
    expect(ledger.auditEvents.find((e) => e.action === 'share.apply_all')!.detail).toMatchObject({ waitingForLimit: 0 });
  });
});
