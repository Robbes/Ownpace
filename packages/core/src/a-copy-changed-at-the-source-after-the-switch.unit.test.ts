// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A COPY CHANGED AT THE SOURCE AFTER THE SWITCH, WHOSE ADDRESS ROWS MOVED
 * (the owner's decision of 2026-11-23, option (b): "2) b."; ADR-0055 decision
 * 6; workplan 0168).
 *
 * Past a data type's cutover a change at the source overwrites no copy
 * (ADR-0048, the owner's "Stop overwriting" of 2026-10-05): it is counted
 * `changedAfterCutover`, and only new items are copied. When the address
 * table moved for that copy too, the pass marked the change it waits for, and
 * every reader counted it as waiting for *Apply the new addresses here too*.
 * But the press never rewrites it, since that rewrite would carry the
 * source's later change as well: it waited for something that never comes.
 *
 * Now it is left and said as left: counted apart (`addressChangesLeft`),
 * never as waiting, never claimed or rewritten by the press, and on the
 * confirmed list a plain copy marked `left`. Option (c), rewriting only the
 * address lines in the new account's own copy, was not chosen.
 *
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import { runContactSync, type AddressChangesForPass } from './dav-sync.ts';
import { MemoryCursorStore, MemoryLedger } from './__testing__/memory.ts';
import {
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

const TENANT = asTenantId('71111111-1111-4111-8111-111111111111');
const MAPPING = asMappingId('72222222-2222-4222-8222-222222222222');

function row(oldAddress: string, newAddress: string): ConfirmedAddressChange {
  return { oldKey: addressKey(oldAddress), oldAddress, newAddress };
}
const BEN = row('ben@old.example.org', 'ben@example.org');

function changes(rows: ConfirmedAddressChange[], pastCutoverApplies = false): AddressChangesForPass {
  return { table: prepareAddressTable(rows), ownKeys: [], ...(pastCutoverApplies ? { pastCutoverApplies } : {}) };
}

function card(uid: string, email: string, note = ''): string {
  return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${uid}\r\nEMAIL:${email}\r\n${note ? `NOTE:${note}\r\n` : ''}UID:${uid}\r\nEND:VCARD\r\n`;
}

/** A source with one card for Ben, edited at the source when `edited` is set; everything is listed every pass. */
function source(state: { edited: boolean }): ContactSource {
  return {
    listFolders: async () => [{ path: '/book/', name: 'Contacts' }],
    listSince: async (_folder: unknown, _cursor?: SyncCursor) => ({
      items: [
        {
          item: {
            uid: 'c-ben',
            type: 'individual',
            name: 'c-ben',
            etag: state.edited ? '"ben-2"' : '"ben-1"',
            sourcePath: '/book/c-ben.vcf',
          } as unknown as Contact,
          vcard: card('c-ben', 'ben@old.example.org', state.edited ? 'edited after the switch' : ''),
        },
      ],
      nextCursor: { value: 'tok' },
      removed: [],
    }),
  } as unknown as ContactSource;
}

/** A DAV-like target with strong ETags, keeping what it is given. */
class Target {
  readonly bodies = new Map<string, string>();
  readonly etags = new Map<string, number>();
  rewrites = 0;
  put(uid: string, body: string, options?: UpsertOptions) {
    if (options?.overwrite) {
      this.rewrites += 1;
      this.bodies.set(uid, body);
      this.etags.set(uid, (this.etags.get(uid) ?? 0) + 1);
      return { targetId: uid, created: false, updated: true, targetVersion: `"${this.etags.get(uid)}"` };
    }
    if (this.bodies.has(uid)) return { targetId: uid, created: false, adopted: true };
    this.bodies.set(uid, body);
    this.etags.set(uid, 1);
    return { targetId: uid, created: true, targetVersion: '"1"' };
  }
}

function harness() {
  const ledger = new MemoryLedger();
  const cursors = new MemoryCursorStore();
  const t = new Target();
  const state = { edited: false };
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
      source: source(state),
      target,
      ledger,
      cursors,
      addressChanges: c,
    });
  const ben = async () => (await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-ben')))!;
  return { ledger, t, state, pass, ben };
}

describe('a copy changed at the source after the switch, whose address rows moved', () => {
  it('is counted apart as left, never as waiting for the press', async () => {
    const { pass, state, ben } = harness();
    await pass(changes([]));
    // Past the switch: a row for Ben's address, and Ben's card edited at the old account.
    state.edited = true;
    const result = await pass(changes([BEN]), true);
    expect(result.changedAfterCutover).toBe(1);
    expect(result.addressChangesWaiting).toBe(0);
    expect(result.addressChangesLeft).toBe(1);
    expect(result.metrics?.addressChangesLeft).toBe(1);
    expect(result.metrics?.addressChangesWaiting).toBe(0);
    expect(result.addressChangesUnguarded).toBe(0);
    const copy = await ben();
    expect(copy.addressDigestDue).toBe(addressTableDigest([BEN]));
    expect(copy.addressLeft).toBe(true);
  });

  it('is never rewritten by the press, and stays left on every pass after it', async () => {
    const { pass, state, t, ben } = harness();
    await pass(changes([]));
    const before = t.bodies.get('c-ben');
    state.edited = true;
    await pass(changes([BEN]), true);
    // Somebody presses Apply the new addresses here too: the pass after it
    // leaves this copy as it is, the old address and the source's edit both.
    const pressed = await pass(changes([BEN], true), true);
    expect(t.rewrites).toBe(0);
    expect(t.bodies.get('c-ben')).toBe(before);
    expect(pressed.updated).toBe(0);
    expect(pressed.addressChangesLeft).toBe(1);
    expect(pressed.addressChangesWaiting).toBe(0);
    expect((await ben()).addressLeft).toBe(true);
  });

  it('is a plain copy on the confirmed list, said as left', async () => {
    const { pass, state, ben } = harness();
    await pass(changes([]));
    state.edited = true;
    await pass(changes([BEN]), true);
    const copy = await ben();
    const listed = rowFor({
      domain: 'contact',
      status: copy.status,
      answer: { onTarget: true, comparison: 'match' },
      contentHash: copy.contentHash,
      addressDigest: {
        item: copy.addressDigest ?? null,
        due: copy.addressDigestDue ?? null,
        waitsFor: 'press',
        targetVersion: copy.targetVersion ?? null,
        left: copy.addressLeft === true,
      },
    });
    expect(listed).toMatchObject({ state: 'verified', address: 'older', waitsFor: 'left' });
  });

  it('is no longer left once the table goes back to what the copy carries', async () => {
    const { pass, state, ben } = harness();
    await pass(changes([]));
    state.edited = true;
    await pass(changes([BEN]), true);
    const back = await pass(changes([]), true);
    expect(back.addressChangesLeft).toBe(0);
    const copy = await ben();
    expect(copy.addressDigestDue ?? null).toBeNull();
    expect(copy.addressLeft).toBeUndefined();
  });

  it('before the switch, is rewritten as ever: a source change and its address together', async () => {
    const { pass, state, t, ben } = harness();
    await pass(changes([]));
    state.edited = true;
    const result = await pass(changes([BEN]));
    expect(t.rewrites).toBe(1);
    expect(result.addressChangesLeft ?? 0).toBe(0);
    expect((await ben()).addressLeft).toBeUndefined();
  });
});
