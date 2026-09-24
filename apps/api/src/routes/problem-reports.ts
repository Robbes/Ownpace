// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report a problem" (workplan 0130 T1, T2): a signed-in customer's report,
 * delivered as a ticket on the owner's own Zammad.
 *
 * Mounted BEFORE the API's global JSON parser, with a parser of its own: a
 * screenshot arrives in the body, and the global parser's 100 kB limit would
 * refuse it before this route saw it. The larger limit applies here and
 * nowhere else.
 *
 * Signed-in only, and limited per person: five reports an hour is more than
 * anybody writing about a real problem needs, and it keeps a stuck form or a
 * script from filling the owner's helpdesk.
 */

import express, { Router } from 'express';
import type { Response } from 'express';
import { log, newAppEvent, recordAppEvent } from '@openmig/shared';
import { authenticate } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { createKnockLimiter, type KnockLimiter } from '../knock-limit.ts';
import {
  PROBLEM_REPORT_BODY_LIMIT,
  isRefusal,
  parseProblemReport,
  ticketFor,
} from '../problem-report.ts';
import { createZammadTicket, reportingConfig, ZammadRefused } from '../services/zammad.ts';

/** Five reports an hour, per person. */
export const PROBLEM_REPORT_LIMIT = { windowMs: 60 * 60 * 1000, max: 5 } as const;

export interface ProblemReportDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly limiter?: KnockLimiter;
}

export function problemReportRoutes(deps: ProblemReportDeps = {}): Router {
  const router = Router();
  const limiter = deps.limiter ?? createKnockLimiter(PROBLEM_REPORT_LIMIT);
  router.use(express.json({ limit: PROBLEM_REPORT_BODY_LIMIT }));

  /** Whether to offer the form at all: a form that can send nowhere is not shown. */
  router.get('/available', authenticate, (_req: AuthenticatedRequest, res: Response) => {
    res.json({ available: reportingConfig(deps.env) !== undefined });
  });

  router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const config = reportingConfig(deps.env);
    if (!config) {
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
    const parsed = parseProblemReport(req.body);
    if (isRefusal(parsed)) {
      res.status(parsed.status).json({ error: 'invalid_report', field: parsed.field, reason: parsed.reason });
      return;
    }
    try {
      const ticket = await createZammadTicket(
        config,
        ticketFor(parsed, { email, ...(req.tenantId ? { tenantId: req.tenantId } : {}) }, config.group),
        deps.fetchImpl,
      );
      res.status(201).json({ ticket });
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
  });

  return router;
}
