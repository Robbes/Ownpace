// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * What the confirmed list says of a row the address table marked (ADR-0055;
 * workplan 0168 T5, D5; the screens' review S4).
 *
 * One map, so no screen says "the next pass" of a copy that waits for a
 * person: past its data type's switch, a change of the table reaches a copy
 * only when somebody presses *Apply the new addresses here too*, and the row
 * says so (`waitsFor: 'press'`, which the confirmed list sets from the same
 * reading of the phases a pass makes). A row the table did not mark says
 * nothing.
 */

import type { StringKey } from './strings.ts';

export function addressMarkKey(row: { readonly address?: unknown; readonly waitsFor?: unknown }): StringKey | null {
  if (row.address === 'changed') return 'addresses.confirmedList.changed';
  if (row.address === 'older') {
    return row.waitsFor === 'press' ? 'addresses.confirmedList.olderPress' : 'addresses.confirmedList.older';
  }
  return null;
}
