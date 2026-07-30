// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * JMAP's `removeItem` — the mail domain's half of the one destructive operation
 * in this product, reached only through an explicit owner decision in
 * `applyDeletion` (@openmig/core).
 *
 * The one thing worth getting wrong here is the ORDER: move to the account's
 * trash mailbox where one exists (recoverable — `binned`), destroy outright only
 * when there is none (`deleted`). Getting that backwards would either silently
 * make every mail removal irreversible, or silently do nothing wherever the
 * account happens to have no trash role — both wrong in the direction that
 * costs someone their data.
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

interface MethodCall {
  method: string;
  args: Record<string, unknown>;
}

/**
 * Routes each single-method JMAP request to a handler keyed by method name, and
 * records every call so a test can assert not just the RESULT but which methods
 * were actually invoked, and with what arguments — the distinction between
 * "moved to trash" and "destroyed outright" is exactly which method got called.
 */
function mockJmap(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: MethodCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const respond = (body: unknown) => ({
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
        headers: new Map(),
      } as unknown as Response);

      if (String(url).includes('.well-known/jmap')) return respond(SESSION);

      const parsed = JSON.parse(String(init?.body ?? '{}')) as {
        methodCalls: Array<[string, Record<string, unknown>, string]>;
      };
      const [method, args] = parsed.methodCalls[0]!;
      calls.push({ method, args });

      const handler = handlers[method];
      if (!handler) throw new Error(`unmocked JMAP method: ${method}`);
      return respond({ methodResponses: [[method, handler(args), 'c1']] });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('JmapTargetWriter.removeItem', () => {
  it('moves the message to the trash mailbox when the account has one', async () => {
    const calls = mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [
          { id: 'mb-inbox', name: 'Inbox', role: 'inbox' },
          { id: 'mb-trash', name: 'Deleted Items', role: 'trash' },
        ],
      }),
      'Email/set': (args) => ({
        accountId: 'a1',
        updated: args.update as Record<string, unknown>,
      }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    const result = await writer.removeItem('email-1');

    expect(result).toEqual({ kind: 'binned' });
    const setCall = calls.find((c) => c.method === 'Email/set');
    expect(setCall?.args.update).toEqual({ 'email-1': { mailboxIds: { 'mb-trash': true } } });
    // Never a destroy when a trash mailbox exists.
    expect(calls.some((c) => c.method === 'Email/set' && 'destroy' in c.args)).toBe(false);
  });

  it('REPLACES mailboxIds rather than adding to them', async () => {
    // A message can be filed under more than one mailbox on plenty of servers.
    // Adding trash as one more membership would leave it still visible in
    // Inbox/Archive, and the target would go on showing an item the owner just
    // asked to have removed.
    const calls = mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-trash', name: 'Trash', role: 'trash' }],
      }),
      'Email/set': (args) => ({ accountId: 'a1', updated: args.update as Record<string, unknown> }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await writer.removeItem('email-2');

    const setCall = calls.find((c) => c.method === 'Email/set')!;
    const update = setCall.args.update as Record<string, { mailboxIds: Record<string, boolean> }>;
    // Exactly one mailbox in the replacement set, and it is trash.
    expect(Object.keys(update['email-2']!.mailboxIds)).toEqual(['mb-trash']);
  });

  it('finds trash by ROLE, not by name — a server may call it anything', async () => {
    const calls = mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-x', name: 'Papierkorb', role: 'trash' }],
      }),
      'Email/set': (args) => ({ accountId: 'a1', updated: args.update as Record<string, unknown> }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    const result = await writer.removeItem('email-3');

    expect(result).toEqual({ kind: 'binned' });
    const setCall = calls.find((c) => c.method === 'Email/set')!;
    expect(setCall.args.update).toEqual({ 'email-3': { mailboxIds: { 'mb-x': true } } });
  });

  it('destroys the message outright when there is no trash-role mailbox', async () => {
    const calls = mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-inbox', name: 'Inbox', role: 'inbox' }],
      }),
      'Email/set': (args) => ({ accountId: 'a1', destroyed: args.destroy as string[] }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    const result = await writer.removeItem('email-4');

    expect(result).toEqual({ kind: 'deleted' });
    const setCall = calls.find((c) => c.method === 'Email/set')!;
    expect(setCall.args.destroy).toEqual(['email-4']);
    expect('update' in setCall.args).toBe(false);
  });

  it('asks Mailbox/get for every mailbox (ids: null) rather than filtering by name', async () => {
    // A `Mailbox/query` filter on `role` is not universally supported, and
    // filtering by name would depend on the server's language. Requesting
    // everything and checking `role` client-side is the reliable path.
    const calls = mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: [{ id: 'mb-trash', role: 'trash' }] }),
      'Email/set': (args) => ({ accountId: 'a1', updated: args.update as Record<string, unknown> }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await writer.removeItem('email-5');

    const mailboxGet = calls.find((c) => c.method === 'Mailbox/get')!;
    expect(mailboxGet.args.ids).toBeNull();
  });
});
