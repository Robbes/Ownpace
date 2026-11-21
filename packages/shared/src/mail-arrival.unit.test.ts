// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The arrival time a copied message is written with (`mail-arrival.ts`):
 * the source's own first, then the `Date:` line, then none, and never a
 * placeholder.
 */

import { describe, expect, it } from 'vitest';
import { arrivalTimeOf, EARLIEST_MAIL } from './mail-arrival.ts';

const bytes = (...headers: string[]): Uint8Array =>
  new TextEncoder().encode([...headers, '', 'body'].join('\r\n'));

describe('arrivalTimeOf', () => {
  it("takes the source's own arrival time first, over the Date: line", () => {
    const at = arrivalTimeOf({
      item: { receivedAt: '2009-09-18T19:35:00.000Z' },
      rfc822: bytes('Date: Mon, 1 Jan 2001 00:00:00 +0000'),
    });
    expect(at?.toISOString()).toBe('2009-09-18T19:35:00.000Z');
  });

  it('reads the Date: line when there is no item', () => {
    const at = arrivalTimeOf({ rfc822: bytes('Date: Fri, 18 Sep 2009 21:35:00 +0200') });
    expect(at?.toISOString()).toBe('2009-09-18T19:35:00.000Z');
  });

  it("treats the epoch, Graph's placeholder for no time, as none, and reads the Date: line", () => {
    const at = arrivalTimeOf({
      item: { receivedAt: new Date(0).toISOString() },
      rfc822: bytes('Date: Fri, 18 Sep 2009 21:35:00 +0200'),
    });
    expect(at?.toISOString()).toBe('2009-09-18T19:35:00.000Z');
  });

  it('treats an unreadable arrival time as none, and reads the Date: line', () => {
    const at = arrivalTimeOf({
      item: { receivedAt: 'not a time' },
      rfc822: bytes('Date: Fri, 18 Sep 2009 21:35:00 +0200'),
    });
    expect(at?.toISOString()).toBe('2009-09-18T19:35:00.000Z');
  });

  it('reads a folded Date: line, and its name in any case', () => {
    const at = arrivalTimeOf({ rfc822: bytes('DATE: Fri, 18 Sep 2009', ' 21:35:00 +0200') });
    expect(at?.toISOString()).toBe('2009-09-18T19:35:00.000Z');
  });

  it('gives none when neither the source nor the message holds a usable time', () => {
    expect(arrivalTimeOf({ rfc822: bytes('Subject: no date here') })).toBeUndefined();
    expect(arrivalTimeOf({ rfc822: bytes('Date: whenever') })).toBeUndefined();
    expect(
      arrivalTimeOf({ item: { receivedAt: '1970-01-01T00:00:00.000Z' }, rfc822: bytes('Date: 1 Jan 1970 00:00:00 +0000') }),
    ).toBeUndefined();
  });

  it('does not read a Date: line from the body', () => {
    const rfc822 = new TextEncoder().encode(['Subject: x', '', 'Date: Fri, 18 Sep 2009 21:35:00 +0200'].join('\r\n'));
    expect(arrivalTimeOf({ rfc822 })).toBeUndefined();
  });

  it('draws the line at 1971: the first moment counts, the one before does not', () => {
    expect(arrivalTimeOf({ item: { receivedAt: new Date(EARLIEST_MAIL).toISOString() }, rfc822: bytes() })?.getTime()).toBe(
      EARLIEST_MAIL,
    );
    expect(arrivalTimeOf({ item: { receivedAt: new Date(EARLIEST_MAIL - 1).toISOString() }, rfc822: bytes() })).toBeUndefined();
  });
});
