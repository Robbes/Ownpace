// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A NEW ADDRESS WITH NO VERSION TO GUARD IT (workplan 0168 §3.4, S1; ADR-0055
 * decision 6).
 *
 * The spec: an address rewrite "reaches only copies the person has not edited
 * (the If-Match rule)". A copy whose row recorded no target version, or only a
 * weak one, cannot be checked that way: a row written before ledger 0023, a
 * server that answers a PUT with no ETag, a JMAP card that could not be read
 * back. Before the review such a copy was overwritten, the person's edit with
 * it (E1 before the cutover, E2 on the press after it).
 *
 * Now the copy is left as it is and counted, before the cutover and after it
 * alike (`addressChangesUnguarded`: "not changed: no version to guard the
 * write"), and marked, so it never reads as a match. The rewrite of a SOURCE
 * change keeps 0149 D3's trade-off, unchanged.
 *
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import { runContactSync, type AddressChangesForPass } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  addressKey,
  addressTableDigest,
  asMappingId,
  asTenantId,
  contactNaturalKeyHash,
  prepareAddressTable,
  type ConfirmedAddressChange,
  type Contact,
  type ContactSource,
  type ContactTargetWriter,
  type UpsertOptions,
} from '@openmig/shared';

const TENANT = asTenantId('71111111-1111-4111-8111-111111111111');
const MAPPING = asMappingId('72222222-2222-4222-8222-222222222222');

function row(oldAddress: string, newAddress: string): ConfirmedAddressChange {
  return { oldKey: addressKey(oldAddress), oldAddress, newAddress };
}
const ANA = row('ana@old.example.org', 'ana@example.org');
const BEN = row('ben@old.example.org', 'ben@example.org');

function changes(rows: ConfirmedAddressChange[], pastCutoverApplies = false): AddressChangesForPass {
  return { table: prepareAddressTable(rows), ownKeys: [], ...(pastCutoverApplies ? { pastCutoverApplies } : {}) };
}

function card(uid: string, email: string): string {
  return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${uid}\r\nEMAIL;TYPE=INTERNET:${email}\r\nUID:${uid}\r\nEND:VCARD\r\n`;
}

/** Ana's and Ben's cards; Ben's source version can be moved on, as an edit at the source. */
function source(benVersion = '1'): ContactSource {
  const cards: Array<[string, string, string]> = [
    ['c-ana', 'ana@old.example.org', '1'],
    ['c-ben', 'ben@old.example.org', benVersion],
  ];
  return {
    listFolders: async () => [{ path: '/book/', name: 'Contacts' }],
    listSince: async () => ({
      items: cards.map(([uid, email, v]) => ({
        item: { uid, type: 'individual', name: uid, etag: `"${uid}-${v}"`, sourcePath: `/book/${uid}.vcf` } as unknown as Contact,
        vcard: card(uid, email),
      })),
      nextCursor: { value: '1' },
      removed: [],
    }),
  } as unknown as ContactSource;
}

/** A DAV-like target whose ETags are `strong`, `weak`, or never given (`none`). */
class Target {
  readonly bodies = new Map<string, string>();
  readonly etags = new Map<string, number>();
  constructor(private readonly versions: 'strong' | 'weak' | 'none') {}
  private version(uid: string): { targetVersion?: string } {
    const n = this.etags.get(uid) ?? 0;
    if (this.versions === 'none') return {};
    return { targetVersion: this.versions === 'weak' ? `W/${n}` : `"${n}"` };
  }
  /** The person edits the copy in the new system. */
  edit(uid: string, body: string): void {
    this.bodies.set(uid, body);
    this.etags.set(uid, (this.etags.get(uid) ?? 0) + 100);
  }
  put(uid: string, body: string, options?: UpsertOptions) {
    if (options?.overwrite) {
      // `If-Match` only for a strong version, as the DAV writers send it.
      const strong = options.expectedTargetVersion !== undefined && !options.expectedTargetVersion.startsWith('W/');
      if (strong && options.expectedTargetVersion !== `"${this.etags.get(uid)}"`) {
        return { targetId: uid, created: false, conflicted: true };
      }
      this.bodies.set(uid, body);
      this.etags.set(uid, (this.etags.get(uid) ?? 0) + 1);
      return { targetId: uid, created: false, updated: true, ...this.version(uid) };
    }
    if (this.bodies.has(uid)) return { targetId: uid, created: false, adopted: true };
    this.bodies.set(uid, body);
    this.etags.set(uid, 1);
    return { targetId: uid, created: true, ...this.version(uid) };
  }
}

function harness(versions: 'strong' | 'weak' | 'none') {
  const ledger = new MemoryLedger();
  const t = new Target(versions);
  const target = {
    ensureContactFolder: async (folder: { path: string }) => folder.path,
    upsertContact: async (_f: string, raw: { item: Contact; vcard: string }, options?: UpsertOptions) =>
      t.put(raw.item.uid, raw.vcard, options),
  } as unknown as ContactTargetWriter;
  const pass = (c: AddressChangesForPass, o: { cutover?: boolean; benVersion?: string } = {}) =>
    runContactSync({
      sourceIsAuthorityOnExistence: !o.cutover,
      stillTheAuthority: async () => !o.cutover,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: source(o.benVersion),
      target,
      ledger,
      addressChanges: c,
    });
  const ben = async () => (await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-ben')))!;
  return { t, pass, ben };
}

const EDITED = 'the person edited this card on the target';

describe('an address rewrite with no version to guard the write', () => {
  it('leaves a copy the person edited alone before the cutover, counts it, and marks it (E1)', async () => {
    const { t, pass, ben } = harness('none');
    await pass(changes([ANA]));
    t.edit('c-ben', EDITED);
    const p = await pass(changes([ANA, BEN]));
    expect(p.updated).toBe(0);
    expect(p.addressChangesUnguarded).toBe(1);
    expect(t.bodies.get('c-ben')).toBe(EDITED);
    expect((await ben()).addressDigestDue).toBe(addressTableDigest([BEN]));
    // And on every pass after, though nothing changes.
    expect((await pass(changes([ANA, BEN]))).addressChangesUnguarded).toBe(1);
    expect(t.bodies.get('c-ben')).toBe(EDITED);
  });

  it('leaves it alone past the cutover, on the press too (E2)', async () => {
    const { t, pass } = harness('none');
    await pass(changes([ANA]));
    t.edit('c-ben', 'edited after the cutover');
    const waiting = await pass(changes([ANA, BEN]), { cutover: true });
    expect(waiting.addressChangesUnguarded).toBe(1);
    expect(waiting.addressChangesWaiting).toBe(0);
    const pressed = await pass(changes([ANA, BEN], true), { cutover: true });
    expect(pressed.updated).toBe(0);
    expect(pressed.addressChangesUnguarded).toBe(1);
    expect(t.bodies.get('c-ben')).toBe('edited after the cutover');
  });

  it('treats a weak version as none: If-Match cannot carry it', async () => {
    const { t, pass } = harness('weak');
    await pass(changes([ANA]));
    t.edit('c-ben', EDITED);
    const p = await pass(changes([ANA, BEN]));
    expect(p.addressChangesUnguarded).toBe(1);
    expect(t.bodies.get('c-ben')).toBe(EDITED);
  });

  it('rewrites a copy with a strong version, and refuses one the person edited (the If-Match rule)', async () => {
    const { t, pass } = harness('strong');
    await pass(changes([ANA]));
    const p = await pass(changes([ANA, BEN]));
    expect(p.updated).toBe(1);
    expect(p.addressChangesUnguarded).toBe(0);
    expect(t.bodies.get('c-ben')).toContain('EMAIL;TYPE=pref;TYPE=INTERNET:ben@example.org');
  });

  it('keeps 0149 D3 for a change at the source: a copy with no version is rewritten, with the table applied', async () => {
    const { t, pass, ben } = harness('none');
    await pass(changes([ANA]));
    await pass(changes([ANA, BEN]));
    const p = await pass(changes([ANA, BEN]), { benVersion: '2' });
    expect(p.updated).toBe(1);
    expect(t.bodies.get('c-ben')).toContain('ben@example.org');
    expect((await ben()).addressDigestDue ?? null).toBeNull();
  });
});
