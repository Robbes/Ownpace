// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A SUBJECT NOBODY COULD READ.
 *
 * #995 put a name beside the identifier on the confirmed list and the failures
 * list, for every domain whose parsed item carried one. Mail carried none, and
 * the descriptor said why: its name is the Subject, which is in the RFC 822
 * bytes behind RFC 2047 encoded-words, and nothing in this codebase decoded
 * those. So on the owner's live Gmail run every mail row on both screens read
 * `<CAF…@mail.gmail.com>` — an identifier a mail client can search for, and not
 * a thing a person recognises.
 *
 * These are the cases that decide whether the name is worth showing at all. A
 * decoder that gets the first one right and the rest wrong produces text that
 * LOOKS decoded, which is worse than the Message-ID: nobody double-checks a
 * line that reads like words.
 */

import { describe, it, expect } from 'vitest';
import {
  SUBJECT_SCAN_LIMIT,
  decodeEncodedWords,
  displayNameForMessage,
} from './mail-subject.ts';
import { DISPLAY_NAME_LIMIT } from './hash.ts';

/** A message with these headers and a body that also mentions a Subject. */
function message(headers: string, eol = '\r\n'): Uint8Array {
  const body = `Subject: THE BODY IS NOT A HEADER${eol}nor is this`;
  return new TextEncoder().encode(`${headers}${eol}${eol}${body}`);
}

describe('plain text passes through untouched', () => {
  it('leaves an ASCII subject exactly as written', () => {
    expect(decodeEncodedWords('Invoice 2026-09 attached')).toBe('Invoice 2026-09 attached');
  });

  it('keeps the part of a header that is not an encoded word', () => {
    // `Re: ` is ASCII and outside the word; losing it would change what the
    // line means, and a reply is the commonest mail there is.
    expect(decodeEncodedWords('Re: =?UTF-8?B?VGVzdCDDqcOgw7w=?=')).toBe('Re: Test éàü');
  });

  it('answers undefined for nothing', () => {
    expect(decodeEncodedWords(undefined)).toBeUndefined();
  });
});

describe('the three rules that are easy to get wrong', () => {
  it('drops the whitespace BETWEEN two adjacent encoded words (§6.2)', () => {
    // The rule that matters most in practice: a long UTF-8 subject is split
    // into several words, and keeping the separator inserts a space into the
    // middle of a word. `Quarterly ` carries its own trailing space INSIDE the
    // first word, which is how a correct encoder writes it.
    expect(decodeEncodedWords('=?utf-8?B?UXVhcnRlcmx5IA==?= =?utf-8?B?csOpc3Vtw6k=?=')).toBe(
      'Quarterly résumé',
    );
  });

  it('reads `_` as a space in Q-encoding (§4.2), not as an underscore', () => {
    // Quoted-printable says nothing of the sort; this is RFC 2047's own rule
    // and the classic wrong answer.
    expect(decodeEncodedWords('=?utf-8?Q?hello_world?=')).toBe('hello world');
  });

  it("decodes in the message's charset, not ours", () => {
    // 0xE9 is é in ISO-8859-1 and an invalid byte in UTF-8. Decoding this as
    // UTF-8 gives `caf�`, which reads as a corrupted migration.
    expect(decodeEncodedWords('=?ISO-8859-1?Q?caf=E9?=')).toBe('café');
  });
});

describe('the bytes are assembled before they are decoded', () => {
  it('joins the =XX escapes of one multi-byte character', () => {
    // é as UTF-8 is two bytes, so it arrives as two escapes. Decoding them one
    // at a time yields two replacement characters — a wrong answer that looks
    // like a broken message rather than a broken decoder.
    expect(decodeEncodedWords('=?UTF-8?Q?caf=C3=A9?=')).toBe('café');
  });

  it('accepts base64 the way real mail writes it', () => {
    expect(decodeEncodedWords('=?UTF-8?B?VGVzdCDDqcOgw7w=?=')).toBe('Test éàü');
  });
});

describe('what it refuses to guess', () => {
  it('leaves a word in an unknown charset exactly as the message wrote it', () => {
    // Visible and true beats confident nonsense (hard rule 9). Decoding these
    // bytes as latin1 anyway would print plausible-looking words that are not
    // what the sender typed.
    const word = '=?x-nonesuch-1?B?QUJD?=';
    expect(decodeEncodedWords(word)).toBe(word);
  });

  it('treats an unreadable word as ordinary text, so the spaces around it stay', () => {
    // It was not decoded, so §6.2 does not apply to it: collapsing the gap
    // would run it into the word after.
    const line = '=?x-nonesuch-1?B?QUJD?= =?utf-8?B?csOpc3Vtw6k=?=';
    expect(decodeEncodedWords(line)).toBe('=?x-nonesuch-1?B?QUJD?= résumé');
  });

  it('leaves a malformed word alone rather than swallowing the text after it', () => {
    // A space inside an encoded word is forbidden. A permissive parser would
    // match across it and eat the following word.
    const line = '=?utf-8?B?not base64?= tail';
    expect(decodeEncodedWords(line)).toBe(line);
  });
});

describe('the Subject is read out of a real message', () => {
  it('finds it, decodes it, and never reads the body', () => {
    const name = displayNameForMessage(
      message('From: a@example.test\r\nSubject: =?UTF-8?B?VGVzdCDDqcOgw7w=?=\r\nTo: b@example.test'),
    );
    expect(name).toBe('Test éàü');
  });

  it('un-folds a Subject split across lines', () => {
    // Reading only the first physical line beheads the subject, and a long one
    // is folded by every mailer that respects the line-length recommendation.
    const name = displayNameForMessage(
      message('Subject: The quarterly report\r\n\tand its appendices\r\nFrom: a@example.test'),
    );
    expect(name).toBe('The quarterly report and its appendices');
  });

  it('reads a bare-LF message, which real servers do produce', () => {
    const name = displayNameForMessage(message('Subject: Bare newlines', '\n'));
    expect(name).toBe('Bare newlines');
  });

  it('answers undefined when there is no Subject at all', () => {
    // NOT '' — the ledger treats a blank as "not recorded" and the screen
    // falls back to the identifier, which is what it showed before.
    expect(displayNameForMessage(message('From: a@example.test'))).toBeUndefined();
  });

  it('answers undefined for an empty Subject', () => {
    expect(displayNameForMessage(message('Subject:   \r\nFrom: a@example.test'))).toBeUndefined();
  });

  it('does not mistake a line in the BODY for a header', () => {
    // The fixture's body says `Subject: THE BODY IS NOT A HEADER`. A scan that
    // ran past the blank line would show it.
    const name = displayNameForMessage(message('Subject: The real one\r\nFrom: a@example.test'));
    expect(name).toBe('The real one');
  });

  it('answers undefined for no message at all', () => {
    // The listing has no bytes, so the pass asks before the fetch and must not
    // throw for it.
    expect(displayNameForMessage(undefined)).toBeUndefined();
  });
});

describe('a header cannot cost more than it is worth', () => {
  it('bounds the name to what a table row can hold', () => {
    const long = 'x'.repeat(DISPLAY_NAME_LIMIT * 3);
    const name = displayNameForMessage(message(`Subject: ${long}`));
    expect(Array.from(name!)).toHaveLength(DISPLAY_NAME_LIMIT + 1); // the ellipsis
    expect(name!.endsWith('…')).toBe(true);
  });

  it('bounds the WORK, not only the output', () => {
    // A megabyte of Subject is broken or hostile, and neither earns a
    // megabyte of base64 decoding.
    const huge = 'y'.repeat(SUBJECT_SCAN_LIMIT * 4);
    const started = Date.now();
    const name = decodeEncodedWords(huge);
    expect(name!.length).toBeLessThanOrEqual(SUBJECT_SCAN_LIMIT);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('never cuts inside an encoded word', () => {
    // Half a word (`=?utf-8?B?SGVsbG`) is visible rubbish. Dropping the
    // dangling opener loses only text that was past the limit anyway.
    const padded = `${'z'.repeat(SUBJECT_SCAN_LIMIT - 4)}=?utf-8?B?VGVzdCDDqcOgw7w=?=`;
    expect(decodeEncodedWords(padded)).not.toContain('=?utf-8');
  });
});
