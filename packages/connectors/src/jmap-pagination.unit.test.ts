// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `listEntries` must enumerate the WHOLE mailbox, not the first page.
 *
 * It used to stop after 100 items on every target. The loop broke on
 * `totalFetched >= total`, where `total` came from the `Email/query` response —
 * but RFC 8621 §4.4 only computes `total` when `calculateTotal: true` is
 * requested, and it defaults to false. We never asked, so `total` was absent,
 * `?? 0` made it 0, and `totalFetched >= 0` was true the moment the first page
 * had been read.
 *
 * Nothing caught it because every earlier run seeded fewer than 100 messages.
 * At 150 the §20 gate reported `sourceCount: 150, targetCount: 100,
 * missingOnTarget: 50` — fifty perfectly healthy messages called data loss, and
 * a complete migration blocked from cutover. Any real mailbox is bigger than
 * one page, so this made the gate unusable outside the fixtures.
 *
 * These drive the paging boundaries directly, because that is where the
 * off-by-a-page lives.
 */

import { describe, it, expect } from 'vitest';
import { JmapTargetWriter } from './jmap-target.ts';

const PAGE = 100;

/**
 * A JMAP server holding `count` messages, answering Email/query with real
 * paging and Email/get with matching metadata.
 *
 * `total` is deliberately OMITTED from every Email/query response — which is
 * exactly what a spec-following server does when `calculateTotal` was not
 * requested, and what made the old loop stop after one page.
 */
function serverWith(count: number): { writer: JmapTargetWriter; queries: number[] } {
  const ids = Array.from({ length: count }, (_, i) => `id-${i}`);
  const queries: number[] = [];

  const fetchImpl = async (url: string | URL, init?: { body?: unknown }) => {
    const urlText = String(url);

    if (urlText.endsWith('/.well-known/jmap')) {
      return jsonResponse({
        accounts: { acct: { id: 'acct', email: 'target@example.net', name: 'target' } },
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'acct' },
        apiUrl: 'https://mail.example.net/jmap',
      });
    }

    const request = JSON.parse(String(init?.body ?? '{}')) as {
      methodCalls: Array<[string, Record<string, unknown>, string]>;
    };
    const [method, args] = request.methodCalls[0]!;

    if (method === 'Email/query') {
      const position = Number(args.position ?? 0);
      const limit = Number(args.limit ?? PAGE);
      queries.push(position);
      // No `total` — see the note above.
      return jsonResponse({
        methodResponses: [['Email/query', { ids: ids.slice(position, position + limit) }, 'c0']],
      });
    }

    if (method === 'Email/get') {
      const wanted = args.ids as string[];
      return jsonResponse({
        methodResponses: [
          [
            'Email/get',
            {
              list: wanted.map((id) => ({
                id,
                mailboxIds: { mbox: true },
                headers: [{ name: 'Message-ID', value: `<${id}@example.net>` }],
                size: 10,
              })),
            },
            'c0',
          ],
        ],
      });
    }

    throw new Error(`unexpected JMAP method ${method}`);
  };

  globalThis.fetch = fetchImpl as unknown as typeof fetch;

  const writer = new JmapTargetWriter({
    baseUrl: 'https://mail.example.net',
    username: 'target@example.net',
    password: 'pw',
  });
  return { writer, queries };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Map(),
  };
}

async function collect(writer: JmapTargetWriter): Promise<string[]> {
  const keys: string[] = [];
  for await (const entry of writer.listEntries()) keys.push(entry.naturalKey);
  return keys;
}

describe('JmapTargetWriter.listEntries pagination', () => {
  it('enumerates past the first page — the case that reported 50 messages missing', async () => {
    const { writer, queries } = serverWith(150);

    const keys = await collect(writer);

    expect(keys).toHaveLength(150);
    // Two pages: offset 0, then offset 100.
    expect(queries).toEqual([0, 100]);
  });

  it('handles a mailbox that is an exact multiple of the page size', async () => {
    // The boundary a "short page means the end" rule has to get right: page 2
    // comes back full, so it must ask again and get nothing.
    const { writer, queries } = serverWith(200);

    const keys = await collect(writer);

    expect(keys).toHaveLength(200);
    expect(queries).toEqual([0, 100, 200]);
  });

  it('stops after one query when the mailbox is smaller than a page', async () => {
    const { writer, queries } = serverWith(7);

    expect(await collect(writer)).toHaveLength(7);
    expect(queries).toEqual([0]);
  });

  it('yields nothing, and asks once, for an empty mailbox', async () => {
    const { writer, queries } = serverWith(0);

    expect(await collect(writer)).toEqual([]);
    expect(queries).toEqual([0]);
  });

  it('walks several pages without repeating or dropping an item', async () => {
    const { writer } = serverWith(437);

    const keys = await collect(writer);

    expect(keys).toHaveLength(437);
    expect(new Set(keys).size, 'a repeated page would inflate the target count').toBe(437);
  });
});
