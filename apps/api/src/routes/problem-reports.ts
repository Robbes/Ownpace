// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130 T1, T2): a signed-in customer's report,
 * delivered as a ticket on the owner's own Zammad, or, on a service with no
 * Zammad, as one mail to its support mailbox (the owner, for the alpha,
 * 2026-09-28; `services/report-channel.ts`).
 *
 * Mounted BEFORE the API's global JSON parser, with a parser of its own: a
 * screenshot arrives in the body, and the global parser's 100 kB limit would
 * refuse it before this route saw it. The larger limit applies here and
 * nowhere else.
 *
 * Signed-in only, and limited per person: five reports an hour is more than
 * anybody writing about a real problem needs, and it keeps a stuck form or a
 * script from filling the owner's helpdesk.
 *
 * THE BODY IS READ LAST. Until 2026-09-28 the parser was mounted on the whole
 * router, so it read and parsed a body of up to 8 MB before sign-in was asked
 * for: anybody, signed in or not, could make the API do that as often as they
 * liked, and a body that was not JSON reached the global error handler as a
 * 500 "fault on our side". Now sign-in, where a report can go (a Zammad or
 * the support mailbox), the reply address and the hour's five are all decided
 * first, none of which reads the body, and a body too large, not JSON, or in a
 * charset or encoding the parser does not read is answered here, 413, 400 or
 * 415, in JSON the form can read. Only the day's cap on report mails is taken
 * after the body, since only a report that will be mailed may use one.
 *
 * ## What the server adds, and the preview of it (workplan 0130 T6, Part A)
 *
 * Before a report is sent, `GET /preview` answers where it goes and the lines
 * of facts it will carry, for the form's *What we send with this*: signed in,
 * for the reporter's own organisation, sixty an hour per person. On sending,
 * the facts are read again, never taken from the body, and the ticket's
 * article or the mail carries the same lines (`reportFactLines`).
 *
 * Facts that cannot be read do not stop a report (the owner, 2026-09-28:
 * *"Send anyway"*). It goes with `Facts: could not be read [ref …]`, and the
 * error is recorded as `report.facts-unread` under that reference, for the
 * log page. So does a read that takes longer than
 * {@link REPORT_FACTS_DEADLINE_MS}: the person is waiting, and the moment the
 * database is the problem is the moment a report is for.
 */

import express, { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { LedgerDriver } from '@openmig/ledger';
import { log, newAppEvent, newReference, recordAppEvent } from '@openmig/shared';
import { authenticate, getDbPool } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { createKnockLimiter, type KnockLimiter } from '../knock-limit.ts';
import {
  PROBLEM_REPORT_BODY_LIMIT,
  isRefusal,
  parseProblemReport,
  parseReportPlace,
  reportFactLines,
  reportMailFor,
  ticketFor,
  type ReportPlace,
  type ServerFacts,
} from '../problem-report.ts';
import { migrationIdOnPage, reportFactsReader, type ReportFactsReader } from '../report-facts.ts';
import { createZammadTicket, ZammadRefused } from '../services/zammad.ts';
import {
  reportChannel,
  sendReportMail,
  takeReportMail,
  type ReportChannel,
  type ReportMailTransport,
} from '../services/report-channel.ts';

/** Five reports an hour, per person. */
export const PROBLEM_REPORT_LIMIT = { windowMs: 60 * 60 * 1000, max: 5 } as const;

/**
 * Sixty previews an hour, per person: one each time the form is opened, far
 * more than anybody writing a report opens it, and a bound on the reads a
 * script could make the database do.
 */
export const PROBLEM_REPORT_PREVIEW_LIMIT = { windowMs: 60 * 60 * 1000, max: 60 } as const;

/**
 * How long the facts may take to read: five seconds. A handful of indexed
 * reads in one organisation take milliseconds; a database that takes longer
 * is the problem the report may be about, and the report goes without them.
 */
export const REPORT_FACTS_DEADLINE_MS = 5_000;

export interface ProblemReportDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  /** How a report mail reaches the relay; `smtpTransport` unless a test fakes it. */
  readonly mailTransport?: ReportMailTransport;
  readonly limiter?: KnockLimiter;
  /** The day's report mails, shared with the link doors unless a test gives its own. */
  readonly mailCap?: KnockLimiter;
  /** The hour's previews per person; {@link PROBLEM_REPORT_PREVIEW_LIMIT} unless a test gives its own. */
  readonly previewLimiter?: KnockLimiter;
  /**
   * How the facts are read: in the reporter's organisation on the API's
   * `app_user` pool, unless a test reads them from PGlite in that role.
   */
  readonly readFacts?: ReportFactsReader;
  /** TEST SEAM ONLY: {@link REPORT_FACTS_DEADLINE_MS}, shorter. */
  readonly factsDeadlineMs?: number;
}

/** Where a report goes, as the form says it: the addresses a mail goes to, or the helpdesk. */
export type ReportRecipient =
  | { readonly kind: 'mail'; readonly addresses: readonly string[] }
  | { readonly kind: 'helpdesk' };

function recipientOf(channel: ReportChannel): ReportRecipient {
  return channel.kind === 'mail' ? { kind: 'mail', addresses: channel.mail.to } : { kind: 'helpdesk' };
}

export function problemReportRoutes(deps: ProblemReportDeps = {}): Router {
  const router = Router();
  const limiter = deps.limiter ?? createKnockLimiter(PROBLEM_REPORT_LIMIT);
  const previewLimiter = deps.previewLimiter ?? createKnockLimiter(PROBLEM_REPORT_PREVIEW_LIMIT);
  let pool: Pool | LedgerDriver | null = null;
  const readFacts = deps.readFacts ?? reportFactsReader(() => (pool ??= getDbPool()));
  const deadline = deps.factsDeadlineMs ?? REPORT_FACTS_DEADLINE_MS;

  /**
   * What the server adds to a report from `place`: the role the session's
   * membership gave (`role`, read by each route from the request; it is
   * written into the report and decides nothing), the browser from the
   * request's header, and the records, read in the reporter's organisation.
   * A read that fails, or takes too long, is recorded, and the report goes
   * with the reference of that record in the place of the facts.
   */
  async function serverFacts(
    req: AuthenticatedRequest,
    place: ReportPlace,
    role: string | undefined,
  ): Promise<ServerFacts> {
    const said = { role, browser: req.get('user-agent') };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const tenantId = req.tenantId;
      if (!tenantId) throw new Error('the request names no organisation to read the facts in');
      const mappingId = migrationIdOnPage(place.page);
      const reading = readFacts({
        tenantId,
        ...(mappingId ? { mappingId } : {}),
        ...(place.reference ? { reference: place.reference } : {}),
      });
      const late = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`the facts were not read within ${deadline / 1000} seconds`)),
          deadline,
        );
      });
      return { ...said, records: await Promise.race([reading, late]) };
    } catch (err) {
      const failed = newAppEvent({
        level: 'error',
        event: 'report.facts-unread',
        ...(req.tenantId ? { tenantId: req.tenantId } : {}),
      });
      log.error(`[api] the facts for a problem report could not be read; it goes without them [ref ${failed.reference}]:`, err);
      void recordAppEvent(failed);
      return { ...said, records: { unread: failed.reference } };
    } finally {
      clearTimeout(timer);
    }
  }
  /** What the checks before the body decided, for the handler after it. */
  const accepted = new WeakMap<Request, { readonly channel: ReportChannel; readonly email: string }>();

  /** Whether to offer the form at all: a form that can send nowhere is not shown. */
  router.get('/available', authenticate, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ available: reportChannel(deps.env) !== undefined });
  });

  /**
   * Where a report would go, and the lines of facts it would carry, for the
   * form to show before it is sent. The same function writes these lines and
   * the report's; they are read again when it is sent.
   */
  router.get('/preview', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const channel = reportChannel(deps.env);
    if (!channel) {
      res.status(503).json({
        error: 'reporting_unavailable',
        reason: 'Reporting a problem is not set up on this service.',
      });
      return;
    }
    const who = req.userId ?? req.userEmail ?? '';
    if (!previewLimiter.take(who)) {
      res.set('Retry-After', String(previewLimiter.retryAfterSeconds(who)));
      res.status(429).json({
        error: 'too_many_previews',
        reason: 'You have opened the report form many times in the last hour. Please wait a little.',
      });
      return;
    }
    const place = parseReportPlace(req.query);
    if (isRefusal(place)) {
      res.status(place.status).json({ error: 'invalid_report', field: place.field, reason: place.reason });
      return;
    }
    const tenant = req.tenantId ? { tenantId: req.tenantId } : {};
    res.json({
      to: recipientOf(channel),
      lines: reportFactLines(place, tenant, undefined, await serverFacts(req, place, req.userRole)),
    });
  });

  /** Everything that decides whether a report may be sent, before a byte of it is read. */
  const mayReport = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const channel = reportChannel(deps.env);
    if (!channel) {
      res.status(503).json({
        error: 'reporting_unavailable',
        reason: 'Reporting a problem is not set up on this service.',
      });
      return;
    }
    // The address a reply goes to. Without one, a ticket would be a report
    // nobody can answer.
    const email = req.userEmail?.trim();
    if (!email) {
      res.status(400).json({
        error: 'no_reply_address',
        reason: 'Your sign-in carries no email address, so a reply could not reach you.',
      });
      return;
    }
    const who = req.userId ?? email;
    if (!limiter.take(who)) {
      res.set('Retry-After', String(limiter.retryAfterSeconds(who)));
      res.status(429).json({
        error: 'too_many_reports',
        reason: 'You have sent several reports in the last hour. Please wait a little before sending another.',
      });
      return;
    }
    accepted.set(req, { channel, email });
    next();
  };

  router.post(
    '/',
    authenticate,
    mayReport,
    express.json({ limit: PROBLEM_REPORT_BODY_LIMIT }),
    async (req: AuthenticatedRequest, res: Response) => {
      const decided = accepted.get(req);
      // Unreachable: this handler runs only after `mayReport` said yes.
      if (!decided) throw new Error('a problem report reached its handler without passing the checks before it');
      const { channel, email } = decided;
      const parsed = parseProblemReport(req.body);
      if (isRefusal(parsed)) {
        res.status(parsed.status).json({ error: 'invalid_report', field: parsed.field, reason: parsed.reason });
        return;
      }
      if (channel.kind === 'mail') {
        // The relay's login is the identity provider's too (0133): a day's cap
        // for every report mail together, whichever door it came through.
        // Taken here, after the body, and not with the hour's five before it:
        // only a report that will be mailed uses one of the day's mails, so a
        // screenshot too large, or a body that is not a report, costs the
        // service none. Reading that body first is bounded by the five.
        const today = takeReportMail(deps.mailCap);
        if (!today.ok) {
          res.set('Retry-After', String(today.retryAfter));
          res.status(429).json({
            error: 'too_many_reports',
            reason: 'Many reports reached us today. Please try again tomorrow.',
          });
          return;
        }
      }
      const reporter = { email, ...(req.tenantId ? { tenantId: req.tenantId } : {}) };
      // Read again here, whatever the preview showed, and never from the body.
      const server = await serverFacts(req, parsed, req.userRole);
      try {
        if (channel.kind === 'zammad') {
          const ticket = await createZammadTicket(
            channel.zammad,
            ticketFor(parsed, reporter, channel.zammad.group, undefined, server),
            deps.fetchImpl,
          );
          res.status(201).json({ ticket });
          return;
        }
        // No ticket number to give, so the report's own reference, which its
        // mail carries too: what the person quotes is what the mailbox finds.
        const reference = newReference();
        await sendReportMail(
          channel.mail,
          reportMailFor(parsed, reporter, reference, undefined, server),
          deps.mailTransport,
        );
        log.info(`[api] a problem report was sent to the support mailbox [report ${reference}]`);
        res.status(201).json({ reference });
      } catch (err) {
        // On the operator's log page (0129 T1), and on this line with its
        // reference. The person keeps what they wrote: the form still holds it.
        const failed = newAppEvent({
          level: 'error',
          event: 'report.not-delivered',
          ...(req.tenantId ? { tenantId: req.tenantId } : {}),
        });
        log.error(
          `[api] a problem report could not be delivered [ref ${failed.reference}]:`,
          err instanceof ZammadRefused ? err.message : err,
        );
        void recordAppEvent(failed);
        res.status(502).json({
          error: 'report_not_delivered',
          reason:
            'Your report could not be delivered just now. What you wrote is still in the form: ' +
            `try again in a moment. Reference ${failed.reference}.`,
        });
      }
    },
  );

  /**
   * A body the parser refused, answered as the route's other refusals are.
   * Without this, body-parser's error went on to the API's global handler,
   * which answers every error 500 "a fault on our side" and records it as one.
   * Too large is 413, which the form reads as "choose a smaller screenshot".
   *
   * Every other refusal the parser makes of what the sender sent is answered
   * with its own status: not JSON (400), a charset or a `Content-Encoding` it
   * does not read (415), a body that ended early or was not the length it
   * said (400). body-parser gives each a `type` and a 4xx status. Until
   * 2026-09-28 only "not JSON" was answered here, and a signed-in POST with
   * `charset=latin1` was answered 500 and recorded as `api.unhandled`. A 5xx
   * the parser raises is a fault of ours, and goes on with anything else.
   */
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const { type, status } = (typeof err === 'object' && err !== null ? err : {}) as {
      type?: unknown;
      status?: unknown;
    };
    if (type === 'entity.too.large') {
      res.status(413).json({
        error: 'report_too_large',
        reason: `The report is larger than this service takes (${PROBLEM_REPORT_BODY_LIMIT}): choose a smaller screenshot.`,
      });
      return;
    }
    if (typeof type === 'string' && typeof status === 'number' && status < 500) {
      res.status(status).json({ error: 'invalid_report', reason: 'The report did not arrive as JSON this service reads.' });
      return;
    }
    next(err);
  });

  return router;
}
