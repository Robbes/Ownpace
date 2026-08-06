// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The IMAP/DAV mail target, against a fake IMAP server.
 *
 * Written for two things at once. The first is `removeItem` — this target's
 * half of ADR-0024, the one destructive operation in the product, reached only
 * through `applyDeletion`'s seven gates and one explicit owner decision. The
 * second is the mailbox ENUMERATION this file used to get wrong, which is worth
 * its own regression tests because it failed silently in both directions:
 * `conn.imap.getBoxes` is callback-only, so calling it with no arguments and
 * awaiting the `undefined` it returns made every account look empty — the
 * reindexer then fell back to its `['INBOX']` path and rebuilt a ledger that
 * looked complete while missing every other mailbox, and `ensureMailbox`
 * decided nothing existed and called an `addMailbox` that exists on nothing.
 *
 * The fake server is deliberately picky about the parts that matter: UIDs are
 * per-mailbox (which is the whole reason `removeItem` needs a collection),
 * UIDVALIDITY is per-mailbox, and the bin is called "Deleted Items" — the name
 * Stalwart and Exchange both use — so any implementation that finds the bin by
 * matching /trash/i on the name fails these tests, as it should.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { REINDEX_FETCH_OPTIONS } from './imap-dav-target';

interface FakeMailbox {
  uidvalidity: number;
  /** RFC 6154 attributes, as node-imap reports them: `attribs`, not `attributes`. */
  attribs: string[];
  /** UID -> Message-ID. */
  messages: Map<number, string>;
  /** UIDs someone has flagged `\Deleted` without expunging. */
  deletedFlag: Set<number>;
}

function mailbox(
  uidvalidity: number,
  attribs: string[],
  messages: Array<[number, string]> = [],
): FakeMailbox {
  return { uidvalidity, attribs, messages: new Map(messages), deletedFlag: new Set() };
}

/**
 * A fake `imap-simple` connection over a fake account.
 *
 * `accept` lets a test make the server ANSWER OK to a move or expunge without
 * carrying it out — the failure a read-back exists to catch, and one no amount
 * of checking the command's return value would ever notice.
 */
class FakeImap {
  selected: string | undefined;
  readonly capabilities: Set<string>;
  readonly log: string[] = [];
  accept: 'really' | 'pretend' = 'really';

  constructor(
    readonly boxes: Record<string, FakeMailbox>,
    capabilities: string[] = ['UIDPLUS', 'MOVE'],
  ) {
    this.capabilities = new Set(capabilities);
  }

  private box(name?: string): FakeMailbox {
    const box = this.boxes[name ?? this.selected ?? ''];
    if (!box) throw new Error(`no such mailbox: ${name ?? this.selected}`);
    return box;
  }

  /** The `imap-simple` surface the target uses. */
  conn(): unknown {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      getBoxes: async () => {
        self.log.push('getBoxes');
        const tree: Record<string, { attribs: string[]; delimiter: string }> = {};
        for (const [name, box] of Object.entries(self.boxes)) {
          tree[name] = { attribs: box.attribs, delimiter: '/' };
        }
        return tree;
      },
      addBox: async (name: string) => {
        self.log.push(`addBox ${name}`);
        self.boxes[name] = mailbox(1, []);
      },
      openBox: async (name: string) => {
        self.box(name);
        self.selected = name;
        return name;
      },
      moveMessage: async (source: string[], to: string) => {
        self.log.push(`move ${source.join(',')} -> ${to}`);
        const from = self.box();
        const dest = self.box(to);
        if (self.accept === 'pretend') return;
        for (const raw of source) {
          const uid = Number(raw);
          const messageId = from.messages.get(uid);
          if (messageId === undefined) continue;
          from.messages.delete(uid);
          dest.messages.set(Math.max(0, ...dest.messages.keys()) + 1, messageId);
        }
      },
      addFlags: async (source: number[], flag: string) => {
        self.log.push(`addFlags ${source.join(',')} ${flag}`);
        if (flag === '\\Deleted') for (const uid of source) self.box().deletedFlag.add(uid);
      },
      append: async () => undefined,
      search: async (criteria: unknown[]) => {
        const uids = self.searchSync(criteria);
        return uids.map((uid) => ({ attributes: { uid, size: 42 } }));
      },
      end: () => undefined,
      imap: {
        // CALLBACK-ONLY, exactly like node-imap's. Modelled faithfully so the
        // enumeration tests below fail the way the real bug failed: the old
        // code called this with zero arguments and awaited the `undefined` it
        // returns, which threw nothing and looked like an empty account.
        getBoxes: (cb?: (err: Error | null, boxes: unknown) => void) => {
          self.log.push('imap.getBoxes');
          if (!cb) return undefined;
          const tree: Record<string, { attribs: string[]; delimiter: string }> = {};
          for (const [name, box] of Object.entries(self.boxes)) {
            tree[name] = { attribs: box.attribs, delimiter: '/' };
          }
          cb(null, tree);
          return undefined;
        },
        serverSupports: (cap: string) => self.capabilities.has(cap),
        openBox: (
          name: string,
          _readOnly: boolean,
          cb: (err: Error | null, box: { uidvalidity: number }) => void,
        ) => {
          let box: FakeMailbox;
          try {
            box = self.box(name);
          } catch (err) {
            cb(err as Error, { uidvalidity: 0 });
            return;
          }
          self.selected = name;
          cb(null, { uidvalidity: box.uidvalidity });
        },
        search: (criteria: unknown[], cb: (err: Error | null, uids: number[]) => void) => {
          cb(null, self.searchSync(criteria));
        },
        expunge: (uids: number[], cb: (err: Error | null) => void) => {
          self.log.push(`expunge ${uids.join(',')}`);
          if (!self.capabilities.has('UIDPLUS')) {
            cb(new Error('UID EXPUNGE without UIDPLUS'));
            return;
          }
          if (self.accept === 'really') {
            const box = self.box();
            for (const uid of uids) if (box.deletedFlag.has(uid)) box.messages.delete(uid);
          }
          cb(null);
        },
        fetch: (uids: number[], _opts: unknown) => self.fakeFetch(uids),
      },
    };
  }

  private searchSync(criteria: unknown[]): number[] {
    const box = this.box();
    const first = criteria[0];
    if (Array.isArray(first) && first[0] === 'UID') {
      const wanted = Number(first[1]);
      return box.messages.has(wanted) ? [wanted] : [];
    }
    return [...box.messages.keys()];
  }

  /** node-imap's fetch, emitting one `HEADER` body per requested UID. */
  private fakeFetch(uids: number[]): EventEmitter {
    const fetch = new EventEmitter();
    const box = this.box();
    queueMicrotask(() => {
      for (const uid of uids) {
        const messageId = box.messages.get(uid);
        if (messageId === undefined) continue;
        const msg = new EventEmitter();
        fetch.emit('message', msg, uid);
        msg.emit('attributes', { uid, size: 42 });
        const stream = new EventEmitter();
        msg.emit('body', stream, { which: 'HEADER' });
        stream.emit('data', Buffer.from(`Message-ID: <${messageId}>\r\n\r\n`));
        stream.emit('end');
      }
      fetch.emit('end');
    });
    return fetch;
  }
}

let server: FakeImap;

vi.mock('imap-simple', () => ({
  default: { connect: async () => server.conn() },
  connect: async () => server.conn(),
}));

/** Imported after the mock is registered, so the target picks up the fake. */
const { ImapDavMailTarget } = await import('./imap-dav-target');

const CONFIG = {
  host: 'imap.example.com',
  port: 993,
  tls: true,
  username: 'target@example.com',
  password: 'pw',
};

function target() {
  return new ImapDavMailTarget(CONFIG);
}

/** An account whose bin is named the way real servers name it. */
function accountWithBin() {
  return new FakeImap({
    INBOX: mailbox(101, ['\\HasNoChildren'], [[10, 'a@example.com'], [11, 'b@example.com']]),
    'Deleted Items': mailbox(202, ['\\HasNoChildren', '\\Trash']),
    Archive: mailbox(303, ['\\HasNoChildren', '\\Archive'], [[10, 'c@example.com']]),
  });
}

beforeEach(() => {
  server = accountWithBin();
});

describe('ImapDavMailTarget.removeItem', () => {
  it('bins the message in the \\Trash mailbox, found by flag and not by name', async () => {
    // The bin here is "Deleted Items". Anything matching on the NAME finds no
    // bin, silently expunges instead, and hands the owner an unrecoverable
    // deletion where a recoverable one was available.
    const result = await target().removeItem('10', { collection: 'INBOX' });

    expect(result).toEqual({ kind: 'binned' });
    expect(server.boxes.INBOX!.messages.has(10)).toBe(false);
    expect([...server.boxes['Deleted Items']!.messages.values()]).toEqual(['a@example.com']);
    // The other message in the mailbox is untouched.
    expect(server.boxes.INBOX!.messages.get(11)).toBe('b@example.com');
  });

  it('removes from the mailbox it was told about, not from INBOX', async () => {
    // UID 10 exists in both INBOX and Archive and names a different message in
    // each. This is the entire reason `collection` had to be plumbed through.
    await target().removeItem('10', { collection: 'Archive' });

    expect(server.boxes.Archive!.messages.has(10)).toBe(false);
    expect(server.boxes.INBOX!.messages.get(10)).toBe('a@example.com');
    expect([...server.boxes['Deleted Items']!.messages.values()]).toEqual(['c@example.com']);
  });

  it('refuses outright when no collection is supplied, rather than guessing INBOX', async () => {
    await expect(target().removeItem('10')).rejects.toThrow(/no mailbox was supplied/i);
    expect(server.boxes.INBOX!.messages.has(10)).toBe(true);
  });

  it('expunges when the account advertises no bin at all, and says so', async () => {
    server = new FakeImap({
      INBOX: mailbox(101, ['\\HasNoChildren'], [[10, 'a@example.com']]),
    });

    const result = await target().removeItem('10', { collection: 'INBOX' });

    expect(result).toEqual({ kind: 'deleted' });
    expect(server.boxes.INBOX!.messages.has(10)).toBe(false);
  });

  it('expunges a copy that is already in the bin instead of moving it onto itself', async () => {
    server.boxes['Deleted Items']!.messages.set(5, 'already-binned@example.com');

    const result = await target().removeItem('5', { collection: 'Deleted Items' });

    expect(result).toEqual({ kind: 'deleted' });
    expect(server.boxes['Deleted Items']!.messages.has(5)).toBe(false);
  });

  it('never sends a bare EXPUNGE — it would destroy other clients\' pending deletions', async () => {
    // No bin and no UIDPLUS. The only remaining way to delete is `EXPUNGE`,
    // which removes EVERY \Deleted-flagged message in the mailbox — including
    // this one, which another client flagged and has not committed. Hard rule 2
    // makes that not ours to do, so this refuses instead.
    server = new FakeImap(
      { INBOX: mailbox(101, [], [[10, 'a@example.com'], [11, 'someone-elses@example.com']]) },
      ['MOVE'],
    );
    server.boxes.INBOX!.deletedFlag.add(11);

    await expect(target().removeItem('10', { collection: 'INBOX' })).rejects.toThrow(/UIDPLUS/);
    expect(server.boxes.INBOX!.messages.has(10)).toBe(true);
    expect(server.boxes.INBOX!.messages.has(11)).toBe(true);
  });

  it('proceeds when the recorded UIDVALIDITY still matches', async () => {
    const result = await target().removeItem('10', {
      collection: 'INBOX',
      expectedTargetVersion: '101',
    });
    expect(result).toEqual({ kind: 'binned' });
  });

  it('refuses on a UIDVALIDITY change — every UID now names a different message', async () => {
    // The mailbox was recreated since we wrote. UID 10 is somebody else's mail
    // now, and there is no way to tell which. Thrown rather than reported as
    // `conflicted`, which would tell the operator "somebody edited your copy" —
    // a specific explanation, and a false one.
    await expect(
      target().removeItem('10', { collection: 'INBOX', expectedTargetVersion: '99' }),
    ).rejects.toThrow(/UIDVALIDITY/);
    expect(server.boxes.INBOX!.messages.has(10)).toBe(true);
  });

  it('reports no removal, rather than a success, for a message that is already gone', async () => {
    const result = await target().removeItem('999', { collection: 'INBOX' });

    // No `kind`, which `applyDeletion` turns into "the target reported no
    // removal, so nothing has been changed" and leaves the ledger row saying
    // the item is on the target — §20 then reports it as missing. Loud and
    // correctable, as opposed to a tombstone recorded for something this never
    // touched.
    expect(result).toEqual({});
  });

  it('refuses to record a removal the server accepted but did not carry out', async () => {
    server.accept = 'pretend';

    await expect(target().removeItem('10', { collection: 'INBOX' })).rejects.toThrow(
      /still there/i,
    );
  });

  it('refuses a target id that is not a UID', async () => {
    await expect(target().removeItem('not-a-uid', { collection: 'INBOX' })).rejects.toThrow(
      /not a UID/,
    );
  });
});

describe('ImapDavMailTarget mailbox enumeration', () => {
  it('sees mailboxes that already exist instead of trying to create them', async () => {
    // `conn.imap.getBoxes` called with no callback returns undefined, so this
    // used to see an empty account for every folder and call `addBox` — or,
    // before that, an `addMailbox` that exists on neither imap-simple nor
    // node-imap, making folder creation throw a TypeError.
    const name = await target().ensureMailbox({ path: 'Archive', name: 'Archive', specialUse: 'archive' });

    expect(name).toBe('Archive');
    expect(server.log).not.toContain('addBox Archive');
  });

  it('creates a mailbox that is genuinely absent, via addBox', async () => {
    const name = await target().ensureMailbox({ path: 'Projects', name: 'Projects', specialUse: 'normal' });

    expect(name).toBe('Projects');
    expect(server.log).toContain('addBox Projects');
    expect(server.boxes.Projects).toBeDefined();
  });

  it('reindexes every mailbox, not just INBOX', async () => {
    // The silent one. With enumeration broken, `listEntries` fell through to
    // its `['INBOX']` fallback and yielded a ledger that LOOKS complete —
    // so the next sync re-appends every message in every other folder, which
    // is ADR-0020 recovery turning into mass duplication.
    const seen: Array<{ naturalKey: string; mailboxId: string }> = [];
    for await (const entry of target().listEntries()) {
      seen.push({ naturalKey: entry.naturalKey, mailboxId: entry.mailboxId });
    }

    expect(seen).toEqual(
      expect.arrayContaining([
        { naturalKey: 'a@example.com', mailboxId: 'INBOX' },
        { naturalKey: 'b@example.com', mailboxId: 'INBOX' },
        { naturalKey: 'c@example.com', mailboxId: 'Archive' },
      ]),
    );
    expect(seen).toHaveLength(3);
  });
});

describe('ImapDavMailTarget.upsertEmail', () => {
  it('records the mailbox UIDVALIDITY as the target version', async () => {
    // Which is what makes `removeItem`'s staleness check possible at all: an
    // IMAP message cannot be edited in place, so the thing that invalidates our
    // handle is the mailbox being recreated, not the message changing.
    const result = await target().upsertEmail(
      'INBOX',
      { rfc822: Buffer.from('Message-ID: <new@example.com>\r\n\r\nhi') } as never,
      [],
    );

    expect(result.created).toBe(true);
    expect(result.targetVersion).toBe('101');
  });

  it('adopts an existing message under our natural key, with its UIDVALIDITY', async () => {
    const result = await target().upsertEmail(
      'INBOX',
      { rfc822: Buffer.from('Message-ID: <a@example.com>\r\n\r\nhi') } as never,
      [],
    );

    expect(result).toMatchObject({ targetId: '10', created: false, adopted: true });
    expect(result.targetVersion).toBe('101');
  });
});

describe('REINDEX_FETCH_OPTIONS', () => {
  it('asks for RFC822.SIZE, which verification needs to measure target bytes', () => {
    // node-imap only appends RFC822.SIZE when `options.size` is set, so
    // dropping this makes `attrs.size` undefined for every message and every
    // `TargetEntry` carries no `sizeBytes`. Nothing throws: §20 simply reports
    // `totalBytesTarget` as unmeasurable, for every IMAP target, forever.
    //
    // That is what this connector did until 2026-08-06, and the workplan 0032
    // WRITE-path parity harness is what found it — `entries · every entry
    // carries a size: false vs true`, with the imapflow writer on the right
    // side of the comparison.
    expect(REINDEX_FETCH_OPTIONS.size).toBe(true);
    // Headers only: the reindex reads Message-IDs, never bodies.
    expect(REINDEX_FETCH_OPTIONS.bodies).toEqual(['HEADER']);
  });
});
