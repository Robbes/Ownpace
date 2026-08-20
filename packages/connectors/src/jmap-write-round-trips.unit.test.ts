// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * How many requests importing a message costs.
 *
 * The DAV writers stopped asking "is this already here?" once per item; mail
 * kept doing it, and mail is where it hurts most. `Email/query` with a
 * `Message-ID` header filter is a search across the WHOLE ACCOUNT, so the
 * probe's cost grows with the account — meaning the work per message goes up
 * as the migration progresses. Two real runs measured exactly that:
 *
 *   run #36: 202 messages, 24 s -> 119 ms/item
 *   run #38: 506 messages, 111 s -> 219 ms/item
 *
 * These tests COUNT method calls, so a regression that reintroduces the
 * per-item probe fails here rather than in someone's migration window.
 *
 * What is held fixed while it gets faster:
 *   - a message already on the target is adopted, never imported again;
 *   - a target that cannot be enumerated still migrates, via the old path;
 *   - an unenumerable target is never mistaken for an empty one.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { JmapTargetWriter } from './jmap-target.ts';

const CONFIG = {
  baseUrl: 'https://mail.example.com',
  username: 'target@example.com',
  password: 'pw',
};

const SESSION = {
  accounts: { a1: { name: 'target@example.com' } },
  primaryAccounts: { 'urn:ietf:params:jmap:mail': 'a1' },
  apiUrl: 'https://mail.example.com/jmap',
};

function message(id: string): { rfc822: Uint8Array } {
  const text =
    `Message-ID: <${id}@dev.local>\r\nFrom: a@dev.local\r\nTo: b@dev.local\r\n` +
    `Subject: ${id}\r\nDate: Mon, 1 Jun 2026 10:00:00 +0000\r\n\r\nbody ${id}\r\n`;
  return { rfc822: new TextEncoder().encode(text) };
}

/**
 * A JMAP server holding `existing` Message-IDs, counting every method call.
 *
 * `enumerable: false` models a target whose account-wide listing fails while
 * per-message lookups still work — the case that must fall back rather than
 * conclude the account is empty.
 */
function jmapServer(
  existing: string[],
  opts: {
    enumerable?: boolean;
    /**
     * Message-IDs the server refuses with `alreadyExists`, and the id it
     * volunteers with the refusal (`null` to refuse without one).
     *
     * The refusal is the JMAP counterpart of `If-None-Match: *` on the DAV
     * writes: the snapshot is taken once per pass, so the window between "not
     * in the snapshot" and the import is a whole pass wide, and it is the
     * SERVER, not our check, that actually holds hard rule 1 there.
     */
    refuse?: Map<string, string | null>;
    /** Answer `Email/import` with a `created` entry that has no `id`. */
    createdWithoutId?: boolean;
    /**
     * Message-IDs the account holds but the ENUMERATION does not list.
     *
     * This is the race the refusal exists for, modelled honestly: the snapshot
     * is taken once per pass, so a message that arrives afterwards is absent
     * from it and present on the server. A per-message lookup still finds it.
     */
    hiddenFromSnapshot?: string[];
  } = {},
) {
  const enumerable = opts.enumerable ?? true;
  const refuse = opts.refuse ?? new Map<string, string | null>();
  const hidden = new Set((opts.hiddenFromSnapshot ?? []).map((id) => `<${id}@dev.local>`));
  const methods: string[] = [];
  // Message-ID -> email id
  const present = new Map(existing.map((id, i) => [`<${id}@dev.local>`, `E${i}`]));
  let nextId = 1000;
  /** Message-ID of the blob most recently uploaded. See the upload handler. */
  let lastImported: string | undefined;
  /**
   * How many `alreadyExists` refusals this server actually issued.
   *
   * Exposed and ASSERTED by every test that asks for one. The upload body is a
   * Blob, and the first version of the matching above stringified it — which is
   * "[object Blob]", matches no Message-ID, and refuses nothing. Every refusal
   * test passed anyway, for the wrong reason. A fixture that can quietly not
   * fire is the same defect as the tests this sweep exists to find.
   */
  let refusalsIssued = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const ok = (body: unknown) =>
        ({
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
          headers: new Map(),
        }) as unknown as Response;

      if (u.includes('.well-known/jmap')) return ok(SESSION);
      if (u.includes('/upload/')) {
        // The import that follows carries only an opaque blobId, so the only
        // place a fake server can tell WHICH message is being written is the
        // upload body.
        // `uploadBlob` sends a Blob, so this has to be read rather than
        // stringified — `String(blob)` is "[object Blob]" and matches nothing,
        // which is a silent no-op that would leave `refuse` never firing and
        // every test below passing for the wrong reason.
        const body = init?.body;
        const raw =
          typeof body === 'string'
            ? body
            : body instanceof Blob
              ? await body.text()
              : body instanceof Uint8Array
                ? new TextDecoder().decode(body)
                : '';
        lastImported = /^Message-ID:\s*(\S+)/im.exec(raw)?.[1];
        return ok({ blobId: `B${nextId++}` });
      }

      const call = JSON.parse(String(init?.body)) as {
        methodCalls: Array<[string, Record<string, unknown>, string]>;
      };
      const [method, args] = call.methodCalls[0]!;
      methods.push(method);

      if (method === 'Email/query') {
        // A header-filtered query is the per-message probe; an unfiltered one
        // is the account enumeration.
        const filter = args.filter as { header?: [string, string] } | undefined;
        if (filter?.header) {
          const found = present.get(filter.header[1]);
          return ok({ methodResponses: [['Email/query', { ids: found ? [found] : [] }, 'c1']] });
        }
        if (!enumerable) {
          return ok({
            methodResponses: [['error', { type: 'forbidden', description: 'no listing' }, 'c1']],
          });
        }
        const position = Number(args.position ?? 0);
        const visible = [...present.entries()]
          .filter(([mid]) => !hidden.has(mid))
          .map(([, id]) => id);
        const ids = visible.slice(position, position + 100);
        return ok({ methodResponses: [['Email/query', { ids }, 'c1']] });
      }

      if (method === 'Email/get') {
        const wanted = new Set(args.ids as string[]);
        const list = [...present.entries()]
          .filter(([, id]) => wanted.has(id))
          .map(([mid, id]) => ({
            id,
            mailboxIds: { m1: true },
            headers: [{ name: 'Message-ID', value: mid }],
            size: 100,
          }));
        return ok({ methodResponses: [['Email/get', { list }, 'c1']] });
      }

      if (method === 'Email/import') {
        const emails = args.emails as Record<string, unknown>;
        const id = `E${nextId++}`;
        // The blob is opaque here, so key the import off what the test asked
        // for: one created email per call.
        void emails;
        if (lastImported !== undefined && refuse.has(lastImported)) {
          const existingId = refuse.get(lastImported);
          refusalsIssued += 1;
          return ok({
            methodResponses: [
              [
                'Email/import',
                {
                  notCreated: {
                    '0': {
                      type: 'alreadyExists',
                      description: existingId
                        ? `existingId: "${existingId}"`
                        : 'the server already holds this message',
                      ...(existingId !== null ? { existingId } : {}),
                    },
                  },
                },
                'c1',
              ],
            ],
          });
        }
        if (opts.createdWithoutId) {
          // RFC 8620 §5.3 says the server assigns `.id`; a server that answers
          // without one has told us nothing we can record.
          return ok({ methodResponses: [['Email/import', { created: { '0': { blobId: 'b' } } }, 'c1']] });
        }
        return ok({ methodResponses: [['Email/import', { created: { '0': { id, blobId: 'b' } } }, 'c1']] });
      }

      return ok({ methodResponses: [[method, {}, 'c1']] });
    }),
  );

  return { methods, present, refusals: () => refusalsIssued };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('JMAP write cost', () => {
  it('asks the account once, not once per message', async () => {
    const { methods } = jmapServer([]);
    const writer = new JmapTargetWriter(CONFIG as never);

    for (let i = 1; i <= 20; i++) {
      await writer.upsertEmail('m1', message(`e${i}`) as never, []);
    }

    const queries = methods.filter((m) => m === 'Email/query');
    const imports = methods.filter((m) => m === 'Email/import');

    // One enumeration for the whole account (an empty account is a single
    // short page), and one import per message. Before this, `queries` was 20 —
    // a full-account header search per message.
    expect(queries).toHaveLength(1);
    expect(imports).toHaveLength(20);
  });

  it('still adopts what the target already has, without importing it again', async () => {
    const { methods } = jmapServer(['e1', 'e2']);
    const writer = new JmapTargetWriter(CONFIG as never);

    const first = await writer.upsertEmail('m1', message('e1') as never, []);
    const third = await writer.upsertEmail('m1', message('e3') as never, []);

    expect(first.created).toBe(false);
    expect(first.adopted).toBe(true);
    expect(first.targetId).toBe('E0');
    expect(third.created).toBe(true);

    // Exactly one import: the message that was actually missing.
    expect(methods.filter((m) => m === 'Email/import')).toHaveLength(1);
  });

  it('does not import the same message twice within one pass', async () => {
    // The snapshot is taken once, so it has to learn what we write into it —
    // otherwise the second occurrence looks absent and gets duplicated, which
    // is the one property the whole product rests on (hard rule 1).
    const { methods } = jmapServer([]);
    const writer = new JmapTargetWriter(CONFIG as never);

    const a = await writer.upsertEmail('m1', message('dup') as never, []);
    const b = await writer.upsertEmail('m1', message('dup') as never, []);

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.adopted).toBe(true);
    expect(b.targetId).toBe(a.targetId);
    expect(methods.filter((m) => m === 'Email/import')).toHaveLength(1);
  });

  it('records the SERVER\'s id for a newly imported message, not our creation id', async () => {
    // `Email/import` answers with `created` keyed by the CREATION ID the request
    // chose (this writer always sends `"0"`), and the server's real id is `.id`
    // on the value (RFC 8620 §5.3). Reading the KEY instead recorded the literal
    // string "0" as `targetId` for every mail item ever migrated.
    //
    // It hid for a long time because nothing fed a mail row's targetId back into
    // a JMAP call: verification re-derives ids from `Email/query`, and the adopt
    // path takes its id from `Email/get`. Only `removeItem` (ADR-0024) ever used
    // it, and it failed against a real Stalwart with `Email/set ... notFound`
    // for an id named "0". Nothing here asserted the created path's targetId at
    // all — and the "same message twice" test below passed while both of its
    // sides were equally wrong, which is how a broken id stayed invisible.
    const { methods } = jmapServer([]);
    const writer = new JmapTargetWriter(CONFIG as never);

    const result = await writer.upsertEmail('m1', message('fresh') as never, []);

    expect(result.created).toBe(true);
    // A server-assigned id (the mock mints `E<n>`), never the `"0"` creation
    // key. Matched by shape rather than an exact number because the mock shares
    // one counter between blob ids and email ids.
    expect(result.targetId).toMatch(/^E\d+$/);
    expect(result.targetId).not.toBe('0');
    expect(methods.filter((m) => m === 'Email/import')).toHaveLength(1);
  });

  it('falls back to the per-message check when the account cannot be enumerated', async () => {
    // A target we cannot list must still migrate — just not as fast. And
    // crucially it must not be READ AS EMPTY: an unenumerable account that
    // already holds `e1` must still adopt it.
    const { methods } = jmapServer(['e1'], { enumerable: false });
    const writer = new JmapTargetWriter(CONFIG as never);

    const existing = await writer.upsertEmail('m1', message('e1') as never, []);
    const fresh = await writer.upsertEmail('m1', message('e2') as never, []);

    expect(existing.adopted).toBe(true);
    expect(fresh.created).toBe(true);
    expect(methods.filter((m) => m === 'Email/import')).toHaveLength(1);
  });

  it('pages the enumeration instead of stopping at the first 100', async () => {
    const many = Array.from({ length: 250 }, (_, i) => `old${i}`);
    const { methods } = jmapServer(many);
    const writer = new JmapTargetWriter(CONFIG as never);

    // A message from the third page must still be recognised as present.
    const result = await writer.upsertEmail('m1', message('old240') as never, []);

    expect(result.adopted).toBe(true);
    expect(methods.filter((m) => m === 'Email/import')).toHaveLength(0);
    // 250 messages at 100 a page: 3 pages, and the third is short so it stops.
    expect(methods.filter((m) => m === 'Email/query')).toHaveLength(3);
  });

  it('sends Email/query only arguments RFC 8621 §4.4 defines', async () => {
    // `properties` belongs to Email/get. RFC 8620 §3.2 says a server MUST
    // answer an unknown argument with `invalidArguments` — this was fixed in
    // the enumeration and left in the per-message probe, where it would have
    // failed every existence check against a stricter server than Stalwart.
    const bodies: string[] = [];
    jmapServer(['e1'], { enumerable: false });
    const realFetch = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', async (u: string | URL, i?: RequestInit) => {
      if (i?.body) bodies.push(String(i.body));
      return realFetch(String(u), i);
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await writer.upsertEmail('m1', message('e1') as never, []);

    const probe = bodies
      .map((b) => JSON.parse(b) as { methodCalls: Array<[string, Record<string, unknown>, string]> })
      .find((b) => b.methodCalls[0]![0] === 'Email/query' && 'filter' in b.methodCalls[0]![1]);

    expect(probe, 'no header-filtered Email/query was issued').toBeTruthy();
    expect(probe!.methodCalls[0]![1]).not.toHaveProperty('properties');
  });
});

/**
 * When the SERVER, not our snapshot, is what stops a duplicate.
 *
 * The account snapshot is taken once per pass, so the window between "not in
 * the snapshot" and the import is a whole pass wide — long enough for a
 * concurrent delivery, a second appliance, or a resumed run to put the message
 * there first. `alreadyExists` is JMAP's answer to that, and handling it is the
 * counterpart of `If-None-Match: *` on the DAV writes: the last thing standing
 * between a re-run and a duplicated mailbox (hard rule 1).
 *
 * Found untested by mutation on 2026-08-07. Three separate mutations survived
 * all 1922 tests:
 *
 *   - disable the `alreadyExists` branch, so the refusal becomes a hard failure
 *     and the item never migrates;
 *   - replace the lookup with a literal `'unknown'` id, writing a fabricated
 *     targetId into the ledger — the exact thing the code comment says never to
 *     do, because a row pointing at nothing is worse than a failed item;
 *   - delete the missing-`id` guard, so a server that answers `created` without
 *     one records `undefined` as a message's target id.
 *
 * The contacts and files JMAP targets each had an `alreadyExists` test. Mail,
 * the domain the product is mostly about, had none.
 */
describe('the server refuses a duplicate', () => {
  it('adopts the id the refusal names, instead of failing the item', async () => {
    const { refusals } = jmapServer([], {
      refuse: new Map([['<dup@dev.local>', 'E-SERVER-7']]),
    });
    const writer = new JmapTargetWriter(CONFIG as never);

    const result = await writer.upsertEmail('m1', message('dup') as never, []);

    // The fixture fired. Without this the whole block passes when the server
    // never refuses anything — see `refusalsIssued`.
    expect(refusals(), 'the fake server never issued the refusal').toBe(1);
    expect(result.created, 'we did not create it — the server refused').toBe(false);
    expect(result.adopted).toBe(true);
    expect(result.targetId).toBe('E-SERVER-7');
  });

  it('asks for the id when the refusal does not name one', async () => {
    // Stalwart supplies `existingId`; the spec does not require it. Without the
    // lookup this item fails on a server that is merely less chatty.
    const { refusals, methods } = jmapServer(['known'], {
      // On the server, but not in the snapshot: it arrived after the
      // enumeration, which is the whole reason the refusal exists.
      hiddenFromSnapshot: ['known'],
      refuse: new Map([['<known@dev.local>', null]]),
    });
    const writer = new JmapTargetWriter(CONFIG as never);

    const result = await writer.upsertEmail('m1', message('known') as never, []);

    expect(refusals(), 'the fake server never issued the refusal').toBe(1);
    expect(result.adopted).toBe(true);
    expect(result.targetId, 'the looked-up id, not an invented one').toBe('E0');
    // It really did go and ASK: a header-filtered query after the import.
    expect(methods.filter((m) => m === 'Email/query').length).toBeGreaterThan(1);
  });

  it('FAILS the item rather than inventing an id it cannot find', async () => {
    // The one outcome that must not happen. A fabricated targetId in the ledger
    // is worse than a failed item: the failure is visible in the queue and
    // retried, while a row pointing at nothing is counted as migrated and only
    // discovered when something tries to use it — which is how `targetId: "0"`
    // survived every mail migration until ADR-0024's removeItem met a real
    // Stalwart.
    const { refusals } = jmapServer([], {
      refuse: new Map([['<ghost@dev.local>', null]]),
    });
    const writer = new JmapTargetWriter(CONFIG as never);

    await expect(
      writer.upsertEmail('m1', message('ghost') as never, []),
    ).rejects.toThrow(/alreadyExists/);
    expect(refusals(), 'the fake server never issued the refusal').toBe(1);
  });

  it('refuses a created response that carries no server-assigned id', async () => {
    // RFC 8620 §5.3: the server assigns `.id`. One that answers `created`
    // without it has told us nothing to record, and recording `undefined` as a
    // message's target id is the same class of defect as recording "0".
    jmapServer([], { createdWithoutId: true });
    const writer = new JmapTargetWriter(CONFIG as never);

    await expect(
      writer.upsertEmail('m1', message('nid') as never, []),
    ).rejects.toThrow(/missing the server-assigned id/);
  });
});
