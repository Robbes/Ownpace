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
  applyShareGrant,
  markShareGrant,
  refreshShareGrants,
  shareGrantHash,
  summariseShareGrants,
} from './share-queue.ts';

const TENANT = 'tenant-1' as TenantId;
const MAPPING = 'mapping-1' as MappingId;

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
      scans: [
        async () => ({ kind: 'listed' as const, grants: [PERSON_GRANT, LINK_GRANT] }),
        async () => ({ kind: 'not_discoverable' as const, reason: 'nothing was looked at' }),
      ],
    });

    expect(result.open).toBe(2);
    expect(result.blindSpots).toEqual(['nothing was looked at']);
    const rows = await ledger.listShareGrants(TENANT, MAPPING);
    expect(rows).toHaveLength(2);
    // A per-person file share maps clean; a link is a decision, not a
    // translation (0029 T2) — the queue inherits exactly those verdicts.
    expect(rows.find((r) => r.grantee === 'anna@example.nl')!.verdict).toBe('clean');
    expect(rows.find((r) => r.viaLink)!.verdict).toBe('manual');
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
