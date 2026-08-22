// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `POST /api/access-requests` — the front door somebody can actually knock on
 * (workplan 0093 T2).
 *
 * What it replaces: the website's only call to action was `mailto:`, so the
 * first step of becoming a customer was composing an email in whatever client
 * the visitor's browser opened, and the first record of them was an inbox.
 * Invite-only stays (owner decision, 2026-08-22) — this makes the ASKING part
 * of the service; granting is still the owner's own act.
 *
 * **Unauthenticated, on purpose, like `/health`, `/version` and `/metrics`** —
 * and unlike them it WRITES, which is the whole of the risk. Four things carry
 * that:
 *
 *  1. `access_request` grants `app_user` INSERT and nothing else, and its only
 *     RLS policy is for INSERT (migration 0002). Even if this route were
 *     tricked into reading, the database refuses — `permission denied for
 *     table access_request`, pinned by `access-request-under-rls.unit.test.ts`.
 *  2. Every field is length-capped here, before the insert. A public form is
 *     otherwise a free 100kb-per-request writeable store (express.json's
 *     default limit is the only other ceiling).
 *  3. A refusing rate limit (`knock-limit.ts`), which is a nuisance gate and
 *     says so — the real protection is the ingress. Sized as a SERVICE-WIDE cap,
 *     because without `TRUST_PROXY` every caller shares the ingress's address.
 *  4. **The response is the same whatever happens.** It never says whether an
 *     address is already known, already granted, or new: a public endpoint that
 *     distinguishes those is an account-enumeration oracle. It is also honest —
 *     from the asker's side all four cases genuinely are "we have it, a human
 *     will read it".
 *
 * It holds NO credentials and nothing about a mailbox (hard rule 3, §17): an
 * email address, a name, an organisation, a sentence, and which tier they think
 * they need — which is indicative only, because a tier is DERIVED from what
 * actually runs (ADR-0014) and never picked.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { withSubject, withSubjectAndTenant, tenant as tenantTable } from '@openmig/ledger';
import { accessRequest, tenantMember } from '@openmig/managed/schema-managed';
import { authenticateSubject, getDbPool } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
import { drizzle } from 'drizzle-orm/node-postgres';
import { log } from '@openmig/shared';
import { tell, type TellOutcome } from '../access-notify.ts';
import { serverFault } from '../server-fault.ts';
import { createKnockLimiter, knockLimitFromEnv, type KnockLimiter } from '../knock-limit.ts';

const router = Router();

let _dbPool: Pool | null = null;
function getSharedPool(): Pool {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

/**
 * Built on the first request rather than at import, matching `getSharedPool`
 * above — and for a reason beyond symmetry: the limit is read from the
 * environment, and a module-scope read happens at import time, which in a test
 * run is before the file that configures it has done anything. Reading it here
 * makes the configured value the one that is actually used, whoever imports
 * whom in what order.
 */
let _limiter: KnockLimiter | null = null;
function limiter(): KnockLimiter {
  if (!_limiter) _limiter = createKnockLimiter(knockLimitFromEnv());
  return _limiter;
}

/**
 * Caps chosen so a person is never truncated and a script gets nowhere. `note`
 * is the only one anybody could bump into: 2000 characters is several
 * paragraphs about what somebody is moving.
 */
const AccessRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().max(200).optional(),
  organisation: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
  /** ADR-0014's five, or nothing. Not validated against the tier list on
   *  purpose: a stale name here would refuse a request over a label, and the
   *  value is read by a human who knows what the tiers are called. */
  tier: z.string().trim().max(40).optional(),
  locale: z.enum(['en', 'nl']).default('en'),
});

/**
 * Who is knocking, for the rate limit only.
 *
 * `req.ip` is Express's, which honours `trust proxy` — see `TRUST_PROXY` in
 * `index.ts`. Unset, this is the INGRESS's address and the limit is
 * service-wide, which is what `DEFAULT_KNOCK_LIMIT` is sized for. Set, it
 * becomes per-caller and the limit can be tightened with
 * `ACCESS_REQUEST_MAX_PER_HOUR`.
 */
const callerKey = (req: Request): string => req.ip ?? 'unknown';

router.post('/', async (req: Request, res: Response) => {
  try {
    if (!limiter().take(callerKey(req))) {
      const retryAfter = limiter().retryAfterSeconds(callerKey(req));
      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Too many requests',
        message:
          'That is more requests than we expected from one place. Try again later, or write ' +
          'to us directly — nothing is lost.',
      });
      return;
    }

    const parsed = AccessRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // The field-level detail is the asker's own form coming back to them, so
      // it is safe and it is what makes the form usable.
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }
    const body = parsed.data;

    // NOT `withTenantDb`: there is no tenant. That is the point of this row,
    // and the reason `access_request` has no `tenant_id` on the way in.
    const db = drizzle(getSharedPool());
    await db.insert(accessRequest).values({
      email: body.email,
      ...(body.name ? { name: body.name } : {}),
      ...(body.organisation ? { organisation: body.organisation } : {}),
      ...(body.note ? { note: body.note } : {}),
      ...(body.tier ? { tier: body.tier } : {}),
      locale: body.locale,
    });

    // Logged without the note, and without the name: an access request is
    // somebody's contact details, and logs travel further than the database
    // does (§17). The address is what makes the line useful for support.
    log.info(`[access-request] ${body.email} asked for access (${body.locale})`);

    // 201 and nothing about them. See point 4 above.
    res.status(201).json({
      received: true,
      message:
        'Thank you — we have your request. A person reads these, and you will hear back by ' +
        'email.',
    });
  } catch (error) {
    serverFault(res, 'access_request_failed', 'recording this request', error);
  }
});

// ============================ Answering the door ============================
//
// Everything below is an OPERATOR's half of the conversation, and every one of
// these handlers is behind `authenticateSubject` rather than `authenticate`:
// an operator acts before any tenant exists, so resolving one would refuse them
// at the door (workplan 0093 T6).
//
// **The middleware is not what authorises them.** Migration 0005's policies
// are: `access_request` is invisible and unwritable unless
// `app.current_user` names a row in `platform_operator`, enforced against the
// `app_user` role the API really connects as. So a non-operator reaching these
// routes gets an empty list and a "not found", because to the database that is
// exactly what the row is. That is why nothing here re-checks "are you an
// operator" in application code and then trusts the answer — the check that
// matters already ran, one layer down, and a route that duplicated it would
// invite somebody to later "simplify" the real one away.

/**
 * The three states a request can be in, as a value rather than a comment.
 *
 * The column is an enum, so a plain `string` from the query string does not
 * type-check against it — which is the compiler asking the question the route
 * has to answer anyway: is what somebody typed in `?state=` one of these.
 */
const REQUEST_STATES = ['open', 'granted', 'declined'] as const;
type RequestState = (typeof REQUEST_STATES)[number];
const isRequestState = (value: unknown): value is RequestState =>
  typeof value === 'string' && (REQUEST_STATES as readonly string[]).includes(value);

/** The columns an operator is shown. `id` is what the decide routes take. */
const QUEUE_COLUMNS = {
  id: accessRequest.id,
  email: accessRequest.email,
  name: accessRequest.name,
  organisation: accessRequest.organisation,
  note: accessRequest.note,
  tier: accessRequest.tier,
  locale: accessRequest.locale,
  state: accessRequest.state,
  tenantId: accessRequest.tenantId,
  decidedBy: accessRequest.decidedBy,
  decidedAt: accessRequest.decidedAt,
  decisionNote: accessRequest.decisionNote,
  createdAt: accessRequest.createdAt,
};

/**
 * Where to send somebody to sign in, or null if this deployment cannot say.
 *
 * `WEB_URL` is the address a BROWSER uses — the same value the status page
 * probes and the identity provider registers its redirect against. Never
 * defaulted: a grant email carrying `http://localhost:3123` has told somebody
 * to go nowhere, and would go out looking exactly like a successful one.
 *
 * **And never thrown, either.** The first version of this threw, which turned a
 * missing variable into a 500 on a grant whose transaction had ALREADY
 * COMMITTED — the organisation existed and the operator was told it had failed.
 * That is precisely the inversion the send is placed after the commit to avoid,
 * reintroduced two lines away from the comment saying so. CI caught it.
 *
 * A deployment with no `WEB_URL` gets a warning at boot (`config-guards.ts`)
 * and, per grant, an operator who is told nobody was emailed.
 */
function appUrl(): string | null {
  const url = process.env.WEB_URL;
  return url ? url.replace(/\/+$/, '') : null;
}

/**
 * GET /api/access-requests — the queue.
 *
 * Open ones first and oldest first within that, because the queue is worked
 * from the top and somebody who asked on Monday should not be behind somebody
 * who asked on Friday. `?state=` narrows it; no filter shows everything, which
 * is what makes a decision reviewable afterwards.
 */
router.get('/', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'No subject on this request' });
      return;
    }

    const asked = req.query.state;
    if (asked !== undefined && !isRequestState(asked)) {
      res.status(400).json({
        error: 'Bad request',
        message: `state must be one of ${REQUEST_STATES.join(', ')} — not ${JSON.stringify(asked)}.`,
      });
      return;
    }
    const state = isRequestState(asked) ? asked : undefined;

    const requests = await withSubject(getSharedPool(), userId, async (db) => {
      // `$dynamic()` because the filter is conditional: without it drizzle
      // types a stored builder as already finished and `.where` becomes
      // uncallable.
      const query = db.select(QUEUE_COLUMNS).from(accessRequest).$dynamic();
      return await (state ? query.where(eq(accessRequest.state, state)) : query).orderBy(
        accessRequest.createdAt,
      );
    });

    res.json({ requests });
  } catch (error) {
    serverFault(res, 'access_request_list_failed', 'reading the access queue', error);
  }
});

/**
 * The `:id` from the path, or null if it is not one id.
 *
 * Express types a path parameter as `string | string[]` — a repeated one
 * arrives as an array — so `req.params.id!` is a lie that only shows up as a
 * type error at the query. `tenants/index.ts` guards the same way.
 */
function pathId(req: AuthenticatedRequest): string | null {
  const raw = req.params.id;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

const DecisionSchema = z.object({
  /** Free text a human wrote about the decision. Not shown to the asker. */
  note: z.string().trim().max(2000).optional(),
  /** What to call the organisation. Defaults to what they told us. */
  organisationName: z.string().trim().min(1).max(200).optional(),
});

/**
 * A decline, which can be a quiet one.
 *
 * **`notify` exists on this decision and not on the other**, and that asymmetry
 * is the point rather than an oversight. A grant that is not announced is a
 * grant nobody can use — the person has no way to learn they may sign in — so
 * there is nothing to opt out of. A decline is a courtesy, and the form it
 * answers is PUBLIC and rate-limited: `test@test.test` and a line of casino
 * spam both reach this queue, and mailing a refusal to a forged address means
 * mailing a stranger who never wrote to us. The operator can see which is which;
 * the server cannot.
 *
 * Defaulted to true so the quiet path is always deliberate — an operator who
 * sends nothing has unticked a box, not forgotten to tick one.
 */
const DeclineSchema = DecisionSchema.extend({
  notify: z.boolean().default(true),
});

/**
 * What became of the courtesy email, as the operator's screen says it.
 *
 * `tell`'s three, plus the one it never gets an opinion about: `skipped` is a
 * decision a human made here, not something that happened to a send. Keeping it
 * out of `TellOutcome` keeps that module honest — it reports on attempts, and
 * this was not one.
 */
type NotifiedOutcome = TellOutcome | 'skipped';

/**
 * POST /api/access-requests/:id/grant — say yes, and mean it.
 *
 * Granting is not a flag. It creates the organisation and its first owner, in
 * the SAME transaction that marks the request granted, because the three facts
 * are one fact: a tenant nobody asked for, or a request pointing at an
 * organisation that does not exist, are both worse than a failure.
 *
 * **The owner row is an INVITATION, not a member.** The person has not signed
 * in yet — they have no subject, and there is no way to know one before they
 * do. Inventing one keyed on their email would mean anybody who can create an
 * account with that address gets the organisation. So the row is written the
 * way `members.ts` already writes one (`status: 'invited'`, a `pending:` user
 * id), and `claimInvitations` binds it to a real subject on first sign-in —
 * only against an email the issuer says it VERIFIED.
 */
router.post('/:id/grant', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'No subject on this request' });
      return;
    }
    const id = pathId(req);
    if (!id) {
      res.status(400).json({ error: 'Bad request', message: 'Name exactly one request id.' });
      return;
    }
    const parsed = DecisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }

    // Minted here, not by the database: the tenant policies key on
    // `app.current_tenant`, so the scope has to be known BEFORE the insert.
    const tenantId = randomUUID();

    const outcome = await withSubjectAndTenant(getSharedPool(), userId, tenantId, async (db) => {
      const [request] = await db
        .select(QUEUE_COLUMNS)
        .from(accessRequest)
        .where(eq(accessRequest.id, id));

      // Invisible and absent are the same answer here, deliberately: a
      // non-operator must not be able to tell whether an id exists.
      if (!request) return { kind: 'notFound' } as const;
      if (request.state !== 'open') return { kind: 'decided', state: request.state } as const;

      const name =
        parsed.data.organisationName ?? request.organisation ?? request.name ?? request.email;

      await db.insert(tenantTable).values({ id: tenantId, name, status: 'active', settings: {} });

      await db.insert(tenantMember).values({
        tenantId,
        // Same placeholder shape `members.ts` uses, and for the same reason:
        // `user_id` is NOT NULL and unique per tenant, and the real subject
        // does not exist yet.
        userId: `pending:${randomUUID()}`,
        email: request.email,
        role: 'owner',
        status: 'invited',
        invitedAt: new Date(),
      });

      await db
        .update(accessRequest)
        .set({
          state: 'granted',
          tenantId,
          decidedBy: userId,
          decidedAt: new Date(),
          ...(parsed.data.note ? { decisionNote: parsed.data.note } : {}),
        })
        .where(eq(accessRequest.id, id));

      // `locale` travels out because the mail is written in the language they
      // asked in (ADR-0013), and the transaction is the only place the row is read.
      return { kind: 'granted', tenantId, name, email: request.email, locale: request.locale } as const;
    });

    if (outcome.kind === 'notFound') {
      res.status(404).json({ error: 'Not Found', message: 'No such access request.' });
      return;
    }
    if (outcome.kind === 'decided') {
      res.status(409).json({
        error: 'Conflict',
        message:
          `That request was already ${outcome.state}. Deciding it twice would ` +
          'either create a second organisation or lose the first.',
      });
      return;
    }

    // The address, because it is what makes the line useful for support; not
    // the note or the name (§17, same rule the knock above follows).
    log.info(`[access-request] granted ${outcome.email} tenant ${tenantId}`);

    // AFTER the commit, and outside it (workplan 0095 T3). Granting is three
    // writes or none; the email is not a fourth. A mail server that is down
    // must not roll back an organisation that was correctly created — and
    // equally the mail must only ever describe something that actually
    // happened, which is why it is here rather than inside the transaction.
    //
    // `tell` never throws. What it returns goes back to the operator, because
    // "nobody was told" means the manual step is back and they are the only
    // one who can take it.
    const where = appUrl();
    let notified: TellOutcome;
    if (where) {
      notified = await tell(outcome.email, outcome.locale, {
        kind: 'access_granted',
        organisation: outcome.name,
        appUrl: where,
        email: outcome.email,
      });
    } else {
      // `off` to the operator, because what they need to know is the same in
      // both cases: nobody was told, and the manual step is theirs. WHY goes to
      // the log, where it names the variable to set.
      log.error(
        `[access-request] WEB_URL is not set — granted ${outcome.email} but sent no email, ` +
          'because it would have named no address to sign in at',
      );
      notified = 'off';
    }

    res.status(201).json({ tenantId, name: outcome.name, email: outcome.email, notified });
  } catch (error) {
    serverFault(res, 'access_request_grant_failed', 'granting this request', error);
  }
});

/**
 * POST /api/access-requests/:id/decline — say no, and keep the record.
 *
 * No tenant, and the row is not deleted: `access_request` has no DELETE grant
 * for anybody, so a refusal cannot be made to disappear afterwards. That is the
 * queue's whole value as a record.
 *
 * **The person is told, unless the operator says not to** (workplan 0095 T5).
 * Somebody who wrote to a business and heard nothing back does not conclude
 * "declined"; they conclude the form is broken, and write again — which is why
 * a silent refusal costs more support than a spoken one. The mail carries no
 * reason and, in particular, NOT the decision note: the queue labels that field
 * "Note (for you, not for them)", and that promise is kept in the type — the
 * `access_declined` event has no fields at all, so there is nothing to leak
 * through and no later edit here can add one.
 */
router.post('/:id/decline', authenticateSubject, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized', message: 'No subject on this request' });
      return;
    }
    const id = pathId(req);
    if (!id) {
      res.status(400).json({ error: 'Bad request', message: 'Name exactly one request id.' });
      return;
    }
    const parsed = DeclineSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation error', details: parsed.error.issues });
      return;
    }

    const outcome = await withSubject(getSharedPool(), userId, async (db) => {
      const [request] = await db
        .select(QUEUE_COLUMNS)
        .from(accessRequest)
        .where(eq(accessRequest.id, id));

      if (!request) return { kind: 'notFound' } as const;
      if (request.state !== 'open') return { kind: 'decided', state: request.state } as const;

      await db
        .update(accessRequest)
        .set({
          state: 'declined',
          decidedBy: userId,
          decidedAt: new Date(),
          ...(parsed.data.note ? { decisionNote: parsed.data.note } : {}),
        })
        .where(eq(accessRequest.id, id));

      // `locale` for the same reason the grant carries it: the refusal is
      // written in the language they asked in (ADR-0013), and this transaction
      // is the only place the row is read.
      return {
        kind: 'declined',
        id: request.id,
        email: request.email,
        locale: request.locale,
      } as const;
    });

    if (outcome.kind === 'notFound') {
      res.status(404).json({ error: 'Not Found', message: 'No such access request.' });
      return;
    }
    if (outcome.kind === 'decided') {
      res.status(409).json({
        error: 'Conflict',
        message: `That request was already ${outcome.state}.`,
      });
      return;
    }

    log.info(`[access-request] declined ${outcome.email}`);

    // AFTER the commit and outside it, exactly like the grant: the refusal is
    // recorded whether or not the mail server is reachable, and the mail only
    // ever describes something that already happened.
    //
    // No `appUrl()` here — there is nowhere to send them, which is the whole
    // difference between this email and the other one. So a deployment with no
    // `WEB_URL` can still be polite.
    let notified: NotifiedOutcome;
    if (parsed.data.notify) {
      notified = await tell(outcome.email, outcome.locale, { kind: 'access_declined' });
    } else {
      // Logged because it is a decision a person made about another person, and
      // the queue row records the decision but not that it was kept quiet.
      log.info(`[access-request] declined ${outcome.email} without telling them (operator's choice)`);
      notified = 'skipped';
    }

    res.json({ declined: true, id: outcome.id, notified });
  } catch (error) {
    serverFault(res, 'access_request_decline_failed', 'declining this request', error);
  }
});

export default router;
