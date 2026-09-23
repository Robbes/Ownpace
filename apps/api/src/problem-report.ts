// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PROBLEM REPORT THAT REACHES A PERSON (workplan 0130 T1, T2).
 *
 * What a customer sends from "Report a problem", read and checked here, and the
 * Zammad ticket it becomes. The owner's decisions (0130 D1, D2): the owner's
 * own, self-hosted Zammad, and a form in the app. What he asked a report to
 * carry: *"the URL they on, the error they see (screenshot or similar)"*, so he
 * can see it, write back, and help.
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
 */

import { APP_EVENT_REFERENCE, isFailureCategory, type FailureCategory } from '@openmig/shared';
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

export function isRefusal(parsed: ProblemReport | ReportRefusal): parsed is ReportRefusal {
  return 'field' in parsed && 'status' in parsed;
}

/** Who is reporting, as the signed-in session knows them. */
export interface Reporter {
  readonly email: string;
  readonly tenantId?: string;
}

/**
 * The Zammad ticket a report becomes (Zammad's REST API, `POST /api/v1/tickets`).
 *
 * The customer is the reporter's own address, `guess:` so Zammad finds or makes
 * the customer record: that is what makes the owner's reply reach them by email.
 * The article is plain text, so nothing the person wrote is ever rendered as
 * HTML in the owner's helpdesk.
 */
export function ticketFor(report: ProblemReport, reporter: Reporter, group: string) {
  const firstLine = report.description.split('\n')[0]!.trim();
  const title = `Ownpace: ${firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine}`;
  const facts = [
    `Page: ${report.page}`,
    ...(report.reference ? [`Reference: ${report.reference}`] : []),
    ...(report.category ? [`Category: ${report.category}`] : []),
    ...(reporter.tenantId ? [`Organisation: ${reporter.tenantId}`] : []),
  ];
  return {
    title,
    group,
    customer_id: `guess:${reporter.email}`,
    article: {
      subject: title,
      body: `${report.description}\n\n---\n${facts.join('\n')}`,
      type: 'web',
      internal: false,
      content_type: 'text/plain',
      ...(report.screenshot
        ? {
            attachments: [
              {
                filename: report.screenshot.type === 'image/png' ? 'screenshot.png' : 'screenshot.jpg',
                data: report.screenshot.data,
                'mime-type': report.screenshot.type,
              },
            ],
          }
        : {}),
    },
  };
}
