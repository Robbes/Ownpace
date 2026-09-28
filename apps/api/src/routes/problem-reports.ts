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
 */

import express, { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { log, newAppEvent, newReference, recordAppEvent } from '@openmig/shared';
import { authenticate } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { createKnockLimiter, type KnockLimiter } from '../knock-limit.ts';
import {
  PROBLEM_REPORT_BODY_LIMIT,
  isRefusal,
  parseProblemReport,
  reportMailFor,
  ticketFor,
} from '../problem-report.ts';
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

export interface ProblemReportDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  /** How a report mail reaches the relay; `smtpTransport` unless a test fakes it. */
  readonly mailTransport?: ReportMailTransport;
  readonly limiter?: KnockLimiter;
  /** The day's report mails, shared with the link doors unless a test gives its own. */
  readonly mailCap?: KnockLimiter;
}

export function problemReportRoutes(deps: ProblemReportDeps = {}): Router {
  const router = Router();
  const limiter = deps.limiter ?? createKnockLimiter(PROBLEM_REPORT_LIMIT);
  /** What the checks before the body decided, for the handler after it. */
  const accepted = new WeakMap<Request, { readonly channel: ReportChannel; readonly email: string }>();

  /** Whether to offer the form at all: a form that can send nowhere is not shown. */
  router.get('/available', authenticate, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ available: reportChannel(deps.env) !== undefined });
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
      try {
        if (channel.kind === 'zammad') {
          const ticket = await createZammadTicket(
            channel.zammad,
            ticketFor(parsed, reporter, channel.zammad.group),
            deps.fetchImpl,
          );
          res.status(201).json({ ticket });
          return;
        }
        // No ticket number to give, so the report's own reference, which its
        // mail carries too: what the person quotes is what the mailbox finds.
        const reference = newReference();
        await sendReportMail(channel.mail, reportMailFor(parsed, reporter, reference), deps.mailTransport);
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
