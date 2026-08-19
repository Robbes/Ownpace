// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import {
  ensureMessageId,
  generateMessageId,
  readMessageId,
  isGeneratedMessageId,
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
