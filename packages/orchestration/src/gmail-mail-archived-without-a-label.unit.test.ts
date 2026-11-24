// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * GMAIL MAIL ARCHIVED WITHOUT A LABEL IS COPIED (the owner, 2026-11-24).
 *
 * Over IMAP a Gmail message archived with no label lives ONLY in All Mail.
 * Gmail's own Archive button makes exactly such messages. `GmailFolderView`
 * used to drop All Mail by its `\All` attribute, so none of them was ever
 * copied, discovery did not count them, and the Check took its source figure
 * from the ledger: the loss passed every gate.
 *
 * The fix, as approved: read All Mail LAST, copy only what no other folder
 * carried into a folder called Archive, and never read a sighting there as a
 * move. These tests drive the real view and the real sync loop over a fake
 * Gmail whose LIST carries Google's real attributes, a localised All Mail
 * name among them.
 */
import { describe, expect, it } from 'vitest';
import {
  asMappingId,
  asTenantId,
  naturalKeyHash,
  type LedgerVerificationReader,
  type SourceCountWindow,
  type MailFolder,
  type MailItem,
  type RawMessage,
  type ReconcileDeps,
  type SourceConnector,
  type SyncCursor,
} from '@openmig/shared';
import { mapImapSpecialUse } from '../../connectors/src/imap-conventions.ts';
import { runShadowPass } from '../../core/src/reconcile.ts';
import { discoverSource } from '../../core/src/discovery.ts';
import { runVerification } from '../../core/src/verification.ts';
import { createRealVerificationDeps } from '../../core/src/verification-implementations.ts';
import { mailSourceSideCount } from './source-side-count.ts';
import { MemoryCursorStore, MemoryLedger, MemoryTarget } from '../../core/src/__testing__/memory.ts';
import { GmailFolderView } from './gmail-source-factory.ts';

const tenantId = asTenantId('t-gmail');
const mappingId = asMappingId('m-gmail');

/** Google's LIST answer, attributes verbatim, with Dutch [Gmail] names. */
const LIST: ReadonlyArray<{ path: string; attributes: string[] }> = [
  { path: 'INBOX', attributes: ['\\HasNoChildren'] },
  { path: 'Work', attributes: ['\\HasNoChildren'] },
  { path: '[Gmail]', attributes: ['\\HasChildren', '\\Noselect'] },
  { path: '[Gmail]/Alle berichten', attributes: ['\\All', '\\HasNoChildren'] },
  { path: '[Gmail]/Belangrijk', attributes: ['\\HasNoChildren', '\\Important'] },
  { path: '[Gmail]/Concepten', attributes: ['\\Drafts', '\\HasNoChildren'] },
  { path: '[Gmail]/Met ster', attributes: ['\\Flagged', '\\HasNoChildren'] },
  { path: '[Gmail]/Prullenbak', attributes: ['\\HasNoChildren', '\\Trash'] },
  { path: '[Gmail]/Spam', attributes: ['\\HasNoChildren', '\\Junk'] },
  { path: '[Gmail]/Verzonden berichten', attributes: ['\\HasNoChildren', '\\Sent'] },
];
const ALL_MAIL = '[Gmail]/Alle berichten';
const TRASH = '[Gmail]/Prullenbak';
const SPAM = '[Gmail]/Spam';

interface Message {
  readonly id: string;
  readonly bytes: Uint8Array;
  /** The folders it is in, besides All Mail, which Gmail derives. */
  readonly labels: Set<string>;
  /** Its UID in each folder it has entered, issued on entry as IMAP does. */
  readonly uids: Map<string, number>;
  /** When it arrived (INTERNALDATE), ISO 8601. */
  readonly at: string;
}

/** When the fixtures' mail arrives, unless a test says otherwise: before every pass below. */
const EARLY = '2026-11-01T00:00:00.000Z';
/** When the last completed pass started, as the ledger's status row says. */
const PASS_STARTED = '2026-11-10T00:00:00.000Z';

/**
 * Gmail as its IMAP surface shows it: each label a folder, All Mail every
 * message once except Spam and Trash, and a fresh UID in a folder each time a
 * message enters it. Each message carries the time it arrived (INTERNALDATE).
 */
class FakeGmail implements SourceConnector {
  private readonly messages: Message[] = [];
  private readonly uidNext = new Map<string, number>();

  private folder(path: string): MailFolder {
    const listed = LIST.find((f) => f.path === path)!;
    return {
      path,
      name: path.split('/').pop()!,
      specialUse: mapImapSpecialUse(listed.attributes),
      listAttributes: listed.attributes,
    };
  }

  private enter(m: Message, path: string): void {
    const uid = this.uidNext.get(path) ?? 1;
    this.uidNext.set(path, uid + 1);
    m.uids.set(path, uid);
  }

  /** Does `path` hold `m` right now? All Mail by Gmail's own rule. */
  private holds(m: Message, path: string): boolean {
    if (path === ALL_MAIL) return !m.labels.has(SPAM) && !m.labels.has(TRASH);
    return m.labels.has(path);
  }

  private reissueAllMail(m: Message, wasIn: boolean): void {
    if (!wasIn && this.holds(m, ALL_MAIL)) this.enter(m, ALL_MAIL);
  }

  /** A message arrives under these labels (none: archived with no label). */
  deliver(id: string, labels: string[], at: string = EARLY): void {
    const m: Message = {
      id,
      bytes: new TextEncoder().encode(`Message-ID: ${id}\r\nSubject: ${id}\r\n\r\nbody of ${id}`),
      labels: new Set(labels),
      uids: new Map(),
      at,
    };
    this.messages.push(m);
    for (const l of labels) this.enter(m, l);
    this.reissueAllMail(m, false);
  }

  private find(id: string): Message {
    const m = this.messages.find((x) => x.id === id);
    if (!m) throw new Error(`FakeGmail: no message ${id}`);
    return m;
  }

  /** Gmail's Archive button: the INBOX label goes, All Mail keeps it as it was. */
  archive(id: string): void {
    const m = this.find(id);
    m.labels.delete('INBOX');
    m.uids.delete('INBOX');
  }

  /** Delete: into Trash, out of every label and out of All Mail. */
  trash(id: string): void {
    const m = this.find(id);
    for (const l of [...m.labels]) {
      m.labels.delete(l);
      m.uids.delete(l);
    }
    m.uids.delete(ALL_MAIL);
    m.labels.add(TRASH);
    this.enter(m, TRASH);
  }

  async listFolders(): Promise<ReadonlyArray<MailFolder>> {
    return LIST.filter((f) => !f.attributes.includes('\\Noselect')).map((f) => this.folder(f.path));
  }

  async listSince(
    folder: MailFolder,
    cursor?: SyncCursor,
  ): Promise<{ items: ReadonlyArray<MailItem>; nextCursor: SyncCursor }> {
    const from = cursor ? Number(cursor.value) : 0;
    const items: MailItem[] = [];
    for (const m of this.messages) {
      const uid = m.uids.get(folder.path);
      if (!this.holds(m, folder.path) || uid === undefined || uid < from) continue;
      items.push({
        messageId: m.id,
        folder,
        keywords: [],
        receivedAt: m.at,
        size: m.bytes.byteLength,
        sourceRef: `${folder.path}:${uid}`,
      });
    }
    return { items, nextCursor: { value: String(this.uidNext.get(folder.path) ?? 1) } };
  }

  async fetch(item: MailItem): Promise<RawMessage> {
    return { item, rfc822: this.find(item.messageId).bytes };
  }
}

interface World {
  readonly gmail: FakeGmail;
  readonly target: MemoryTarget;
  readonly ledger: MemoryLedger;
  readonly cursors: MemoryCursorStore;
}

function world(): World {
  return {
    gmail: new FakeGmail(),
    target: new MemoryTarget(),
    ledger: new MemoryLedger(),
    cursors: new MemoryCursorStore(),
  };
}

/** One pass, through the real view, with cursors unless told to list whole. */
function pass(w: World, options: { readonly whole?: boolean } = {}): ReturnType<typeof runShadowPass> {
  const deps: ReconcileDeps = {
    sourceIsAuthorityOnExistence: true,
    stillTheAuthority: async () => true,
    tenantId,
    mappingId,
    source: new GmailFolderView(w.gmail),
    target: w.target,
    ledger: w.ledger,
    ...(options.whole ? {} : { cursors: w.cursors }),
  };
  return runShadowPass(deps);
}

/** Where on the destination each message landed, by mailbox path. */
async function placed(w: World): Promise<Record<string, string[]>> {
  const pathOf = new Map<string, string>();
  for (const path of w.target.mailboxNames()) pathOf.set(await w.target.ensureMailbox({ path, specialUse: 'normal' }), path);
  const out: Record<string, string[]> = {};
  for await (const e of w.target.listEntries()) {
    const path = pathOf.get(e.mailboxId ?? '') ?? '?';
    (out[path] ??= []).push(e.naturalKey);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

const moves = (w: World) => w.ledger.listMoves(tenantId, mappingId, 'email');

describe('Gmail: All Mail is read last, as Archive', () => {
  it('lists every real folder first and All Mail last, by its \\All attribute under a Dutch name', async () => {
    const folders = await new GmailFolderView(new FakeGmail()).listFolders();
    expect(folders.map((f) => f.path)).toEqual([
      'INBOX',
      'Work',
      '[Gmail]/Concepten',
      TRASH,
      SPAM,
      '[Gmail]/Verzonden berichten',
      'Archive',
    ]);
    // Starred and Important stay dropped; Archive carries the RFC 6154 role.
    expect(folders.at(-1)).toMatchObject({ specialUse: 'archive', catchAll: true });
  });

  it('copies a message that is ONLY in All Mail into Archive, once', async () => {
    const w = world();
    w.gmail.deliver('<archived@example.org>', []);
    w.gmail.deliver('<inbox@example.org>', ['INBOX']);

    const first = await pass(w);
    expect(first.created).toBe(2);
    expect(await placed(w)).toEqual({
      INBOX: ['<inbox@example.org>'],
      Archive: ['<archived@example.org>'],
    });

    // Again, with cursors and listed whole: nothing more.
    expect((await pass(w)).created).toBe(0);
    expect((await pass(w, { whole: true })).created).toBe(0);
    expect(w.target.size()).toBe(2);
    expect(await moves(w)).toEqual([]);
  });

  it('copies a message under INBOX and a label once, and never reports it as a move', async () => {
    const w = world();
    w.gmail.deliver('<two-labels@example.org>', ['INBOX', 'Work']);

    const first = await pass(w);
    expect(first.created).toBe(1);
    expect(first.moved).toBe(0);
    expect(await placed(w)).toEqual({ INBOX: ['<two-labels@example.org>'] });

    // Listed whole again (no cursors): INBOX, Work and All Mail all show it.
    const again = await pass(w, { whole: true });
    expect(again).toMatchObject({ created: 0, moved: 0 });
    expect(w.target.size()).toBe(1);
    expect(await moves(w)).toEqual([]);
  });

  it('a message archived after its first copy is neither a deletion nor a move, and stays where it was copied', async () => {
    const w = world();
    w.gmail.deliver('<later-archived@example.org>', ['INBOX']);
    await pass(w);
    expect(await placed(w)).toEqual({ INBOX: ['<later-archived@example.org>'] });

    w.gmail.archive('<later-archived@example.org>');
    const withCursors = await pass(w);
    const whole = await pass(w, { whole: true });
    // And with All Mail's cursor lost, so it lists everything again.
    const fresh = world();
    const lostCursors = await runShadowPass({
      sourceIsAuthorityOnExistence: true,
      stillTheAuthority: async () => true,
      tenantId,
      mappingId,
      source: new GmailFolderView(w.gmail),
      target: w.target,
      ledger: w.ledger,
      cursors: fresh.cursors,
    });

    for (const r of [withCursors, whole, lostCursors]) {
      expect(r).toMatchObject({ created: 0, moved: 0 });
      expect(r.deletions ?? []).toEqual([]);
    }
    expect(await moves(w)).toEqual([]);
    expect(await w.ledger.listDeletions(tenantId, mappingId)).toEqual([]);
    expect(await placed(w)).toEqual({ INBOX: ['<later-archived@example.org>'] });
  });

  it('still leaves Spam and Trash out, and still reads the bin for deletions', async () => {
    const w = world();
    w.gmail.deliver('<spam@example.org>', [SPAM]);
    w.gmail.deliver('<kept@example.org>', ['INBOX']);
    w.gmail.deliver('<binned@example.org>', ['INBOX']);
    const first = await pass(w);
    expect(first.created).toBe(2);
    expect(first.excludedCollections).toEqual(expect.arrayContaining(['trash', 'junk']));

    w.gmail.trash('<binned@example.org>');
    const second = await pass(w);
    expect(second.created).toBe(0);
    expect(second.deletions?.map((d) => d.naturalKeyHash)).toHaveLength(1);
    expect(await placed(w)).toEqual({ INBOX: ['<binned@example.org>', '<kept@example.org>'] });
  });

  it("counts every message by Gmail's own All Mail figure, Spam and Trash aside", async () => {
    const gmail = new FakeGmail();
    gmail.deliver('<a@example.org>', ['INBOX', 'Work']);
    gmail.deliver('<b@example.org>', []);
    gmail.deliver('<c@example.org>', [SPAM]);
    expect(await new GmailFolderView(gmail).countEveryMessage({ before: new Date(PASS_STARTED) })).toBe(2);
  });

  it('counts only what arrived before the cut-off, and one per Message-ID', async () => {
    const gmail = new FakeGmail();
    gmail.deliver('<a@example.org>', ['INBOX']);
    // Two messages with one Message-ID: one copy, so one in the count.
    gmail.deliver('<twice@example.org>', ['INBOX']);
    gmail.deliver('<twice@example.org>', []);
    // Arrived after the last completed pass started: no pass has had it yet.
    gmail.deliver('<new@example.org>', ['INBOX'], '2026-11-20T00:00:00.000Z');
    expect(await new GmailFolderView(gmail).countEveryMessage({ before: new Date(PASS_STARTED) })).toBe(2);
    expect(await new GmailFolderView(gmail).countEveryMessage({ before: new Date('2026-12-01') })).toBe(3);
  });
});

describe('Gmail on Confirm: what will be copied, and what Gmail itself counts', () => {
  it('counts each message once, label-less archived mail included, beside All Mail\'s own figure', async () => {
    const gmail = new FakeGmail();
    gmail.deliver('<two-labels@example.org>', ['INBOX', 'Work']);
    gmail.deliver('<archived@example.org>', []);
    gmail.deliver('<sent@example.org>', ['[Gmail]/Verzonden berichten']);
    gmail.deliver('<spam@example.org>', [SPAM]);

    const found = await discoverSource(new GmailFolderView(gmail), {
      isExcluded: (f) => (f.specialUse === 'junk' || f.specialUse === 'trash' ? f.specialUse : undefined),
    });
    // Three to copy, once each: the two-label message is not counted twice,
    // and the archived one counts in Archive.
    expect(found.items).toBe(3);
    // Gmail's own count: All Mail, every message once, Spam and Trash aside.
    expect(found.sourceTotal).toBe(3);
    const archive = found.perCollection?.find((c) => c.name === 'Archive');
    expect(archive).toMatchObject({ items: 1, sourceTotal: 3 });
    expect(found.perCollection?.find((c) => c.name === 'Work')).toMatchObject({ items: 0 });
  });

  it('carries no source figure for a source without All Mail', async () => {
    const found = await discoverSource({
      listFolders: async () => [{ path: 'INBOX', specialUse: 'inbox' as const }],
      listSince: async () => ({ items: [], nextCursor: { value: '' } }),
    });
    expect(found.sourceTotal).toBeUndefined();
  });
});

describe("Gmail on the Check: measured against Gmail's own count", () => {
  /** The ledger's side, read from what the pass recorded and the target holds. */
  async function readerOf(w: World, window: SourceCountWindow): Promise<LedgerVerificationReader> {
    const hashes: string[] = [];
    for await (const e of w.target.listEntries()) hashes.push(naturalKeyHash(e.naturalKey));
    return {
      countItems: async (_t: unknown, _m: unknown, domain: string) => (domain === 'email' ? w.ledger.size() : 0),
      totalSizeBytes: async () => 0,
      getAllNaturalKeyHashes: async (_t: unknown, _m: unknown, domain: string) => (domain === 'email' ? hashes : []),
      getSamples: async () => [],
      sourceCountWindow: async () => window,
    } as unknown as LedgerVerificationReader;
  }

  async function check(
    w: World,
    withGmailsCount: boolean,
    options: {
      /** What the ledger's status says: the last completed pass's start, and the switch. */
      readonly window?: SourceCountWindow;
      /** Gmail cannot be asked: the account deleted, or our access withdrawn. */
      readonly gmailGone?: true;
    } = {},
  ) {
    const count = options.gmailGone
      ? async () => {
          throw new Error('Invalid credentials (Failure)');
        }
      : mailSourceSideCount({ source: new GmailFolderView(w.gmail) });
    return runVerification(
      createRealVerificationDeps({
        tenantId,
        mappingId,
        config: {
          checksumSamplePercentage: 5,
          minSampleSize: 1,
          maxSampleSize: 10,
          requiredMatchPercentage: 0.99,
          maxDiscrepancyPercentage: 0.01,
          verifyMail: true,
          verifyCalendar: false,
          verifyContacts: false,
          verifyFiles: false,
          verifyTasks: false,
        },
        verificationReader: await readerOf(
          w,
          options.window ?? { lastCompletedPassStartedAt: PASS_STARTED, pastTheSwitch: false },
        ),
        targetReindexers: { mail: w.target },
        ...(withGmailsCount && count ? { sourceSideCounts: { mail: count } } : {}),
      }),
    );
  }

  /** A pass as it ran before the fix: All Mail never read. */
  async function passWithoutAllMail(w: World): Promise<void> {
    const view = new GmailFolderView(w.gmail);
    await runShadowPass({
      sourceIsAuthorityOnExistence: true,
      stillTheAuthority: async () => true,
      tenantId,
      mappingId,
      source: {
        listFolders: async () => (await view.listFolders()).filter((f) => !f.catchAll),
        listSince: (f, c) => view.listSince(f, c),
        fetch: (i) => view.fetch(i),
      },
      target: w.target,
      ledger: w.ledger,
    });
  }

  it('FAILS when one All-Mail-only message was never copied, which the ledger alone passed', async () => {
    const w = world();
    w.gmail.deliver('<inbox@example.org>', ['INBOX']);
    w.gmail.deliver('<archived@example.org>', []);
    await passWithoutAllMail(w);
    expect(w.target.size()).toBe(1);

    // The hole: measured against the ledger, the loss is on neither side.
    expect((await check(w, false)).mail.status).toBe('PASS');

    const r = await check(w, true);
    expect(r.mail.status).toBe('FAIL');
    expect(r.mail.sourceCount).toBe(2);
    expect(r.mail.missingOnTarget).toBe(1);
    expect(r.mail.issues.map((i) => i.id)).toContain('NEVER_COPIED_mail');
    expect(r.canProceedToCutover).toBe(false);
  });

  it('passes once All Mail is read and the message is in Archive', async () => {
    const w = world();
    w.gmail.deliver('<inbox@example.org>', ['INBOX']);
    w.gmail.deliver('<archived@example.org>', []);
    await pass(w);
    const r = await check(w, true);
    expect(r.mail.status).toBe('PASS');
    expect(r.mail).toMatchObject({ sourceCount: 2, matchedCount: 2, missingOnTarget: 0 });
  });

  it('does not fail over mail that arrived after the last completed pass started', async () => {
    const w = world();
    w.gmail.deliver('<inbox@example.org>', ['INBOX']);
    await pass(w);
    // Arrives in All Mail, with no label, after that pass started.
    w.gmail.deliver('<since@example.org>', [], '2026-11-20T00:00:00.000Z');

    const r = await check(w, true);
    expect(r.mail.status).toBe('PASS');
    expect(r.mail.issues.map((i) => i.id)).not.toContain('NEVER_COPIED_mail');
  });

  it('does not fail for good over two messages that share one Message-ID', async () => {
    const w = world();
    w.gmail.deliver('<twice@example.org>', ['INBOX']);
    w.gmail.deliver('<twice@example.org>', ['INBOX']);
    await pass(w);
    expect(w.target.size()).toBe(1);

    const r = await check(w, true);
    expect(r.mail.status).toBe('PASS');
    expect(r.mail).toMatchObject({ sourceCount: 1, missingOnTarget: 0 });
  });

  it('holds nothing to the figure before any pass has completed', async () => {
    const w = world();
    w.gmail.deliver('<inbox@example.org>', ['INBOX']);
    w.gmail.deliver('<archived@example.org>', []);
    await passWithoutAllMail(w);
    // No completed pass in the status: the ledger's count, as before.
    const r = await check(w, true, { window: { pastTheSwitch: false } });
    expect(r.mail.issues.map((i) => i.id)).not.toContain('NEVER_COPIED_mail');
    expect(r.mail.sourceCount).toBe(1);
  });

  it('before the switch, a Gmail that cannot be asked holds the Check (NOT_VERIFIABLE)', async () => {
    const w = world();
    w.gmail.deliver('<inbox@example.org>', ['INBOX']);
    await pass(w);
    const r = await check(w, true, { gmailGone: true });
    expect(r.mail.status).toBe('NOT_VERIFIABLE');
    expect(r.mail.issues[0]?.message).toContain('Invalid credentials (Failure)');
  });

  it('after the switch, a Gmail that cannot be asked is measured against our own record, and says so', async () => {
    const w = world();
    w.gmail.deliver('<inbox@example.org>', ['INBOX']);
    w.gmail.deliver('<archived@example.org>', []);
    await pass(w);
    const r = await check(w, true, {
      gmailGone: true,
      window: { lastCompletedPassStartedAt: PASS_STARTED, pastTheSwitch: true },
    });
    expect(r.mail.status).toBe('PASS');
    expect(r.mail).toMatchObject({ sourceCount: 2, matchedCount: 2, missingOnTarget: 0 });
    const own = r.mail.issues.find((i) => i.id === 'SOURCE_COUNT_OWN_RECORD_mail');
    expect(own).toMatchObject({ severity: 'WARNING' });
    expect(own?.message).toContain('Invalid credentials (Failure)');
  });

  it("is no measure of a test migration or of one that leaves out more than Spam and Trash", () => {
    const view = new GmailFolderView(new FakeGmail());
    expect(mailSourceSideCount({ source: view })).toBeTypeOf('function');
    expect(mailSourceSideCount({ source: view, excludeSpecialUse: ['trash', 'junk', 'sent'] })).toBeUndefined();
    expect(mailSourceSideCount({ source: Object.assign(Object.create(view), { markedOnly: true }) })).toBeUndefined();
  });
});
