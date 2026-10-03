// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * HOW LONG, BEFORE START: A RANGE WITH ITS REASON (workplan 0154 T3 (a)).
 *
 * Said on the review screens (*Start a migration*'s last screen and Review &
 * confirm, on both editions) and on a migration's page until its first pass
 * reports, from what the count found and the one limit the product states:
 * Gmail lets a mailbox download 2.5 GB a day over IMAP
 * (`GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY`, the number the site's calculator
 * states too; `site/calculator.unit.test.ts` keeps the two equal).
 *
 * - **Mail from Gmail that the count measured**: the days that ceiling takes.
 *   The `gmail` card reads it, and so does a Google account, whose mail face
 *   IS that card (`ACCOUNT_FACE_BUILDERS.google.email`). So does a plain IMAP
 *   account pointed at `imap.gmail.com`, where the host is known
 *   (`imapDownloadPlan`). A download that needs n days' worth of the ceiling
 *   ends on the n-th day, n − 1 days after it starts: the range is *n − 1 to
 *   n days*, and one day's worth or less is *within a day*.
 * - **Anything else**: no provider publishes a rate, and none is invented. It
 *   says it will know after the first hour, as the owner asked (*"You, say
 *   it."*, 2026-09-29), never a number nobody measured (hard rule 9).
 * - **Files beside Gmail's mail** are said apart: their time is not the mail's.
 *
 * Pure, so a test holds each rule; the screens draw what this returns.
 */
import type { DiscoveryDomain } from './discovery.ts';
import { GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY, imapDownloadPlan } from './rate-budget.ts';

export type TimeBeforeStart =
  | {
      readonly kind: 'gmailDays';
      readonly low: number;
      readonly high: number;
      /** The migration carries files too, whose time the ceiling does not say. */
      readonly filesToo: boolean;
    }
  | { readonly kind: 'gmailWithinADay'; readonly mailBytes: number; readonly filesToo: boolean }
  | { readonly kind: 'notKnownYet' };

/** The cards and connection kinds whose mail is read through Gmail's IMAP. */
const GMAIL_MAIL: ReadonlySet<string> = new Set(['gmail', 'google']);

export function timeBeforeStart(input: {
  /** The source's card or connection kind (`gmail`, `google`, `imap`); undefined where unread. */
  readonly source: string | undefined;
  /** An IMAP source's host, where it is known. */
  readonly sourceHost?: string;
  /** The data types the migration carries. */
  readonly domains: ReadonlyArray<DiscoveryDomain>;
  /** What the count measured of the mail; undefined where it measured none. */
  readonly mailBytes: number | undefined;
}): TimeBeforeStart {
  const { source, sourceHost, domains, mailBytes } = input;
  const throughGmail =
    source !== undefined &&
    (GMAIL_MAIL.has(source) || (source === 'imap' && imapDownloadPlan(sourceHost)?.provider === 'gmail-imap'));
  if (!throughGmail || !domains.includes('email') || mailBytes === undefined || !(mailBytes >= 0)) {
    return { kind: 'notKnownYet' };
  }
  const filesToo = domains.includes('file');
  const days = Math.ceil(mailBytes / GMAIL_IMAP_DOWNLOAD_BYTES_PER_DAY);
  if (days <= 1) return { kind: 'gmailWithinADay', mailBytes, filesToo };
  return { kind: 'gmailDays', low: days - 1, high: days, filesToo };
}
