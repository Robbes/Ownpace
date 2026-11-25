// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * PUT /api/grant/:link/password — A PASSWORD THE PERSON TYPES THEMSELVES
 * (workplan 0174 §5.3 to §5.7, §7; the owner's D1 to D5 of 2026-11-25; T3).
 *
 * The owner, 2026-11-25: *"I want all sources/targets that supports granting
 * to be able to use the others-grant-page."* The point: no person's password
 * ever has to pass through the one who sets up the migration. So the person
 * types it on their own link, it is tested as the create door tests, and it
 * is stored only when it works.
 *
 *     { "ref": "<the card's ref from GET>", "values": { "password": "…" }, "locale": "nl" }
 *
 * ## The order (§5.3)
 *
 * 1. The caller's limit (§7.4): thirty tests an hour per `req.ip`, before the
 *    link is even read. Then the link: a PERSON'S grant link only (a
 *    migration's own link answers 404, §13), and an open organisation.
 * 2. The body: `application/json` only (415), at most 4 KiB (413), the keys
 *    `ref`, `values` and `locale` and no other, and `values` exactly the
 *    card's person fields, each a non-empty string (400). Nothing of it is
 *    ever echoed.
 * 3. Already connected through this link: 409 `already_connected`, and no
 *    test (§7.2: a replay makes no login and counts no try).
 * 4. A server the owner named by an IP literal: 409 `server_not_a_name`, no
 *    test (§5.8, D3 (a)). A host that resolves inside our own network is
 *    refused by the probe's own rule (`tenantFetch`, `reachableHost`, 0136 T1)
 *    and answers `unreachable`.
 * 5. A try is claimed (§5.5, `person-link-tries.ts`): none left, 423
 *    `locked`, and no test. The sixth try is never tested.
 * 6. The test (§5.4, `password-test.ts`), within the door's budget.
 * 7. A failure: the try kept for `refused_login` (D4) and given back for
 *    anything else, `mapping.grant_refused` written, 422 with the category
 *    and the tries left. Nothing else is written.
 * 8. A success: one transaction (`storePersonPassword`), the link checked
 *    live again inside it (§7.5: a revoke mid-test stores nothing, 401 the
 *    one sentence).
 * 9. After commit: `startWhenGranted`, and the person's progress link, as a
 *    sign-in's ending does. The answer: `{ connected, faces, linkSpent,
 *    progressUrl }`. Never a value.
 *
 * ## The password in no log, audit row, response or URL (§5.6)
 *
 * The route logs the category and the card's `ref`, never `req.body`. The
 * probe's failure is said from its parts and its full text logged under a
 * reference (`probeAnswers`), never returned. A body the parser could not
 * read is answered by `unreadable-body.ts`, which prints none of it. The
 * guard is a test, not a promise: `a-password-the-link-never-says.unit.test.ts`.
 *
 * ## CSRF (§7.3)
 *
 * No cookie and no session ride here: the link is in the path and must be
 * known. JSON only, which a cross-site form cannot send without a preflight.
 *
 * The words for each answer are the page's (T4): this route answers codes,
 * and the two sentences a person may need to forward, in both languages.
 */

import type { Pool } from 'pg';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { LINK_SPENT, log, reasonPair, type Bilingual, type DiscoveryDomain } from '@openmig/shared';
import { withTenantDb } from '../middleware/auth.ts';
import { refusedAsClosed } from '../closed-organisation.ts';
import { createKnockLimiter, type KnockLimiter } from '../knock-limit.ts';
import { probeAnswers } from '../probe-answer.ts';
import { serverFault } from '../server-fault.ts';
import type { PersonLinkRequest } from '../types/api.ts';
import { DOOR_BUDGET_MS } from './qualify-and-remember.ts';
import { readGrantRows, storedCredentials } from './migrations/grant-subject.ts';
import {
  PASSWORD_TRIES_PER_LINK,
  readPersonGrantSubject,
  type PersonGrantAccount,
  type PersonGrantSubject,
} from './migrations/person-grant-subject.ts';
import {
  mintPersonProgressLink,
  recordPasswordRefused,
  storePersonPassword,
  type PersonPasswordTarget,
} from './migrations/person-grant-ending.ts';
import { claimATry, giveTheTryBack, keepTheTry } from './migrations/person-link-tries.ts';
import { startWhenGranted } from './migrations/start-when-granted.ts';
import { runPasswordTest, type PasswordTestDeps, type PasswordTestRun } from './password-test.ts';
import { isAddressLiteral } from './grant-server-domain.ts';
import type { PasswordKind, PasswordTestInput } from './grant-providers.ts';

/** The largest body this route reads (§5.3 step 2). */
export const PASSWORD_BODY_LIMIT_BYTES = 4 * 1024;

/** The longest one value may be: a password, not a document. */
const VALUE_LIMIT = 1024;

/** Tests per caller per hour (§7.4): one process, keyed by `req.ip`, as `knock-limit.ts` says. */
export const PASSWORD_TESTS_PER_HOUR = 30;

/** When the owner named the server by a number, so the password is not sent to it (§5.8, D3 (a)). */
export const SERVER_NOT_A_NAME: Bilingual = {
  en:
    'This link names its server by a number instead of a name, so your password is not sent to it. ' +
    'Tell the person who sent you the link.',
  nl:
    'Deze link noemt de server met een nummer in plaats van een naam, dus uw wachtwoord wordt er niet ' +
    'naartoe gestuurd. Laat het de persoon weten die u de link stuurde.',
};

type PersonLink = NonNullable<PersonLinkRequest['personLink']>;

/** The source of the database, resolved on first use, as `grant.ts` does. */
export type PoolSource = () => Pool | LedgerDriver;

/** What the route reaches outside itself, so a test can record the servers. */
export interface PasswordRouteDeps {
  readonly test?: PasswordTestDeps;
  readonly limiter?: KnockLimiter;
}

/** The limiter, ahead of the link check: a guessed link spends from it too. */
export function passwordLimit(limiter: KnockLimiter): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    if (limiter.take(key)) return next();
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds(key)));
    res.status(429).json({ error: 'too_many_tests' });
  };
}

/** The limiter the route is mounted with. */
export function passwordLimiter(): KnockLimiter {
  return createKnockLimiter({ windowMs: 60 * 60 * 1000, max: PASSWORD_TESTS_PER_HOUR });
}

/** The body, checked (§5.3 step 2): the ref and the values, or the code of what is wrong. */
function readBody(
  req: Request,
): { readonly ok: true; readonly ref: string; readonly values: Record<string, string> } | { readonly ok: false; readonly status: number; readonly error: string } {
  if (!req.is('application/json')) return { ok: false, status: 415, error: 'json_only' };
  const declared = Number(req.get('content-length'));
  const body: unknown = req.body;
  const size = Number.isFinite(declared) && declared > 0 ? declared : Buffer.byteLength(JSON.stringify(body ?? null));
  if (size > PASSWORD_BODY_LIMIT_BYTES) return { ok: false, status: 413, error: 'body_too_large' };
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, status: 400, error: 'body_not_an_object' };
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== 'ref' && k !== 'values' && k !== 'locale')) {
    return { ok: false, status: 400, error: 'unknown_key' };
  }
  if (typeof b.ref !== 'string' || b.ref === '' || b.ref.length > 64) return { ok: false, status: 400, error: 'ref_missing' };
  const v = b.values;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ok: false, status: 400, error: 'values_missing' };
  const values: Record<string, string> = {};
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    if (typeof value !== 'string' || value === '' || value.length > VALUE_LIMIT) {
      return { ok: false, status: 400, error: 'values_not_the_fields' };
    }
    values[k] = value;
  }
  return { ok: true, ref: b.ref, values };
}

/** Whether a person's link asks for this account again (managed migration 0036), as `grant.ts` reads it. */
function asksAgainFor(link: PersonLink, account: PersonGrantAccount): boolean {
  return account.granted && account.migrations.some((m) => link.asksAgain?.includes(m.mappingId) ?? false);
}

/** A config object, or nothing. */
function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The string values of a record. */
function stringValues(record: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

/**
 * What the test is handed (§5.4): the owner's config with the migration's own
 * account over it, and the stored credentials (the connection's, and for a
 * source the migration's own) with the person's values over them, key by
 * key. Read from the card's first migration: every migration of one card
 * reads one connection and one account.
 */
async function testInput(
  source: Pool | LedgerDriver,
  link: PersonLink,
  account: PersonGrantAccount & { readonly ask: { readonly ok: true; readonly way: 'password'; readonly kind: PasswordKind } },
  values: Record<string, string>,
): Promise<PasswordTestInput | null> {
  const first = account.migrations[0];
  if (!first) return null;
  return withTenantDb(link.tenantId, source, async (db) => {
    const rows = await readGrantRows(db, link.tenantId, first.mappingId);
    if (!rows) return null;
    const conn = account.role === 'source' ? rows.source : rows.target;
    if (!conn) return null;
    const { recentOnly: _own, ...override } = objectOf(account.role === 'source' ? rows.sourceOverride : rows.targetOverride);
    const config = { ...objectOf(conn.config), ...override };
    let mine: Record<string, string> = {};
    if (account.role === 'source') {
      const [m] = await db
        .select({ ref: schema.mailboxMapping.sourceSecretRef })
        .from(schema.mailboxMapping)
        .where(and(eq(schema.mailboxMapping.id, first.mappingId), eq(schema.mailboxMapping.tenantId, link.tenantId)));
      mine = stringValues(storedCredentials(m?.ref ?? null));
    }
    const stored = { ...stringValues(storedCredentials(conn.secretRef)), ...mine };
    // A row saved for the person by its address alone (0174 §8.2) keeps the
    // account in its config: the DAV and JMAP logins read `username`.
    const user = typeof config.user === 'string' ? config.user : typeof config.username === 'string' ? config.username : '';
    const credentials = { ...(user ? { username: user } : {}), ...stored, ...values };
    return {
      role: account.role,
      kind: account.ask.kind,
      config,
      credentials,
      faces: account.ask.domains as ReadonlyArray<DiscoveryDomain>,
    };
  });
}

/** The test, or `unreachable` when it outlived the door's budget (§5.3 step 5). */
async function withinTheDoor(run: Promise<PasswordTestRun>): Promise<PasswordTestRun> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<PasswordTestRun>((resolve) => {
    timer = setTimeout(() => resolve({ test: { ok: false, category: 'unreachable' } }), DOOR_BUDGET_MS);
  });
  try {
    return await Promise.race([run, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The handler, mounted behind the limiter and the link check (`grant.ts`). */
export function passwordThroughLink(pool: PoolSource, deps: PasswordRouteDeps = {}): RequestHandler {
  return async (req: Request, res: Response) => {
    const link = (req as PersonLinkRequest).personLink;
    // A migration's own link has no password page (§13): as if no door were here.
    if (!link) return void res.status(404).json({ error: 'not_found' });
    const body = readBody(req);
    if (!body.ok) return void res.status(body.status).json({ error: body.error });
    try {
      if (await refusedAsClosed(res, link.tenantId, pool())) return;
      const subject: PersonGrantSubject | null = await withTenantDb(link.tenantId, pool(), (db) =>
        readPersonGrantSubject(db, link.tenantId, link.personId, process.env, { linkId: link.linkId }),
      );
      const account = subject?.accounts.find((a) => a.ref === body.ref);
      if (!account || account.way !== 'password' || !account.ask.ok || account.ask.way !== 'password') {
        return void res.status(409).json({ error: 'not_this_account' });
      }
      const ask = account.ask;
      // Exactly the card's person fields: none missing, none added (§5.3 step 2).
      const personKeys = (account.fields ?? []).filter((f) => f.who === 'person').map((f) => f.key);
      const given = Object.keys(body.values);
      if (given.length !== personKeys.length || !personKeys.every((k) => given.includes(k))) {
        return void res.status(400).json({ error: 'values_not_the_fields' });
      }
      // A replay, or a second tab, tries no login (§7.2).
      if (account.granted && !asksAgainFor(link, account)) {
        return void res.status(409).json({ error: 'already_connected' });
      }
      // A password is sent to a name, never a number (§5.8, D3 (a)).
      if (account.server && !account.server.published && account.server.hosts.some(isAddressLiteral)) {
        return void res.status(409).json({ error: 'server_not_a_name', ...reasonPair(SERVER_NOT_A_NAME) });
      }

      const target: PersonPasswordTarget = { linkId: link.linkId, tenantId: link.tenantId, personId: link.personId, ref: account.ref };
      const mappingIds = account.migrations.map((m) => m.mappingId);
      const claim = await claimATry(pool(), target);
      if (!claim.claimed) {
        log.info(`[grant] a password on a person's link: locked (ref ${account.ref})`);
        await recordPasswordRefused(pool(), target, mappingIds, 'locked');
        return void res.status(423).json({ error: 'locked', tries: { left: 0, locked: true } });
      }

      const input = await testInput(pool(), link, { ...account, ask }, body.values);
      if (!input) {
        await giveTheTryBack(pool(), target);
        return void res.status(409).json({ error: 'not_this_account' });
      }
      const answers = probeAnswers('testing a password on a grant link', link.tenantId);
      const run = await withinTheDoor(runPasswordTest(input, personKeys, answers, deps.test));
      const left = (refusedNow: number) => Math.max(0, PASSWORD_TRIES_PER_LINK - refusedNow);

      if (!run.test.ok) {
        const { category } = run.test;
        let tries: { left: number; locked: boolean };
        if (category === 'refused_login') {
          tries = await keepTheTry(pool(), target);
        } else {
          await giveTheTryBack(pool(), target);
          tries = { left: left(claim.refused - 1), locked: false };
        }
        log.info(`[grant] a password on a person's link: ${category} (ref ${account.ref})`);
        await recordPasswordRefused(pool(), target, mappingIds, category);
        return void res.status(422).json({
          error: category,
          category,
          ...(run.test.faces === undefined ? {} : { faces: run.test.faces }),
          tries,
        });
      }

      // A login that worked is no try.
      await giveTheTryBack(pool(), target);
      const stored = await storePersonPassword(pool(), target, run.test.secret, run.qualification);
      if (!stored.ok) {
        log.info(`[grant] a tested password was not stored: ${stored.code} (ref ${account.ref})`);
        const status = stored.code === 'link_spent' ? 401 : 409;
        const reason = stored.code === 'link_spent' ? LINK_SPENT : stored.reason;
        return void res.status(status).json({ error: stored.code, ...reasonPair(reason) });
      }
      log.info(`[grant] a password on a person's link: connected (ref ${account.ref})`);
      // After the commit, as a sign-in's ending: neither can undo the grant.
      await startWhenGranted(pool(), { tenantId: link.tenantId, mappingIds: stored.granted });
      const progress = await mintPersonProgressLink(pool(), link);
      res.json({ connected: true, faces: run.test.faces, linkSpent: stored.linkSpent, progressUrl: progress ?? null });
    } catch (error) {
      // A try claimed before a fault stays counted: the safe direction for
      // somebody's password (`person-link-tries.ts`).
      serverFault(res, 'grant_password_failed', 'testing a password on a grant link', error);
    }
  };
}
