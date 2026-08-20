// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// A target saying "too many requests" must cost seconds, not items.
//
// Every JMAP call went straight to `fetch` with no throttle handling, while
// the DAV writers had had `requestWithRetry` for a while. A ~500-message run
// found the hole: Stalwart answered 429 to blob uploads and to the
// `Email/query` existence lookup, and eight messages FAILED. Not silently —
// loudly, and correctly, because a failed existence lookup is not allowed to
// be read as "not present" (that appends a duplicate; hard rule 1). But the
// right thing to do with a 429 is wait, and nothing was waiting.
//
// These tests count requests and assert the waits, so a regression that drops
// the retry shows up here rather than as failed items in a migration window.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { JmapTargetWriter } from './jmap-target.ts';
import { loadJmapSession } from './jmap-session.ts';
import { RATE_LIMIT_MAX_WAIT_MS, RATE_LIMIT_TOTAL_BUDGET_MS } from './http-rate-limit.ts';

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

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Serve a scripted sequence of replies to the JMAP endpoint.
 *
 * Waits are made instant by stubbing the timer rather than by faking clocks:
 * the point of the test is how long the code ASKS to wait, which the recorded
 * delays capture exactly.
 */
function scriptFetch(replies: Reply[]) {
  const calls: string[] = [];
  let next = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('.well-known/jmap')) {
        return {
          ok: true,
          status: 200,
          json: async () => SESSION,
          text: async () => JSON.stringify(SESSION),
          headers: new Map(),
        } as unknown as Response;
      }
      calls.push(u);
      const reply = replies[Math.min(next++, replies.length - 1)]!;
      const status = reply.status ?? 200;
      const body = reply.body ?? {};
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
        headers: new Map(Object.entries(reply.headers ?? {})),
      } as unknown as Response;
    }),
  );

  return { calls };
}

/** Record every requested wait and return immediately. */
function captureDelays(): number[] {
  const delays: number[] = [];
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
    delays.push(ms ?? 0);
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as never);
  return delays;
}

const OK_QUERY = { methodResponses: [['Email/query', { ids: [], total: 0 }, 'c1']] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('JMAP rate limiting', () => {
  it('waits and retries instead of failing the item', async () => {
    const delays = captureDelays();
    const { calls } = scriptFetch([
      { status: 429, body: { type: 'about:blank', status: 429, title: 'Too Many Requests' } },
      { status: 200, body: OK_QUERY },
    ]);

    const writer = new JmapTargetWriter(CONFIG as never);
    // Completing at all is the assertion: before this it threw on the 429.
    for await (const _e of writer.listEntries()) { /* drain */ }

    expect(calls).toHaveLength(2);
    expect(delays.length).toBeGreaterThan(0);
  });

  it('honours a Retry-After it can satisfy inside the cap', async () => {
    const delays = captureDelays();
    scriptFetch([
      { status: 429, headers: { 'retry-after': '3' }, body: {} },
      { status: 200, body: OK_QUERY },
    ]);

    const writer = new JmapTargetWriter(CONFIG as never);
    for await (const _e of writer.listEntries()) { /* drain */ }

    // Exactly what the server asked for — not a guess, and not zero.
    expect(delays).toContain(3000);
  });

  it('caps a long Retry-After and probes sooner instead of sleeping through it', async () => {
    // THE REAL ONE, 2026-08-09. Stalwart answered a blob upload with
    // `Retry-After: 40` while its own body said "please try again in a few
    // seconds", and the old code slept the full forty. Twice, from concurrent
    // uploads. The prose was the accurate half: the pass resumed fine.
    //
    // Retry-After is advisory (RFC 9110 §10.2.3 — how long the service EXPECTS
    // to be unavailable), so capping it is allowed. The trade is explicit: one
    // extra request per probe against up to 35 seconds of migration window
    // spent asleep after the server was already ready.
    const delays = captureDelays();
    scriptFetch([
      { status: 429, headers: { 'retry-after': '40' }, body: {} },
      { status: 200, body: OK_QUERY },
    ]);

    const writer = new JmapTargetWriter(CONFIG as never);
    for await (const _e of writer.listEntries()) { /* drain */ }

    expect(delays).toContain(RATE_LIMIT_MAX_WAIT_MS);
    expect(delays, 'slept the full 40s the server asked for').not.toContain(40_000);
  });

  it('does NOT probe a server whose ask is longer than the budget', async () => {
    // The half of the cap reasoning that was WRONG, corrected on the same
    // machine an hour later. Stalwart puts two different mechanisms behind 429:
    //
    //   {"title":"Too Many Requests","detail":"…try again in a few seconds."}
    //   {"title":"Quota exceeded","detail":"…quota of 1000 files or 50000000 bytes."}
    //
    // The first's Retry-After really is over-cautious. The second's is a QUOTA
    // window counting down accurately — 441s, then 436, then 431 — and probing
    // it every five seconds produced twenty-four guaranteed-failing requests
    // and burned the entire budget per item before failing anyway.
    //
    // Magnitude tells them apart: nothing that asks for longer than we can wait
    // can possibly recover inside the budget, so the only useful move is to
    // stop and let the next scheduled pass have it.
    const delays = captureDelays();
    const { calls } = scriptFetch([{ status: 429, headers: { 'retry-after': '441' }, body: {} }]);

    const writer = new JmapTargetWriter(CONFIG as never);
    const drain = async () => {
      for await (const _e of writer.listEntries()) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow(/429/);

    // One request, no waiting at all — not twenty-five and two minutes.
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('backs off further each time, with jitter, when no Retry-After is sent', async () => {
    const delays = captureDelays();
    // Never recovers: drives the loop until the budget is spent.
    scriptFetch([{ status: 429, body: {} }]);

    const writer = new JmapTargetWriter(CONFIG as never);
    const drain = async () => {
      for await (const _e of writer.listEntries()) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow(/429/);

    // Rising, until it flattens out at the cap.
    const rising = delays.slice(0, 4);
    for (let i = 1; i < rising.length; i++) {
      expect(rising[i]!).toBeGreaterThan(rising[i - 1]!);
    }
    expect(Math.max(...delays)).toBe(RATE_LIMIT_MAX_WAIT_MS);
    // Jitter, so concurrent workers do not all resume in the same millisecond
    // and throttle the target again.
    expect(delays.some((d) => !Number.isInteger(d / 100))).toBe(true);
  });

  it('gives up on a budget, not on an attempt count, and reports the 429', async () => {
    // The old rule was "five attempts", which meant total patience swung
    // between 15 seconds (exponential backoff, no header) and 160 (Stalwart's
    // 40s header) with nothing deliberately choosing either. What an operator
    // cares about is how long ONE request may stall a pass, so that is what is
    // configured — and when it is spent the 429 is reported rather than
    // swallowed, so the item lands in the failure queue for the next pass
    // (hard rule 9).
    const delays = captureDelays();
    scriptFetch([{ status: 429, body: {} }]);

    const writer = new JmapTargetWriter(CONFIG as never);
    const drain = async () => {
      for await (const _e of writer.listEntries()) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow(/429/);

    const total = delays.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(RATE_LIMIT_TOTAL_BUDGET_MS);
    // And it really did use the budget rather than stopping after a handful of
    // tries — the mutation this kills is "cap the wait but keep 5 attempts",
    // which would wait at most ~25s and give up while the server was recovering.
    //
    // It has already earned its keep once: when the "believe a long ask" exit
    // above was first written it keyed on the wait NUMBER rather than on
    // whether a header sent it, so the no-header backoff — which doubles, and
    // so "asks" for 128s by attempt 9 — tripped it and abandoned the request
    // after 28s of the 120s budget. This assertion is what noticed.
    expect(total).toBeGreaterThan(RATE_LIMIT_TOTAL_BUDGET_MS * 0.9);
  });

  it('retries a 503 too — a target restarting should not cost items', async () => {
    captureDelays();
    const { calls } = scriptFetch([{ status: 503, body: {} }, { status: 200, body: OK_QUERY }]);

    const writer = new JmapTargetWriter(CONFIG as never);
    for await (const _e of writer.listEntries()) { /* drain */ }

    expect(calls).toHaveLength(2);
  });

  it('does not retry a status that will never change', async () => {
    const delays = captureDelays();
    const { calls } = scriptFetch([{ status: 401, body: { type: 'unauthorized' } }]);

    const writer = new JmapTargetWriter(CONFIG as never);
    const drain = async () => {
      for await (const _e of writer.listEntries()) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow(/401/);

    // Retrying bad credentials just delays the error by a minute.
    expect(calls).toHaveLength(1);
    expect(delays).toHaveLength(0);
  });

  it('waits out a throttled SESSION load, which discovery gave up on', async () => {
    // 2026-08-09, on a target that was merely busy:
    //
    //   [discovery] could not enumerate the email destination: The JMAP session
    //   request to http://.../.well-known/jmap returned HTTP 429
    //
    // Uploads rode the throttling out; discovery hit the same server one layer
    // up and failed on the first refusal, because `loadJmapSession` called
    // `fetch` directly. Every JMAP client here begins with this document, so
    // one unretried GET made the whole connector fragile to a condition the
    // rest of it already handled.
    captureDelays();
    const calls: string[] = [];
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        const throttled = n++ === 0;
        return {
          ok: !throttled,
          status: throttled ? 429 : 200,
          json: async () => SESSION,
          text: async () => JSON.stringify(SESSION),
          headers: new Map(throttled ? [['retry-after', '40']] : []),
        } as unknown as Response;
      }),
    );

    const session = await loadJmapSession('https://mail.example.com/.well-known/jmap', 'Basic x');

    expect(calls).toHaveLength(2);
    expect(session.primaryAccounts).toEqual(SESSION.primaryAccounts);
  });

  it('reports the status when the error body is not JSON', async () => {
    // A proxy or load balancer in front of the target answers with HTML.
    // `response.json()` threw a parse error here, and the parse error is what
    // the operator saw — the real failure replaced by a misleading one.
    scriptFetch([{ status: 502, body: '<html><body>Bad Gateway</body></html>' }]);

    const writer = new JmapTargetWriter(CONFIG as never);
    const drain = async () => {
      for await (const _e of writer.listEntries()) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow(/HTTP 502/);
  });
});
