// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * REPORT THIS LINK (workplan 0108 T8 (d); the owner, 2026-09-24: a report goes
 * to *"the problem report forms"*, the Zammad of workplan 0130). Where the
 * service has no Zammad, the same note goes as one mail to its support mailbox,
 * as the signed-in form's report does (the owner, for the alpha, 2026-09-28).
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
 * - **An address to reply to, if they want an answer.** Typed, and not
 *   verified: the reporter has no account. The ticket says so, so nobody takes
 *   it as proven. A report without one is taken too (the owner, 2026-09-24:
 *   *"should link reports be allowed without a reply address? Yes"*), and is
 *   filed under the helpdesk's own user, since Zammad needs a customer for
 *   every ticket; its note says that nobody can be answered.
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
 * helpdesk knows the reporter by is only as good as their typing. A reporter
 * who left an address is still the ticket's customer, so the owner's reply
 * reaches them by email; what nobody at that address can read in the helpdesk
 * is the note. One who left none is answered by nobody: the ticket is the
 * helpdesk's own user's, and the note says so. The title
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

import type { ViewGrant } from '@openmig/shared';
import { MAX_DESCRIPTION, oneLine, REPLY_ADDRESS, type ReportRefusal } from './problem-report.ts';

export type ReportedLink = 'grant' | 'view';

export interface LinkReport {
  readonly description: string;
  /** Where the owner's answer goes, when the reporter left an address. */
  readonly replyTo?: string;
}

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

  // No address, or an empty field, is a report nobody asked to be answered.
  if (b.replyTo === undefined || b.replyTo === null || (typeof b.replyTo === 'string' && b.replyTo.trim() === '')) {
    return { description };
  }
  const replyTo = REPLY_ADDRESS.safeParse(b.replyTo);
  if (!replyTo.success) {
    return {
      field: 'replyTo',
      reason: 'An email address we can reply to, or leave it empty.',
      status: 400,
    };
  }
  return { description, replyTo: replyTo.data };
}

/** One migration as a report names it: from the rows, never from the body. */
export interface ReportedMigration {
  readonly mappingId: string;
  /** The migration's lifecycle state, as its row holds it. */
  readonly state: string;
  /** The account the migration reads, when it names one. */
  readonly from: string | null;
  /** The destination, when it has one. */
  readonly to: { readonly provider: string; readonly host: string | null; readonly account: string | null } | null;
  readonly access: ViewGrant['state'];
}

/** What every reported link says about itself. */
interface ReportedLinkFacts {
  readonly link: ReportedLink;
  readonly linkId: string;
  readonly tenantId: string;
  readonly organisation: string;
  /** The member who issued the link, when they still are one. */
  readonly issuedBy: string | null;
}

/** What the rows say about a migration's reported link, for the owner to act on. */
export interface MigrationLinkFacts extends ReportedLinkFacts, ReportedMigration {}

/**
 * What the rows say about a PERSON'S reported link (ADR-0035, amended
 * 2026-09-29; 0153 T5 (b)): the person, and every migration of theirs, each
 * as a migration's report names it.
 */
export interface PersonLinkFacts extends ReportedLinkFacts {
  readonly personId: string;
  readonly migrations: readonly ReportedMigration[];
}

/** A migration's link, or a person's. */
export type LinkReportFacts = MigrationLinkFacts | PersonLinkFacts;

const isPersonFacts = (facts: LinkReportFacts): facts is PersonLinkFacts => 'personId' in facts;

const LINK_NAME: Readonly<Record<ReportedLink, string>> = {
  grant: 'grant link',
  view: 'progress link',
};

/** `grant link`, or `person's grant link` when the link is a person's. */
function linkName(facts: LinkReportFacts): string {
  return isPersonFacts(facts) ? `person's ${LINK_NAME[facts.link]}` : LINK_NAME[facts.link];
}

const ACCESS: Readonly<Record<ViewGrant['state'], string>> = {
  granted: 'given: the migration can read the account',
  withdrawn: 'given, then withdrawn by the person',
  none: 'not given',
};

/** `nextcloud at cloud.example.org, as dest@example.org`, or as much of it as is known. */
function destination(to: NonNullable<ReportedMigration['to']>): string {
  const provider = oneLine(to.provider);
  const where = to.host ? `${provider} at ${oneLine(to.host)}` : provider;
  return to.account ? `${where}, as ${oneLine(to.account)}` : where;
}

/** The title a link report goes by: fixed, since it is shown wherever the report is listed. */
function linkReportTitle(facts: LinkReportFacts): string {
  return `Ownpace: a ${linkName(facts)} was reported`;
}

/** One migration of a person's, on one line, as each of a migration's facts is. */
function migrationLine(m: ReportedMigration): string {
  return (
    `Migration: ${m.mappingId} (${m.state}); from ${m.from ? oneLine(m.from) : 'no account named'}; ` +
    `to ${m.to ? destination(m.to) : 'no destination'}; access ${ACCESS[m.access]}`
  );
}

/** The facts, one line each, from the rows; the ticket's note and the mail both start with them. */
function factLines(report: LinkReport, facts: LinkReportFacts): string[] {
  const about = isPersonFacts(facts)
    ? [
        `Person: ${facts.personId}, with ${facts.migrations.length} migration${facts.migrations.length === 1 ? '' : 's'}`,
        ...(facts.issuedBy ? [`Issued by: ${oneLine(facts.issuedBy)}`] : []),
        ...facts.migrations.map(migrationLine),
      ]
    : [
        `Migration: ${facts.mappingId} (${facts.state})`,
        ...(facts.issuedBy ? [`Issued by: ${oneLine(facts.issuedBy)}`] : []),
        `From: ${facts.from ? oneLine(facts.from) : 'no account named'}`,
        `To: ${facts.to ? destination(facts.to) : 'no destination'}`,
        `Access: ${ACCESS[facts.access]}`,
      ];
  return [
    `Link: ${facts.linkId} (${linkName(facts)})`,
    `Organisation: ${oneLine(facts.organisation)} (${facts.tenantId})`,
    ...about,
    report.replyTo === undefined
      ? 'Reply to: none. The reporter left no address, so nobody can be answered'
      : `Reply to: ${report.replyTo} (typed by the reporter, not verified)`,
  ];
}

/**
 * The Zammad ticket a link report becomes (`POST /api/v1/tickets`): an internal
 * note, plain text. Its customer is the reporter when they left an address
 * (`guess:` finds or makes them), so that a reply reaches them by email, and
 * otherwise the helpdesk's own user (`ownUserId`), since every ticket needs one.
 */
export function linkReportTicketFor(
  report: LinkReport,
  facts: LinkReportFacts,
  group: string,
  ownUserId?: number,
) {
  if (report.replyTo === undefined && ownUserId === undefined) {
    throw new Error('A report without a reply address is filed under the helpdesk\'s own user, and none was given.');
  }
  const title = linkReportTitle(facts);
  return {
    title,
    group,
    customer_id: report.replyTo === undefined ? ownUserId : `guess:${report.replyTo}`,
    article: {
      subject: title,
      body: `${factLines(report, facts).join('\n')}\n\nWhat they wrote:\n${report.description}`,
      type: 'note',
      internal: true,
      content_type: 'text/plain',
    },
  };
}

/**
 * The first line of a link report's mail. In Zammad the note is internal and
 * the reporter never sees it. A mail has no internal note, so it has no
 * Reply-To either, and the reporter's address is only the `Reply to:` line.
 */
export const LINK_REPORT_MAIL_WARNING =
  'For support only: Reply does not reach the reporter. To answer them, write a new mail to the address on the "Reply to" line, and leave these facts out of it.';

/**
 * The mail a link report becomes when the service has no Zammad (the owner, for
 * the alpha, 2026-09-28). The ticket's title and note, the same facts in the
 * same order, and after them the report's own reference, which the person is
 * answered with in place of a ticket number.
 *
 * NEVER A REPLY-TO, not even the address the reporter typed. The note names
 * what a progress link does not show (who issued the link, the accounts) and
 * what neither page shows (the ids), and the address is typed by somebody with
 * no account, unverified. Pressing Reply on a mail quotes all of it to that
 * address, and a warning line would have to be read and acted on every time.
 * Without the header, the owner answers by writing a new mail to the `Reply
 * to:` line's address, and nothing is quoted unless they paste it.
 */
export function linkReportMailFor(
  report: LinkReport,
  facts: LinkReportFacts,
  reference: string,
): { readonly subject: string; readonly body: string } {
  const lines = [...factLines(report, facts), `Report reference: ${reference}`];
  return {
    subject: linkReportTitle(facts),
    body: `${LINK_REPORT_MAIL_WARNING}\n\n${lines.join('\n')}\n\nWhat they wrote:\n${report.description}`,
  };
}
