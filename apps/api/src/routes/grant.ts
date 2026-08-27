// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The migrator's two routes (workplan 0108 T4).
 *
 * Their own file, and not beside the owner's, because they authenticate a
 * different kind of caller: `authenticateMappingLink` attaches a mapping and a
 * tenant and **no identity at all**. Keeping them apart is what makes that
 * visible — a route in `migrations/` sits under `authenticate` and can read a
 * `userId`; a route here cannot, because there is no user.
 *
 * ## What a link holder may learn
 *
 * `GET /api/grant/:link` answers with the smallest set of facts a person needs
 * in order to decide: **who is asking** (the organisation's name — consenting
 * to an anonymous request is not consenting), **what will be read**, **which
 * scope** in Google's own words, and **until when** the link works. It does
 * not answer with the mapping id, the tenant id, the owner's email, the
 * client id, anything about other mappings, or anything about the
 * organisation beyond its name.
 *
 * ## The owner's secret never leaves the server
 *
 * `POST /api/grant/:link/google/authorize` reads the client id and secret out
 * of the mapping's own source connection and decrypts them here. 0089 T1's
 * owner beginning takes them from the request body, because the owner is the
 * person typing them in; this beginning must not, because the link holder is
 * not that person and must never hold that secret. The consent URL carries the
 * client id (Google requires it and it is not a secret); the secret goes only
 * into the token-exchange POST body, in the callback, in this process.
 */

import { Router } from 'express';
import type { RequestHandler, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { authenticateMappingLink, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { MappingLinkRequest } from '../types/api.ts';
import { serverFault } from '../server-fault.ts';
import {
  GOOGLE_SOURCE_SCOPES,
  consentUrl,
  rawIpCallbackRefusal,
} from './migrations/google-consent.ts';
import { consentFlows } from './migrations/consent-flows.ts';
import { GOOGLE_CONSENT_KIND_TO_SOURCE } from './migrations/grant-link-readiness.ts';

const router = Router();

let _dbPool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_dbPool) _dbPool = getDbPool();
  return _dbPool;
}

/**
 * Link authentication, with the database resolved on the FIRST REQUEST rather
 * than at import.
 *
 * `authenticateMappingLink(purpose, source)` takes its source eagerly, so
 * writing it straight into `router.get(...)` would call `getDbPool()` while
 * this module is being loaded — which throws when `DATABASE_URL` is unset, and
 * therefore makes merely importing the router depend on a configured database.
 * Every other database use in this file already defers through `pool()`; this
 * makes the middleware do the same.
 */
const linkAuth: RequestHandler = (req, res, next) =>
  authenticateMappingLink('grant', pool())(req, res, next);

/**
 * What each Google source reads, in the words a person would use about their
 * own account — beside the scope, never instead of it (ADR-0041's operative
 * rule: the scopes are shown AS scopes).
 */
const READS: Readonly<Record<string, string>> = {
  gmail: 'your email — messages, folders and labels',
  google_calendar: 'your calendars and their events',
  google_contacts: 'your contacts',
  google_drive: 'your files in Google Drive',
};

interface GrantSubject {
  readonly organisation: string;
  readonly sourceKind: string;
  readonly reads: string;
  readonly scope: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Everything the grant flow needs about one mapping, read in one place.
 *
 * The refusals here are the SAME ones the owner met at issue time
 * (`grant-link-readiness.ts`), because a link can outlive the configuration
 * that made it issuable — an owner can delete a connection, or rotate a
 * client, between sending a link and somebody opening it. Re-checked at use,
 * not trusted from issue.
 */
async function loadSubject(
  tenantId: string,
  mappingId: string,
): Promise<{ ok: true; subject: GrantSubject } | { ok: false; reason: string }> {
  const rows = await withTenantDb(tenantId, pool(), (db) =>
    db
      .select({
        organisation: schema.tenant.name,
        kind: schema.connection.kind,
        secretRef: schema.connection.secretRef,
      })
      .from(schema.mailboxMapping)
      .innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMapping.sourceMailboxId))
      .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
      .innerJoin(schema.tenant, eq(schema.tenant.id, schema.mailboxMapping.tenantId))
      .where(
        and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)),
      ),
  );
  const row = rows[0];
  // Every one of these is somebody else's mistake, so the sentence is written
  // to be forwarded: it tells the reader what to say to the person who sent
  // them here, rather than what to fix themselves.
  const notReady = (what: string) => ({
    ok: false as const,
    reason:
      `This migration is not ready to be connected — ${what}. Nothing you can do from here ` +
      'will fix that; please tell the person who sent you the link.',
  });
  if (!row) return notReady('it no longer exists');

  const source = GOOGLE_CONSENT_KIND_TO_SOURCE[row.kind];
  if (!source) return notReady('it does not connect to a Google account');

  let creds: Record<string, unknown> = {};
  try {
    if (row.secretRef) creds = SecretStore.decryptCredentials(row.secretRef);
  } catch {
    creds = {};
  }
  const str = (key: string) =>
    typeof creds[key] === 'string' && creds[key].trim().length > 0 ? creds[key] : '';
  const clientId = str('clientId');
  const clientSecret = str('clientSecret');
  if (!clientId || !clientSecret) return notReady('its Google application is not set up yet');

  return {
    ok: true,
    subject: {
      organisation: row.organisation,
      sourceKind: row.kind,
      reads: READS[row.kind] ?? 'your account',
      scope: GOOGLE_SOURCE_SCOPES[source],
      clientId,
      clientSecret,
    },
  };
}

/** The address Google must redirect to — the SAME one the owner registered. */
function callbackUri(req: MappingLinkRequest): string {
  const base = (process.env.API_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return `${base}/api/migrations/google/callback`;
}

/**
 * GET /api/grant/:link — what this page must be able to say before the button.
 *
 * Deliberately a GET that changes nothing. Chat applications fetch URLs to draw
 * previews, and 0108 T1 made single-use spend at the GRANT rather than at the
 * open precisely so this cannot burn a link. Opening is repeatable right up
 * until somebody actually grants.
 */
router.get(
  '/:link',
  linkAuth,
  async (req: MappingLinkRequest, res: Response) => {
    try {
      const { tenantId, mappingId, expiresAt } = req.mappingLink!;
      const loaded = await loadSubject(tenantId, mappingId);
      if (!loaded.ok) return void res.status(409).json({ error: 'not_ready', reason: loaded.reason });
      res.json({
        organisation: loaded.subject.organisation,
        reads: loaded.subject.reads,
        // The scope in Google's own words, beside the plain sentence rather
        // than behind it: a person consenting is entitled to the exact string
        // their account will record (ADR-0041).
        scope: loaded.subject.scope,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      serverFault(res, 'grant_read_failed', 'reading this migration', error);
    }
  },
);

/**
 * POST /api/grant/:link/google/authorize — where the button goes.
 *
 * Answers with a URL for the browser to follow rather than redirecting, so the
 * page can show what happened if this refuses — a 302 into a Google error is
 * exactly the dead end this whole task exists to remove.
 */
router.post(
  '/:link/google/authorize',
  linkAuth,
  async (req: MappingLinkRequest, res: Response) => {
    try {
      const { linkId, tenantId, mappingId } = req.mappingLink!;
      const loaded = await loadSubject(tenantId, mappingId);
      if (!loaded.ok) return void res.status(409).json({ error: 'not_ready', reason: loaded.reason });

      const redirectUri = callbackUri(req);
      const ipRefusal = rawIpCallbackRefusal(redirectUri);
      if (ipRefusal) {
        // 0089 T6's refusal, reached by a person who cannot act on it — so it
        // is wrapped rather than repeated raw. The detail stays, because the
        // owner will need it when this gets forwarded to them.
        return void res.status(409).json({
          error: 'raw_ip_callback',
          reason:
            'This migration cannot use a Google sign-in yet, because of how the server is ' +
            `reached. Please forward this to the person who sent you the link: ${ipRefusal}`,
        });
      }

      const state = consentFlows.begin({
        clientId: loaded.subject.clientId,
        clientSecret: loaded.subject.clientSecret,
        scope: loaded.subject.scope,
        redirectUri,
        // What makes this the LINK ending at the callback. Recorded server-side
        // on the pending state, never round-tripped through the browser.
        link: { linkId, mappingId, tenantId },
      });

      res.json({
        url: consentUrl({
          clientId: loaded.subject.clientId,
          scope: loaded.subject.scope,
          redirectUri,
          state,
        }),
      });
    } catch (error) {
      serverFault(res, 'grant_authorize_failed', 'starting the Google sign-in', error);
    }
  },
);

export default router;
