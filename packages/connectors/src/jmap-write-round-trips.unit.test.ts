// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
import { JmapTargetWriter } from './jmap-target';

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
function jmapServer(existing: string[], opts: { enumerable?: boolean } = {}) {
  const enumerable = opts.enumerable ?? true;
  const methods: string[] = [];
  // Message-ID -> email id
  const present = new Map(existing.map((id, i) => [`<${id}@dev.local>`, `E${i}`]));
  let nextId = 1000;

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
      if (u.includes('/upload/')) return ok({ blobId: `B${nextId++}` });

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
        const ids = [...present.values()].slice(position, position + 100);
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
        return ok({ methodResponses: [['Email/import', { created: { '0': { id, blobId: 'b' } } }, 'c1']] });
      }

      return ok({ methodResponses: [[method, {}, 'c1']] });
    }),
  );

  return { methods, present };
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
