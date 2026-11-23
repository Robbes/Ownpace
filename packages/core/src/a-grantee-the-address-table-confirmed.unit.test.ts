// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A GRANTEE THE ADDRESS TABLE CONFIRMED (workplan 0168 §2.4, T6; ADR-0055
 * decision 7).
 *
 * A confirmed row of the organisation's address table IS a person's
 * confirmation of a grantee's new address, ADR-0032 §6's. So a folder press
 * sends such a grantee to the row's new address and does not refuse for
 * them; an address the page confirmed wins over the row; a proposed row, or
 * none, still refuses. ADR-0032's gates are otherwise as they were: the press
 * is a person's, nothing is sent before the cutover, and every invitation
 * carries its address. Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import {
  addressKey,
  withGranteesNewAddress,
  type ConfirmedAddressChange,
  type MappingId,
  type PermissionGrant,
  type TenantId,
} from '@openmig/shared';
import { MemoryLedger } from './__testing__/memory.ts';
import { applyShareGrantsInFolder, refreshShareGrants } from './share-queue.ts';

const TENANT = 'tenant-0168' as TenantId;
const MAPPING = 'mapping-0168' as MappingId;

const ANA: ConfirmedAddressChange = {
  oldKey: addressKey('ana@old.example.org'),
  oldAddress: 'ana@old.example.org',
  newAddress: 'ana@example.org',
};

const inFolder = (over: Partial<PermissionGrant> & { on: string }): PermissionGrant => ({
  subject: 'drive_item',
  grantee: 'Ana@Old.Example.org',
  role: 'writer',
  raw: '{"type":"user","role":"writer"}',
  parentKey: 'F',
  isContainer: false,
  ...over,
});

const FOLDER: PermissionGrant[] = [
  inFolder({ on: 'Holiday', itemKey: 'F', parentKey: 'root', isContainer: true }),
  inFolder({ on: 'IMG_1.jpg', itemKey: 'c1' }),
];

async function queue(grants: PermissionGrant[] = FOLDER): Promise<MemoryLedger> {
  const ledger = new MemoryLedger();
  await refreshShareGrants({
    tenantId: TENANT,
    mappingId: MAPPING,
    ledger,
    delegationReason: 'not read',
    scans: [async () => ({ kind: 'listed' as const, grants })],
  });
  return ledger;
}

function press(
  ledger: MemoryLedger,
  options: { confirmed?: Record<string, string>; addressChanges?: ConfirmedAddressChange[]; cutOver?: boolean },
) {
  const sentTo: string[] = [];
  const outcome = applyShareGrantsInFolder(
    {
      tenantId: TENANT,
      mappingId: MAPPING,
      ledger,
      decidedBy: 'owner',
      isCutOver: () => options.cutOver ?? true,
      confirmed: options.confirmed ?? {},
      ...(options.addressChanges ? { addressChanges: options.addressChanges } : {}),
      createShare: async (_row, shareWith) => {
        sentTo.push(shareWith ?? '(none)');
        return { ok: true };
      },
    },
    'F',
  );
  return { outcome, sentTo };
}

describe('the Sharing checklist and the address table', () => {
  it('sends a grantee a confirmed row covers to the row’s new address, matched on the key', async () => {
    const { outcome, sentTo } = press(await queue(), { addressChanges: [ANA] });
    const done = await outcome;
    expect(done.ok).toBe(true);
    expect(sentTo).toEqual(['ana@example.org', 'ana@example.org']);
  });

  it('records how many grantees the table confirmed, never their addresses', async () => {
    const ledger = await queue();
    await press(ledger, { addressChanges: [ANA] }).outcome;
    const event = ledger.auditEvents.find((e) => e.action === 'share.apply_folder');
    expect(event?.detail).toMatchObject({ grantees: 1, fromAddressChanges: 1 });
    expect(JSON.stringify(event?.detail)).not.toContain('example.org');
  });

  it('lets an address the page confirmed win over the row', async () => {
    const { outcome, sentTo } = press(await queue(), {
      confirmed: { 'Ana@Old.Example.org': 'ana.other@example.org' },
      addressChanges: [ANA],
    });
    expect((await outcome).ok).toBe(true);
    expect(sentTo).toEqual(['ana.other@example.org', 'ana.other@example.org']);
  });

  it('still refuses, and sends nothing, for a grantee neither the page nor the table confirmed', async () => {
    const { outcome, sentTo } = press(await queue(), { addressChanges: [] });
    const refused = await outcome;
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('unconfirmed_grantees');
    expect(sentTo).toEqual([]);
  });

  it('keeps ADR-0032’s cutover gate: nothing is sent before the data type’s cutover', async () => {
    const { outcome, sentTo } = press(await queue(), { addressChanges: [ANA], cutOver: false });
    const refused = await outcome;
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('not_cut_over');
    expect(sentTo).toEqual([]);
  });

  it('proposes the new address on the row the checklist reads, and nothing where the table has none', () => {
    expect(withGranteesNewAddress({ grantee: 'ana@OLD.example.org' }, [ANA])).toEqual({
      grantee: 'ana@OLD.example.org',
      granteeNewAddress: 'ana@example.org',
    });
    expect(withGranteesNewAddress({ grantee: 'carla@stays.example.org' }, [ANA])).toEqual({
      grantee: 'carla@stays.example.org',
    });
    expect(withGranteesNewAddress({ grantee: null }, [ANA])).toEqual({ grantee: null });
  });
});
