// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Contacts over JMAP (workplan 0031 T2.1).
 *
 * These tests are aimed at the things that fail SILENTLY, because that is what
 * this connector's whole design is arranged around. A JMAP write returns
 * success whether or not the card carried what it should, so "the route
 * returns 201" pins nothing worth pinning.
 *
 * Four properties get the attention:
 *
 *   1. Every read names `vCard`. Stalwart stores the RFC 9555 escape hatch —
 *      every source property with no JSContact equivalent — and does NOT
 *      volunteer it. A read that forgets is a PASSING read returning a thinner
 *      card than the target holds.
 *   2. The card written is the SERVER's parse output, not one we built. That
 *      is the entire fidelity argument (route 2 in the header comment); a
 *      hand-built card would drop IMPP, ROLE, GEO and every X- property.
 *   3. A failed existence check never reads as "not present". That turn is how
 *      a duplicate gets written, and a duplicate is a successful write nobody
 *      notices.
 *   4. Overwrite and removal refuse when the card has moved under us. This
 *      transport has no ETag, so the guard is a fingerprint of the stored card
 *      — and if that fingerprint were unstable, update propagation would
 *      silently stop working.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawContact } from '@openmig/shared';
import { JmapContactTarget, extractUidFromVcard } from './jmap-contact-target.ts';

/**
 * The session document this writer connects against.
 *
 * Served through the fake `fetch` below rather than by mocking `jmap-jam`,
 * which is how this file used to do it. That mock asserted something untrue:
 * that session loading either succeeds or throws. `JamClient.loadSession` never
 * checked `response.ok`, so a 401 RESOLVED with the error document, and no test
 * built on a library mock could ever have seen it. Stub the transport; let the
 * real loader run.
 */
const SESSION = {
  accounts: { acct: { email: 'target@dev.local' } },
  primaryAccounts: { 'urn:ietf:params:jmap:contacts': 'acct' },
  // Deliberately unroutable, the way Stalwart really answers. If the writer
  // ever starts trusting this, every test here fails.
  apiUrl: 'https://0.0.0.0/jmap/',
};

/** The session response, for every stub in this file. */
function sessionResponse(): Response {
  return new Response(JSON.stringify(SESSION), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** One JMAP method call, as the fake transport recorded it. */
interface Call {
  readonly url: string;
  readonly method: string;
  readonly args: Record<string, unknown>;
  readonly using: string[];
}

/** What the fake server should answer, per JMAP method name. */
type Responder = (args: Record<string, unknown>, call: number) => unknown;

const calls: Call[] = [];
let responders: Record<string, Responder>;
let uploads: string[];

function target(): JmapContactTarget {
  return new JmapContactTarget({
    baseUrl: 'http://jmap.test',
    username: 'target@dev.local',
    password: 'pw',
  });
}

function rawContact(uid = 'card-1', extra = ''): RawContact {
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:4.0',
    `UID:${uid}`,
    'FN:A Person',
    extra,
    'END:VCARD',
    '',
  ]
    .filter((l) => l !== '')
    .join('\r\n');
  return { vcard, item: { uid, vcard } as unknown as RawContact['item'] };
}

/** How many times each method has been asked for, so responders can vary. */
const seen: Record<string, number> = {};

beforeEach(() => {
  calls.length = 0;
  uploads = [];
  for (const k of Object.keys(seen)) delete seen[k];
  responders = {};

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.includes('/.well-known/jmap')) return sessionResponse();
    if (url.includes('/upload/')) {
      uploads.push(String(init.body));
      return new Response(JSON.stringify({ blobId: `blob-${uploads.length}` }), { status: 200 });
    }
    const body = JSON.parse(String(init.body)) as {
      using: string[];
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const [method, args] = body.methodCalls[0]!;
    calls.push({ url, method, args, using: body.using });
    seen[method] = (seen[method] ?? 0) + 1;

    const responder = responders[method];
    if (!responder) throw new Error(`test fake has no responder for ${method}`);
    const result = responder(args, seen[method]!);
    return new Response(JSON.stringify({ methodResponses: [[method, result, 'c1']] }), {
      status: 200,
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The parse output a real Stalwart returned for the spike's fixture vCard. */
function parsedCard(uid: string) {
  return {
    '@type': 'Card',
    uid,
    version: '1.0',
    name: { full: 'A Person' },
    onlineServices: { k1: { uri: 'xmpp:a@dev.local' } },
    vCard: {
      convertedProperties: { 'onlineServices/k1/uri': { name: 'impp' } },
      properties: [['x-openmig-probe', {}, 'unknown', 'no JSContact equivalent']],
    },
  };
}

describe('the vCard escape hatch, which is the read this connector cannot forget', () => {
  it('names `vCard` on every ContactCard/get it makes', async () => {
    responders['ContactCard/get'] = () => ({ list: [] });
    responders['ContactCard/parse'] = (args) => ({
      parsed: { [(args.blobIds as string[])[0]!]: parsedCard('card-1') },
    });
    responders['ContactCard/set'] = () => ({ created: { '0': { id: 'srv-1' } } });

    await target().upsertContact('book-1', rawContact());

    const gets = calls.filter((c) => c.method === 'ContactCard/get');
    expect(gets.length).toBeGreaterThan(0);
    for (const get of gets) {
      // THE point of this test. Stalwart stores every source property with no
      // JSContact equivalent inside `vCard` and does not volunteer it, so a
      // read that omits it succeeds and returns a card missing data. Nothing
      // else in the system would notice.
      expect(get.args.properties).toContain('vCard');
      expect(get.args.properties).toContain('uid');
    }
  });
});

describe('what actually gets written', () => {
  beforeEach(() => {
    responders['ContactCard/get'] = () => ({ list: [] });
    responders['ContactCard/parse'] = (args) => ({
      parsed: { [(args.blobIds as string[])[0]!]: parsedCard('card-1') },
    });
    responders['ContactCard/set'] = () => ({ created: { '0': { id: 'srv-1' } } });
  });

  it('sends the raw vCard to the SERVER to convert, rather than converting it here', async () => {
    await target().upsertContact('book-1', rawContact('card-1', 'IMPP:xmpp:a@dev.local'));

    // The bytes go up untouched. Converting from our own normalised `Contact`
    // would have dropped IMPP, ROLE, GEO and every X- property — silently, on
    // every card. Route (2) exists precisely so that cannot happen.
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toContain('IMPP:xmpp:a@dev.local');
    expect(calls.some((c) => c.method === 'ContactCard/parse')).toBe(true);
  });

  it('writes the parse output back, with only the address book added', async () => {
    await target().upsertContact('book-1', rawContact());

    const set = calls.find((c) => c.method === 'ContactCard/set')!;
    const created = (set.args.create as Record<string, Record<string, unknown>>)['0']!;
    // Everything the server produced, unedited — including the escape hatch.
    expect(created.vCard).toEqual(parsedCard('card-1').vCard);
    expect(created.onlineServices).toEqual(parsedCard('card-1').onlineServices);
    // Plus the one thing the parser cannot know. Omitting it is refused with
    // "Contact has to belong to at least one address book".
    expect(created.addressBookIds).toEqual({ 'book-1': true });
  });

  it('declares the parse capability on the parse call', async () => {
    await target().upsertContact('book-1', rawContact());
    const parse = calls.find((c) => c.method === 'ContactCard/parse')!;
    // A server that enforces RFC 8620 §2 refuses a method whose capability was
    // not declared. Stalwart does not, which is exactly why forgetting it here
    // would go unnoticed until a stricter server.
    expect(parse.using).toContain('urn:ietf:params:jmap:contacts:parse');
  });

  it('ignores the session apiUrl and posts to the rebuilt endpoint', async () => {
    await target().upsertContact('book-1', rawContact());
    // The session advertises https://0.0.0.0/jmap/, which is unroutable.
    for (const call of calls) expect(call.url).toBe('http://jmap.test/jmap');
  });
});

describe('adoption, so a first migration into a used account cannot duplicate', () => {
  it('adopts a card already on the target under our UID and writes nothing', async () => {
    responders['ContactCard/get'] = () => ({
      list: [{ id: 'existing', uid: 'card-1', addressBookIds: { 'book-1': true } }],
    });

    const result = await target().upsertContact('book-1', rawContact('card-1'));

    expect(result).toMatchObject({ targetId: 'existing', created: false, adopted: true });
    // `adopted`, not merely `created: false`. The two are different facts —
    // one is "we already copied this", the other is "the customer already had
    // it" — and only the second is a decision about their data.
    expect(calls.some((c) => c.method === 'ContactCard/set')).toBe(false);
    expect(uploads).toHaveLength(0);
  });

  it('adopts across address books, not just the one being written to', async () => {
    // The natural key is unique per MAPPING, not per collection (ADR-0020).
    // A card filed in another book is still on the target.
    responders['ContactCard/get'] = () => ({
      list: [{ id: 'elsewhere', uid: 'card-1', addressBookIds: { 'some-other-book': true } }],
    });
    const result = await target().upsertContact('book-1', rawContact('card-1'));
    expect(result).toMatchObject({ targetId: 'elsewhere', adopted: true });
  });

  it('adopts when the SERVER refuses with alreadyExists mid-pass', async () => {
    // The snapshot is taken once per pass, so the window between "not in the
    // snapshot" and the write is a whole pass wide. The server, not our
    // snapshot, is what actually guarantees no second copy.
    responders['ContactCard/get'] = (_a, n) =>
      n === 1
        ? { list: [] }
        : { list: [{ id: 'raced', uid: 'card-1', addressBookIds: { 'book-1': true } }] };
    responders['ContactCard/parse'] = (args) => ({
      parsed: { [(args.blobIds as string[])[0]!]: parsedCard('card-1') },
    });
    responders['ContactCard/set'] = () => ({
      notCreated: { '0': { type: 'alreadyExists', description: 'already there' } },
    });

    const result = await target().upsertContact('book-1', rawContact('card-1'));
    expect(result).toMatchObject({ targetId: 'raced', created: false, adopted: true });
  });
});

describe('failures that must never look like an empty result', () => {
  it('throws when the account cannot be enumerated for a specific card', async () => {
    responders['ContactCard/get'] = () => {
      throw new Error('boom');
    };
    // The snapshot swallows its own failure by design and falls back to a
    // per-card probe; the PROBE must not swallow anything, because
    // `upsertContact` reads undefined as "not on the target" and writes.
    await expect(target().findContactByNaturalKey('book-1', 'card-1')).rejects.toThrow();
  });

  it('surfaces a method-level JMAP error rather than returning it as a result', async () => {
    // RFC 8620 §3.6.2: a refused method comes back as ["error", {...}] with
    // HTTP 200. Handing `methodResponses[0][1]` back blindly turns that into
    // `{ list: undefined }`, so enumeration yields nothing and verification
    // reports the target as EMPTY — total data loss, from a working server.
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('/.well-known/jmap')
        ? sessionResponse()
        : new Response(
            JSON.stringify({
              methodResponses: [['error', { type: 'unknownMethod', description: 'nope' }, 'c1']],
            }),
            { status: 200 },
          ),
    );
    const entries = target().listEntries();
    await expect((async () => { for await (const _ of entries) { /* drain */ } })()).rejects.toThrow(
      /unknownMethod/,
    );
  });

  it('refuses to key a card with no uid instead of falling back to its JMAP id', async () => {
    responders['ContactCard/get'] = () => ({ list: [{ id: 'srv-9', addressBookIds: {} }] });
    const entries = target().listEntries();
    // Keying by the JMAP id would mis-key a card that IS present, so
    // verification would report it missing — the ADR-0020 failure mode.
    await expect((async () => { for await (const _ of entries) { /* drain */ } })()).rejects.toThrow(
      /no uid/,
    );
  });

  it('names WHICH parse outcome happened, because they need different responses', async () => {
    responders['ContactCard/get'] = () => ({ list: [] });
    responders['ContactCard/parse'] = (args) => ({
      notParsable: [(args.blobIds as string[])[0]!],
    });
    // A malformed source card is one item to park; a missing blob is a
    // transport problem affecting everything. "parse failed" sends somebody
    // looking at the wrong one.
    await expect(target().upsertContact('book-1', rawContact())).rejects.toThrow(
      /could not parse it as a vCard/,
    );
  });

  it('does not report a removal the server never confirmed', async () => {
    responders['ContactCard/set'] = () => ({ destroyed: [] });
    // Neither destroyed nor notDestroyed. Returning success there lets the
    // ledger tombstone a row for a card still sitting on the target.
    await expect(target().removeItem('srv-1')).rejects.toThrow(/did not confirm/);
  });
});

describe('ownership, on a transport with no ETag', () => {
  const stored = { id: 'srv-1', uid: 'card-1', addressBookIds: { 'book-1': true }, vCard: {} };

  it('fingerprints the stored card identically however the server orders its keys', async () => {
    // JMAP promises nothing about key order and Stalwart demonstrably varies
    // it between reads — the spike's own output shows a different order every
    // run. Hashing raw JSON would report a conflict on EVERY rewrite and
    // silently stop update propagation working at all.
    //
    // The fake alternates order on the FINGERPRINT reads specifically (the
    // ones that name an id), not on every call. An earlier version of this
    // test alternated on a counter shared with the snapshot read, so both
    // fingerprints happened to land on the same ordering and the assertion
    // held whether or not the code sorted anything — a vacuous pass, verified
    // by mutation: removing the sort left all 22 tests green.
    let fingerprintReads = 0;
    responders['ContactCard/get'] = (args) => {
      const ordered = { id: 'srv-1', uid: 'card-1', addressBookIds: { 'book-1': true }, vCard: {} };
      const reversed = { vCard: {}, addressBookIds: { 'book-1': true }, uid: 'card-1', id: 'srv-1' };
      if (!Array.isArray(args.ids)) return { list: [ordered] }; // the snapshot read
      fingerprintReads++;
      return { list: [fingerprintReads % 2 === 1 ? ordered : reversed] };
    };
    responders['ContactCard/parse'] = (args) => ({
      parsed: { [(args.blobIds as string[])[0]!]: parsedCard('card-1') },
    });
    responders['ContactCard/set'] = () => ({ updated: { 'srv-1': null } });

    const first = await target().upsertContact('book-1', rawContact('card-1'), { overwrite: true });
    const second = await target().upsertContact('book-1', rawContact('card-1'), { overwrite: true });

    expect(fingerprintReads).toBe(2); // both orderings were actually served
    expect(first.targetVersion).toBeDefined();
    expect(first.targetVersion).toBe(second.targetVersion);
  });

  it('refuses the rewrite when the stored card has moved under us', async () => {
    responders['ContactCard/get'] = () => ({ list: [stored] });
    responders['ContactCard/parse'] = (args) => ({
      parsed: { [(args.blobIds as string[])[0]!]: parsedCard('card-1') },
    });
    responders['ContactCard/set'] = () => ({ updated: { 'srv-1': null } });

    const result = await target().upsertContact('book-1', rawContact('card-1'), {
      overwrite: true,
      expectedTargetVersion: 'a fingerprint from some earlier shape of this card',
    });

    // Hard rule 2. Somebody edited our copy in the new system — which shadow
    // migration positively invites — and their edit is out of reach. Reported,
    // not thrown: a conflict is a fact about ownership, not a failed migration.
    expect(result).toMatchObject({ conflicted: true, created: false });
    expect(calls.some((c) => c.method === 'ContactCard/parse')).toBe(false);
  });

  it('refuses the REMOVAL when the stored card has moved under us', async () => {
    responders['ContactCard/get'] = () => ({ list: [stored] });
    responders['ContactCard/set'] = () => ({ destroyed: ['srv-1'] });

    const result = await target().removeItem('srv-1', {
      expectedTargetVersion: 'not what the card looks like now',
    });
    // The guard matters more here than anywhere else: this is the one
    // operation that cannot be undone.
    expect(result).toEqual({ conflicted: true });
    expect(calls.some((c) => c.method === 'ContactCard/set')).toBe(false);
  });

  it('refuses to rewrite a card that is not on the target at all', async () => {
    responders['ContactCard/get'] = () => ({ list: [] });
    // Falling through to a create would be convenient and wrong: the caller
    // believes this item was already copied, and quietly disagreeing hides
    // whatever made that false.
    await expect(
      target().upsertContact('book-1', rawContact('card-1'), { overwrite: true }),
    ).rejects.toThrow(/no card with that UID is on the target/);
  });
});

describe('the UID, which is the natural key', () => {
  it('keeps a URI-shaped UID whole', () => {
    // Splitting on every colon truncates `urn:uuid:…` to `urn`, which keys
    // every such card identically and collapses an address book into one
    // entry. The CardDAV writer's `split(':')[1]` does exactly that.
    expect(extractUidFromVcard('BEGIN:VCARD\r\nUID:urn:uuid:abc-123\r\nEND:VCARD')).toBe(
      'urn:uuid:abc-123',
    );
  });

  it('reads a UID carrying parameters', () => {
    expect(extractUidFromVcard('UID;VALUE=TEXT:plain-1')).toBe('plain-1');
  });

  it('refuses a vCard with no UID rather than inventing a key', () => {
    expect(() => extractUidFromVcard('BEGIN:VCARD\r\nFN:No Key\r\nEND:VCARD')).toThrow(
      /no natural key/,
    );
  });
});

describe('address books', () => {
  it('reuses a book matching the source collection name', async () => {
    responders['AddressBook/get'] = () => ({ list: [{ id: 'b1', name: 'Colleagues' }] });
    const id = await target().ensureContactFolder({ path: '/books/colleagues', name: 'Colleagues' });
    expect(id).toBe('b1');
    expect(calls.some((c) => c.method === 'AddressBook/set')).toBe(false);
  });

  it('creates one when nothing matches', async () => {
    responders['AddressBook/get'] = () => ({ list: [{ id: 'b1', name: 'Something else' }] });
    responders['AddressBook/set'] = () => ({ created: { '0': { id: 'b2' } } });
    const id = await target().ensureContactFolder({ path: '/books/colleagues' });
    expect(id).toBe('b2');
    // Named from the source collection's last segment when the folder carries
    // no display name.
    const set = calls.find((c) => c.method === 'AddressBook/set')!;
    expect((set.args.create as Record<string, { name: string }>)['0']!.name).toBe('colleagues');
  });
});
