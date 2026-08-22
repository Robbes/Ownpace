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
import { getDbPool } from '../middleware/auth.ts';
import { managedSchema } from '@openmig/managed';
import { drizzle } from 'drizzle-orm/node-postgres';
import { log } from '@openmig/shared';
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
    await db.insert(managedSchema.accessRequest).values({
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

export default router;
