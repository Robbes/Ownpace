// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROBLEM REPORT THAT REACHES A PERSON (workplan 0130 T1, T2).
 *
 * What a customer sends from "Report a problem", read and checked here, and the
 * Zammad ticket it becomes, or the mail. The owner's decisions (0130 D1, D2):
 * the owner's own, self-hosted Zammad, and a form in the app. For the alpha
 * (2026-09-28), a service with no Zammad sends the same report as one mail to
 * its support mailbox instead; a Zammad, when there is one, still wins. What
 * the owner asked a report to carry: *"the URL they on, the error they see
 * (screenshot or similar)"*, so they can see it, write back, and help.
 *
 * Pure: the route does the network, this does the deciding, so every rule
 * below is tested without either.
 *
 * ## What a report may carry, and what it never does
 *
 * - **What the person wrote**, in their own words. It is theirs to send.
 * - **The page they were on**, recorded as the access log records it (0108): a
 *   grant or view link as `:link`, and no query. The browser sends the path,
 *   and the server redacts it again, so a report never carries a credential
 *   even if a client forgot.
 * - **The error on the screen**, when there is one: its category and its
 *   reference (0129 T1), each checked against its own shape, never free text.
 * - **A screenshot**, if the person adds one: a PNG or JPEG, checked by its
 *   own first bytes rather than by the name it arrived with, at most 5 MB.
 *
 * And one line the server adds: **the build** that answered, as `/version`
 * gives it (workplan 0146 T2). Every managed build since 2026-08-04 has said
 * the same version, so the commit is what tells two apart, and a person
 * reporting a problem is not asked to copy it off the page.
 */

import { z } from 'zod';
import { buildIdentity, type BuildIdentity } from '@openmig/core';
import {
  APP_EVENT_REFERENCE,
  isFailureCategory,
  type FailureCategory,
  type MailAttachment,
} from '@openmig/shared';
import { loggableUrl } from './access-log.ts';

/** The most a description may hold. A report, not an essay, and a bound on the body. */
export const MAX_DESCRIPTION = 5000;
/** The largest screenshot, decoded. */
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
/** The body limit the route parses with: the screenshot in base64, and room for the rest. */
export const PROBLEM_REPORT_BODY_LIMIT = '8mb';

export type ScreenshotType = 'image/png' | 'image/jpeg';

export interface ProblemReport {
  readonly description: string;
  /** The page, already redacted. */
  readonly page: string;
  readonly reference?: string;
  readonly category?: FailureCategory;
  readonly screenshot?: { readonly type: ScreenshotType; readonly data: string };
}

/** Why a report was refused, as the field it concerns and a sentence. */
export interface ReportRefusal {
  readonly field: string;
  readonly reason: string;
  readonly status: 400 | 413;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

/** The image type its first bytes say it is, or undefined. */
export function imageTypeOf(bytes: Uint8Array): ScreenshotType | undefined {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(PNG)) return 'image/png';
  if (starts(JPEG)) return 'image/jpeg';
  return undefined;
}

/** Read a report from a request body, or say which field is wrong. */
export function parseProblemReport(body: unknown): ProblemReport | ReportRefusal {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length === 0) {
    return { field: 'description', reason: 'Say what happened.', status: 400 };
  }
  if (description.length > MAX_DESCRIPTION) {
    return { field: 'description', reason: `At most ${MAX_DESCRIPTION} characters.`, status: 400 };
  }

  if (typeof b.page !== 'string' || !b.page.startsWith('/') || b.page.length > 2000) {
    return { field: 'page', reason: 'The page is a path on this site.', status: 400 };
  }
  const page = loggableUrl(b.page);

  let reference: string | undefined;
  if (b.reference !== undefined && b.reference !== null && b.reference !== '') {
    if (typeof b.reference !== 'string' || !APP_EVENT_REFERENCE.test(b.reference)) {
      return { field: 'reference', reason: 'A reference is eight characters, 0-9 and a-f.', status: 400 };
    }
    reference = b.reference;
  }

  let category: FailureCategory | undefined;
  if (b.category !== undefined && b.category !== null && b.category !== '') {
    if (!isFailureCategory(b.category)) {
      return { field: 'category', reason: 'Not a category this product knows.', status: 400 };
    }
    category = b.category;
  }

  let screenshot: ProblemReport['screenshot'];
  if (b.screenshot !== undefined && b.screenshot !== null) {
    const shot = b.screenshot as Record<string, unknown>;
    if (typeof shot.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(shot.data)) {
      return { field: 'screenshot', reason: 'The screenshot did not arrive whole.', status: 400 };
    }
    const bytes = Buffer.from(shot.data, 'base64');
    if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
      return { field: 'screenshot', reason: 'A screenshot may be at most 5 MB.', status: 413 };
    }
    // By its own first bytes, not by the type the browser claimed: a file
    // named .png is not thereby a picture.
    const type = imageTypeOf(bytes);
    if (!type) {
      return { field: 'screenshot', reason: 'A screenshot is a PNG or a JPEG.', status: 400 };
    }
    screenshot = { type, data: shot.data };
  }

  return {
    description,
    page,
    ...(reference ? { reference } : {}),
    ...(category ? { category } : {}),
    ...(screenshot ? { screenshot } : {}),
  };
}

/** Whether a parse refused, for this form's report or a link's (`link-report.ts`). */
export function isRefusal<T extends object>(parsed: T | ReportRefusal): parsed is ReportRefusal {
  return 'field' in parsed && 'status' in parsed;
}

/** Who is reporting, as the signed-in session knows them. */
export interface Reporter {
  readonly email: string;
  readonly tenantId?: string;
}

/**
 * The build, written as the web app's build stamp writes it (`describeBuild` in
 * `apps/web/src/services/build-identity.ts`): `v<version> · <seven characters
 * of the commit>`, so the ticket and the bottom of the page read alike.
 *
 * One difference, on purpose. With no commit the stamp shows the version
 * alone; the ticket says the commit is unknown. It is read later, by somebody
 * who cannot look at that page again, and a bare `v0.1.0-rc.1` reads as the
 * release of that name, which a build without a commit almost never is.
 */
function buildLine(build: BuildIdentity): string {
  const commit = build.commit && build.commit !== 'unknown' ? build.commit.slice(0, 7) : 'commit unknown';
  return `Build: v${build.version} · ${commit}`;
}

/** A value typed by somebody, kept to one line: any control character or line separator becomes a space. */
export function oneLine(value: string): string {
  return value.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').trim();
}

/**
 * One address a reply may go to: the shape the public access-request door
 * accepts, and a link report's typed address. Not a list, and nothing a
 * header could be built from but the address itself.
 */
export const REPLY_ADDRESS = z.string().trim().email().max(320);

/** The title a report goes by: `Ownpace: ` and its first line, kept to one line and 80 characters. */
function titleFor(report: ProblemReport): string {
  // One line whatever the person typed: in a mail this is the Subject header,
  // where a carriage return would start a header of its own.
  const firstLine = oneLine(report.description.split('\n')[0]!);
  return `Ownpace: ${firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine}`;
}

/**
 * What the person wrote, then the facts under it: the page, the reference and
 * category when there is one, the organisation, the build. The ticket's article
 * and the mail's body are both exactly this, so the two ways a report travels
 * cannot say different things.
 */
function reportText(report: ProblemReport, reporter: Reporter, build: BuildIdentity): string {
  const facts = [
    `Page: ${report.page}`,
    ...(report.reference ? [`Reference: ${report.reference}`] : []),
    ...(report.category ? [`Category: ${report.category}`] : []),
    ...(reporter.tenantId ? [`Organisation: ${reporter.tenantId}`] : []),
    buildLine(build),
  ];
  return `${report.description}\n\n---\n${facts.join('\n')}`;
}

/** The screenshot's file name, by the type its own first bytes gave it. */
function screenshotName(type: ScreenshotType): string {
  return type === 'image/png' ? 'screenshot.png' : 'screenshot.jpg';
}

/**
 * The Zammad ticket a report becomes (Zammad's REST API, `POST /api/v1/tickets`).
 *
 * The customer is the reporter's own address, `guess:` so Zammad finds or makes
 * the customer record: that is what makes the owner's reply reach them by email.
 * The article is plain text, so nothing the person wrote is ever rendered as
 * HTML in the owner's helpdesk.
 *
 * `build` is this API's own unless a caller says otherwise; the route never does.
 */
export function ticketFor(
  report: ProblemReport,
  reporter: Reporter,
  group: string,
  build: BuildIdentity = buildIdentity(),
) {
  const title = titleFor(report);
  return {
    title,
    group,
    customer_id: `guess:${reporter.email}`,
    article: {
      subject: title,
      body: reportText(report, reporter, build),
      type: 'web',
      internal: false,
      content_type: 'text/plain',
      ...(report.screenshot
        ? {
            attachments: [
              {
                filename: screenshotName(report.screenshot.type),
                data: report.screenshot.data,
                'mime-type': report.screenshot.type,
              },
            ],
          }
        : {}),
    },
  };
}

/** A report as one mail, for a transport that fills in From and To itself. */
export interface ReportMail {
  readonly subject: string;
  readonly body: string;
  readonly replyTo?: string;
  readonly attachments?: readonly MailAttachment[];
}

/**
 * The mail a report becomes when the service has no Zammad (the owner, for the
 * alpha, 2026-09-28: *"b"*, a mail to the support mailbox through the relay
 * that already sends the product's mail).
 *
 * The ticket's title as the Subject, the ticket's article as the body, and the
 * screenshot, already checked by its first bytes, as its one attachment. Two
 * lines more than the ticket:
 *
 * - `Reply to:`, the reporter's sign-in address, written in the body as well
 *   as in the Reply-To header. On live the mail goes from the support address
 *   to itself, and a client may answer such a mail to its own To, or a
 *   provider may drop the header; the body line is what still names who to
 *   write to. The header is set only when the address is one valid address,
 *   so an identity provider's odd claim (`a@x, b@y`) cannot add a second
 *   recipient to the owner's reply; the line then says so.
 * - `Report reference:`, which the person is answered with in place of a
 *   ticket number, so that what they quote can be found in the mailbox. Named
 *   so it is not taken for the error's `Reference:` above it, an app event's.
 */
export function reportMailFor(
  report: ProblemReport,
  reporter: Reporter,
  reference: string,
  build: BuildIdentity = buildIdentity(),
): ReportMail {
  const address = REPLY_ADDRESS.safeParse(reporter.email);
  const replyLine = address.success
    ? `Reply to: ${address.data} (sign-in address)`
    : `Reply to: none. The sign-in address is not one address a reply can go to: ${oneLine(reporter.email)}`;
  return {
    subject: titleFor(report),
    body: `${reportText(report, reporter, build)}\n${replyLine}\nReport reference: ${reference}`,
    ...(address.success ? { replyTo: address.data } : {}),
    ...(report.screenshot
      ? {
          attachments: [
            {
              filename: screenshotName(report.screenshot.type),
              contentType: report.screenshot.type,
              base64: report.screenshot.data,
            },
          ],
        }
      : {}),
  };
}
