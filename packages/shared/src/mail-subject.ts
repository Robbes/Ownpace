// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE SUBJECT A PERSON RECOGNISES THEIR MESSAGE BY.
 *
 * #995 gave the confirmed list and the failures list a name instead of a UID,
 * for every domain that had one on the parsed item: a calendar event's SUMMARY,
 * a task's, a contact's FN. Mail was left out, and its own descriptor said why
 * — *"mail's name is its Subject, which lives in the RFC 822 bytes behind
 * encoded-words and is not decoded anywhere in this codebase yet"*. This is
 * that decoder, and mail is the domain with the most rows in a real migration:
 * on the owner's live Gmail run every mail line on both screens read
 * `<CAF…@mail.gmail.com>`, which is an identifier a mail client could search
 * for and not a thing a person can recognise.
 *
 * ## What RFC 2047 actually asks for
 *
 * A header is ASCII. Anything else arrives as encoded-words:
 *
 *     Subject: =?UTF-8?B?VGVzdCDDqcOgw7w=?= and =?ISO-8859-1?Q?caf=E9?=
 *
 * Three rules are easy to miss and all three change what a person reads:
 *
 *  1. **Whitespace BETWEEN two adjacent encoded words is not part of the
 *     text** (§6.2). A long UTF-8 subject is split into several words, and
 *     keeping the space that separates them inserts a space into the middle of
 *     a word — worse than not decoding at all, because it looks correct.
 *  2. **`_` means space in Q-encoding** (§4.2), which is not what
 *     quoted-printable says and is the classic wrong answer.
 *  3. **The charset is the message's, not ours.** A `windows-1252` subject
 *     decoded as UTF-8 is mojibake, and mojibake in a list of what was
 *     migrated reads as corruption of the migration.
 *
 * ## What it refuses to guess
 *
 * A charset `TextDecoder` does not know leaves the encoded word VERBATIM. The
 * alternative is to decode it as latin1 and show confident nonsense, and hard
 * rule 9's whole position is that "I could not read this" and "this is what it
 * says" must not arrive looking the same. `=?x-mac-ce?B?…?=` on screen is
 * ugly and true; `Ãºvod` is neither.
 *
 * Bytes that are invalid FOR a charset it does know are a different case and
 * are replaced with U+FFFD rather than refused: the word is still mostly
 * readable, and one replacement character is itself the honest signal.
 *
 * One `TextDecoder` behaviour is worth knowing rather than discovering: the
 * WHATWG encoding standard aliases `iso-8859-1` to `windows-1252`, so byte
 * 0x92 in a word labelled ISO-8859-1 decodes to a curly apostrophe rather than
 * a C1 control. That is what every browser and mail client does, and it is the
 * RIGHT answer for real mail, which mislabels Windows text as ISO-8859-1
 * constantly — a strict decode would put an invisible control character in the
 * middle of `Don't`.
 *
 * ## Nothing keys on this
 *
 * It is a label. `naturalKeyText` remains the Message-ID, and the idempotency
 * anchor remains its hash — so a Subject that decodes differently after a
 * library change cannot move an item, split a row, or re-copy anything.
 */

import { boundDisplayName } from './hash.ts';
import { headerValue } from './mail-headers.ts';

/**
 * How much of a Subject header is read before decoding.
 *
 * The OUTPUT is bounded by `boundDisplayName` at 200 code points whatever
 * happens; this bounds the WORK. A folded Subject is a few hundred bytes in
 * practice and 998 by the line-length recommendation, so four kilobytes is
 * already generous — and a message carrying a megabyte of header is either
 * broken or hostile, and neither deserves the base64 decode.
 */
export const SUBJECT_SCAN_LIMIT = 4096;

/**
 * One encoded word.
 *
 * `[^?\s]` for both charset and text rather than `[^?]`: RFC 2047 forbids
 * whitespace inside an encoded word, and a permissive class would let one
 * malformed word swallow the space and the word after it. A word this does not
 * match is left verbatim, which is the documented behaviour above.
 */
const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;

/**
 * Decode RFC 2047 encoded-words in a header value.
 *
 * Text outside an encoded word is returned unchanged — a header is often part
 * ASCII and part encoded, and `Re: =?utf-8?B?…?=` must keep its `Re: `.
 */
export function decodeEncodedWords(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const source = bounded(value);
  let out = '';
  let cursor = 0;
  // Whether the previous thing appended was an encoded word, so the
  // whitespace-only gap before the next one can be dropped (§6.2).
  let previousWasEncoded = false;
  ENCODED_WORD.lastIndex = 0;
  for (let m = ENCODED_WORD.exec(source); m !== null; m = ENCODED_WORD.exec(source)) {
    const gap = source.slice(cursor, m.index);
    const decoded = decodeWord(m[1]!, m[2]!, m[3]!);
    if (decoded === undefined) {
      // Unknown charset: the word stays as the message wrote it, and it counts
      // as ordinary text — so the gap on EITHER side of it is real whitespace.
      out += gap + m[0];
      previousWasEncoded = false;
    } else {
      out += previousWasEncoded && gap.trim() === '' ? decoded : gap + decoded;
      previousWasEncoded = true;
    }
    cursor = m.index + m[0].length;
  }
  return out + source.slice(cursor);
}

/** The Subject of this message, as a bounded one-line name, or undefined. */
export function displayNameForMessage(rfc822: Uint8Array | undefined): string | undefined {
  if (rfc822 === undefined) return undefined;
  return boundDisplayName(decodeEncodedWords(headerValue(rfc822, 'Subject')));
}

/**
 * At most `SUBJECT_SCAN_LIMIT` characters, and never ending mid-word.
 *
 * A cut inside an encoded word would leave `=?utf-8?B?SGVsbG` in the output —
 * visible, unreadable rubbish. Dropping the dangling opener instead loses text
 * that was past the limit anyway.
 */
function bounded(value: string): string {
  if (value.length <= SUBJECT_SCAN_LIMIT) return value;
  const cut = value.slice(0, SUBJECT_SCAN_LIMIT);
  const opener = cut.lastIndexOf('=?');
  return opener > cut.lastIndexOf('?=') ? cut.slice(0, opener) : cut;
}

/** One word's text, or undefined when its charset is not one we can read. */
function decodeWord(charset: string, encoding: string, text: string): string | undefined {
  // RFC 2231 §5 allows a language tag on the charset: `utf-8*en`. The language
  // says nothing about the bytes, so it is dropped rather than failed on.
  const label = charset.split('*')[0]!;
  const decoder = decoderFor(label);
  if (decoder === undefined) return undefined;
  const bytes = encoding.toLowerCase() === 'b' ? base64Bytes(text) : quotedPrintableBytes(text);
  return decoder.decode(bytes);
}

/**
 * A decoder for this label, or undefined.
 *
 * `TextDecoder` knows the whole WHATWG encoding set — every ISO-8859 part,
 * the Windows code pages, Shift_JIS, GB18030, KOI8 — and throws `RangeError`
 * for a label it does not. That throw is the answer, not an error to report:
 * see the header on why an unreadable charset is left visible.
 */
function decoderFor(label: string): TextDecoder | undefined {
  try {
    return new TextDecoder(label, { fatal: false });
  } catch {
    return undefined;
  }
}

/** Base64, leniently: real mail omits padding and wraps in odd places. */
function base64Bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'));
}

/**
 * Q-encoding (§4.2): `_` is a space, `=XX` is a byte, everything else is its
 * own latin1 byte.
 *
 * Built as BYTES rather than characters, because a multi-byte UTF-8 character
 * arrives as several `=XX` escapes and decoding them one at a time would
 * produce one replacement character per byte.
 */
function quotedPrintableBytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '_') {
      bytes.push(0x20);
      continue;
    }
    if (ch === '=' && i + 2 < text.length) {
      const hex = text.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    // A lone `=`, or ordinary ASCII. `charCodeAt` is the latin1 byte because
    // the header section was decoded as latin1 (see `mail-headers.ts`).
    bytes.push(text.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(bytes);
}
