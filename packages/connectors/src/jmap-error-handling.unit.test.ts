// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// A JMAP method-level error must not be mistaken for a result.
//
// JMAP returns method errors INSIDE a 200 response, as
// ["error", {type, description}, callId] in methodResponses (RFC 8620 §3.6.2).
// `apiRequest` returned `methodResponses[0][1]` unconditionally, so that error
// object was handed back as if it were the method's result. For `listEntries`
// that meant `response.ids` was undefined, the paging loop broke on its first
// iteration, and the reindexer yielded NOTHING.
//
// An empty listing is the single most dangerous wrong answer this code can
// give: verification reads it as "the target holds none of it" and reports a
// complete migration as total data loss.
//
// The trigger was real. Email/query was being sent a `properties` argument,
// which RFC 8621 §4.4 does not define for that method (it belongs to
// Email/get), and RFC 8620 §3.2 says a server MUST answer an unknown argument
// with `invalidArguments`.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { JmapTargetWriter } from './jmap-target.ts';

const CONFIG = {
  baseUrl: 'https://mail.example.com',
  username: 'target@example.com',
  password: 'pw',
};

/** A session response good enough for connect() to resolve an account. */
const SESSION = {
  accounts: { a1: { name: 'target@example.com' } },
  primaryAccounts: { 'urn:ietf:params:jmap:mail': 'a1' },
  apiUrl: 'https://mail.example.com/jmap',
};

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const body = handler(String(url), init);
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Map(),
      } as unknown as Response;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('JMAP method-level errors', () => {
  it('throws instead of yielding an empty listing when the server rejects the call', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known/jmap')) return SESSION;
      // What a spec-following server answers for an unknown argument.
      return {
        methodResponses: [
          ['error', { type: 'invalidArguments', description: 'unknown argument: properties' }, 'c1'],
        ],
      };
    });

    const writer = new JmapTargetWriter(CONFIG as never);

    // The load-bearing assertion. Before this fix the iterator completed
    // normally with zero entries, and verification called that data loss.
    const collect = async () => {
      const out = [];
      for await (const e of writer.listEntries()) out.push(e);
      return out;
    };
    await expect(collect()).rejects.toThrow(/invalidArguments/);
  });

  it('names the method and the description, so the failure is actionable', async () => {
    mockFetch((url) => {
      if (url.includes('.well-known/jmap')) return SESSION;
      return {
        methodResponses: [['error', { type: 'serverFail', description: 'backend down' }, 'c1']],
      };
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    const collect = async () => {
      for await (const _e of writer.listEntries()) { /* drain */ }
    };
    await expect(collect()).rejects.toThrow(/Email\/query failed: serverFail - backend down/);
  });

  it('does not send Email/query an argument RFC 8621 does not define', async () => {
    const bodies: string[] = [];
    mockFetch((url, init) => {
      if (url.includes('.well-known/jmap')) return SESSION;
      if (init?.body) bodies.push(String(init.body));
      return { methodResponses: [['Email/query', { ids: [], total: 0 }, 'c1']] };
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    for await (const _e of writer.listEntries()) { /* drain */ }

    const query = bodies.find((b) => b.includes('Email/query'));
    expect(query, 'no Email/query was issued').toBeTruthy();
    // `properties` belongs to Email/get; sending it here is what drew the
    // invalidArguments that then went undetected.
    const parsed = JSON.parse(query!) as { methodCalls: Array<[string, Record<string, unknown>, string]> };
    expect(parsed.methodCalls[0]![1]).not.toHaveProperty('properties');
  });
});
