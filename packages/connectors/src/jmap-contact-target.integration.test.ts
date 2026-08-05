// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `JmapContactTarget` against a REAL Stalwart (workplan 0031 T2.2).
 *
 * The unit tests run against a fake transport, so they pin the connector's
 * shape and prove nothing about the server. Everything this file asserts was
 * established by hand in `scripts/jmap-target-spike.ts` on 2026-08-05 — this is
 * that evidence turned into something that fails when it stops being true.
 *
 * Bring the dev stack up first if it is not already:
 *
 *     deploy/selfhost/setup-stalwart.sh
 *     STALWART_JMAP_URL=http://127.0.0.1:18080 pnpm vitest run --project integration \
 *       packages/connectors/src/jmap-contact-target.integration.test.ts
 *
 * `STALWART_JMAP_URL` is required rather than defaulted, and the skip below
 * says WHAT WAS NOT VERIFIED rather than "skipped": a suite that goes green
 * having checked nothing is the failure mode this repo keeps finding, and a
 * skipped test named after its own absence is the cheapest guard against
 * reading that green as coverage.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JmapContactTarget } from './jmap-contact-target';
import type { RawContact, TargetEntry } from '@openmig/shared';
import { contactNaturalKeyHash } from '@openmig/shared';

const BASE = process.env.STALWART_JMAP_URL;
const USER = process.env.STALWART_JMAP_USER ?? 'target@dev.local';
/**
 * The dev fixture credential, applied only against loopback.
 *
 * `target_password` is not a secret: it is `setup-stalwart.sh`'s committed
 * fixture password, in the repo in plain text, for a throwaway container of
 * `dev.local` accounts. What hard rule 3 is about is a real credential
 * reaching a real server, so the default stops at the boundary where that
 * becomes possible — point this at a non-loopback host and it must be told.
 */
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(BASE ?? '');
const PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? (LOOPBACK ? 'target_password' : undefined);

/** A card with the properties our own `Contact` model cannot carry. */
function fixtureVcard(uid: string): string {
  return [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `UID:${uid}`,
    'FN:Integration Fixture',
    'N:Fixture;Integration;;;',
    'ORG:Open Migration Stack;Engineering',
    'ROLE:Probe',
    'EMAIL;TYPE=work:fixture@dev.local',
    'TEL;TYPE=cell:+31600000001',
    'ADR;TYPE=work:;;Keizersgracht 1;Amsterdam;;1015 CJ;NL',
    'IMPP:xmpp:fixture@dev.local',
    'GEO:geo:52.3676,4.9041',
    'CATEGORIES:fixture',
    'X-OPENMIG-PROBE:this property has no JSContact equivalent',
    'END:VCARD',
    '',
  ].join('\r\n');
}

function raw(uid: string): RawContact {
  const vcard = fixtureVcard(uid);
  return { vcard, item: { uid, vcard } as unknown as RawContact['item'] };
}

if (!BASE || !PASSWORD) {
  console.warn(
    '[jmap-contacts] NOT RUN: set STALWART_JMAP_URL (and STALWART_JMAP_PASSWORD off loopback). ' +
      'Bring the dev server up with deploy/selfhost/setup-stalwart.sh.',
  );
  describe.skip('JMAP contacts target — NOT VERIFIED against a real server', () => {
    it('was not run, so nothing below is known to hold', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('JmapContactTarget against a real Stalwart', () => {
    // Unique per run, so a previous run's leftovers cannot make an assertion
    // pass for the wrong reason.
    const stamp = `${process.pid}-${Math.floor(Math.random() * 1e6)}`;
    const uid = `openmig-it-${stamp}`;
    const target = new JmapContactTarget({ baseUrl: BASE, username: USER, password: PASSWORD });
    let bookId: string;
    const written: string[] = [];

    beforeAll(async () => {
      bookId = await target.ensureContactFolder({ path: '/books/default', name: 'Contacts' });
      expect(bookId).toBeTruthy();
    }, 60_000);

    afterAll(async () => {
      // Leave the fixture account as we found it. A test that litters makes the
      // NEXT run's "already exists" look like a finding.
      for (const id of written) await target.removeItem(id).catch(() => undefined);
    }, 60_000);

    it('writes a contact and keys it by the vCard UID', async () => {
      const result = await target.upsertContact(bookId, raw(uid));
      expect(result.created).toBe(true);
      written.push(result.targetId);

      // The natural key is the whole point: it is what makes a mapping
      // switchable between this target and the CardDAV one without re-copying
      // (hard rule 1). Asserted through the SAME hash the ledger uses.
      const entries: TargetEntry[] = [];
      for await (const entry of target.listEntries()) entries.push(entry);
      const mine = entries.find((e) => e.targetId === result.targetId);
      expect(mine, `nothing in listEntries matched the id just written`).toBeDefined();
      // Keyed by the SOURCE vCard's UID, not by anything the server invented.
      // Looked up by targetId first so this compares the key rather than
      // finding by the key and then asserting it — which would hold whatever
      // the connector did.
      expect(mine!.naturalKey).toBe(uid);
      expect(contactNaturalKeyHash(mine!.naturalKey)).toBe(contactNaturalKeyHash(uid));
    }, 60_000);

    it('adopts on a second pass instead of writing a duplicate', async () => {
      const again = await target.upsertContact(bookId, raw(uid));
      // A duplicate is a SUCCESSFUL write nobody notices until an address book
      // is twice its size, which is why this is the assertion that matters
      // most in the file.
      expect(again.created).toBe(false);
      expect(again.adopted).toBe(true);
      expect(again.targetId).toBe(written[0]);
    }, 60_000);

    it('stores the properties our own normalised model could not carry', async () => {
      // ROLE, IMPP, GEO and an X- property with no JSContact equivalent at all.
      // Route (2) — letting the SERVER convert — exists precisely so these
      // survive; converting from `Contact` would have dropped every one of
      // them silently.
      const entries: TargetEntry[] = [];
      for await (const entry of target.listEntries(bookId)) entries.push(entry);
      expect(entries.some((e) => e.naturalKey === uid)).toBe(true);

      // Read the raw card to see what actually landed. Deliberately NOT
      // through the connector — the point is what the SERVER holds, and a
      // helper that shares the connector's assumptions could agree with it
      // while both were wrong.
      const auth = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
      const session = (await fetch(`${BASE}/.well-known/jmap`, {
        headers: { Authorization: auth },
      }).then((r) => r.json())) as { primaryAccounts?: Record<string, string> };
      const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:contacts'];
      expect(accountId, 'the session advertises no contacts account').toBeTruthy();

      const response = await fetch(`${BASE}/jmap`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:contacts'],
          methodCalls: [
            [
              'ContactCard/get',
              // `vCard` NAMED, because ContactCard/get does not volunteer it.
              // A read that omits it returns a card that looks complete, and
              // this assertion would then fail for a reason that has nothing
              // to do with what the server stored.
              { accountId, ids: null, properties: ['uid', 'vCard', 'onlineServices', 'titles'] },
              '0',
            ],
          ],
        }),
      });
      const body = await response.text();
      expect(body).toContain(uid);
      // The RFC 9555 escape hatch, carrying the property JSContact has no home
      // for. If this ever stops holding, a JMAP contacts migration silently
      // starts thinning every card that has an X- property — which is most of
      // the ones a real address book contains.
      expect(body.toLowerCase()).toContain('x-openmig-probe');
    }, 60_000);

    it('refuses to rewrite a card whose stored shape has moved under us', async () => {
      const result = await target.upsertContact(bookId, raw(uid), {
        overwrite: true,
        expectedTargetVersion: 'a fingerprint this card has never had',
      });
      // Hard rule 2, on a transport with no ETag: the guard is a fingerprint of
      // the card as stored. An owner who edited our copy in the new system —
      // which shadow migration positively invites — keeps their edit.
      expect(result.conflicted).toBe(true);
    }, 60_000);

    it('rewrites when the version we hold still matches', async () => {
      const first = await target.upsertContact(bookId, raw(uid), { overwrite: true });
      expect(first.updated).toBe(true);
      expect(first.targetVersion).toBeDefined();

      const second = await target.upsertContact(bookId, raw(uid), {
        overwrite: true,
        expectedTargetVersion: first.targetVersion,
      });
      // Same bytes in, so the stored card is unchanged and the fingerprint must
      // be stable. An unstable one would report a conflict on every pass and
      // silently stop update propagation working at all — which is why this
      // asserts the round trip rather than just the first write.
      expect(second.conflicted).toBeUndefined();
      expect(second.updated).toBe(true);
    }, 60_000);

    it('removes a card and reports it as deleted rather than binned', async () => {
      const doomed = `${uid}-doomed`;
      const created = await target.upsertContact(bookId, raw(doomed));
      const removal = await target.removeItem(created.targetId);
      // JMAP contacts has no trash collection to move a card into, unlike the
      // mail writer's trash mailbox. Understating recoverability is the safe
      // direction to be wrong in.
      expect(removal.kind).toBe('deleted');

      const entries: TargetEntry[] = [];
      for await (const entry of target.listEntries()) entries.push(entry);
      expect(entries.some((e) => e.naturalKey === doomed)).toBe(false);
    }, 60_000);
  });
}
