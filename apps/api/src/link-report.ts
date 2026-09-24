// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * REPORT THIS LINK (workplan 0108 T8 (d); the owner, 2026-09-24: a report goes
 * to *"the problem report forms"*, the Zammad of workplan 0130).
 *
 * The other half of T8 (a). The grant page says who asked, from which account
 * and to which destination, so that the person can judge the request. This is
 * what they can do when they judge it wrong: tell the owner, from the page,
 * without an account. The progress page they keep after granting offers the
 * same, since that is where somebody who granted and then had doubts returns.
 *
 * Pure: the route reads the rows and sends; this decides what a report may
 * carry and what the ticket says.
 *
 * ## What the reporter gives, and what the server adds
 *
 * - **What makes them doubt the link**, in their own words.
 * - **An address to reply to.** Typed, and not verified: the reporter has no
 *   account. The ticket says so, so nobody takes it as proven.
 *
 * Everything else comes from the rows the link itself names, never from the
 * body: the organisation, the migration, the link, who issued it, from and
 * to, and whether access has been given. A report cannot be pointed at
 * another organisation's migration.
 *
 * ## An internal note, and a title nobody typed
 *
 * The ticket's one article is internal. Its facts include what a progress link
 * does not show (the addresses, who issued the link) and what neither page
 * shows (the organisation's and the migration's ids), and the address the
 * helpdesk knows the reporter by is only as good as their typing. The reporter
 * is still the ticket's customer, so the owner's reply reaches them by email;
 * what nobody at that address can read in the helpdesk is the note. The title
 * is fixed rather than taken from what they wrote, because it is shown
 * wherever the ticket is listed.
 *
 * ## Nothing anybody typed can pass for a fact
 *
 * Two people wrote parts of the note, and the owner must be able to tell them
 * apart. The organisation that asked typed its name, the accounts and the
 * host, and it may be exactly who the report is about: a line break in any of
 * them would write a line of its own, such as a false `Access: not given`. So
 * each fact is kept to one line. The facts come first, from the rows; what the
 * reporter wrote comes after them, under its own label, so a paragraph shaped
 * like the facts is read as theirs.
 */

import { z } from 'zod';
import type { ViewGrant } from '@openmig/shared';
import { MAX_DESCRIPTION, type ReportRefusal } from './problem-report.ts';

export type ReportedLink = 'grant' | 'view';

export interface LinkReport {
  readonly description: string;
  readonly replyTo: string;
}

/** The same shape the public access-request door accepts. */
const REPLY_ADDRESS = z.string().trim().email().max(320);

/** Read a report from a request body, or say which field is wrong. */
export function parseLinkReport(body: unknown): LinkReport | ReportRefusal {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length === 0) {
    return { field: 'description', reason: 'Say what makes you doubt this link.', status: 400 };
  }
  if (description.length > MAX_DESCRIPTION) {
    return { field: 'description', reason: `At most ${MAX_DESCRIPTION} characters.`, status: 400 };
  }

  const replyTo = REPLY_ADDRESS.safeParse(b.replyTo);
  if (!replyTo.success) {
    return { field: 'replyTo', reason: 'An email address we can reply to.', status: 400 };
  }
  return { description, replyTo: replyTo.data };
}

/** What the rows say about the reported link, for the owner to act on. */
export interface LinkReportFacts {
  readonly link: ReportedLink;
  readonly linkId: string;
  readonly tenantId: string;
  readonly organisation: string;
  readonly mappingId: string;
  /** The migration's lifecycle state, as its row holds it. */
  readonly state: string;
  /** The member who issued the link, when they still are one. */
  readonly issuedBy: string | null;
  /** The account the migration reads, when it names one. */
  readonly from: string | null;
  /** The destination, when it has one. */
  readonly to: { readonly provider: string; readonly host: string | null; readonly account: string | null } | null;
  readonly access: ViewGrant['state'];
}

const LINK_NAME: Readonly<Record<ReportedLink, string>> = {
  grant: 'grant link',
  view: 'progress link',
};

const ACCESS: Readonly<Record<ViewGrant['state'], string>> = {
  granted: 'given: the migration can read the account',
  withdrawn: 'given, then withdrawn by the person',
  none: 'not given',
};

/** A value typed by somebody, kept to one line: any control character or line separator becomes a space. */
function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').trim();
}

/** `nextcloud at cloud.example.org, as dest@example.org`, or as much of it as is known. */
function destination(to: NonNullable<LinkReportFacts['to']>): string {
  const provider = oneLine(to.provider);
  const where = to.host ? `${provider} at ${oneLine(to.host)}` : provider;
  return to.account ? `${where}, as ${oneLine(to.account)}` : where;
}

/**
 * The Zammad ticket a link report becomes (`POST /api/v1/tickets`): an internal
 * note, plain text, with the reporter as the customer (`guess:` finds or makes
 * them) so that a reply reaches them by email.
 */
export function linkReportTicketFor(report: LinkReport, facts: LinkReportFacts, group: string) {
  const title = `Ownpace: a ${LINK_NAME[facts.link]} was reported`;
  const lines = [
    `Link: ${facts.linkId} (${LINK_NAME[facts.link]})`,
    `Organisation: ${oneLine(facts.organisation)} (${facts.tenantId})`,
    `Migration: ${facts.mappingId} (${facts.state})`,
    ...(facts.issuedBy ? [`Issued by: ${oneLine(facts.issuedBy)}`] : []),
    `From: ${facts.from ? oneLine(facts.from) : 'no account named'}`,
    `To: ${facts.to ? destination(facts.to) : 'no destination'}`,
    `Access: ${ACCESS[facts.access]}`,
    `Reply to: ${report.replyTo} (typed by the reporter, not verified)`,
  ];
  return {
    title,
    group,
    customer_id: `guess:${report.replyTo}`,
    article: {
      subject: title,
      body: `${lines.join('\n')}\n\nWhat they wrote:\n${report.description}`,
      type: 'note',
      internal: true,
      content_type: 'text/plain',
    },
  };
}
