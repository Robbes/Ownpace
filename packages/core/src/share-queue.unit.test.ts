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
import type { MappingId, PermissionGrant, TenantId } from '@openmig/shared';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  NOT_CUT_OVER_REASON,
  applyAllOpenShareGrants,
  applyShareGrant,
  applyShareGrantsInFolder,
  markShareGrant,
  refreshShareGrants,
  shareGrantHash,
  summariseShareGrants,
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
      { ...deps(ledger), lifecycleDone: false, createShare: async () => ({ ok: true }) },
      row.id,
    );

    expect(outcome).toMatchObject({ ok: false, code: 'not_cut_over' });
  });

  it('refuses a link share with the unknown-audience sentence (ADR-0032 §7)', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger);
    const link = (await ledger.listShareGrants(TENANT, MAPPING)).find((r) => r.viaLink)!;

    const outcome = await applyShareGrant(
      { ...deps(ledger), lifecycleDone: true, createShare: async () => ({ ok: true }) },
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
      { ...deps(ledger), lifecycleDone: true, createShare: async () => ({ ok: true }) },
      row.id,
    );

    expect(outcome).toMatchObject({ ok: false, code: 'manual_only' });
    if (!outcome.ok) expect(outcome.reason).toContain(row.verdictTarget);
  });

  it('refuses when the target has no share API, naming the protocol gap', async () => {
    const ledger = new MemoryLedger();
    const row = await openCleanRow(ledger);

    const outcome = await applyShareGrant({ ...deps(ledger), lifecycleDone: true }, row.id);

    expect(outcome).toMatchObject({ ok: false, code: 'no_share_api' });
  });

  it('applies through the target, settles the row attributed, writes the audit row', async () => {
    const ledger = new MemoryLedger();
    const row = await openCleanRow(ledger);
    const created: string[] = [];

    const outcome = await applyShareGrant(
      {
        ...deps(ledger),
        lifecycleDone: true,
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
      { ...deps(ledger), lifecycleDone: true, createShare: async () => ({ ok: true }) },
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
        lifecycleDone: true,
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
      lifecycleDone: false,
      createShare: async () => ({ ok: true }),
    });
    const perRow = await applyShareGrant(
      { ...deps(ledger), lifecycleDone: false, createShare: async () => ({ ok: true }) },
      row.id,
    );

    expect(press).toMatchObject({ ok: false, code: 'not_cut_over', reason: NOT_CUT_OVER_REASON });
    if (!press.ok && !perRow.ok) expect(press.reason).toBe(perRow.reason);
  });

  it('applies every open clean addressable row; links and manual stay for the checklist', async () => {
    const ledger = new MemoryLedger();
    await pressReady(ledger);
    const shared: string[] = [];

    const outcome = await applyAllOpenShareGrants({
      ...deps(ledger),
      lifecycleDone: true,
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
      lifecycleDone: true,
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
      lifecycleDone: true,
      createShare: async (row) =>
        row.grantee === 'anna@example.nl'
          ? { ok: false, reason: 'temporarily unavailable' }
          : { ok: true },
    });

    const secondPressShared: string[] = [];
    const retry = await applyAllOpenShareGrants({
      ...deps(ledger),
      lifecycleDone: true,
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
      lifecycleDone: true,
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
        lifecycleDone: true,
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
        lifecycleDone: true,
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
        lifecycleDone: true,
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
        lifecycleDone: false,
        confirmed: CONFIRMED,
        createShare: async () => ({ ok: true }),
      },
      'F',
    );

    expect(press).toMatchObject({ ok: false, code: 'not_cut_over', reason: NOT_CUT_OVER_REASON });
  });

  it('refuses a container that heads no group, rather than pressing nothing quietly', async () => {
    const ledger = new MemoryLedger();
    await refreshed(ledger, FOLDER);

    const press = await applyShareGrantsInFolder(
      {
        ...deps(ledger),
        lifecycleDone: true,
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
        lifecycleDone: true,
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
        lifecycleDone: true,
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
