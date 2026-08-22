// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * JMAP's `ensureMailbox` — where a source folder becomes a target mailbox.
 *
 * The live failure this file exists for, verbatim, Soverin -> Stalwart:
 *
 *   Failed to create mailbox: {"0":{"type":"invalidProperties","description":
 *   "A mailbox with role 'sent' already exists.","properties":["role"]}}
 *
 * Two messages had copied; the throw took the whole email domain with it and
 * the run reported `email sync failed`. The account HAD a sent mailbox — under
 * a different name — and the writer looked it up by name, so it could not
 * possibly have found it. A role is unique per account (RFC 8621 §2); a name
 * is the server's word for it, and sometimes localised.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MailFolder } from '@openmig/shared';
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

interface MethodCall {
  method: string;
  args: Record<string, unknown>;
}

/** Same shape as `jmap-remove-item.unit.test.ts`: one handler per method, every call recorded. */
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

const folder = (over: Partial<MailFolder> & Pick<MailFolder, 'path'>): MailFolder => ({
  name: over.path,
  specialUse: 'normal',
  ...over,
});

/** The mailboxes Stalwart ships an account with, near enough. */
const STALWART_DEFAULTS = [
  { id: 'mb-inbox', name: 'Inbox', role: 'inbox' },
  { id: 'mb-sent', name: 'Sent Items', role: 'sent' },
  { id: 'mb-drafts', name: 'Drafts', role: 'drafts' },
  { id: 'mb-trash', name: 'Deleted Items', role: 'trash' },
  { id: 'mb-junk', name: 'Junk Mail', role: 'junk' },
];

describe('JmapTargetWriter.ensureMailbox', () => {
  it("adopts the account's sent mailbox for a source 'Sent' rather than creating a second one", async () => {
    const calls = mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: STALWART_DEFAULTS }),
      // Reaching Mailbox/set at all is the bug: this is what Stalwart answered.
      'Mailbox/set': () => ({
        accountId: 'a1',
        notCreated: {
          '0': {
            type: 'invalidProperties',
            description: "A mailbox with role 'sent' already exists.",
            properties: ['role'],
          },
        },
      }),
    });

    const writer = new JmapTargetWriter(CONFIG);
    const id = await writer.ensureMailbox(folder({ path: 'Sent', specialUse: 'sent' }));

    expect(id).toBe('mb-sent');
    expect(calls.some((c) => c.method === 'Mailbox/set')).toBe(false);
  });

  it('reads every mailbox (ids: null) instead of filtering by name', async () => {
    // The name filter is a CONTAINS match over a name the server chooses: it
    // answers "Sent Items" for "Sent" and nothing at all for "Verzonden items".
    const calls = mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: STALWART_DEFAULTS }),
    });

    const writer = new JmapTargetWriter(CONFIG);
    await writer.ensureMailbox(folder({ path: 'Sent', specialUse: 'sent' }));

    expect(calls.map((c) => c.method)).toEqual(['Mailbox/get']);
    expect(calls[0]!.args.ids).toBeNull();
  });

  it('adopts a localised role mailbox no name lookup could have found', async () => {
    mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [
          { id: 'mb-inbox', name: 'Postvak IN', role: 'inbox' },
          { id: 'mb-sent', name: 'Verzonden items', role: 'sent' },
        ],
      }),
      'Mailbox/set': () => {
        throw new Error('must not create — the account already has a sent mailbox');
      },
    });

    const writer = new JmapTargetWriter(CONFIG);
    expect(await writer.ensureMailbox(folder({ path: 'Sent', specialUse: 'sent' }))).toBe('mb-sent');
  });

  it("adopts a role mailbox by NAME when the source advertised no SPECIAL-USE", async () => {
    // `ImapFlowSource` reports specialUse from the server's LIST attributes
    // only, so a server that advertises none gives 'normal' for its own "Sent".
    mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-sent', name: 'Sent', role: 'sent' }],
      }),
      'Mailbox/set': () => {
        throw new Error('must not create — "Sent" is right there');
      },
    });

    const writer = new JmapTargetWriter(CONFIG);
    expect(await writer.ensureMailbox(folder({ path: 'Sent', specialUse: 'normal' }))).toBe('mb-sent');
  });

  it("returns the SERVER's id for a mailbox it created, not the creation id", async () => {
    // `created` is keyed by the creation id we sent ("0"); the id inside it is
    // the server's. Reading the key returned the string "0" for every mailbox
    // this writer ever made, and that string is what `upsertEmail` then puts in
    // `mailboxIds` — mail addressed to a mailbox that does not exist.
    mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: [] }),
      'Mailbox/set': () => ({ accountId: 'a1', created: { '0': { id: 'c4f1' } } }),
    });

    const writer = new JmapTargetWriter(CONFIG);
    expect(await writer.ensureMailbox(folder({ path: 'Projects' }))).toBe('c4f1');
  });

  it('refuses to adopt a mailbox holding a DIFFERENT role, however it is named', async () => {
    // A source "Archive" must not land in the account's Sent because somebody
    // renamed it. No archive role exists, so this one is genuinely created.
    const calls = mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [{ id: 'mb-sent', name: 'Archive', role: 'sent' }],
      }),
      'Mailbox/set': () => ({ accountId: 'a1', created: { '0': { id: 'mb-new' } } }),
    });

    const writer = new JmapTargetWriter(CONFIG);
    expect(await writer.ensureMailbox(folder({ path: 'Archive', specialUse: 'archive' }))).toBe('mb-new');
    expect(calls.find((c) => c.method === 'Mailbox/set')!.args).toMatchObject({
      create: { '0': { name: 'Archive', role: 'archive' } },
    });
  });

  it('creates an ordinary folder, and does not re-read the account for the next one', async () => {
    let gets = 0;
    const calls = mockJmap({
      'Mailbox/get': () => {
        gets += 1;
        return { accountId: 'a1', list: STALWART_DEFAULTS };
      },
      'Mailbox/set': (args) => {
        const name = (args.create as { '0': { name: string } })['0'].name;
        return { accountId: 'a1', created: { '0': { id: `mb-${name.toLowerCase()}` } } };
      },
    });

    const writer = new JmapTargetWriter(CONFIG);
    expect(await writer.ensureMailbox(folder({ path: 'Projects' }))).toBe('mb-projects');
    // The second call sees the mailbox the first one made, from the cache.
    expect(await writer.ensureMailbox(folder({ path: 'Projects' }))).toBe('mb-projects');
    expect(gets).toBe(1);
    expect(calls.filter((c) => c.method === 'Mailbox/set')).toHaveLength(1);
  });

  it('re-reads and adopts when the role collision only shows up at create time', async () => {
    // The cache is a pass old, or another client created it underneath us.
    let gets = 0;
    mockJmap({
      'Mailbox/get': () => {
        gets += 1;
        return gets === 1
          ? { accountId: 'a1', list: [{ id: 'mb-inbox', name: 'Inbox', role: 'inbox' }] }
          : { accountId: 'a1', list: STALWART_DEFAULTS };
      },
      'Mailbox/set': () => ({
        accountId: 'a1',
        notCreated: {
          '0': {
            type: 'invalidProperties',
            description: "A mailbox with role 'sent' already exists.",
            properties: ['role'],
          },
        },
      }),
    });

    const writer = new JmapTargetWriter(CONFIG);
    expect(await writer.ensureMailbox(folder({ path: 'Sent', specialUse: 'sent' }))).toBe('mb-sent');
    expect(gets).toBe(2);
  });

  it("takes the server's existingId on a name collision, and never a word out of its prose", async () => {
    // `alreadyExists` carrying an explicit `existingId` is answered from that.
    // Without one, the recovery is a fresh read — not the regex that used to
    // stand here, which pulled the first quoted word out of the description
    // and would have returned the mailbox's NAME as its id.
    let gets = 0;
    mockJmap({
      'Mailbox/get': () => {
        gets += 1;
        return gets === 1
          ? { accountId: 'a1', list: [] }
          : { accountId: 'a1', list: [{ id: 'mb-real', name: 'Projects' }] };
      },
      'Mailbox/set': () => ({
        accountId: 'a1',
        notCreated: {
          '0': { type: 'alreadyExists', description: "Mailbox 'Projects' already exists." },
        },
      }),
    });

    const writer = new JmapTargetWriter(CONFIG);
    expect(await writer.ensureMailbox(folder({ path: 'Projects' }))).toBe('mb-real');
  });

  it('still throws, with the server sentence, when the collision names nothing we can adopt', async () => {
    // Hard rule 9: a refusal we cannot resolve is surfaced verbatim, never
    // swallowed into a mailbox id that would send mail somewhere arbitrary.
    mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: [] }),
      'Mailbox/set': () => ({
        accountId: 'a1',
        notCreated: {
          '0': { type: 'invalidProperties', description: 'name is too long', properties: ['name'] },
        },
      }),
    });

    const writer = new JmapTargetWriter(CONFIG);
    await expect(writer.ensureMailbox(folder({ path: 'Projects' }))).rejects.toThrow(
      /Failed to create mailbox.*name is too long/s,
    );
  });
});

describe('JmapTargetWriter.ensureMailbox — the merge-or-subfolder choice', () => {
  /**
   * `targetFolderPrefix` (owner decision 2026-08-16) is how an owner says
   * "keep each source in its own subfolder" instead of merging into the new
   * account. `reconcile.ts` composes it into `path` and leaves `name` as the
   * source's own leaf — and this connector read `name || path`, so the prefix
   * was dropped on the floor while the IMAP and WebDAV targets honoured it.
   *
   * The composition below is exactly what `reconcile.ts` does, spelled out
   * rather than imported, so these tests keep meaning what they say if that
   * call site changes shape.
   */
  const prefixed = (f: MailFolder, prefix: string): MailFolder => ({
    ...f,
    path: `${prefix}/${f.path}`,
  });

  it('puts a prefixed Sent UNDER the prefix, not in the account\'s own Sent', async () => {
    // The bug in one case: this returned `mb-sent` — the root Sent Items —
    // and never called Mailbox/set at all.
    const created: Array<Record<string, unknown>> = [];
    const calls = mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: STALWART_DEFAULTS }),
      'Mailbox/set': (args) => {
        const spec = (args.create as Record<string, Record<string, unknown>>)['0']!;
        created.push(spec);
        return { accountId: 'a1', created: { '0': { id: `mb-${created.length}` } } };
      },
    });

    const writer = new JmapTargetWriter(CONFIG);
    const id = await writer.ensureMailbox(
      prefixed(folder({ path: 'Sent', specialUse: 'sent' }), 'Gmail'),
    );

    expect(id).toBe('mb-2');
    expect(calls.filter((c) => c.method === 'Mailbox/set')).toHaveLength(2);
    // The prefix itself, at the root.
    expect(created[0]).toMatchObject({ name: 'Gmail', parentId: null });
    expect(created[0]!.role).toBeUndefined();
    // And Sent UNDER it, carrying NO role: RFC 8621 allows one sent per
    // account and the account already has one. A folder that happens to be
    // called Sent is not the account's Sent.
    expect(created[1]).toMatchObject({ name: 'Sent', parentId: 'mb-1' });
    expect(created[1]!.role).toBeUndefined();
  });

  it('reuses the prefix mailbox for the next folder instead of making a second one', async () => {
    const created: Array<Record<string, unknown>> = [];
    mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: STALWART_DEFAULTS }),
      'Mailbox/set': (args) => {
        const spec = (args.create as Record<string, Record<string, unknown>>)['0']!;
        created.push(spec);
        return { accountId: 'a1', created: { '0': { id: `mb-${created.length}` } } };
      },
    });

    const writer = new JmapTargetWriter(CONFIG);
    await writer.ensureMailbox(prefixed(folder({ path: 'Sent', specialUse: 'sent' }), 'Gmail'));
    await writer.ensureMailbox(prefixed(folder({ path: 'Projects' }), 'Gmail'));

    // Three creates, not four: Gmail, Gmail/Sent, Gmail/Projects.
    expect(created.map((c) => c.name)).toEqual(['Gmail', 'Sent', 'Projects']);
    expect(created[2]).toMatchObject({ parentId: 'mb-1' });
  });

  it('adopts a prefix mailbox the account already had', async () => {
    const created: Array<Record<string, unknown>> = [];
    mockJmap({
      'Mailbox/get': () => ({
        accountId: 'a1',
        list: [...STALWART_DEFAULTS, { id: 'mb-gmail', name: 'Gmail', parentId: null }],
      }),
      'Mailbox/set': (args) => {
        const spec = (args.create as Record<string, Record<string, unknown>>)['0']!;
        created.push(spec);
        return { accountId: 'a1', created: { '0': { id: 'mb-child' } } };
      },
    });

    const writer = new JmapTargetWriter(CONFIG);
    expect(await writer.ensureMailbox(prefixed(folder({ path: 'Projects' }), 'Gmail'))).toBe(
      'mb-child',
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: 'Projects', parentId: 'mb-gmail' });
  });

  it('nests a source folder that was already a tree, instead of flattening it', async () => {
    // `name || path` made a source `Archive/2024` into a ROOT mailbox called
    // `2024`, so two folders with the same leaf name under different parents
    // collided into one. Nothing to do with the prefix — its own bug.
    const created: Array<Record<string, unknown>> = [];
    mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: [] }),
      'Mailbox/set': (args) => {
        const spec = (args.create as Record<string, Record<string, unknown>>)['0']!;
        created.push(spec);
        return { accountId: 'a1', created: { '0': { id: `mb-${created.length}` } } };
      },
    });

    const writer = new JmapTargetWriter(CONFIG);
    await writer.ensureMailbox(folder({ path: 'Archive/2024', name: '2024' }));
    await writer.ensureMailbox(folder({ path: 'Projects/2024', name: '2024' }));

    expect(created.map((c) => [c.name, c.parentId])).toEqual([
      ['Archive', null],
      ['2024', 'mb-1'],
      ['Projects', null],
      ['2024', 'mb-3'],
    ]);
  });

  it('leaves the merge default exactly as it was — no prefix, no tree', async () => {
    // The regression that would matter most: this is what every mapping does
    // today, and it must still be one flat mailbox at the root.
    const created: Array<Record<string, unknown>> = [];
    const calls = mockJmap({
      'Mailbox/get': () => ({ accountId: 'a1', list: STALWART_DEFAULTS }),
      'Mailbox/set': (args) => {
        created.push((args.create as Record<string, Record<string, unknown>>)['0']!);
        return { accountId: 'a1', created: { '0': { id: 'mb-projects' } } };
      },
    });

    const writer = new JmapTargetWriter(CONFIG);
    // A role folder still adopts the account's own.
    expect(await writer.ensureMailbox(folder({ path: 'Sent', specialUse: 'sent' }))).toBe('mb-sent');
    // An ordinary one is created at the root, WITH its role where it has one.
    expect(await writer.ensureMailbox(folder({ path: 'Projects' }))).toBe('mb-projects');

    expect(calls.filter((c) => c.method === 'Mailbox/set')).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: 'Projects', parentId: null });
  });

  it('refuses a folder with neither a path nor a name rather than inventing one', async () => {
    // Hard rule 9: guessing here writes mail somewhere arbitrary.
    mockJmap({ 'Mailbox/get': () => ({ accountId: 'a1', list: [] }) });
    const writer = new JmapTargetWriter(CONFIG);
    await expect(
      writer.ensureMailbox({ path: '', name: '', specialUse: 'normal' }),
    ).rejects.toThrow(/no path or name/);
  });
});
