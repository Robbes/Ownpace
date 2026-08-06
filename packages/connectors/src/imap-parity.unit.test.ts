// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The parity harness, tested for the only property that matters: **that it can
 * fail** (workplan 0032 T0).
 *
 * A harness compared against itself is always green. That is not evidence, it
 * is a tautology with a passing badge — and it is the exact shape this repo
 * keeps finding, so it gets caught here rather than in the migration it is
 * supposed to guard.
 *
 * So every test below perturbs ONE thing about an otherwise identical
 * connector and asserts the harness names it. The perturbations are not
 * invented: each is a real way an IMAP client can differ from another, and the
 * first is the one that would cost a customer their mailbox twice over.
 */

import { describe, it, expect } from 'vitest';
import type { SourceConnector, MailFolder, MailItem, RawMessage, SyncCursor } from '@openmig/shared';
import { compareSources, describeDifferences } from './imap-parity';

const INBOX: MailFolder = { path: 'INBOX', name: 'INBOX', specialUse: 'inbox' };
const SENT: MailFolder = { path: 'Sent', name: 'Sent', specialUse: 'sent' };

function item(overrides: Partial<MailItem> = {}): MailItem {
  return {
    messageId: '<abc-123@dev.local>',
    folder: INBOX,
    keywords: ['$seen'],
    receivedAt: '2026-08-05T10:00:00.000Z',
    size: 512,
    sourceRef: 'INBOX:42',
    ...overrides,
  };
}

/** A connector over fixed data — the thing both sides of a comparison are. */
class StubSource implements SourceConnector {
  constructor(
    private readonly folders: ReadonlyArray<MailFolder>,
    private readonly items: ReadonlyArray<MailItem>,
    private readonly bodies: Record<string, string> = {},
    private readonly cursor = '1:100',
    private readonly unkeyable = 0,
  ) {}

  async listFolders(): Promise<ReadonlyArray<MailFolder>> {
    return this.folders;
  }

  async listSince(folder: MailFolder): Promise<{
    items: ReadonlyArray<MailItem>;
    nextCursor: SyncCursor;
    unkeyable?: number;
  }> {
    return {
      items: this.items.filter((i) => i.folder.path === folder.path),
      nextCursor: { value: this.cursor },
      ...(this.unkeyable > 0 ? { unkeyable: this.unkeyable } : {}),
    };
  }

  async fetch(it: MailItem): Promise<RawMessage> {
    const body = this.bodies[it.sourceRef] ?? 'From: a@dev.local\r\n\r\nbody';
    return { item: it, rfc822: new TextEncoder().encode(body) };
  }
}

function baseline(): StubSource {
  return new StubSource([INBOX, SENT], [item(), item({ sourceRef: 'INBOX:43', messageId: '<b@d>' })]);
}

describe('the property the whole migration rests on', () => {
  it('CATCHES a client that normalises the Message-ID differently', async () => {
    // THE test. `naturalKeyForItem()` hashes this field, so a client that
    // strips the angle brackets produces a different key for the same message
    // — and every message re-copies on the next pass, silently, because a
    // duplicate is a successful write.
    //
    // Angle-bracket stripping is not a hypothetical: it is the single most
    // common difference between IMAP libraries, because RFC 5322 msg-id
    // includes them and half the ecosystem treats them as delimiters.
    const b = new StubSource(
      [INBOX, SENT],
      [item({ messageId: 'abc-123@dev.local' }), item({ sourceRef: 'INBOX:43', messageId: '<b@d>' })],
    );

    const result = await compareSources(baseline(), b);

    expect(result.differences).toHaveLength(1);
    expect(result.differences[0]).toMatchObject({
      where: 'INBOX/items/INBOX:42',
      field: 'messageId',
      a: '<abc-123@dev.local>',
      b: 'abc-123@dev.local',
    });
  });

  it('does NOT trim or unwrap the Message-ID before comparing', async () => {
    // A harness that normalised whitespace here would report parity on exactly
    // the difference it exists to catch. Trailing space is a real one: some
    // clients hand back the raw header line.
    const b = new StubSource(
      [INBOX, SENT],
      [item({ messageId: '<abc-123@dev.local> ' }), item({ sourceRef: 'INBOX:43', messageId: '<b@d>' })],
    );
    const result = await compareSources(baseline(), b);
    expect(result.differences.map((d) => d.field)).toContain('messageId');
  });
});

describe('the differences that are ordinary bugs rather than silent duplication', () => {
  it('catches a dropped flag', async () => {
    const b = new StubSource(
      [INBOX, SENT],
      [item({ keywords: [] }), item({ sourceRef: 'INBOX:43', messageId: '<b@d>' })],
    );
    const result = await compareSources(baseline(), b);
    expect(result.differences[0]).toMatchObject({ field: 'keywords', a: '$seen', b: '' });
  });

  it('treats flags as a SET, not a sequence', async () => {
    // Two clients reporting the same flags in a different order have not
    // disagreed about anything, and reporting it would bury a real difference
    // under noise.
    const a = new StubSource([INBOX], [item({ keywords: ['$seen', '$flagged'] })]);
    const b = new StubSource([INBOX], [item({ keywords: ['$flagged', '$seen'] })]);
    const result = await compareSources(a, b);
    expect(result.differences).toEqual([]);
  });

  it('catches a different received date', async () => {
    const b = new StubSource(
      [INBOX, SENT],
      [
        item({ receivedAt: '2026-08-05T11:00:00.000Z' }),
        item({ sourceRef: 'INBOX:43', messageId: '<b@d>' }),
      ],
    );
    const result = await compareSources(baseline(), b);
    expect(result.differences[0]).toMatchObject({ field: 'receivedAt' });
  });

  it('catches a folder the other client did not report', async () => {
    const b = new StubSource([INBOX], [item()]);
    const result = await compareSources(baseline(), b);
    expect(result.differences[0]).toMatchObject({ where: 'folders', field: 'path' });
  });

  it('catches a special-use attribute read differently', async () => {
    // RFC 6154 detection is exactly the kind of thing two libraries disagree
    // about, and getting it wrong sends Sent mail to a folder called Sent that
    // the target does not treat as Sent.
    const b = new StubSource(
      [INBOX, { ...SENT, specialUse: 'normal' }],
      [item(), item({ sourceRef: 'INBOX:43', messageId: '<b@d>' })],
    );
    const result = await compareSources(baseline(), b);
    expect(result.differences[0]).toMatchObject({ where: 'folders/Sent', field: 'specialUse' });
  });

  it('catches a cursor that would make the next pass resume elsewhere', async () => {
    const b = new StubSource([INBOX, SENT], [item(), item({ sourceRef: 'INBOX:43', messageId: '<b@d>' })], {}, '1:999');
    const result = await compareSources(baseline(), b);
    expect(result.differences.some((d) => d.field === 'nextCursor')).toBe(true);
  });

  it('catches a disagreement about which messages have no Message-ID', async () => {
    const b = new StubSource(
      [INBOX, SENT],
      [item(), item({ sourceRef: 'INBOX:43', messageId: '<b@d>' })],
      {},
      '1:100',
      3,
    );
    const result = await compareSources(baseline(), b);
    expect(result.differences.some((d) => d.field === 'unkeyable')).toBe(true);
  });

  it('catches bodies that differ, without putting the bytes in the message', async () => {
    const a = new StubSource([INBOX], [item()], { 'INBOX:42': 'From: a@dev.local\r\n\r\none' });
    const b = new StubSource([INBOX], [item()], { 'INBOX:42': 'From: a@dev.local\r\n\r\ntwo!!' });
    const result = await compareSources(a, b);

    expect(result.differences[0]).toMatchObject({ field: 'rfc822' });
    // §17 counts message content as personal data, and a failure message ends
    // up in CI logs. Report the shape, never the bytes.
    expect(result.differences[0]!.a).toMatch(/^\d+ bytes$/);
    expect(describeDifferences(result)).not.toContain('two!!');
  });
});

describe('what a green result is allowed to claim', () => {
  it('agrees with itself, and says how much it actually compared', async () => {
    const result = await compareSources(baseline(), baseline());
    expect(result.differences).toEqual([]);
    // The counts are the guard against the tautology. A caller that asserts
    // only `differences === []` passes just as happily against two empty
    // mailboxes, which prove nothing whatsoever.
    expect(result.foldersCompared).toBe(2);
    expect(result.itemsCompared).toBe(2);
    expect(result.bodiesCompared).toBe(2);
  });

  it('reports ZERO compared for two empty sources rather than implying success', async () => {
    const empty = new StubSource([], []);
    const result = await compareSources(empty, empty);
    expect(result.differences).toEqual([]);
    // No differences AND nothing compared. `describeDifferences` says both, so
    // a green run cannot be read as coverage it did not have.
    expect(result.itemsCompared).toBe(0);
    expect(describeDifferences(result)).toContain('0 item(s)');
  });

  it('says explicitly when the body leg did not run', async () => {
    const result = await compareSources(baseline(), baseline(), { sampleBodies: 0 });
    expect(result.bodiesCompared).toBe(0);
    expect(describeDifferences(result)).toContain('0 body/bodies');
  });
});
