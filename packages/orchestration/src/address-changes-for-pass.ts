// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE ADDRESS TABLE ONE PASS APPLIES (ADR-0055; workplan 0168 §4.3, T4).
 *
 * Every contact, calendar and task pass of every migration in an organisation
 * reads the organisation's CONFIRMED rows once, at its start, so the change is
 * the same in everyone's address book and calendar. A proposed row never
 * reaches here (`Ledger.listConfirmedAddressChanges`).
 *
 * A table the ledger should never have held (a chain, two rows for one old
 * key) is refused whole by `prepareAddressTable`, and the refusal is this
 * data type's failure, never an empty table in its place (hard rule 9).
 *
 * Both dispatchers build it here, so neither can be the one that forgot: the
 * appliance's and the self-host scheduler's `runAllDomains`, and the managed
 * worker's builder (`buildDomainDepsFromMapping`).
 */

import {
  addressKey,
  addressTablePressDigest,
  isAddress,
  prepareAddressTable,
  type Ledger,
  type TenantId,
} from '@openmig/shared';
import type { AddressChangesForPass } from '@openmig/core';

/** A key that names a secret, whose value is never read for an address. */
const SECRET_KEY = /pass|secret|token|key|cert/i;

/**
 * The migration's own account's addresses, from its source and target
 * connections: every value that is an address, under a key that names no
 * secret. An `ATTENDEE` changes in an event one of them organised (D3).
 * Shallow, as a connection's settings are flat.
 */
export function accountAddressesOf(...connections: ReadonlyArray<Record<string, unknown> | undefined>): string[] {
  const out = new Set<string>();
  for (const c of connections) {
    if (!c) continue;
    for (const [key, value] of Object.entries(c)) {
      if (SECRET_KEY.test(key) || typeof value !== 'string') continue;
      if (isAddress(value)) out.add(addressKey(value));
    }
  }
  return [...out].sort();
}

/**
 * The table for one pass, or nothing when the ledger keeps none.
 *
 * `applied` is the digest a person last pressed *Apply the new addresses here
 * too* for on this migration (`PassPhases.addressChangesApplied`, D5): past
 * the data type's cutover the table rewrites copies only while it is the
 * table's press digest now (`addressTablePressDigest`).
 */
export async function addressChangesForPass(
  ledger: Pick<Ledger, 'listConfirmedAddressChanges'>,
  tenantId: string,
  ownAddressKeys: ReadonlyArray<string>,
  applied: string | undefined,
): Promise<AddressChangesForPass | undefined> {
  if (!ledger.listConfirmedAddressChanges) return undefined;
  const rows = await ledger.listConfirmedAddressChanges(tenantId as TenantId);
  const table = prepareAddressTable(rows);
  return {
    table,
    ownKeys: ownAddressKeys,
    ...(applied !== undefined && applied === addressTablePressDigest(rows) ? { pastCutoverApplies: true } : {}),
  };
}
