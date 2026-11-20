// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHEN A COPIED MESSAGE ARRIVED: THE TIME A TARGET IS GIVEN WITH ITS BYTES.
 *
 * A mail server keeps two times for a message. The `Date:` line inside it is
 * what its sender's client wrote. The arrival time (IMAP's INTERNALDATE,
 * JMAP's `receivedAt`) is when the mailbox received it, and it is what a mail
 * app sorts by when it sorts by "received". A webmail that shows the `Date:`
 * line falls back to the arrival time when that line is missing or unreadable.
 *
 * A copy is a new arrival unless the writer says otherwise. The IMAP writer
 * said nothing: its APPEND carried no date, so every copied message arrived at
 * the moment it was copied. Most still looked right, because their `Date:`
 * line was read first. On 2026-11-20, in a migration from Gmail into Cirrux on
 * the test environment, four old messages did not: they showed the evening
 * they were copied. Sorted by received, a whole copied mailbox reads that way.
 * The JMAP writer read the `Date:` line, and fell back to its own clock.
 *
 * ## The order, and why
 *
 * 1. **The source's own arrival time** (`MailItem.receivedAt`: INTERNALDATE on
 *    IMAP, `receivedDateTime` on Microsoft Graph). It is the time the person's
 *    mailbox shows today, so the copy shows the same.
 * 2. **The `Date:` line**, when the source gave no usable time. It is what a
 *    webmail shows anyway.
 * 3. **Nothing**, so the target uses its own clock, as before. Better than an
 *    invented date.
 *
 * ## What counts as no time
 *
 * A source that cannot read a message's time still fills `receivedAt`, which
 * is required. `graph-mail-source.ts` writes the epoch, 1970-01-01, when Graph
 * gives no `receivedDateTime`; `imapflow-source.ts` writes the moment of
 * listing when the server gives no INTERNALDATE. The epoch is not a time any
 * message arrived, so a time before {@link EARLIEST_MAIL} counts as none and
 * the next step is asked. The moment of listing cannot be told from a real
 * recent arrival, and passing it on is no worse than the target's clock.
 */

import type { MailItem, RawMessage } from './mail.ts';
import { headerValue } from './mail-headers.ts';

/**
 * The cut-off below which a time is a placeholder: 1971-01-01T00:00:00Z.
 * Networked mail began in late 1971; anything earlier is the epoch or an
 * unset clock.
 */
export const EARLIEST_MAIL = Date.UTC(1971, 0, 1);

/**
 * What the reading needs: the bytes, and the source's item when there is one.
 * Every source's `RawMessage` carries its item; `item` is optional here so the
 * reading also works on bytes alone, as tests build them. Then the `Date:` line
 * is asked.
 */
export type ArrivalInput = Pick<RawMessage, 'rfc822'> & {
  readonly item?: Pick<MailItem, 'receivedAt'>;
};

/**
 * The time to give a target as this message's arrival, or undefined to leave
 * it to the target's own clock.
 */
export function arrivalTimeOf(raw: ArrivalInput): Date | undefined {
  return usable(raw.item?.receivedAt) ?? usable(headerValue(raw.rfc822, 'Date'));
}

/** A parsed time, when it is one and not a placeholder. */
function usable(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  const ms = parsed.getTime();
  if (Number.isNaN(ms) || ms < EARLIEST_MAIL) return undefined;
  return parsed;
}
