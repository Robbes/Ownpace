// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The WRITE-path parity harness (workplan 0032 T2).
 *
 * **These tests perturb rather than agree, and that is the whole point.** A
 * harness that cannot fail is worse than no harness: it produces a green badge
 * over an unexamined migration. So every case below breaks one writer in one
 * specific way and asserts the harness NAMES it — the duplicate, the lost
 * adoption, the wrong hash, the missing size, the lookup that answers "absent"
 * for a message that is there.
 *
 * The baseline case (two identical writers agree) is deliberately LAST and
 * deliberately small, because it is the one assertion that proves nothing on
 * its own.
 */

import { describe, it, expect } from 'vitest';
import type {
  TargetEntry,
  MailFolder,
  MailKeyword,
  RawMessage,
  UpsertResult,
} from '@openmig/shared';
import { contentHash } from '@openmig/shared';
import {
  compareMailTargets,
  describeTargetDifferences,
  type ComparableMailTarget,
  type ParityMessage,
} from './imap-target-parity';

/** Ways a fake writer can be broken, one at a time. */
interface Faults {
  /** Append again on the second pass instead of adopting — the duplicate. */
  readonly duplicateOnSecondPass?: boolean;
  /** Report `adopted` on the second pass but append anyway — the sneakier one. */
  readonly lieAboutAdopting?: boolean;
  /** Report a hash of something other than the stored bytes. */
  readonly wrongHash?: boolean;
  /** Omit `sizeBytes` from listed entries. */
  readonly noSize?: boolean;
  /** Answer "not found" for a message that is present. */
  readonly blindLookup?: boolean;
  /** Return a non-UID targetId. */
  readonly badTargetId?: boolean;
  /** Never report a targetVersion. */
  readonly noTargetVersion?: boolean;
}

/** An in-memory mail target, correct unless a fault says otherwise. */
class FakeTarget implements ComparableMailTarget {
  private readonly boxes = new Map<string, Array<{ uid: number; id: string; bytes: Uint8Array }>>();
  private nextUid = 1;

  constructor(private readonly faults: Faults = {}) {}

  async ensureMailbox(folder: MailFolder): Promise<string> {
    const name = folder.path || folder.name!;
    if (!this.boxes.has(name)) this.boxes.set(name, []);
    return name;
  }

  async findByNaturalKey(mailboxId: string, naturalKey: string): Promise<string | undefined> {
    if (this.faults.blindLookup) return undefined;
    const key = strip(naturalKey);
    const found = (this.boxes.get(mailboxId) ?? []).find((m) => m.id === key);
    return found ? String(found.uid) : undefined;
  }

  async upsertEmail(
    mailboxId: string,
    raw: RawMessage,
    _keywords: ReadonlyArray<MailKeyword>,
  ): Promise<UpsertResult> {
    const box = this.boxes.get(mailboxId) ?? [];
    this.boxes.set(mailboxId, box);
    const id = strip(idOf(raw.rfc822));

    // THROUGH THE LOOKUP, exactly as both real writers do. Reading `box`
    // directly here was this fake's own bug: it made `blindLookup` a wrong
    // ANSWER rather than a duplicate, so the test asserting that a blind lookup
    // duplicates failed against a harness that was working correctly. A fake
    // that does not share the real writers' control flow cannot model their
    // failure modes.
    const existing = await this.findByNaturalKey(mailboxId, id);

    if (existing && !this.faults.duplicateOnSecondPass && !this.faults.lieAboutAdopting) {
      return {
        targetId: existing,
        created: false,
        adopted: true,
        ...(this.faults.noTargetVersion ? {} : { targetVersion: '1' }),
      };
    }

    const uid = this.nextUid++;
    box.push({ uid, id, bytes: raw.rfc822 });
    if (existing && this.faults.lieAboutAdopting) {
      // Appended AND claimed to have adopted. Only a count of what is really in
      // the mailbox catches this.
      return {
        targetId: existing,
        created: false,
        adopted: true,
        ...(this.faults.noTargetVersion ? {} : { targetVersion: '1' }),
      };
    }
    return {
      targetId: this.faults.badTargetId ? 'not-a-uid' : String(uid),
      created: true,
      ...(this.faults.noTargetVersion ? {} : { targetVersion: '1' }),
    };
  }

  async *listEntries(mailboxId?: string): AsyncIterable<TargetEntry> {
    for (const [name, box] of this.boxes) {
      if (mailboxId && name !== mailboxId) continue;
      for (const m of box) {
        yield {
          naturalKey: m.id,
          targetId: String(m.uid),
          mailboxId: name,
          ...(this.faults.noSize ? {} : { sizeBytes: m.bytes.byteLength }),
        };
      }
    }
  }

  async contentHashFor(entry: TargetEntry): Promise<string | undefined> {
    const box = this.boxes.get(entry.mailboxId) ?? [];
    const found = box.find((m) => String(m.uid) === entry.targetId);
    if (!found) return undefined;
    if (this.faults.wrongHash) return contentHash(new TextEncoder().encode('something else'));
    return contentHash(found.bytes);
  }
}

function strip(v: string): string {
  return v.replace(/[<>]/g, '').trim();
}

function idOf(bytes: Uint8Array): string {
  const text = Buffer.from(bytes).toString('utf8');
  return /Message-ID:\s*([^\r\n]+)/i.exec(text)?.[1]?.trim() ?? '';
}

function fixture(n: number): ParityMessage {
  const messageId = `parity-target-${n}@dev.local`;
  const rfc822 = new TextEncoder().encode(
    [`Message-ID: <${messageId}>`, 'From: a@dev.local', 'To: b@dev.local', '', `body ${n}`].join(
      '\r\n',
    ),
  );
  return { messageId, rfc822, keywords: ['$seen'] };
}

const MESSAGES = [fixture(1), fixture(2)];
const BOXES = { mailboxA: 'PARITY-A', mailboxB: 'PARITY-B', messages: MESSAGES } as const;

async function run(a: ComparableMailTarget, b: ComparableMailTarget) {
  return compareMailTargets(a, b, BOXES);
}

describe('the write-path parity harness names what broke', () => {
  it('catches a DUPLICATE on the second pass', async () => {
    const result = await run(new FakeTarget(), new FakeTarget({ duplicateOnSecondPass: true }));
    // The failure this whole workplan exists to prevent: a successful write, a
    // correct-looking result, and a mailbox that doubles every pass.
    expect(result.differences.length).toBeGreaterThan(0);
    const fields = result.differences.map((d) => `${d.where} · ${d.field}`);
    expect(fields.some((f) => f.startsWith('second-pass/') && f.endsWith('created'))).toBe(true);
    expect(fields).toContain('entries · count');
  });

  it('catches a writer that CLAIMS to adopt and appends anyway', async () => {
    const result = await run(new FakeTarget(), new FakeTarget({ lieAboutAdopting: true }));
    // Every returned flag agrees here — `created: false`, `adopted: true`, the
    // same targetId. Only the count of what is really in the mailbox differs,
    // which is exactly why the harness reads `listEntries` instead of trusting
    // the result objects.
    const fields = result.differences.map((d) => `${d.where} · ${d.field}`);
    expect(fields).toContain('entries · count');
    expect(fields).toContain('entries · count matches what was written');
  });

  it('catches a content hash that does not describe the stored bytes', async () => {
    const result = await run(new FakeTarget(), new FakeTarget({ wrongHash: true }));
    const fields = result.differences.map((d) => `${d.where} · ${d.field}`);
    expect(fields.some((f) => f.endsWith('· hash'))).toBe(true);
    // And against the SOURCE bytes, so two writers hashing the same wrong thing
    // would still be caught.
    expect(fields.some((f) => f.endsWith('· matches the source hash'))).toBe(true);
  });

  it('catches a missing per-entry size, which verification needs to measure bytes', async () => {
    const result = await run(new FakeTarget(), new FakeTarget({ noSize: true }));
    expect(result.differences.map((d) => d.field)).toContain('every entry carries a size');
  });

  it('catches a lookup that answers "absent" for a message that is present', async () => {
    const result = await run(new FakeTarget(), new FakeTarget({ blindLookup: true }));
    const fields = result.differences.map((d) => `${d.where} · ${d.field}`);
    // A blind lookup is how a duplicate gets written, so it shows up twice: the
    // find leg reports it directly, and the second pass appends instead of
    // adopting.
    expect(fields.some((f) => f.startsWith('find/') && f.endsWith('found'))).toBe(true);
    expect(fields).toContain('entries · count');
  });

  it('catches a targetId that is not a UID', async () => {
    const result = await run(new FakeTarget(), new FakeTarget({ badTargetId: true }));
    // A naive string comparison would pass two writers that both returned
    // rubbish; this compares the SHAPE, because the value legitimately differs
    // between two mailboxes.
    expect(result.differences.map((d) => d.field)).toContain('targetId is a UID');
  });

  it('catches a missing targetVersion, which removal depends on', async () => {
    const result = await run(new FakeTarget(), new FakeTarget({ noTargetVersion: true }));
    // Without it, `removeItem`'s UIDVALIDITY gate has nothing to check and a
    // recreated mailbox would have `apply` remove whatever message now holds
    // that number.
    expect(result.differences.map((d) => d.field)).toContain('targetVersion present');
  });

  it('refuses to run both writers against ONE mailbox', async () => {
    // Sharing a mailbox makes the second writer adopt the first's messages, so
    // the harness would report a difference that is purely an artefact of
    // ordering. Refusing beats producing a confident wrong answer.
    await expect(
      compareMailTargets(new FakeTarget(), new FakeTarget(), {
        messages: MESSAGES,
        mailboxA: 'SAME',
        mailboxB: 'SAME',
      }),
    ).rejects.toThrow(/mailbox per writer/);
  });

  it('reports agreement only when the two really agree, with counts to prove it ran', async () => {
    const result = await run(new FakeTarget(), new FakeTarget());
    expect(result.differences, describeTargetDifferences(result)).toEqual([]);
    // "No differences" over an empty script is a tautology with a passing
    // badge. The counts are what make the green mean something.
    expect(result.messagesWritten).toBe(MESSAGES.length);
    expect(result.entriesListed).toBe(MESSAGES.length);
    expect(result.hashesCompared).toBe(MESSAGES.length);
    expect(describeTargetDifferences(result)).toContain('no differences');
  });
});
