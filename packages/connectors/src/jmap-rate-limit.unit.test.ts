// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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

  it('honours Retry-After when the server says how long to wait', async () => {
    const delays = captureDelays();
    scriptFetch([
      { status: 429, headers: { 'retry-after': '7' }, body: {} },
      { status: 200, body: OK_QUERY },
    ]);

    const writer = new JmapTargetWriter(CONFIG as never);
    for await (const _e of writer.listEntries()) { /* drain */ }

    // Exactly what the server asked for — not a guess, and not zero.
    expect(delays).toContain(7000);
  });

  it('backs off further each time, with jitter, when no Retry-After is sent', async () => {
    const delays = captureDelays();
    // Never recovers: drives the loop to its cap.
    const { calls } = scriptFetch([{ status: 429, body: {} }]);

    const writer = new JmapTargetWriter(CONFIG as never);
    const drain = async () => {
      for await (const _e of writer.listEntries()) { /* drain */ }
    };
    // Giving up is correct — a target refusing five times running is not
    // merely busy, and the operator needs to hear about it (hard rule 9).
    await expect(drain()).rejects.toThrow(/429/);

    // 5 attempts, so 4 waits, each roughly double the last.
    expect(calls).toHaveLength(5);
    expect(delays).toHaveLength(4);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
    // Jitter, so concurrent workers do not all resume in the same millisecond
    // and throttle the target again.
    expect(delays.some((d) => !Number.isInteger(d / 1000))).toBe(true);
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
