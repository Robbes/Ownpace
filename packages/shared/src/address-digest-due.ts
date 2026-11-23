// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * THE DIGESTS A COPY RECORDS AND WAITS FOR (ADR-0055 decision 5; workplan 0168
 * §3.1, S1, S3).
 *
 * Pure, and importing nothing: the confirmed list asks `waitsForAnAddressChange`
 * of every row it marks, and that module performs no I/O and imports only what
 * imports nothing (`a-list-somebody-deletes-on-the-strength-of`). The address
 * change itself, which hashes, stays in `address-changes.ts`, which re-exports
 * these.
 */

/**
 * The digest of no rows at all, which no table of rows can have: the press
 * for an empty table (`addressTablePressDigest`), and the change a copy waits
 * for when the table says it should carry none (`addressDigestDue`).
 *
 * A literal, not a hash taken when the module loads: the web bundle imports
 * it and has no `node:crypto` to call. `address-changes.unit` pins it to the
 * SHA-256 of `addressTableDigestInput([])`.
 */
export const ADDRESS_DIGEST_OF_NO_CHANGE = '2cbba60cb6d49adc1df7c709282f76838ca4cdb6e5062805e6f49e90acd08582';

/**
 * What a pass records on a copy it did not write although its table moved
 * (`item.address_digest_due`, ledger migration 0074; workplan 0168 S3): the
 * digest the copy should carry now, or the digest of no change when it should
 * carry none (a row deleted or sent back). NULL in the column says nothing is
 * due: the copy carries what the last pass that looked at it said it should.
 */
export function addressDigestDue(digestNow: string | null): string {
  return digestNow ?? ADDRESS_DIGEST_OF_NO_CHANGE;
}

/**
 * DOES THIS COPY WAIT FOR A CHANGE OF THE ADDRESS TABLE? (ADR-0055 decision 5;
 * workplan 0168 §3.1, S3.) True when a pass found it should carry another
 * digest than the one it was written under, and nothing has written it since.
 * Such a copy is never a match: the bytes on the target are what we wrote
 * then, and what the table says now is something else. The confirmed list,
 * verification and the report all ask this, of the two columns.
 */
export function waitsForAnAddressChange(
  recorded: string | null | undefined,
  due: string | null | undefined,
): boolean {
  if (due === null || due === undefined) return false;
  return due !== (recorded ?? ADDRESS_DIGEST_OF_NO_CHANGE);
}

/**
 * May a rewrite of this copy for its addresses go ahead (workplan 0168 §3.4,
 * S1)? Only with a recorded target version the write can be guarded by: one
 * that is there and strong. A weak one keeps its `W/` (`UpsertResult.
 * targetVersion`), and cannot be sent as `If-Match`. Without one the person's
 * own edit on the target could not be told apart from our copy, so the copy
 * is left as it is and counted (`addressChangesUnguarded`).
 */
export function guardsAnAddressRewrite(targetVersion: string | undefined): boolean {
  return targetVersion !== undefined && targetVersion !== '' && !targetVersion.startsWith('W/');
}
