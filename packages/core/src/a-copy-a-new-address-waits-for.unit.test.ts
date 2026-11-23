// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COPY A NEW ADDRESS WAITS FOR (workplan 0168 §3.1, S3, S5; ADR-0055
 * decision 5).
 *
 * A copy the current table would change, written before the change, must
 * never read as a match. Past a data type's cutover such a copy waits for a
 * person's press, and before the review it read as a match all that time: it
 * carried no digest, or an older one the list could not tell apart.
 *
 * The pass now marks it with the digest it should carry
 * (`item.address_digest_due`, ledger 0074), clears the mark when it writes the
 * copy or finds it as the table says, and counts what waits from the ledger
 * when it ends, so a source that lists only what changed does not make the
 * count, and the press the migration page offers on it, vanish one pass later.
 *
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import { runContactSync, type AddressChangesForPass } from './dav-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';
import {
  ADDRESS_DIGEST_OF_NO_CHANGE,
  addressKey,
  addressTableDigest,
  asMappingId,
  asTenantId,
  contactNaturalKeyHash,
  prepareAddressTable,
  rowFor,
  type ConfirmedAddressChange,
  type Contact,
  type ContactSource,
  type ContactTargetWriter,
  type SyncCursor,
  type UpsertOptions,
} from '@openmig/shared';

const TENANT = asTenantId('61111111-1111-4111-8111-111111111111');
const MAPPING = asMappingId('62222222-2222-4222-8222-222222222222');

function row(oldAddress: string, newAddress: string): ConfirmedAddressChange {
  return { oldKey: addressKey(oldAddress), oldAddress, newAddress };
}
const ANA = row('ana@old.example.org', 'ana@example.org');
const BEN = row('ben@old.example.org', 'ben@example.org');

function changes(rows: ConfirmedAddressChange[], pastCutoverApplies = false): AddressChangesForPass {
  return { table: prepareAddressTable(rows), ownKeys: [], ...(pastCutoverApplies ? { pastCutoverApplies } : {}) };
}

function card(uid: string, email: string): string {
  return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${uid}\r\nEMAIL:${email}\r\nUID:${uid}\r\nEND:VCARD\r\n`;
}

const CARDS: Array<[string, string]> = [
  ['c-ana', 'ana@old.example.org'],
  ['c-ben', 'ben@old.example.org'],
  ['c-carla', 'carla@stays.example.org'],
];

/** A source that lists everything without a cursor, and nothing after one: none of these cards changes there. */
function source(): ContactSource {
  return {
    listFolders: async () => [{ path: '/book/', name: 'Contacts' }],
    listSince: async (_folder: unknown, cursor?: SyncCursor) => ({
      items:
        cursor === undefined
          ? CARDS.map(([uid, email]) => ({
              item: { uid, type: 'individual', name: uid, etag: `"${uid}"`, sourcePath: `/book/${uid}.vcf` } as unknown as Contact,
              vcard: card(uid, email),
            }))
          : [],
      nextCursor: { value: 'tok' },
      removed: [],
    }),
  } as unknown as ContactSource;
}

/** A DAV-like target with strong ETags, keeping what it is given. */
class Target {
  readonly bodies = new Map<string, string>();
  readonly etags = new Map<string, number>();
  writes = 0;
  put(uid: string, body: string, options?: UpsertOptions) {
    if (options?.overwrite) {
      if (options.expectedTargetVersion !== undefined && options.expectedTargetVersion !== `"${this.etags.get(uid)}"`) {
        return { targetId: uid, created: false, conflicted: true };
      }
      this.writes += 1;
      this.bodies.set(uid, body);
      this.etags.set(uid, (this.etags.get(uid) ?? 0) + 1);
      return { targetId: uid, created: false, updated: true, targetVersion: `"${this.etags.get(uid)}"` };
    }
    if (this.bodies.has(uid)) return { targetId: uid, created: false, adopted: true };
    this.writes += 1;
    this.bodies.set(uid, body);
    this.etags.set(uid, 1);
    return { targetId: uid, created: true, targetVersion: '"1"' };
  }
}

function harness() {
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  const t = new Target();
  const target = {
    ensureContactFolder: async (folder: { path: string }) => folder.path,
    upsertContact: async (_f: string, raw: { item: Contact; vcard: string }, options?: UpsertOptions) =>
      t.put(raw.item.uid, raw.vcard, options),
  } as unknown as ContactTargetWriter;
  const pass = (c: AddressChangesForPass, cutover = false) =>
    runContactSync({
      sourceIsAuthorityOnExistence: !cutover,
      stillTheAuthority: async () => !cutover,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: source(),
      target,
      ledger,
      cursors,
      addressChanges: c,
    });
  const ben = async () => (await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-ben')))!;
  return { ledger, t, pass, ben };
}

describe('a copy a new address waits for', () => {
  it('is marked with the digest it should carry, and never reads as a match on the confirmed list (E4)', async () => {
    const { pass, ben } = harness();
    await pass(changes([]));
    // Past the cutover, a row for Ben's address: his copy waits for a press.
    const waiting = await pass(changes([BEN]), true);
    expect(waiting.addressChangesWaiting).toBe(1);
    const row = await ben();
    expect(row.addressDigest ?? null).toBeNull();
    expect(row.addressDigestDue).toBe(addressTableDigest([BEN]));
    // The target answered that the copy is what we wrote: still never a match.
    const listed = rowFor({
      domain: 'contact',
      status: row.status,
      answer: { onTarget: true, comparison: 'match' },
      contentHash: row.contentHash,
      addressDigest: { item: row.addressDigest ?? null, due: row.addressDigestDue ?? null, waitsFor: 'press' },
    });
    expect(listed.state).not.toBe('verified');
    expect(listed).toMatchObject({ address: 'older', waitsFor: 'press' });
  });

  it('keeps counting what waits on every pass after, though the source lists nothing (S5)', async () => {
    const { pass } = harness();
    await pass(changes([]));
    const first = await pass(changes([BEN]), true);
    expect(first.addressChangesWaiting).toBe(1);
    // The next pass reads incrementally and is shown nothing: the count, and
    // the press the migration page offers on it, stay.
    const second = await pass(changes([BEN]), true);
    expect(second.scanned).toBe(0);
    expect(second.addressChangesWaiting).toBe(1);
    expect(second.metrics?.addressChangesWaiting).toBe(1);
    // Pressed: the pass after the press writes it, and nothing waits.
    const pressed = await pass(changes([BEN], true), true);
    expect(pressed.updated).toBe(1);
    expect(pressed.addressChangesWaiting).toBe(0);
    expect(pressed.metrics?.addressChangesCarried).toBe(1);
  });

  it('loses the mark when the pass writes the copy, and when the table goes back to what the copy carries', async () => {
    const { pass, ben, t } = harness();
    await pass(changes([]));
    await pass(changes([BEN]), true);
    expect((await ben()).addressDigestDue).toBe(addressTableDigest([BEN]));
    // The row is sent back before anybody pressed: the copy carries what the
    // table says again, and the mark goes, with nothing written to the target.
    const writes = t.writes;
    const back = await pass(changes([]), true);
    expect(back.addressChangesWaiting).toBe(0);
    expect((await ben()).addressDigestDue ?? null).toBeNull();
    expect(t.writes).toBe(writes);
    // Confirmed again, and pressed: written, and the mark goes with the write.
    await pass(changes([BEN]), true);
    await pass(changes([BEN], true), true);
    const written = await ben();
    expect(written.addressDigest).toBe(addressTableDigest([BEN]));
    expect(written.addressDigestDue ?? null).toBeNull();
  });

  it('marks a copy whose row was deleted past the cutover as waiting to carry no change', async () => {
    const { pass, ben } = harness();
    await pass(changes([ANA, BEN]));
    const waiting = await pass(changes([ANA]), true);
    expect(waiting.addressChangesWaiting).toBe(1);
    expect((await ben()).addressDigestDue).toBe(ADDRESS_DIGEST_OF_NO_CHANGE);
  });

  it('writes no mark on a pass where nothing waits', async () => {
    const { pass, ledger } = harness();
    await pass(changes([ANA, BEN]));
    await pass(changes([ANA, BEN]));
    await pass(changes([ANA, BEN]), true);
    expect(ledger.writes.addressChangeDue).toBe(0);
  });
});
