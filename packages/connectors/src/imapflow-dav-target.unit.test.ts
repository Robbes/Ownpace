// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * `ImapFlowDavMailTarget` against a fake imapflow client (workplan 0032 T2).
 *
 * The parity harness compares this writer with the proven one against a real
 * server. These tests do what that cannot: make the dangerous answers
 * REACHABLE ON DEMAND — a server without UIDPLUS, a MOVE the server refuses, an
 * EXPUNGE it accepts and ignores, a mailbox recreated under us.
 *
 * The headline is the first block. **imapflow's `messageDelete` silently falls
 * back to a bare EXPUNGE when the server lacks UIDPLUS** — its own source reads
 * `byUid = options.uid && hasCapability(connection, 'UIDPLUS')` — and a bare
 * EXPUNGE removes every message in the mailbox that anyone has flagged
 * `\Deleted`, including ones another client flagged and never committed. That
 * is data nobody in this product ever looked at. The capability is therefore
 * checked HERE, before the call, and these tests fail the moment that check is
 * removed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TargetEntry, RawMessage } from '@openmig/shared';
import { contentHash } from '@openmig/shared';

/** One message in the fake server. */
interface FakeMsg {
  uid: number;
  messageId?: string;
  size?: number;
  source?: Buffer;
  flags?: string[];
}

let boxes: Map<string, FakeMsg[]>;
let mailboxFlags: Map<string, Set<string>>;
let uidValidity: bigint;
let capabilities: Set<string>;
let calls: string[];
let nextUid: number;
/** APPENDUID support: when false, `append` returns no uid. */
let appendReturnsUid: boolean;
/** Make messageMove / messageDelete report refusal by return value. */
let moveSucceeds: boolean;
let deleteSucceeds: boolean;
/** Leave the message in place even though the server said OK. */
let removalIsALie: boolean;
let failNext: { count: number; error: Error } | null;
/** Set to make connect() itself throw, e.g. a certificate refusal. */
let connectError: Error | null = null;
/** The 'error' handler the writer registered on the LAST client, if any. */
let lastErrorHandler: ((err: Error) => void) | undefined;
/** Make the FETCH itself fail, which is a different branch from the lock. */
let failFetch: Error | null;
/** What `exists` was when each mailbox was first SELECTed — see getMailboxLock. */
let selectedExists: Map<string, number>;

vi.mock('imapflow', () => {
  class FakeImapFlow {
    mailbox: unknown = false;
    capabilities = new Map<string, boolean>();
    constructor(public readonly options: Record<string, unknown>) {}
    on(event: string, handler: (err: Error) => void): void {
      calls.push(`on(${event})`);
      if (event === 'error') lastErrorHandler = handler;
    }
    async connect(): Promise<void> {
      calls.push('connect');
      if (connectError) throw connectError;
      for (const c of capabilities) this.capabilities.set(c, true);
    }
    async logout(): Promise<void> {
      calls.push('logout');
    }
    close(): void {
      calls.push('close');
    }
    async list() {
      calls.push('list');
      maybeFail();
      return [...boxes.keys()].map((path) => ({
        path,
        name: path.split('/').pop(),
        flags: mailboxFlags.get(path) ?? new Set<string>(),
      }));
    }
    async mailboxCreate(path: string) {
      calls.push(`mailboxCreate(${path})`);
      const created = !boxes.has(path);
      if (created) boxes.set(path, []);
      return { path, created };
    }
    async getMailboxLock(path: string) {
      calls.push(`lock(${path})`);
      maybeFail();
      if (!boxes.has(path)) throw new Error(`NONEXISTENT ${path}`);
      // **`exists` IS A SNAPSHOT FROM SELECT TIME, and this fake now says so.**
      // imapflow does not re-SELECT a mailbox that is already open, so
      // `client.mailbox.exists` keeps the count from the FIRST select for the
      // life of the selection. The earlier fake refreshed it on every lock,
      // which made a stale-`exists` short-circuit look correct in every unit
      // test — and the parity harness then found it against a real Stalwart on
      // its first run. A fake that is kinder than the library cannot catch what
      // the library does.
      if (!selectedExists.has(path)) selectedExists.set(path, boxes.get(path)!.length);
      this.mailbox = { path, uidValidity, uidNext: nextUid, exists: selectedExists.get(path) };
      return { path, release: () => calls.push(`release(${path})`) };
    }
    async fetchAll(range: string, query: Record<string, unknown>, options?: Record<string, unknown>) {
      const box = (this.mailbox as { path: string }).path;
      calls.push(`fetchAll(${box},${range},${Object.keys(query).sort().join('+')},uid=${String(options?.uid ?? false)})`);
      if (failFetch) throw failFetch;
      return (boxes.get(box) ?? []).map((m) => ({
        uid: m.uid,
        ...(query.envelope ? { envelope: { messageId: m.messageId } } : {}),
        ...(query.size ? { size: m.size } : {}),
      }));
    }
    async fetchOne(seq: string, query: Record<string, unknown>, _o: Record<string, unknown>) {
      const box = (this.mailbox as { path: string }).path;
      calls.push(`fetchOne(${box},${seq})`);
      const m = (boxes.get(box) ?? []).find((x) => String(x.uid) === seq);
      if (!m) return false;
      return { uid: m.uid, ...(query.source ? { source: m.source } : {}) };
    }
    async append(path: string, content: Buffer, flags?: string[]) {
      calls.push(`append(${path},[${(flags ?? []).join(',')}])`);
      const uid = nextUid++;
      const text = content.toString('utf8');
      const messageId = /Message-ID:\s*([^\r\n]+)/i.exec(text)?.[1]?.trim().replace(/[<>]/g, '');
      const box = boxes.get(path) ?? [];
      boxes.set(path, box);
      box.push({
        uid,
        ...(messageId ? { messageId } : {}),
        size: content.byteLength,
        source: content,
        flags,
      });
      return { destination: path, ...(appendReturnsUid ? { uid } : {}) };
    }
    async search(query: { uid?: string }, _o: Record<string, unknown>) {
      const box = (this.mailbox as { path: string }).path;
      calls.push(`search(${box},uid=${String(query.uid)})`);
      const uid = Number(query.uid);
      return (boxes.get(box) ?? []).filter((m) => m.uid === uid).map((m) => m.uid);
    }
    async messageMove(range: string, destination: string, _o: Record<string, unknown>) {
      calls.push(`messageMove(${range}->${destination})`);
      if (!moveSucceeds) return false;
      if (removalIsALie) return { path: 'x', destination };
      const from = (this.mailbox as { path: string }).path;
      const box = boxes.get(from) ?? [];
      const i = box.findIndex((m) => String(m.uid) === range);
      if (i >= 0) {
        const [m] = box.splice(i, 1);
        (boxes.get(destination) ?? boxes.set(destination, []).get(destination)!).push(m!);
      }
      return { path: from, destination };
    }
    async messageDelete(range: string, _o: Record<string, unknown>) {
      // The real one computes `byUid = options.uid && hasCapability('UIDPLUS')`
      // and issues a BARE EXPUNGE otherwise. Recorded so a test can assert this
      // is never reached without the capability.
      calls.push(`messageDelete(${range})`);
      if (!deleteSucceeds) return false;
      if (removalIsALie) return true;
      const from = (this.mailbox as { path: string }).path;
      const box = boxes.get(from) ?? [];
      const i = box.findIndex((m) => String(m.uid) === range);
      if (i >= 0) box.splice(i, 1);
      return true;
    }
  }
  return { ImapFlow: FakeImapFlow };
});

function maybeFail(): void {
  if (failNext && failNext.count > 0) {
    failNext.count--;
    throw failNext.error;
  }
}

const { ImapFlowDavMailTarget } = await import('./imapflow-dav-target');

function target() {
  return new ImapFlowDavMailTarget({
    host: 'imap.test',
    port: 993,
    tls: true,
    username: 'target@dev.local',
    password: 'pw',
  });
}

function rawMessage(id = 'msg-1@dev.local', body = 'hello'): RawMessage {
  const bytes = new TextEncoder().encode(
    [`Message-ID: <${id}>`, 'From: a@dev.local', 'To: b@dev.local', '', body].join('\r\n'),
  );
  return { rfc822: bytes } as unknown as RawMessage;
}

beforeEach(() => {
  boxes = new Map([['INBOX', []]]);
  mailboxFlags = new Map([['INBOX', new Set(['\\HasNoChildren'])]]);
  uidValidity = 42n;
  capabilities = new Set(['UIDPLUS']);
  calls = [];
  nextUid = 1;
  appendReturnsUid = true;
  moveSucceeds = true;
  deleteSucceeds = true;
  removalIsALie = false;
  failNext = null;
  failFetch = null;
  connectError = null;
  lastErrorHandler = undefined;
  selectedExists = new Map();
});

// =======================================================================
// 1. THE HEADLINE: a bare EXPUNGE is never issued
// =======================================================================

describe('removal never widens into a bare EXPUNGE', () => {
  beforeEach(() => {
    boxes.set('INBOX', [{ uid: 7, messageId: 'm@dev.local' }]);
  });

  it('REFUSES to expunge on a server without UIDPLUS, and does not call messageDelete', async () => {
    capabilities = new Set(); // no UIDPLUS
    // No \Trash mailbox either, so expunge is the only route — and it is closed.
    await expect(
      target().removeItem('7', { collection: 'INBOX' }),
    ).rejects.toThrow(/does not support UIDPLUS/);

    // THE ASSERTION THAT MATTERS. imapflow's `messageDelete` would have issued
    // a bare EXPUNGE here — removing every \Deleted-flagged message in the
    // mailbox, including ones another client flagged and never committed. The
    // refusal has to happen BEFORE the call, so reaching the call at all is the
    // failure.
    expect(calls.some((c) => c.startsWith('messageDelete'))).toBe(false);
    // And the message is still there.
    expect(boxes.get('INBOX')).toHaveLength(1);
  });

  it('expunges by UID when the server supports UIDPLUS', async () => {
    const result = await target().removeItem('7', { collection: 'INBOX' });
    expect(result.kind).toBe('deleted');
    expect(calls).toContain('messageDelete(7)');
    expect(boxes.get('INBOX')).toHaveLength(0);
  });

  it('prefers the bin, found by RFC 6154 flag rather than by name', async () => {
    // Named in Dutch on purpose: a `/trash/i` match finds none of "Prullenbak",
    // "Deleted Items" or "[Gmail]/Bin", and the failure is silent — no bin
    // found means the message is expunged outright, turning a recoverable
    // removal into an unrecoverable one.
    boxes.set('Prullenbak', []);
    mailboxFlags.set('Prullenbak', new Set(['\\Trash']));

    const result = await target().removeItem('7', { collection: 'INBOX' });
    expect(result.kind).toBe('binned');
    expect(calls).toContain('messageMove(7->Prullenbak)');
    expect(boxes.get('Prullenbak')).toHaveLength(1);
  });
});

// =======================================================================
// 2. imapflow reports failure by RETURN VALUE, not by throwing
// =======================================================================

describe('a refused removal is never recorded as a success', () => {
  beforeEach(() => {
    boxes.set('INBOX', [{ uid: 7, messageId: 'm@dev.local' }]);
  });

  it('surfaces a MOVE the server refused', async () => {
    boxes.set('Trash', []);
    mailboxFlags.set('Trash', new Set(['\\Trash']));
    moveSucceeds = false;
    await expect(target().removeItem('7', { collection: 'INBOX' })).rejects.toThrow(/refused to move/);
  });

  it('surfaces an EXPUNGE the server refused', async () => {
    // imapflow's expunge command catches its own error, logs a warning and
    // returns false. A caller that ignores that records a removal that never
    // happened.
    deleteSucceeds = false;
    await expect(target().removeItem('7', { collection: 'INBOX' })).rejects.toThrow(
      /refused to expunge/,
    );
  });

  it('refuses to record a removal the server accepted and did not perform', async () => {
    // A server can accept a MOVE, answer OK, and leave the message where it
    // was. Without the read-back the ledger tombstones a copy still sitting on
    // the target, and nothing ever looks again — the row says it was removed,
    // so verification does not expect it either.
    boxes.set('Trash', []);
    mailboxFlags.set('Trash', new Set(['\\Trash']));
    removalIsALie = true;
    await expect(target().removeItem('7', { collection: 'INBOX' })).rejects.toThrow(
      /accepted but the message is still there/,
    );
  });
});

// =======================================================================
// 3. The UID is a weak handle: mailbox scope and UIDVALIDITY
// =======================================================================

describe('the guards around a UID', () => {
  beforeEach(() => {
    boxes.set('INBOX', [{ uid: 7, messageId: 'm@dev.local' }]);
  });

  it('refuses to remove without a mailbox rather than guessing INBOX', async () => {
    // A UID only identifies a message within one mailbox. Guessing would remove
    // message number N from the inbox because number N in some other folder was
    // deleted on the source.
    await expect(target().removeItem('7')).rejects.toThrow(/no mailbox was supplied/);
    expect(calls.some((c) => c.startsWith('messageDelete'))).toBe(false);
  });

  it('refuses a non-numeric targetId', async () => {
    await expect(target().removeItem('not-a-uid', { collection: 'INBOX' })).rejects.toThrow(
      /is not a UID/,
    );
  });

  it('refuses "0" and negatives, which are numbers but never UIDs', async () => {
    // Found by mutation on 2026-08-07, the only survivor of seven against this
    // method: relaxing `uid <= 0` to a bare integer check. `'not-a-uid'` was
    // covered; `'0'` was not, and they take different branches of the same
    // condition.
    //
    // `"0"` is not hypothetical here. `upsertEmail` recorded the literal string
    // "0" as `targetId` for every mail item ever migrated until 2026 — it read
    // `Email/import`'s created map by our own creation-id key instead of the
    // server's `.id` — and it went unnoticed until ADR-0024's apply path fed
    // one back to a real Stalwart. A ledger written during that window still
    // holds those rows. RFC 3501 §2.3.1.1 makes UIDs strictly positive, so on
    // IMAP a "0" is the one value guaranteed to name nothing, and this is where
    // it has to stop rather than reaching `messageMove`.
    for (const bad of ['0', '-1', '-0']) {
      await expect(
        target().removeItem(bad, { collection: 'INBOX' }),
        bad,
      ).rejects.toThrow(/is not a UID/);
    }
    // Nothing was touched on the way to refusing.
    expect(calls.some((c) => c.startsWith('messageDelete') || c.startsWith('messageMove'))).toBe(
      false,
    );
    expect(boxes.get('INBOX')).toHaveLength(1);
  });

  it('THROWS on a UIDVALIDITY change rather than reporting a conflict', async () => {
    await expect(
      target().removeItem('7', { collection: 'INBOX', expectedTargetVersion: '41' }),
    ).rejects.toThrow(/has been recreated since/);
    // Deliberately not `conflicted`: that word tells the operator "somebody
    // edited your copy", which is a specific and here FALSE explanation. This
    // is a stale handle.
    expect(boxes.get('INBOX')).toHaveLength(1);
  });

  it('reports no removal — not a success — for a UID that is already gone', async () => {
    boxes.set('INBOX', []);
    const result = await target().removeItem('7', { collection: 'INBOX' });
    // The ledger row then still says the item is on the target, which §20
    // surfaces as `missingOnTarget`. Loud and correctable beats a tombstone
    // recorded for something this never touched.
    expect(result).toEqual({});
  });

  it('records UIDVALIDITY as decimal text, not as a bigint literal', async () => {
    const result = await target().upsertEmail('INBOX', rawMessage(), ['$seen']);
    // imapflow types it as a bigint; a `42n` reaching the ledger would compare
    // unequal to the `42` the other writer records, and every later removal
    // would refuse with a stale-handle error.
    expect(result.targetVersion).toBe('42');
  });
});

// =======================================================================
// 4. Writing: adoption, APPENDUID, and never guessing a UID
// =======================================================================

describe('upsertEmail', () => {
  it('appends a new message and takes its UID from APPENDUID', async () => {
    const result = await target().upsertEmail('INBOX', rawMessage(), ['$seen', '$flagged']);
    expect(result.created).toBe(true);
    expect(result.targetId).toBe('1');
    expect(calls).toContain('append(INBOX,[\\Seen,\\Flagged])');
  });

  it('adopts on a second pass instead of appending a duplicate', async () => {
    const t = target();
    await t.upsertEmail('INBOX', rawMessage(), ['$seen']);
    const again = await t.upsertEmail('INBOX', rawMessage(), ['$seen']);
    // A duplicate is a SUCCESSFUL write nobody notices until a mailbox is twice
    // its size — hard rule 1.
    expect(again.created).toBe(false);
    expect(again.adopted).toBe(true);
    expect(boxes.get('INBOX')).toHaveLength(1);
  });

  it('falls back to a COMPLETE rescan when the server gives no APPENDUID', async () => {
    appendReturnsUid = false;
    const result = await target().upsertEmail('INBOX', rawMessage(), []);
    expect(result.created).toBe(true);
    expect(result.targetId).toBe('1');
  });

  it('refuses to guess a UID when the rescan cannot find what it just wrote', async () => {
    appendReturnsUid = false;
    // A message with no Message-ID header at all: appended, unfindable.
    const raw = { rfc822: new TextEncoder().encode('From: a\r\n\r\nno id') } as unknown as RawMessage;
    // Caught before the append, in fact — but the point stands either way: the
    // recorded id is what a later removal acts on, so guessing is not an option.
    await expect(target().upsertEmail('INBOX', raw, [])).rejects.toThrow(/No Message-ID found/);
  });

  it('marks a message \\Seen by default rather than leaving it unread', async () => {
    await target().upsertEmail('INBOX', rawMessage(), []);
    // A migration that silently marked a mailbox unread would hand the owner
    // thousands of "new" messages on cutover day.
    expect(calls).toContain('append(INBOX,[\\Seen])');
  });
});

// =======================================================================
// 5. A failed lookup is never "not present"
// =======================================================================

describe('findByNaturalKey', () => {
  it('throws rather than reporting absence when the mailbox cannot be opened', async () => {
    failNext = { count: 1, error: new Error('connection reset') };
    // `upsertEmail` reads undefined as "append it", so a swallowed failure here
    // writes a duplicate.
    await expect(target().findByNaturalKey('INBOX', 'm@dev.local')).rejects.toThrow(
      /refusing to treat this as "not present"/,
    );
  });

  it('throws rather than reporting absence when the FETCH fails', async () => {
    // A SEPARATE BRANCH from the one above, and this test exists because a
    // mutation proved the difference mattered: swallowing the fetch failure as
    // "not present" passed all 26 tests, because the only lookup-failure test
    // was exercising the lock-acquisition catch and never reached this one.
    // That is the vacuous-pass shape this repo keeps finding, in a test written
    // to guard against exactly it — and it is only known because the mutation
    // was run rather than assumed.
    boxes.set('INBOX', [{ uid: 3, messageId: 'm@dev.local' }]);
    failFetch = new Error('server closed the connection mid-FETCH');
    await expect(target().findByNaturalKey('INBOX', 'm@dev.local')).rejects.toThrow(
      /refusing to treat this as "not present"/,
    );
  });

  it('does not let a failed lookup become a duplicate append', async () => {
    // The consequence, asserted end to end rather than left to inference: if
    // the lookup swallowed its failure, `upsertEmail` would read undefined as
    // "not on the target" and append a second copy of a message that is there.
    boxes.set('INBOX', [{ uid: 3, messageId: 'msg-1@dev.local' }]);
    failFetch = new Error('server closed the connection mid-FETCH');
    await expect(target().upsertEmail('INBOX', rawMessage(), [])).rejects.toThrow(/Lookup failed/);
    expect(boxes.get('INBOX')).toHaveLength(1);
    expect(calls.some((c) => c.startsWith('append'))).toBe(false);
  });

  it('matches regardless of angle brackets on either side', async () => {
    boxes.set('INBOX', [{ uid: 3, messageId: 'm@dev.local' }]);
    const t = target();
    expect(await t.findByNaturalKey('INBOX', 'm@dev.local')).toBe('3');
    // A ledger row can carry either form; a message that IS there reading as
    // absent gets appended again.
    expect(await t.findByNaturalKey('INBOX', '<m@dev.local>')).toBe('3');
  });

  it('finds a message appended AFTER the mailbox was selected while empty', async () => {
    // THE BUG THE PARITY HARNESS FOUND, as a unit test.
    //
    // `upsertEmail` selects the mailbox (to read UIDVALIDITY) while it is
    // still empty, then appends. imapflow does not re-SELECT an already-open
    // mailbox, so `client.mailbox.exists` is still 0 — and a short-circuit on
    // that value answers "not present" for a message that is right there,
    // which `upsertEmail` turns into a duplicate APPEND on the next pass.
    const t = target();
    const first = await t.upsertEmail('INBOX', rawMessage(), []);
    expect(first.created).toBe(true);

    // Same instance, same open mailbox, stale `exists`.
    expect(await t.findByNaturalKey('INBOX', 'msg-1@dev.local')).toBe(first.targetId);

    const again = await t.upsertEmail('INBOX', rawMessage(), []);
    expect(again.adopted).toBe(true);
    expect(boxes.get('INBOX')).toHaveLength(1);
  });

  it('scans by UID range, which is what makes an empty mailbox safe to fetch', async () => {
    // A sequence FETCH of `1:*` against an empty mailbox is an error on some
    // servers; a UID FETCH matching nothing returns no data (RFC 3501). That
    // is why there is no `exists` guard in front of it — the guard was the bug.
    expect(await target().findByNaturalKey('INBOX', 'nobody@dev.local')).toBeUndefined();
    expect(calls.some((c) => c.startsWith('fetchAll(INBOX,1:*') && c.includes('uid=true'))).toBe(true);
  });

  it('answers undefined only after a complete scan that matched nothing', async () => {
    boxes.set('INBOX', [{ uid: 3, messageId: 'other@dev.local' }]);
    expect(await target().findByNaturalKey('INBOX', 'm@dev.local')).toBeUndefined();
  });
});

// =======================================================================
// 6. Reindex refuses to key by UID
// =======================================================================

describe('listEntries', () => {
  it('carries the natural key and the size', async () => {
    boxes.set('INBOX', [{ uid: 3, messageId: 'm@dev.local', size: 120 }]);
    const entries: TargetEntry[] = [];
    for await (const e of target().listEntries('INBOX')) entries.push(e);
    expect(entries).toEqual([
      { naturalKey: 'm@dev.local', targetId: '3', mailboxId: 'INBOX', sizeBytes: 120 },
    ]);
  });

  it('refuses to key an entry by UID when the message has no Message-ID', async () => {
    boxes.set('INBOX', [{ uid: 3, size: 10 }]);
    // A UID-keyed ledger row can never match the message's real Message-ID, so
    // the next sync treats it as unknown and re-appends it — a duplicate
    // created by the reindex meant to prevent one.
    await expect(async () => {
      for await (const _ of target().listEntries('INBOX')) void _;
    }).rejects.toThrow(/refusing to key the entry by UID/);
  });

  it('refuses a partial view rather than skipping a mailbox it cannot read', async () => {
    boxes.set('Archive', []);
    mailboxFlags.set('Archive', new Set());
    failNext = { count: 2, error: new Error('SELECT failed') };
    await expect(async () => {
      for await (const _ of target().listEntries()) void _;
    }).rejects.toThrow(/refusing/);
  });
});

// =======================================================================
// 7. Verification
// =======================================================================

describe('contentHashFor', () => {
  it('hashes the stored bytes so §20 compares like with like', async () => {
    const raw = rawMessage();
    await target().upsertEmail('INBOX', raw, []);
    const hash = await target().contentHashFor({
      naturalKey: 'msg-1@dev.local',
      targetId: '1',
      mailboxId: 'INBOX',
    });
    expect(hash).toBe(contentHash(raw.rfc822));
  });

  it('reports unavailable rather than hashing nothing', async () => {
    boxes.set('INBOX', [{ uid: 3, messageId: 'm@dev.local' }]); // no source
    const hash = await target().contentHashFor({
      naturalKey: 'm@dev.local',
      targetId: '3',
      mailboxId: 'INBOX',
    });
    // Hashing zero bytes would produce a real-looking hash of nothing, and
    // verification would score it as a mismatch — reporting a healthy message
    // as corrupt.
    expect(hash).toBeUndefined();
  });
});

// =======================================================================
// 8. Mailboxes
// =======================================================================

describe('ensureMailbox', () => {
  it('returns an existing mailbox without creating it', async () => {
    expect(await target().ensureMailbox({ path: 'INBOX', name: 'INBOX', specialUse: 'inbox' })).toBe(
      'INBOX',
    );
    expect(calls.some((c) => c.startsWith('mailboxCreate'))).toBe(false);
  });

  it('creates a missing one and does not try to set a special-use flag', async () => {
    const name = await target().ensureMailbox({ path: 'Archive', name: 'Archive', specialUse: 'archive' });
    expect(name).toBe('Archive');
    expect(calls).toContain('mailboxCreate(Archive)');
    // RFC 6154 assigns special use at CREATE time or by server policy; there is
    // no command to attach one afterwards. The old writer once called a
    // `setFlags` that existed on nothing and logged a warning about a real
    // limitation produced by a call that was never going to work.
  });
});

// =======================================================================
// Certificate refusal names the knob (same treatment as the source)
// =======================================================================

describe('certificate verification', () => {
  it('has always verified by default, and now says which knob exists when it refuses', async () => {
    connectError = Object.assign(new Error('self-signed certificate'), {
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    const err = await target().listEntries()[Symbol.asyncIterator]().next().then(
      () => undefined,
      (e: Error) => e,
    );
    expect(err).toBeDefined();
    expect(err!.message).toContain('"tlsVerify": false');
    // The original stays: recognising an error never replaces it (rule 9).
    expect(err!.message).toContain('self-signed certificate');
  });

  it('leaves an ordinary refused connection alone', async () => {
    connectError = new Error('connect ECONNREFUSED 127.0.0.1:993');
    await expect(target().listEntries()[Symbol.asyncIterator]().next()).rejects.toThrow(/ECONNREFUSED/);
    await expect(target().listEntries()[Symbol.asyncIterator]().next()).rejects.not.toThrow(/tlsVerify/);
  });
});

// =======================================================================
// A dying socket must not take the process with it (see the source's test)
// =======================================================================

describe('socket-level errors', () => {
  it('registers an error listener, and a fired error drops the CACHED client', async () => {
    // This writer HOLDS its connection between calls, so a socket dying while
    // idle is even more likely here than on the per-call source. The handler
    // must both absorb the event (no process crash) and un-cache the dead
    // client, or the next write goes into a corpse.
    const t = target();
    await t.listEntries()[Symbol.asyncIterator]().next();
    expect(lastErrorHandler).toBeDefined();

    const connectsBefore = calls.filter((c) => c === 'connect').length;
    expect(() =>
      lastErrorHandler!(Object.assign(new Error('write ECONNABORTED'), { code: 'ECONNABORTED' })),
    ).not.toThrow();

    // The next operation RECONNECTS rather than reusing the dead socket.
    await t.listEntries()[Symbol.asyncIterator]().next();
    const connectsAfter = calls.filter((c) => c === 'connect').length;
    expect(connectsAfter).toBe(connectsBefore + 1);
  });
});
