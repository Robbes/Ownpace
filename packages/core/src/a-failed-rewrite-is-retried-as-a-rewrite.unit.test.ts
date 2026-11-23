// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A FAILED REWRITE OF A SOURCE CHANGE IS RETRIED AS THAT REWRITE (workplan
 * 0168, found on the way; arch §11.1).
 *
 * A card we copied changes on the source; its rewrite fails once. A failure
 * keeps the row's target id and its old source version, and the retry used to
 * take the create path, because only an ADDRESS rewrite was retried as one:
 *
 *  - with the copy still there, the create found it and the pass recorded it
 *    as ADOPTED, the target's own, so the change never reached it and no
 *    later change ever would;
 *  - with the copy deleted on the target meanwhile, the create made it again,
 *    against "target-side deletions are deliberately not repaired".
 *
 * Addresses are `example.org` only.
 */

import { describe, it, expect } from 'vitest';
import { runContactSync } from './dav-sync.ts';
import { MemoryLedger } from './__testing__/memory.ts';
import {
  asMappingId,
  asTenantId,
  contactNaturalKeyHash,
  type Contact,
  type ContactSource,
  type ContactTargetWriter,
  type UpsertOptions,
  type UpsertResult,
} from '@openmig/shared';

const TENANT = asTenantId('83333333-3333-4333-8333-333333333333');
const MAPPING = asMappingId('84444444-4444-4444-8444-444444444444');

function card(uid: string, fn: string): string {
  return `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${fn}\r\nEMAIL;TYPE=INTERNET:${uid}@example.org\r\nUID:${uid}\r\nEND:VCARD\r\n`;
}

/** One card, whose name and version the test moves. */
function source(state: { fn: string; v: number }): ContactSource {
  return {
    listFolders: async () => [{ path: '/book/', name: 'Contacts' }],
    listSince: async () => ({
      items: [
        {
          item: { uid: 'c-ben', type: 'individual', name: state.fn, etag: `"ben-${state.v}"`, sourcePath: '/book/c-ben.vcf' } as unknown as Contact,
          vcard: card('c-ben', state.fn),
        },
      ],
      nextCursor: { value: String(state.v) },
      removed: [],
    }),
  } as unknown as ContactSource;
}

/** A DAV-shaped target with strong ETags, as `If-Match` and the writers answer. */
class Target {
  readonly bodies = new Map<string, string>();
  readonly etags = new Map<string, number>();
  creates = 0;
  failNextOverwrite = false;
  put(uid: string, body: string, options?: UpsertOptions): UpsertResult {
    if (options?.overwrite) {
      if (this.failNextOverwrite) {
        this.failNextOverwrite = false;
        throw new Error('the target answered 503 this once');
      }
      if (!this.bodies.has(uid)) return { targetId: uid, created: false, goneFromTarget: true };
      if (options.expectedTargetVersion !== `${this.etags.get(uid)}`) {
        return { targetId: uid, created: false, conflicted: true };
      }
      this.bodies.set(uid, body);
      this.etags.set(uid, this.etags.get(uid)! + 1);
      return { targetId: uid, created: false, updated: true, targetVersion: `${this.etags.get(uid)}` };
    }
    if (this.bodies.has(uid)) return { targetId: uid, created: false, adopted: true };
    this.creates += 1;
    this.bodies.set(uid, body);
    this.etags.set(uid, 1);
    return { targetId: uid, created: true, targetVersion: '1' };
  }
}

function harness() {
  const ledger = new MemoryLedger();
  const t = new Target();
  const state = { fn: 'Ben', v: 1 };
  const target = {
    ensureContactFolder: async (folder: { path: string }) => folder.path,
    upsertContact: async (_f: string, raw: { item: Contact; vcard: string }, options?: UpsertOptions) =>
      t.put(raw.item.uid, raw.vcard, options),
  } as unknown as ContactTargetWriter;
  const pass = (authority = true) =>
    runContactSync({
      sourceIsAuthorityOnExistence: authority,
      stillTheAuthority: async () => authority,
      tenantId: TENANT,
      mappingId: MAPPING,
      source: source(state),
      target,
      ledger,
    });
  const ben = async () => (await ledger.find(TENANT, MAPPING, 'contact', contactNaturalKeyHash('c-ben')))!;
  return { t, state, pass, ben };
}

describe('a failed rewrite of a source change', () => {
  it('is retried as that rewrite, and the change lands on our copy', async () => {
    const { t, state, pass, ben } = harness();
    await pass();
    state.fn = 'Ben Changed';
    state.v = 2;
    t.failNextOverwrite = true;
    const failed = await pass();
    expect(failed.failed).toBe(1);
    expect((await ben()).status).toBe('failed');

    const retried = await pass();
    expect(retried.updated).toBe(1);
    expect(retried.adopted ?? 0).toBe(0);
    expect(t.bodies.get('c-ben')).toContain('FN:Ben Changed');
    expect((await ben()).status).toBe('updated');
    expect((await ben()).sourceVersion).toBe('"ben-2"');
    expect(t.creates).toBe(1);
  });

  it('is retried as that rewrite when the copy was deleted meanwhile, so it is never made again', async () => {
    const { t, state, pass } = harness();
    await pass();
    state.fn = 'Ben Changed';
    state.v = 2;
    t.failNextOverwrite = true;
    await pass();
    t.bodies.delete('c-ben');
    const retried = await pass();
    expect(retried.goneFromTarget).toBe(1);
    expect(retried.created).toBe(0);
    expect(t.creates).toBe(1);
    expect(t.bodies.has('c-ben')).toBe(false);
  });

  it('past the cutover, waits as a source change does and writes nothing', async () => {
    const { t, state, pass } = harness();
    await pass();
    state.fn = 'Ben Changed';
    state.v = 2;
    t.failNextOverwrite = true;
    await pass();
    const after = await pass(false);
    expect(after.changedAfterCutover).toBe(1);
    expect(t.bodies.get('c-ben')).toContain('FN:Ben\r\n');
    expect(t.creates).toBe(1);
  });
});

/**
 * A VERSION RECORDED IS NOT A COPY (workplan 0168, found on the way). A row
 * from before the version column, listed unchanged, gets its version and
 * nothing else: `recordUpdate` stamped `last_synced_at`, which the usage
 * meter read as another copy. The SQL half is
 * `packages/managed/src/a-version-recorded-is-not-a-copy.integration.test.ts`.
 */
describe('a row from before the version column, listed unchanged', () => {
  it('gets its version through recordSourceVersion, never recordUpdate', async () => {
    const ledger = new MemoryLedger();
    const t = new Target();
    const state = { fn: 'Ben', v: 1 };
    const target = {
      ensureContactFolder: async (folder: { path: string }) => folder.path,
      upsertContact: async (_f: string, raw: { item: Contact; vcard: string }, options?: UpsertOptions) =>
        t.put(raw.item.uid, raw.vcard, options),
    } as unknown as ContactTargetWriter;
    const pass = () =>
      runContactSync({
        sourceIsAuthorityOnExistence: true,
        stillTheAuthority: async () => true,
        tenantId: TENANT,
        mappingId: MAPPING,
        source: source(state),
        target,
        ledger,
      });
    await pass();
    const key = contactNaturalKeyHash('c-ben');
    const row = (await ledger.find(TENANT, MAPPING, 'contact', key))!;
    const { sourceVersion: _dropped, ...withoutVersion } = row;
    await ledger.recordUpdate({ ...withoutVersion, status: 'copied' });
    ledger.writes.recordUpdate = 0;

    const second = await pass();
    expect(second.skipped).toBe(1);
    expect(ledger.writes.recordUpdate).toBe(0);
    expect(ledger.writes.sourceVersion).toBe(1);
    expect((await ledger.find(TENANT, MAPPING, 'contact', key))!.sourceVersion).toBe('"ben-1"');
  });
});
