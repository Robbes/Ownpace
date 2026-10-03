// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Generating a Message-ID touches the idempotency anchor (hard rule 1), so the
// properties below are not stylistic — each one, broken, produces duplicates or
// silent data loss:
//
//   - not stable across runs      -> a new key every pass -> the message is
//                                    copied again every pass
//   - not derived from content    -> a UID or timestamp changes when the message
//                                    moves or the folder is recreated -> same
//   - not written into the message -> the target reindexer cannot see it, so the
//                                    message migrates but stays invisible to
//                                    verification: the hole we are closing
//   - rewrites messages that already have one -> every message's content hash
//                                    changes for no reason

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  asWrittenBefore,
  ensureMessageId,
  generateMessageId,
  legacyGeneratedMessageId,
  readMessageId,
  isGeneratedMessageId,
  withoutGeneratedMessageId,
  GENERATED_MESSAGE_ID_DOMAIN,
} from './generated-message-id.ts';
import { naturalKeyHash } from './hash.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

const WITH_ID = enc('Subject: hi\r\nMessage-ID: <real@example.com>\r\n\r\nbody');
const WITHOUT_ID = enc('Subject: hi\r\nFrom: a@example.com\r\n\r\nbody');

describe('readMessageId', () => {
  it('finds the header regardless of case', () => {
    expect(readMessageId(WITH_ID)).toBe('<real@example.com>');
    expect(readMessageId(enc('message-id: <x@y>\r\n\r\nb'))).toBe('<x@y>');
    expect(readMessageId(enc('MESSAGE-ID: <x@y>\r\n\r\nb'))).toBe('<x@y>');
  });

  it('unfolds a wrapped header (RFC 5322 §2.2.3)', () => {
    // Reading only the first physical line would truncate the id, mint a
    // "generated" one for a message that already has a perfectly good id, and
    // rewrite the message for no reason.
    const folded = enc('Message-ID:\r\n <very-long-id@example.com>\r\n\r\nbody');
    expect(readMessageId(folded)).toBe('<very-long-id@example.com>');
  });

  it('returns undefined when absent or empty', () => {
    expect(readMessageId(WITHOUT_ID)).toBeUndefined();
    expect(readMessageId(enc('Message-ID:   \r\n\r\nbody'))).toBeUndefined();
  });

  it('does not read a Message-ID out of the BODY', () => {
    // A quoted reply containing "Message-ID: <...>" in its text must not be
    // mistaken for this message's own header.
    const quoted = enc('Subject: fwd\r\n\r\n> Message-ID: <quoted@example.com>\r\n');
    expect(readMessageId(quoted)).toBeUndefined();
  });

  it('handles bare-LF messages, which real servers do produce', () => {
    expect(readMessageId(enc('Message-ID: <lf@example.com>\n\nbody'))).toBe('<lf@example.com>');
  });

  it('is not fooled by a header that merely ends in message-id', () => {
    const other = enc('X-Original-Message-Id: <other@example.com>\r\n\r\nbody');
    expect(readMessageId(other)).toBeUndefined();
  });
});

describe('generateMessageId', () => {
  it('is stable: the same bytes always give the same id', () => {
    // The property everything else rests on. If this ever varies, every pass
    // mints a new key and re-copies the message.
    expect(generateMessageId(WITHOUT_ID)).toBe(generateMessageId(WITHOUT_ID));
    expect(generateMessageId(new Uint8Array(WITHOUT_ID))).toBe(generateMessageId(WITHOUT_ID));
  });

  it('differs for different messages', () => {
    expect(generateMessageId(enc('a'))).not.toBe(generateMessageId(enc('b')));
  });

  it('is a well-formed, non-resolvable Message-ID', () => {
    const id = generateMessageId(WITHOUT_ID);
    expect(id.startsWith('<')).toBe(true);
    expect(id.endsWith('>')).toBe(true);
    expect(id).toContain(`@${GENERATED_MESSAGE_ID_DOMAIN}`);
    // .invalid is reserved by RFC 2606 and can never resolve.
    expect(GENERATED_MESSAGE_ID_DOMAIN.endsWith('.invalid')).toBe(true);
  });

  it('is recognisable as ours afterwards', () => {
    expect(isGeneratedMessageId(generateMessageId(WITHOUT_ID))).toBe(true);
    expect(isGeneratedMessageId('<real@example.com>')).toBe(false);
  });
});

describe('generateMessageId is a hash of the message normalised (ADR-0020, 2026-10-03)', () => {
  /**
   * A server that builds a message's MIME when it is asked for it can serve
   * other bytes for the same message. Each case below is one way it does, and
   * each must give the same id, or the message is copied again.
   */
  const SENT = enc(
    [
      'Date: Fri, 3 Oct 2026 09:00:00 +0200',
      'From: Anna <anna@example.com>',
      'Subject: the minutes',
      'Content-Type: multipart/mixed; boundary="AAA"',
      '',
      '--AAA',
      'Content-Type: text/plain',
      '',
      'body',
      '--AAA--',
      '',
    ].join('\r\n'),
  );
  const id = generateMessageId(SENT);
  const variant = (f: (s: string) => string) => generateMessageId(enc(f(dec(SENT))));

  it('ignores the line endings', () => {
    expect(variant((s) => s.replace(/\r\n/g, '\n'))).toBe(id);
  });

  it('ignores headers a server adds on the way', () => {
    expect(variant((s) => `Received: from mx by store; Fri, 3 Oct 2026\r\nX-Spam-Score: 0\r\n${s}`)).toBe(id);
  });

  it('ignores the order of the headers', () => {
    expect(
      variant((s) =>
        s.replace(
          'Date: Fri, 3 Oct 2026 09:00:00 +0200\r\nFrom: Anna <anna@example.com>\r\nSubject: the minutes',
          'Subject: the minutes\r\nFrom: Anna <anna@example.com>\r\nDate: Fri, 3 Oct 2026 09:00:00 +0200',
        ),
      ),
    ).toBe(id);
  });

  it('ignores a boundary the server minted again', () => {
    expect(variant((s) => s.replaceAll('AAA', '_000_rebuilt_'))).toBe(id);
  });

  it('ignores whitespace at the ends of lines and of the body', () => {
    expect(variant((s) => s.replace('body', 'body   ') + '\r\n\r\n')).toBe(id);
  });

  it('still tells messages apart by their date, their sender and their body', () => {
    expect(variant((s) => s.replace('09:00:00', '09:30:00'))).not.toBe(id);
    expect(variant((s) => s.replace('anna@example.com', 'bas@example.com'))).not.toBe(id);
    expect(variant((s) => s.replace('body', 'another body'))).not.toBe(id);
  });
});

describe('the key a message without one had before 2026-10-03', () => {
  it('is the hash of its raw bytes, as every copy made until then carries it', () => {
    const raw = createHash('sha256').update(WITHOUT_ID).digest('hex');
    expect(legacyGeneratedMessageId(WITHOUT_ID)).toBe(`<${raw}@${GENERATED_MESSAGE_ID_DOMAIN}>`);
  });

  it('is computed from the bytes the source served, with the id we prepended taken off', () => {
    const written = ensureMessageId(WITHOUT_ID).rfc822;
    expect(withoutGeneratedMessageId(written)).toEqual(WITHOUT_ID);
    expect(legacyGeneratedMessageId(withoutGeneratedMessageId(written))).toBe(
      legacyGeneratedMessageId(WITHOUT_ID),
    );
  });

  it('leaves a message whose first line is not an id of ours as it is', () => {
    expect(withoutGeneratedMessageId(WITH_ID)).toEqual(WITH_ID);
  });
});

describe('a message as a pass before 2026-10-03 wrote it', () => {
  it('is the bytes the source served under the id they were given then, as they were written then', () => {
    const before = asWrittenBefore(ensureMessageId(WITHOUT_ID).rfc822);
    expect(before?.messageId).toBe(legacyGeneratedMessageId(WITHOUT_ID));
    // Byte for byte what `ensureMessageId` wrote when the id was the hash of
    // the raw bytes: the header prepended the same way, with the same ending.
    expect(dec(before!.rfc822)).toBe(`Message-ID: ${legacyGeneratedMessageId(WITHOUT_ID)}\r\n${dec(WITHOUT_ID)}`);
    expect(readMessageId(before!.rfc822)).toBe(before!.messageId);
  });

  it('keeps a bare-LF message bare LF', () => {
    const lf = enc('Subject: hi\nFrom: a@example.com\n\nbody');
    const before = asWrittenBefore(ensureMessageId(lf).rfc822);
    expect(dec(before!.rfc822)).toBe(`Message-ID: ${legacyGeneratedMessageId(lf)}\n${dec(lf)}`);
  });

  it('is nothing for a message that came with a Message-ID of its own', () => {
    expect(asWrittenBefore(ensureMessageId(WITH_ID).rfc822)).toBeUndefined();
  });

  it('is nothing for a message whose generated id this pass did not give it', () => {
    // An earlier migration's copy, read back as a source: its id is one of
    // ours, but not the one these bytes would be given now.
    const copied = enc(`Message-ID: ${legacyGeneratedMessageId(WITHOUT_ID)}\r\n${dec(WITHOUT_ID)}`);
    expect(asWrittenBefore(copied)).toBeUndefined();
  });
});

describe('ensureMessageId', () => {
  it('leaves a message that already has one byte-identical', () => {
    // The common path. Rewriting here would change the content hash of every
    // message in every migration.
    const result = ensureMessageId(WITH_ID);

    expect(result.generated).toBe(false);
    expect(result.messageId).toBe('<real@example.com>');
    expect(result.rfc822).toBe(WITH_ID);
  });

  it('adds a real Message-ID header the target can read back', () => {
    const result = ensureMessageId(WITHOUT_ID);

    expect(result.generated).toBe(true);
    // The load-bearing property: what we key by is what a reindexer reading
    // headers off the target will find. Derive-but-do-not-write would leave the
    // message invisible to verification — the hole this closes.
    expect(readMessageId(result.rfc822)).toBe(result.messageId);
    expect(dec(result.rfc822)).toContain('Message-ID: <');
  });

  it('keeps the original message intact below the added header', () => {
    const result = ensureMessageId(WITHOUT_ID);
    const text = dec(result.rfc822);

    expect(text).toContain('Subject: hi');
    expect(text).toContain('From: a@example.com');
    expect(text.endsWith('body')).toBe(true);
    expect(result.rfc822.length).toBeGreaterThan(WITHOUT_ID.length);
  });

  it('matches the message\'s own line endings', () => {
    // Splicing CRLF into a bare-LF message leaves a header block that strict
    // parsers reject.
    const lf = enc('Subject: hi\n\nbody');
    const result = ensureMessageId(lf);

    expect(dec(result.rfc822).startsWith('Message-ID: <')).toBe(true);
    expect(dec(result.rfc822)).not.toContain('\r\n');
    expect(readMessageId(result.rfc822)).toBe(result.messageId);
  });

  it('is idempotent: running it on its own output changes nothing', () => {
    // A second pass must see the message as already keyed. If it generated
    // again — now hashing the modified bytes — the key would drift on every
    // run and the message would be copied endlessly.
    const once = ensureMessageId(WITHOUT_ID);
    const twice = ensureMessageId(once.rfc822);

    expect(twice.generated).toBe(false);
    expect(twice.messageId).toBe(once.messageId);
    expect(twice.rfc822).toBe(once.rfc822);
  });

  it('gives a key the ledger and the reindexer both agree on', () => {
    const result = ensureMessageId(WITHOUT_ID);

    // What the sync records...
    const ledgerKey = naturalKeyHash(result.messageId);
    // ...and what a reindexer reading the target's headers would hash.
    const reindexerKey = naturalKeyHash(readMessageId(result.rfc822)!);

    expect(reindexerKey).toBe(ledgerKey);
  });

  it('derives the id from the ORIGINAL bytes, so re-fetching the source agrees', () => {
    // The source still holds the unmodified message. On the next pass we hash
    // what the source gives us; that must reproduce the same id we already
    // stored, or the ledger fast-path misses and we copy a duplicate.
    const result = ensureMessageId(WITHOUT_ID);
    expect(result.messageId).toBe(generateMessageId(WITHOUT_ID));
  });

  it('handles a message with no body separator at all', () => {
    const headersOnly = enc('Subject: hi\r\n');
    const result = ensureMessageId(headersOnly);

    expect(result.generated).toBe(true);
    expect(readMessageId(result.rfc822)).toBe(result.messageId);
  });

  it('does not corrupt a UTF-8 body', () => {
    const utf8 = enc('Subject: hi\r\n\r\nhello éè世界 🚀');
    const result = ensureMessageId(utf8);

    expect(dec(result.rfc822)).toContain('hello éè世界 🚀');
  });
});
