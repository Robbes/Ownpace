// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * "Report this link" (workplan 0108 T8 (d)): a link holder's report, delivered
 * as a ticket on the owner's own Zammad, like every other report (0130).
 *
 * One router per kind of link, mounted beside that link's own routes:
 * `/api/grant/:link/report` for the grant page, `/api/view/:link/report` for
 * the progress page. Each authenticates its own kind of link, so neither page
 * can report through the other's address, and a link that no longer opens its
 * page cannot report either: nothing more can happen through it, and a person
 * who granted keeps the progress link to report from.
 *
 * ## Nobody is signed in, so the limits are the link's and the service's
 *
 * The signed-in form limits each person. Here there is no person to count,
 * and the address a reporter types is theirs to make up. So:
 *
 * - **three reports a day per link.** A person reporting a link does it once,
 *   perhaps adds something later;
 * - **thirty an hour across the service**, for grant and progress links
 *   together, so that minting links to report from cannot fill the owner's
 *   helpdesk faster than somebody reads it. Both routers share the one count.
 *
 * Only a report that parses counts against either. A refusal costs nothing
 * and makes no ticket.
 *
 * ## What is never sent, logged or answered
 *
 * The link itself: the ticket carries its id, which is the half of the link
 * that grants nothing. The access log writes the path as `:link`
 * (`access-log.ts`), and nothing here writes it anywhere else.
 */

import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import type { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { log, newAppEvent, recordAppEvent, viewGrantFor } from '@openmig/shared';
import { authenticateMappingLink, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { MappingLinkRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import { createKnockLimiter, type KnockLimiter } from '../knock-limit.ts';
import { isRefusal } from '../problem-report.ts';
import {
  linkReportTicketFor,
  parseLinkReport,
  type LinkReportFacts,
  type ReportedLink,
} from '../link-report.ts';
import { createZammadTicket, reportingConfig, ZammadRefused, zammadOwnUserId } from '../services/zammad.ts';
import { namedAccount, readAskedBy, readGrantRows, whereFromAndTo } from './migrations/grant-subject.ts';

/** Three reports a day, per link. */
export const LINK_REPORT_PER_LINK = { windowMs: 24 * 60 * 60 * 1000, max: 3 } as const;
/** Thirty an hour, for every link on the service together. */
export const LINK_REPORT_OVERALL = { windowMs: 60 * 60 * 1000, max: 30 } as const;

/** The one key the service-wide count is kept under. */
const EVERY_LINK = 'every-link';

// Module-level, so the grant and progress routers count together.
const PER_LINK = createKnockLimiter(LINK_REPORT_PER_LINK);
const OVERALL = createKnockLimiter(LINK_REPORT_OVERALL);

export interface LinkReportDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  readonly perLink?: KnockLimiter;
  readonly overall?: KnockLimiter;
  /** The database, resolved on the first request, as `grant.ts` resolves it. */
  readonly source?: () => Pool | LedgerDriver;
}

/** What the rows say about the link and its migration. */
async function readFacts(
  source: Pool | LedgerDriver,
  link: ReportedLink,
  ids: { linkId: string; tenantId: string; mappingId: string },
): Promise<LinkReportFacts | null> {
  const { linkId, tenantId, mappingId } = ids;
  return withTenantDb(tenantId, source, async (db) => {
    const rows = await db
      .select({
        organisation: schema.tenant.name,
        state: schema.mailboxMapping.status,
        sourceSecretRef: schema.mailboxMapping.sourceSecretRef,
        grantWithdrawnAt: schema.mailboxMapping.grantWithdrawnAt,
      })
      .from(schema.mailboxMapping)
      .innerJoin(schema.tenant, eq(schema.tenant.id, schema.mailboxMapping.tenantId))
      .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
    const mapping = rows[0];
    if (!mapping) return null;
    // Best effort past this point: a migration whose source or destination
    // is gone is still worth reporting, and says so in the ticket.
    const grantRows = await readGrantRows(db, tenantId, mappingId);
    return {
      link,
      linkId,
      tenantId,
      organisation: mapping.organisation,
      mappingId,
      state: mapping.state,
      issuedBy: await readAskedBy(db, tenantId, linkId),
      from: grantRows ? namedAccount(grantRows) : null,
      to: grantRows ? (whereFromAndTo(grantRows)?.to ?? null) : null,
      access: viewGrantFor(mapping).state,
    };
  });
}

export function linkReportRoutes(link: ReportedLink, deps: LinkReportDeps = {}): Router {
  const router = Router();
  const perLink = deps.perLink ?? PER_LINK;
  const overall = deps.overall ?? OVERALL;

  let pool: Pool | LedgerDriver | null = null;
  const source = (): Pool | LedgerDriver => (pool ??= (deps.source ?? getDbPool)());
  const linkAuth: RequestHandler = (req, res, next) =>
    authenticateMappingLink(link, source())(req, res, next);

  /** Whether to offer the report at all: a report that can reach nobody is not offered. */
  router.get('/:link/report', linkAuth, (_req, res: Response) => {
    res.json({ available: reportingConfig(deps.env) !== undefined });
  });

  router.post('/:link/report', linkAuth, async (req: MappingLinkRequest, res: Response) => {
    const config = reportingConfig(deps.env);
    if (!config) {
      res.status(503).json({
        error: 'reporting_unavailable',
        reason: 'Reporting a link is not set up on this service.',
      });
      return;
    }
    const parsed = parseLinkReport(req.body);
    if (isRefusal(parsed)) {
      res.status(parsed.status).json({ error: 'invalid_report', field: parsed.field, reason: parsed.reason });
      return;
    }
    const { linkId, tenantId, mappingId } = req.mappingLink!;
    if (!perLink.take(linkId)) {
      res.set('Retry-After', String(perLink.retryAfterSeconds(linkId)));
      res.status(429).json({
        error: 'too_many_reports',
        reason: 'This link was reported several times today. Please wait before sending another.',
      });
      return;
    }
    if (!overall.take(EVERY_LINK)) {
      res.set('Retry-After', String(overall.retryAfterSeconds(EVERY_LINK)));
      res.status(429).json({
        error: 'too_many_reports',
        reason: 'Many reports reached us in the last hour. Please try again a little later.',
      });
      return;
    }

    let facts: LinkReportFacts | null;
    try {
      facts = await readFacts(source(), link, { linkId, tenantId, mappingId });
    } catch (error) {
      res.locals.tenantId = tenantId;
      serverFault(res, 'link_report_failed', 'reading the migration this link belongs to', error);
      return;
    }
    if (!facts) {
      // A link goes with its migration (ON DELETE CASCADE), and this one
      // verified a moment ago: the migration was deleted in between.
      res.status(410).json({
        error: 'migration_gone',
        reason: 'The migration this link belonged to no longer exists, so it can no longer read anything.',
      });
      return;
    }

    try {
      // A report without a reply address is filed under the helpdesk's own
      // user (the owner, 2026-09-24): asked only then, since an addressed
      // report's customer is the reporter.
      const ownUserId =
        parsed.replyTo === undefined ? await zammadOwnUserId(config, deps.fetchImpl) : undefined;
      const ticket = await createZammadTicket(
        config,
        linkReportTicketFor(parsed, facts, config.group, ownUserId),
        deps.fetchImpl,
      );
      res.status(201).json({ ticket });
    } catch (err) {
      // On the operator's log page (0129 T1), and on this line with its
      // reference, as the signed-in form records one. The person keeps what
      // they wrote: the form still holds it.
      const failed = newAppEvent({ level: 'error', event: 'report.not-delivered', tenantId });
      log.error(
        `[api] a link report could not be delivered [ref ${failed.reference}]:`,
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
