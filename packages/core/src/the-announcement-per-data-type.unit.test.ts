// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ANNOUNCEMENT OF THE SHARES CARRIED BY HAND, ONE WAVE PER DATA TYPE
 * (workplan 0104 T3; 0128 T5, slice 6, the owner's D8).
 *
 * What these hold, in the order it would cost a grantee if wrong:
 *
 *  1. A data type's shares are announced at its own cutover: the calendars'
 *     while the files still run, the files' at theirs, and each person hears
 *     only of their own items, in the wave of their data type.
 *  2. Each data type is announced once. A press after both waves is refused,
 *     and mails the same people again only when asked to on purpose; a press
 *     made for the whole migration, before the waves, announced them all.
 *  3. A press with nothing cut over is refused, naming what waits; without a
 *     mail channel it is refused before anything is read as sent.
 */

import { describe, it, expect } from 'vitest';
import type { MappingId, NotificationMessage, PermissionGrant, TenantId } from '@openmig/shared';
import { MemoryLedger } from './__testing__/memory.ts';
import { markShareGrant, refreshShareGrants } from './share-queue.ts';
import {
  NOTIFICATIONS_OFF_REASON,
  alreadyAnnouncedReason,
  announceByHandShares,
  notCutOverToAnnounceReason,
} from './share-announce.ts';

const TENANT = 'tenant-1' as TenantId;
const MAPPING = 'mapping-1' as MappingId;

const grant = (subject: PermissionGrant['subject'], on: string, grantee?: string): PermissionGrant => ({
  subject,
  on,
  role: 'reader',
  raw: '{}',
  ...(grantee ? { grantee } : { viaLink: true }),
});

/**
 * A migration with shares carried by hand on its calendars and its files: one
 * person holds one of each, another a file only, and a file is shared by link.
 */
async function carriedByHand(): Promise<MemoryLedger> {
  const ledger = new MemoryLedger();
  await refreshShareGrants({
    tenantId: TENANT,
    mappingId: MAPPING,
    ledger,
    delegationReason: 'not read',
    scans: [
      async () => ({
        kind: 'listed' as const,
        grants: [
          grant('calendar', 'Team planning', 'cas@example.invalid'),
          grant('drive_item', 'Projects/budget.xlsx', 'cas@example.invalid'),
          grant('drive_item', 'Projects/plan.odt', 'anna@example.invalid'),
          grant('drive_item', 'Photos'),
        ],
      }),
    ],
  });
  const deps = { tenantId: TENANT, mappingId: MAPPING, ledger, decidedBy: 'owner' };
  for (const row of await ledger.listShareGrants(TENANT, MAPPING)) {
    expect((await markShareGrant(deps, row.id, 'done_manual')).ok).toBe(true);
  }
  return ledger;
}

/** Who was told what, as the mail channel saw it. */
function mailbox() {
  const mails: Array<{ to: string; message: NotificationMessage }> = [];
  return {
    mails,
    tell: async (to: string, message: NotificationMessage) => {
      mails.push({ to, message });
      return true;
    },
  };
}

const cutOver =
  (...subjects: string[]) =>
  (subject: string) =>
    subjects.includes(subject);

function press(ledger: MemoryLedger, isCutOver: (s: string) => boolean, tell = mailbox().tell, confirmResend = false) {
  return announceByHandShares(
    { tenantId: TENANT, mappingId: MAPPING, ledger, pressedBy: 'owner', isCutOver, channelIsOn: true, tell },
    { note: 'It all lives on the new server now.', locale: 'en', confirmResend },
  );
}

const presses = (ledger: MemoryLedger) => ledger.auditEvents.filter((e) => e.action === 'share.announce');

describe('each data type’s shares carried by hand, announced at its own cutover', () => {
  it('the calendars’ while the files run, the files’ at theirs; each person hears of their own items in their data type’s wave', async () => {
    const ledger = await carriedByHand();

    const calendars = mailbox();
    const first = await press(ledger, cutOver('calendar'), calendars.tell);
    expect(first).toMatchObject({
      ok: true,
      sent: ['cas@example.invalid'],
      failed: [],
      withoutAddress: 0,
      resend: false,
      waitingForCutover: 3,
      alreadyAnnounced: 0,
    });
    expect(calendars.mails).toHaveLength(1);
    expect(calendars.mails[0]!.message.body).toContain('Team planning');
    expect(calendars.mails[0]!.message.body).not.toContain('budget');

    const files = mailbox();
    const second = await press(ledger, cutOver('calendar', 'drive_item'), files.tell);
    expect(second).toMatchObject({
      ok: true,
      sent: ['anna@example.invalid', 'cas@example.invalid'],
      withoutAddress: 1,
      resend: false,
      waitingForCutover: 0,
      alreadyAnnounced: 1,
    });
    const toCas = files.mails.find((m) => m.to === 'cas@example.invalid')!.message.body;
    expect(toCas).toContain('Projects/budget.xlsx');
    expect(toCas).not.toContain('Team planning');

    expect(presses(ledger).map((e) => e.detail)).toEqual([
      expect.objectContaining({ mappingId: MAPPING, subjects: ['calendar'], sent: 1, waitingForCutover: 3 }),
      expect.objectContaining({ mappingId: MAPPING, subjects: ['drive_item'], sent: 2, alreadyAnnounced: 1 }),
    ]);
  });
});

describe('each data type is announced once', () => {
  it('a press after both waves is refused, and mails them all again only when asked to on purpose', async () => {
    const ledger = await carriedByHand();
    await press(ledger, cutOver('calendar'));
    await press(ledger, cutOver('calendar', 'drive_item'));

    const again = mailbox();
    const refused = await press(ledger, cutOver('calendar', 'drive_item'), again.tell);
    expect(refused).toMatchObject({ ok: false, code: 'already_announced' });
    expect((refused as { reason: string }).reason).toMatch(
      /^The shares carried by hand on this migration's calendars and files were already announced, the last time on /,
    );
    expect(again.mails).toEqual([]);
    expect(presses(ledger)).toHaveLength(2);

    const resent = await press(ledger, cutOver('calendar', 'drive_item'), again.tell, true);
    expect(resent).toMatchObject({ ok: true, resend: true, alreadyAnnounced: 0 });
    expect(again.mails.map((m) => m.to)).toEqual(['anna@example.invalid', 'cas@example.invalid']);
    const resend = presses(ledger)[2]!.detail as { subjects: string[]; resend: boolean };
    expect([[...resend.subjects].sort(), resend.resend]).toEqual([['calendar', 'drive_item'], true]);
  });

  it('a press made for the whole migration, before the waves, announced every data type', async () => {
    const ledger = await carriedByHand();
    await ledger.recordAuditEvent(TENANT, {
      actor: 'owner',
      action: 'share.announce',
      entity: 'share_grant',
      detail: { mappingId: MAPPING, grantees: 2, sent: 2, failed: 0 },
    });
    const mail = mailbox();
    const refused = await press(ledger, cutOver('calendar', 'drive_item'), mail.tell);
    expect(refused).toMatchObject({ ok: false, code: 'already_announced' });
    expect(mail.mails).toEqual([]);
  });

  it('a data type announced before is left out of the next wave, counted, and not mailed', async () => {
    const ledger = await carriedByHand();
    await press(ledger, cutOver('calendar'));
    const mail = mailbox();
    const next = await press(ledger, cutOver('calendar', 'drive_item'), mail.tell);
    expect(next).toMatchObject({ ok: true, alreadyAnnounced: 1, resend: false });
    for (const { message } of mail.mails) expect(message.body).not.toContain('Team planning');
  });
});

describe('a press that may not announce', () => {
  it('with none of its data types cut over it is refused, naming the ones that wait, and nothing is sent or recorded', async () => {
    const ledger = await carriedByHand();
    const mail = mailbox();
    expect(await press(ledger, cutOver(), mail.tell)).toEqual({
      ok: false,
      code: 'not_cut_over',
      reason: notCutOverToAnnounceReason(['calendar', 'drive_item']),
    });
    expect(mail.mails).toEqual([]);
    expect(presses(ledger)).toEqual([]);
  });

  it('without a mail channel it is refused after the gate, with nothing sent or recorded', async () => {
    const ledger = await carriedByHand();
    const mail = mailbox();
    const outcome = await announceByHandShares(
      {
        tenantId: TENANT,
        mappingId: MAPPING,
        ledger,
        pressedBy: 'owner',
        isCutOver: cutOver('calendar'),
        channelIsOn: false,
        tell: mail.tell,
      },
      { note: 'Here.', locale: 'en', confirmResend: false },
    );
    expect(outcome).toEqual({ ok: false, code: 'notifications_off', reason: NOTIFICATIONS_OFF_REASON });
    expect(mail.mails).toEqual([]);
    expect(presses(ledger)).toEqual([]);
  });

  it('with nothing carried by hand it announces nothing, and the press is recorded with no data type', async () => {
    const ledger = new MemoryLedger();
    expect(await press(ledger, cutOver())).toMatchObject({ ok: true, sent: [], waitingForCutover: 0 });
    expect(presses(ledger).map((e) => e.detail)).toEqual([expect.objectContaining({ subjects: [] })]);
  });

  it('a mail that did not go is counted as failed, and the data type is still announced', async () => {
    const ledger = await carriedByHand();
    const outcome = await press(ledger, cutOver('calendar'), async () => false);
    expect(outcome).toMatchObject({ ok: true, sent: [], failed: ['cas@example.invalid'] });
    expect(presses(ledger)[0]!.detail).toMatchObject({ subjects: ['calendar'], failed: 1 });
  });
});

describe('the refusals’ words', () => {
  it('name the data types that wait, or the whole migration for a share it cannot place', () => {
    expect(notCutOverToAnnounceReason(['drive_item'])).toBe(
      "The shares carried by hand on this migration's files are announced once the files are cut over, " +
        'not before: the announcement says the new system is live, and the files are not cut over yet. ' +
        'Press again once they are (ADR-0032).',
    );
    expect(notCutOverToAnnounceReason(['mailbox'])).toContain('once the mail is cut over');
    expect(notCutOverToAnnounceReason(['drive_item', 'calendar'])).toContain(
      "on this migration's calendars and files are announced once each is cut over",
    );
    expect(notCutOverToAnnounceReason(['something_new'])).toContain('this migration is not cut over yet');
  });

  it('name the data types announced before, and when', () => {
    expect(alreadyAnnouncedReason(new Map([['calendar', '2026-09-26T10:00:00.000Z']]))).toBe(
      "The shares carried by hand on this migration's calendars were already announced on " +
        '2026-09-26T10:00:00.000Z. Sending again mails the same people again: pass confirmResend: true ' +
        'to do that on purpose.',
    );
    expect(
      alreadyAnnouncedReason(
        new Map([
          ['drive_item', '2026-09-27T10:00:00.000Z'],
          ['calendar', '2026-09-26T10:00:00.000Z'],
        ]),
      ),
    ).toContain("calendars and files were already announced, the last time on 2026-09-27T10:00:00.000Z.");
    expect(alreadyAnnouncedReason(new Map([['something_new', '2026-09-26T10:00:00.000Z']]))).toContain(
      "This migration's shares carried by hand were already announced",
    );
  });
});
