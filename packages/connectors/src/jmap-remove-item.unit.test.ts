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

/**
 * `Email/get` handler returning a DIFFERENT mailboxIds state on each successive
 * call — removeItem() now calls Email/get twice (once to read what to clear,
 * once to verify the move actually took effect), so a single fixed response
 * cannot represent "before" and "after" at once. Repeats the last state given
 * once the list is exhausted.
 */
function emailGetSequence(...states: Array<Record<string, boolean>>) {
  let call = 0;
  return () => {
    const state = states[Math.min(call, states.length - 1)]!;
    call += 1;
    return { accountId: 'a1', list: [{ id: 'whatever', mailboxIds: state }], notFound: [] };
  };
}

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
      // Before: only Inbox. After the move actually takes effect: only Trash.
      'Email/get': emailGetSequence({ 'mb-inbox': true }, { 'mb-trash': true }),
      'Email/set': (args) => ({
        accountId: 'a1',
        updated: args.update as Record<string, unknown>,
      }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    const result = await writer.removeItem('email-1');

    expect(result).toEqual({ kind: 'binned' });
    const setCall = calls.find((c) => c.method === 'Email/set');
    // Patched, not sent as one plain replacement value — see the comment on
    // removeItem() for why a whole-map assignment does not reliably work.
    expect(setCall?.args.update).toEqual({
      'email-1': { 'mailboxIds/mb-trash': true, 'mailboxIds/mb-inbox': null },
    });
    // Never a destroy when a trash mailbox exists.
    expect(calls.some((c) => c.method === 'Email/set' && 'destroy' in c.args)).toBe(false);
  });

  it('clears every OTHER mailbox the message currently sits in, not just one', async () => {
    // A message can be filed under more than one mailbox on plenty of servers.
    // Adding trash as one more membership would leave it still visible in
    // Inbox/Archive, and the target would go on showing an item the owner just
    // asked to have removed. Each membership is therefore cleared BY NAME
    // rather than swept away by one whole-map assignment — see removeItem()'s
    // comment for why the patch form is preferred on its own merits.
    const calls = mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-trash', name: 'Trash', role: 'trash' }],
      }),
      'Email/get': emailGetSequence({ 'mb-inbox': true, 'mb-archive': true }, { 'mb-trash': true }),
      'Email/set': (args) => ({ accountId: 'a1', updated: args.update as Record<string, unknown> }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await writer.removeItem('email-2');

    const setCall = calls.find((c) => c.method === 'Email/set')!;
    const patch = setCall.args.update as Record<string, Record<string, boolean | null>>;
    expect(patch['email-2']).toEqual({
      'mailboxIds/mb-trash': true,
      'mailboxIds/mb-inbox': null,
      'mailboxIds/mb-archive': null,
    });
  });

  it('finds trash by ROLE, not by name — a server may call it anything', async () => {
    const calls = mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-x', name: 'Papierkorb', role: 'trash' }],
      }),
      'Email/get': emailGetSequence({}, { 'mb-x': true }),
      'Email/set': (args) => ({ accountId: 'a1', updated: args.update as Record<string, unknown> }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    const result = await writer.removeItem('email-3');

    expect(result).toEqual({ kind: 'binned' });
    const setCall = calls.find((c) => c.method === 'Email/set')!;
    expect(setCall.args.update).toEqual({ 'email-3': { 'mailboxIds/mb-x': true } });
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
    // No trash mailbox — the destroy path never needs current mailboxIds.
    expect(calls.some((c) => c.method === 'Email/get')).toBe(false);
  });

  it('throws when the server reports the move as notUpdated, rather than claiming success', async () => {
    // Regression test: `Email/set` answers HTTP 200 either way (RFC 8620
    // §3.6.2) — a per-item failure comes back in `notUpdated`, not as a
    // transport error. The self-host e2e's Apply-Deletion Gate found this
    // against a real Stalwart: `apply` reported success and the ledger
    // tombstoned the row, but the message was still sitting in its original
    // mailbox — removeItem never looked at `notUpdated` at all.
    mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-trash', name: 'Trash', role: 'trash' }],
      }),
      'Email/get': emailGetSequence({ 'mb-inbox': true }),
      'Email/set': () => ({
        accountId: 'a1',
        notUpdated: { 'email-6': { type: 'invalidProperties', description: 'mailboxIds not settable' } },
      }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await expect(writer.removeItem('email-6')).rejects.toThrow(/invalidProperties/);
  });

  it('throws when the server reports the destroy as notDestroyed, rather than claiming success', async () => {
    mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-inbox', name: 'Inbox', role: 'inbox' }],
      }),
      'Email/set': () => ({
        accountId: 'a1',
        notDestroyed: { 'email-7': { type: 'notFound' } },
      }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await expect(writer.removeItem('email-7')).rejects.toThrow(/notFound/);
  });

  it('throws when Email/set claims success but the message is still in its old mailbox', async () => {
    // `apply` is the one operation in this product that destroys something, and
    // the ledger tombstones the row on its say-so — so "the server said it
    // worked" is not a good enough basis for that write. Several e2e runs did
    // report success while the message stayed put (the cause turned out to be
    // the `"0"` created-id bug in `upsertEmail`, not the server), and this
    // read-back is what turned that from a silent false success into a
    // diagnosis. Kept as a standing guard, not just as a regression test.
    mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-trash', name: 'Trash', role: 'trash' }],
      }),
      // The server reports success, but the read-back shows Inbox untouched.
      'Email/get': emailGetSequence({ 'mb-inbox': true }, { 'mb-inbox': true, 'mb-trash': true }),
      'Email/set': (args) => ({ accountId: 'a1', updated: args.update as Record<string, unknown> }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await expect(writer.removeItem('email-8')).rejects.toThrow(/did not actually take effect/);
  });

  it('reads a cleared mailbox as cleared, however the server spells it', async () => {
    // Found by mutation on 2026-08-07, the only survivor of seven against
    // removeItem: dropping the truthiness filter from the read-back.
    //
    // RFC 8621 §4.1 makes `mailboxIds` a set — `{id: true}` — and a
    // conforming server simply omits what was removed. Not every server does;
    // some echo the cleared key with `false`. Read literally, that message is
    // in two mailboxes and this throws, failing a move that in fact
    // succeeded.
    //
    // The direction is worth saying plainly rather than overstating the find:
    // WITHOUT the filter this code is over-strict, not permissive, so the
    // failure it causes is a correct deletion reported as broken. That is the
    // safe direction for the one operation in this product that destroys
    // something — but it is still a false alarm on an operator's apply queue,
    // and it depends on a detail of somebody else's server.
    const calls = mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [
          { id: 'mb-inbox', name: 'Inbox', role: 'inbox' },
          { id: 'mb-trash', name: 'Trash', role: 'trash' },
        ],
      }),
      'Email/get': emailGetSequence(
        { 'mb-inbox': true },
        // The move worked. The server just still names the mailbox it emptied.
        { 'mb-trash': true, 'mb-inbox': false },
      ),
      'Email/set': (args) => ({ accountId: 'a1', updated: args.update as Record<string, unknown> }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await expect(writer.removeItem('email-9')).resolves.toEqual({ kind: 'binned' });
    // And it really did go through the bin path, so this is not passing
    // because the fixture quietly took the destroy branch instead.
    expect(calls.some((c) => c.method === 'Email/set' && 'destroy' in c.args)).toBe(false);
  });

  it('still refuses when the message is genuinely left in another mailbox', async () => {
    // The other half, without which the test above is satisfied by removing
    // the read-back altogether — `false` and `true` must be told apart, not
    // both ignored.
    mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [
          { id: 'mb-inbox', name: 'Inbox', role: 'inbox' },
          { id: 'mb-trash', name: 'Trash', role: 'trash' },
        ],
      }),
      'Email/get': emailGetSequence({ 'mb-inbox': true }, { 'mb-trash': true, 'mb-inbox': true }),
      'Email/set': (args) => ({ accountId: 'a1', updated: args.update as Record<string, unknown> }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await expect(writer.removeItem('email-10')).rejects.toThrow(/did not actually take effect/);
  });

  it('asks Mailbox/get for every mailbox (ids: null) rather than filtering by name', async () => {
    // A `Mailbox/query` filter on `role` is not universally supported, and
    // filtering by name would depend on the server's language. Requesting
    // everything and checking `role` client-side is the reliable path.
    const calls = mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: [{ id: 'mb-trash', role: 'trash' }] }),
      'Email/get': emailGetSequence({}, { 'mb-trash': true }),
      'Email/set': (args) => ({ accountId: 'a1', updated: args.update as Record<string, unknown> }),
    });

    const writer = new JmapTargetWriter(CONFIG as never);
    await writer.removeItem('email-5');

    const mailboxGet = calls.find((c) => c.method === 'Mailbox/get')!;
    expect(mailboxGet.args.ids).toBeNull();
  });
});
