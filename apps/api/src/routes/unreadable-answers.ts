// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ANSWER A PAGE COULD NOT READ, TOLD BY THE PAGE (workplan 0145; the
 * owner's "Log it", 2026-09-29).
 *
 * When a page's schema refuses one of this API's answers, the page says so to
 * the person with a reference, and sends that reference here once, with where
 * the answer did not fit and the page's build. This keeps it as `serverFault`
 * keeps a fault of our own: an app event, `web.answer_unreadable`, under the
 * page's reference, for the log page, and one line in the output with the
 * detail and both builds. Quoting the reference the screen showed finds both.
 *
 * Signed in, recorded in the person's organisation, and limited per person:
 * a page reports one failure once (`apps/web/src/services/unreadable-answer.ts`),
 * so thirty an hour is far more than a broken screen sends and still bounds a
 * script. What the body may say is `parseUnreadableAnswer`'s (`@openmig/shared`),
 * which the appliance's route uses too: each field in its own shape, and
 * anything else dropped.
 *
 * Answers 204 and nothing else when it is kept. No alert follows yet (the
 * owner: "The alerting is for later").
 */

import { Router } from 'express';
import type { Response } from 'express';
import type { BuildIdentity } from '@openmig/core';
import { buildIdentity } from '@openmig/core';
import {
  UNREADABLE_ANSWER_EVENT,
  log,
  parseUnreadableAnswer,
  recordAppEvent,
  unreadableAnswerLogLine,
} from '@openmig/shared';
import { authenticate } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { createKnockLimiter, type KnockLimiter } from '../knock-limit.ts';

/** Thirty reports an hour, per person. */
export const UNREADABLE_ANSWER_LIMIT = { windowMs: 60 * 60 * 1000, max: 30 } as const;

export interface UnreadableAnswerDeps {
  readonly limiter?: KnockLimiter;
  /** This server's build, for the line; `buildIdentity` unless a test gives its own. */
  readonly build?: () => BuildIdentity;
}

export function unreadableAnswerRoutes(deps: UnreadableAnswerDeps = {}): Router {
  const router = Router();
  const limiter = deps.limiter ?? createKnockLimiter(UNREADABLE_ANSWER_LIMIT);
  const build = deps.build ?? buildIdentity;

  router.post('/', authenticate, (req: AuthenticatedRequest, res: Response) => {
    const who = req.userId ?? req.userEmail ?? '';
    if (!limiter.take(who)) {
      res.set('Retry-After', String(limiter.retryAfterSeconds(who)));
      res.status(429).json({
        error: 'too_many_reports',
        reason: 'Your pages have reported many unreadable answers in the last hour. The first ones are kept.',
      });
      return;
    }
    const report = parseUnreadableAnswer(req.body);
    if (!report) {
      res.status(400).json({
        error: 'invalid_report',
        reason: 'A report of an unreadable answer needs the reference the page showed: eight hex characters.',
      });
      return;
    }
    log.error(unreadableAnswerLogLine(report, build()));
    // Not awaited: `recordAppEvent` never throws, and the page does not wait.
    void recordAppEvent({
      level: 'error',
      event: UNREADABLE_ANSWER_EVENT,
      reference: report.reference,
      ...(req.tenantId ? { tenantId: req.tenantId } : {}),
    });
    res.status(204).end();
  });

  return router;
}
