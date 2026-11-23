// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEW ADDRESS FOR A COPY THE PERSON DELETED (workplan 0168 B2; arch §11.1,
 * "Target-side deletions are deliberately not repaired").
 *
 * During shadow the person deletes Ben's card in the new system, and then a
 * row for Ben's address is confirmed. Before the review:
 *
 *  - on JMAP the rewrite threw ("Refusing to create one instead"), the row
 *    became `failed`, and the next pass's retry took the create path and made
 *    the card again (E5);
 *  - on DAV with no recorded ETag the PUT carried no `If-Match` and made it
 *    again in one pass (E6).
 *
 * Now a rewrite that finds no copy is counted as gone from the target and
 * leaves the row as it was; an address rewrite needs a strong version (S1),
 * so a copy without one is never written; a strong one meets the server's
 * 412 and is left as it is; and a failed address rewrite is retried as that
 * rewrite, never as a create.
 *
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import { runContactSync, type AddressChangesForPass } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  addressKey,
  asMappingId,
  asTenantId,
  contactNaturalKeyHash,
  prepareAddressTable,
  type ConfirmedAddressChange,
  type Contact,
  type ContactSource,
  type ContactTargetWriter,
  type UpsertOptions,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('81111111-1111-4111-8111-111111111111');
const MAPPING = asMappingId('82222222-2222-4222-8222-222222222222');

function row(oldAddress: string, newAddress: string): ConfirmedAddressChange {
  return { oldKey: addressKey(oldAddress), oldAddress, newAddress };
}
const BEN = row('ben@old.example.org', 'ben@example.org');

function changes(rows: ConfirmedAddressChange[]): AddressChangesForPass {
  return { table: prepareAddressTable(rows), ownKeys: [] };
}

function card(uid: string, email: string): string {
  return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${uid}\r\nEMAIL;TYPE=INTERNET:${email}\r\nUID:${uid}\r\nEND:VCARD\r\n`;
}

function source(): ContactSource {
  return {
    listFolders: async () => [{ path: '/book/', name: 'Contacts' }],
    listSince: async () => ({
      items: [['c-ana', 'ana@stays.example.org'], ['c-ben', 'ben@old.example.org']].map(([uid, email]) => ({
        item: { uid, type: 'individual', name: uid, etag: `"${uid}-1"`, sourcePath: `/book/${uid}.vcf` } as unknown as Contact,
        vcard: card(uid!, email!),
      })),
      nextCursor: { value: '1' },
      removed: [],
    }),
  } as unknown as ContactSource;
}

/**
 * A target in one of three shapes:
 *  - `jmap`: the JMAP contact writer's contract, a rewrite of a card that is
 *    not there answers `goneFromTarget`;
 *  - `dav-strong`: `If-Match` on every rewrite, so a missing resource is a 412;
 *  - `dav-none`: no ETag ever given, so a rewrite carries no precondition and
 *    a PUT to a missing resource makes it.
 */
class Target {
  readonly bodies = new Map<string, string>();
  readonly etags = new Map<string, number>();
  creates = 0;
  /** Throw on the next overwrite, once: a transient refusal. */
  failNextOverwrite = false;
  constructor(private readonly shape: 'jmap' | 'dav-strong' | 'dav-none') {}
  private version(uid: string): { targetVersion?: string } {
    return this.shape === 'dav-none' ? {} : { targetVersion: `"${this.etags.get(uid) ?? 0}"` };
  }
  put(uid: string, body: string, options?: UpsertOptions): UpsertResult {
    if (options?.overwrite) {
      if (this.failNextOverwrite) {
        this.failNextOverwrite = false;
        throw new Error('the target answered 503 this once');
      }
      if (!this.bodies.has(uid)) {
        if (this.shape === 'jmap') return { targetId: '', created: false, goneFromTarget: true };
        if (this.shape === 'dav-strong') return { targetId: uid, created: false, conflicted: true };
        // dav-none: a PUT with no precondition makes the resource.
        this.creates += 1;
      } else if (this.shape !== 'dav-none' && options.expectedTargetVersion !== `"${this.etags.get(uid)}"`) {
        return { targetId: uid, created: false, conflicted: true };
      }
      this.bodies.set(uid, body);
      this.etags.set(uid, (this.etags.get(uid) ?? 0) + 1);
      return { targetId: uid, created: false, updated: true, ...this.version(uid) };
    }
    if (this.bodies.has(uid)) return { targetId: uid, created: false, adopted: true };
    this.creates += 1;
    this.bodies.set(uid, body);
    this.etags.set(uid, 1);
    return { targetId: uid, created: true, ...this.version(uid) };
  }
}

function harness(shape: 'jmap' | 'dav-strong' | 'dav-none') {
  const ledger = new MemoryLedger();
  const t = new Target(shape);
  const target = {
    ensureContactFolder: async (folder: { path: string }) => folder.path,
    upsertContact: async (_f: string, raw: { item: Contact; vcard: string }, options?: UpsertOptions) =>
      t.put(raw.item.uid, raw.vcard, options),
  } as unknown as ContactTargetWriter;
  const pass = (c: AddressChangesForPass) =>
    runContactSync({
      sourceIsAuthorityOnExistence: true,
      stillTheAuthority: async () => true,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: source(),
      target,
      ledger,
      addressChanges: c,
    });
  const ben = async () => (await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-ben')))!;
  return { t, pass, ben };
}

describe('a new address for a copy the person deleted on the target', () => {
  it('on JMAP, counts it as gone, never fails it, and never makes it again (E5)', async () => {
    const { t, pass, ben } = harness('jmap');
    await pass(changes([]));
    t.bodies.delete('c-ben');
    const creates = t.creates;
    const first = await pass(changes([BEN]));
    expect(first.goneFromTarget).toBe(1);
    expect(first.failed).toBe(0);
    expect((await ben()).status).toBe('copied');
    const second = await pass(changes([BEN]));
    expect(second.created).toBe(0);
    expect(t.creates).toBe(creates);
    expect(t.bodies.has('c-ben')).toBe(false);
  });

  it('on DAV with no recorded ETag, writes nothing at all, so nothing is made again (E6)', async () => {
    const { t, pass } = harness('dav-none');
    await pass(changes([]));
    t.bodies.delete('c-ben');
    const creates = t.creates;
    const first = await pass(changes([BEN]));
    expect(first.updated).toBe(0);
    expect(first.addressChangesUnguarded).toBe(1);
    await pass(changes([BEN]));
    expect(t.creates).toBe(creates);
    expect(t.bodies.has('c-ben')).toBe(false);
  });

  it('on DAV with a strong ETag, meets the 412 and leaves it as it is', async () => {
    const { t, pass } = harness('dav-strong');
    await pass(changes([]));
    t.bodies.delete('c-ben');
    const creates = t.creates;
    const first = await pass(changes([BEN]));
    expect(first.conflicted).toBe(1);
    await pass(changes([BEN]));
    expect(t.creates).toBe(creates);
    expect(t.bodies.has('c-ben')).toBe(false);
  });

  it('retries a failed address rewrite as that rewrite, never as a create', async () => {
    const { t, pass, ben } = harness('jmap');
    await pass(changes([]));
    // The rewrite fails once, transiently: the row is failed, its target id kept.
    t.failNextOverwrite = true;
    const failed = await pass(changes([BEN]));
    expect(failed.failed).toBe(1);
    expect((await ben()).status).toBe('failed');
    // Meanwhile the person deletes the card. The retry finds it gone.
    t.bodies.delete('c-ben');
    const creates = t.creates;
    const retried = await pass(changes([BEN]));
    expect(retried.goneFromTarget).toBe(1);
    expect(retried.created).toBe(0);
    expect(t.creates).toBe(creates);
    expect(t.bodies.has('c-ben')).toBe(false);
  });

  it('retries a failed address rewrite of a copy still there as a rewrite, and it lands', async () => {
    const { t, pass, ben } = harness('dav-strong');
    await pass(changes([]));
    t.failNextOverwrite = true;
    await pass(changes([BEN]));
    const creates = t.creates;
    const retried = await pass(changes([BEN]));
    expect(retried.updated).toBe(1);
    expect(t.creates).toBe(creates);
    expect(t.bodies.get('c-ben')).toContain('ben@example.org');
    expect((await ben()).status).toBe('updated');
  });
});
