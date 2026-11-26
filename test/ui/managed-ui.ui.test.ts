// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Does the MANAGED UI work in a browser? (the 2026-08-11 lesson)
//
// On 2026-08-11 the owner spent an afternoon clicking through the running
// managed app and found eight defects. The unit suite was green before and
// after: 2202 tests, none of which had ever opened a page. Three of the eight
// were only findable this way, and all three had shipped:
//
//   * THE STYLESHEET NEVER COMPILED. Both editions served raw unstyled HTML
//     for weeks. Every existing check passed — the packaging test asserts
//     `/ui/confirm` returns `<!doctype html>`, the e2e UI smoke asserts the
//     screens boot, and both are true of a completely unstyled page.
//   * THE BUNDLE CALLED THE WRONG ORIGIN. A stale `VITE_API_URL` baked an
//     absolute `http://localhost:3123/api` into the shipped JavaScript, so
//     every screen showed "Network Error" from any machine that was not the
//     server. Nothing in the repo asserts where the app sends its requests.
//   * THE LIST ROWS WERE DEAD. They had a hover state and no click handler.
//
// This file is the gate those three would have failed. It is a SMOKE, not a
// visual or functional test suite: it asks whether the shipped bundle
// evaluates, renders, is styled, talks to its own origin, and tells the truth
// when a read fails. Pixel diffs, wizard flows and money paths are out of
// scope and belong to the component tests that already cover them.
//
// ## No API, no database, no Docker — and that is deliberate
//
// The three defects above are all in the BUNDLE and its relationship to the
// origin serving it. None of them needs a real API to reproduce, and requiring
// one would have pushed this suite into the nightly e2e job, where it would
// have caught them a release too late. Instead a ~40-line fixture server plays
// the part nginx plays in production: it serves `apps/web/dist` and answers
// `/api/*` at the SAME ORIGIN.
//
// That is what makes the origin assertion honest. A bundle carrying a baked
// absolute URL does not reach this server at all, so the screens render their
// error state and the test fails — the real failure, reproduced, rather than
// mocked away by intercepting whatever URL the app happened to ask for.
//
// The build runs with VITE_API_URL explicitly REMOVED from the environment,
// because the shipped default (`/api`, same-origin) is the thing under test.
// A machine that happens to export it — the exact accident that caused the
// live outage — must not be able to make this suite pass.
//
// ## And under the policy the app is served with (workplan 0158)
//
// The fixture server sends each file with the headers the web image's nginx
// sends it with, read from `apps/web/nginx.conf.template` as nginx reads it
// (`scripts/nginx-config.mjs`), the Content-Security-Policy among them. Every
// page this file opens listens for `securitypolicyviolation`, and a violation
// fails the test that opened the page. The listener is needed: Chromium logs
// nothing to the console for an `eval` a script tried inside a try/catch, and
// that is exactly what zod's probe did on every load until the entry turned it
// off (`apps/web/src/zod-without-eval.ts`).
//
// ## What this suite cannot see
//
// Server-side truth. The same afternoon turned up a mapping list reporting
// "last sync: 9 days ago" for a mapping syncing every 15 minutes, and 24.3
// billable compute hours for seconds of work. Both were real, both were
// invisible here: the UI rendered exactly what the API told it. Those are
// caught by the ledger and worker tests, and by looking at a live deployment.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContextOptions, type Page, type Request } from 'playwright-core';
import { envsubst, headersFor, parseNginx } from '../../scripts/nginx-config.mjs';
import {
  APP_SCREEN_NOW,
  APP_SCREEN_PERSON,
  APP_SCREEN_READY,
  appScreenAnswers,
  appScreenText,
  type AppScreenLocale,
} from './app-screen.ts';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DIST = join(REPO, 'apps/web/dist');

/**
 * THE WEB IMAGE'S NGINX, as the image renders it: `API_UPSTREAM` as the image
 * defines it, and no sign-in host, because this suite builds the bundle
 * without one (it signs in by pasting a token). What the template adds to a
 * file's answer is what this server adds to it.
 */
const TEMPLATE_PATH = 'apps/web/nginx.conf.template';
const NGINX = parseNginx(
  envsubst(readFileSync(join(REPO, TEMPLATE_PATH), 'utf8'), { API_UPSTREAM: 'api:3001', VITE_OIDC_ISSUER: '' }),
  TEMPLATE_PATH,
);

/** The headers nginx adds to the answer for this path; none when it chooses no location. */
function nginxHeaders(path: string): Record<string, string> {
  return Object.fromEntries((headersFor(NGINX, path) ?? []).map((h) => [h.name, h.value]));
}

/**
 * Every policy violation any page of this file met, as `csp: <directive>
 * <blocked> at <file>:<line>`. A page `open` loads also logs each one as a
 * console error, which `expectClean` refuses; this list holds the pages that
 * are opened otherwise, and is asked at the end.
 */
const violations: string[] = [];
const EXPLICIT_CHROMIUM = process.env.E2E_CHROMIUM ?? '/opt/pw-browsers/chromium';

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const MAPPING = 'a0000000-0000-4000-8000-0000000000d1';
const PERSON = 'a0000000-0000-4000-8000-0000000000e1';

/**
 * FOUR LINKS THE FIXTURES KNOW (workplan 0141 T12 (b)): a migration's grant
 * link and progress link, and a person's. Each is `<id>.<secret>`, the one
 * segment `/grant/:link` and `/view/:link` take. NOT CREDENTIALS: nothing here
 * checks a secret, and the API that would is absent from this suite.
 */
const GRANT_LINK = 'a0000000-0000-4000-8000-0000000000f1.ui-smoke-not-a-secret';
const PERSON_GRANT_LINK = 'a0000000-0000-4000-8000-0000000000f2.ui-smoke-not-a-secret';
const VIEW_LINK = 'a0000000-0000-4000-8000-0000000000f3.ui-smoke-not-a-secret';
const PERSON_VIEW_LINK = 'a0000000-0000-4000-8000-0000000000f4.ui-smoke-not-a-secret';
/** A person's link that asks for their own password (workplan 0174 T4). */
const PASSWORD_GRANT_LINK = 'a0000000-0000-4000-8000-0000000000f5.ui-smoke-not-a-secret';
/** What the smoke types into the password box: a placeholder, plainly not anybody's password. */
const TYPED_IN_THE_BOX = 'ui-smoke-placeholder-typed';
/**
 * What a link asks Google for, as `grant-link-readiness.ts` words it: the data
 * types' scopes, then the two that say who signed in.
 */
const WHO_SIGNED_IN = 'openid https://www.googleapis.com/auth/userinfo.email';
const MAIL_AND_CALENDAR_SCOPE = `https://mail.google.com/ https://www.googleapis.com/auth/calendar ${WHO_SIGNED_IN}`;
/**
 * A person's account, as their progress page names it: 32 lowercase hex, the
 * shape of `refOf`'s ref (`apps/api/src/routes/person-progress.ts`), which is
 * all a withdrawal may name (`PersonWithdrawalSchema`).
 */
const ACCOUNT_REF = '0123456789abcdef0123456789abcdef';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/**
 * NOT A CREDENTIAL, and it does not need to be: nothing here verifies a
 * signature. The client decodes the payload for the claims it needs and the
 * API — absent in this suite — is what checks the signature on every call. The
 * claims are the ones `decodeTokenClaims` requires; omitting any of them makes
 * the sign-in screen refuse the paste, which is itself the product working.
 */
const TOKEN = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({
    sub: 'ui-smoke',
    email: 'owner-a@demo.openmigrate.test',
    tenantId: TENANT,
    role: 'owner',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
  'ui-smoke-not-a-signature',
].join('.');

/**
 * What the API would answer. Keyed `METHOD /path`.
 *
 * Shapes come from the OpenAPI document and the live smoke output, not from
 * imagination — a fixture that does not look like the server teaches this
 * suite to accept a UI that could never work against the real one.
 */
const FIXTURES: Record<string, unknown> = {
  /**
   * ASKED ON EVERY SIGNED-IN SCREEN, because that is where the answer belongs.
   *
   * `PlatformPauseBanner` sits in the layout: an operator hold stops copying
   * for every migration a person has, so a notice on one of their pages would
   * be the same silence one click away. That makes this the second fixture,
   * after the build stamp, that every single page in this suite needs — and
   * without it the browser logs a 404 for a resource on every load, which is
   * exactly what `expectClean` is watching for.
   *
   * `held: false` is the shape the route answers when nothing is held. Not a
   * 404: "we asked and the answer is no" and "we could not ask" must not look
   * the same to the screen, and the banner renders nothing for either.
   */
  [`GET /api/platform-pause`]: { held: false },
  /**
   * WHETHER TO OFFER "REPORT A PROBLEM" (workplan 0130), asked by the layout on
   * every signed-in page, like the hold above: the link beside Sign out is
   * shown only when the deployment has somewhere to send a report to.
   *
   * `available: true` is the answer of a deployment with its Zammad or its
   * mail set up (the mail alone is enough since 0130 T5), so
   * the link renders on every page this suite opens, and the form it leads to
   * is opened below. Without this fixture every page logs a 404, which is how
   * this entry came to be written.
   */
  [`GET /api/problem-reports/available`]: { available: true },
  /**
   * THE ORGANISATION'S ADDRESS CHANGES (workplan 0168 §6.3), read by *Start a
   * migration*, the person's page, the team screen, the migration page and the
   * Sharing checklist. An empty table, as most organisations have: every page
   * here then says what it said before the table existed.
   */
  [`GET /api/address-changes`]: { rows: [], door: 'api', file: null },
  /**
   * WHAT A REPORT FROM THIS PAGE WOULD CARRY (workplan 0130 T6), asked by the
   * form once it knows the service takes reports: where it goes, and its
   * lines of facts, which the form shows verbatim in its fold. The lines are
   * the API's to write; two stand for them here.
   */
  [`GET /api/problem-reports/preview`]: {
    to: { kind: 'mail', addresses: ['support@example.invalid'] },
    lines: ['Page: /mappings', 'Role: owner'],
  },
  // The build stamp in the sidebar asks the server what IT is running
  // (services/build-identity.ts). Answered from the ROOT package.json rather
  // than a literal, for the same reason every other consumer reads it there:
  // a copy here would drift and this suite would go on asserting against the
  // wrong one. Commit left empty, which is what an unstamped build sends —
  // and what the bundle under test has, since nothing passes GIT_SHA here.
  [`GET /api/version`]: {
    version: (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string })
      .version,
    commit: '',
  },
  /**
   * WHAT THIS DEPLOYMENT ACCEPTS, asked before the page offers anything at all
   * (workplan 0102 T1).
   *
   * The bundle under test carries no `VITE_OIDC_ISSUER`, and the paste box used
   * to follow from that alone. It now follows from the API's answer, so without
   * this fixture the page renders its "checking" line forever and every case
   * below times out looking for a textarea — the same shape of failure the
   * missing `/api/me` fixture caused in #559, and the reason it is spelled out
   * here rather than left as one more line in a table.
   */
  [`GET /api/auth/mode`]: { mode: 'local', acceptsSeedToken: true },
  /**
   * WHO THE SIGN-IN SCREEN ASKS ABOUT, and the reason `open()` below can reach
   * a dashboard at all.
   *
   * The paste path used to log in on the strength of its own decode. It now
   * asks the API first, because a token this app can DECODE is not a token the
   * API will ACCEPT — on a stack with an issuer configured it never is, and the
   * old behaviour turned that into a dashboard flash and a silent bounce back
   * to the login screen.
   *
   * So this fixture is not scaffolding for the test: it is the call the product
   * makes, and its absence is why this suite timed out waiting to leave /login.
   * The identity is the API's to state (ADR-0042) and deliberately differs from
   * nothing in TOKEN — the claims agree here because a real `/api/me` resolving
   * this subject WOULD agree.
   */
  [`GET /api/me`]: {
    userId: 'ui-smoke',
    email: 'owner-a@demo.openmigrate.test',
    tenantId: TENANT,
    role: 'owner',
    tenants: [{ tenantId: TENANT, role: 'owner' }],
    operator: false,
    invitations: [],
  },
  [`GET /api/migrations`]: {
    mappings: [
      {
        id: MAPPING,
        tenantId: TENANT,
        name: 'Acme Families — mail',
        sourceType: 'imap',
        targetType: 'jmap',
        status: 'active',
        mode: 'mirror',
        pattern: null,
        domains: ['email'],
        lastSyncAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  },
  /**
   * WHO EACH MIGRATION IS FOR (workplan 0153 T3, ADR-0050): the Migrations
   * page is one card per person, so it reads the people beside the
   * migrations. The shape is `packages/shared/src/people.ts`'s, which the
   * route answers on both editions.
   */
  [`GET /api/people`]: {
    people: [
      {
        id: PERSON,
        implicit: false,
        displayName: 'Anna',
        email: null,
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        you: false,
        migrations: [{ id: MAPPING, status: 'active' }],
        counts: { paused: 0, active: 1, cutover: 0, done: 0, continuous: 0 },
      },
    ],
    unassigned: [],
  },
  /**
   * THE PERSON'S ONE LINK (ADR-0035, amended 2026-09-29; 0153 T5 (b)): their
   * page lists it, as `person-link-routes.ts` answers, and none is made yet.
   */
  [`GET /api/people/${PERSON}/links`]: { links: [] },
  /**
   * WHAT WAITS FOR THEIR GRANT (start when granted, per person): their page
   * asks beside the links, and nothing of theirs waits.
   */
  [`GET /api/people/${PERSON}/awaiting-grant`]: { migrations: [] },
  /**
   * WHAT NEEDS EACH PERSON, counted on their card (0153 T3 (a)). `?all=true`
   * keeps the quiet migrations, so this one is here with nothing waiting.
   */
  [`GET /api/attention`]: {
    mappings: [
      {
        mappingId: MAPPING,
        name: 'Acme Families — mail',
        pendingDecisions: 0,
        deletionsWaiting: 0,
        movesWaiting: 0,
        failuresWaiting: 0,
        readyForCutover: false,
        autoApplied: 0,
        sharingOpen: 0,
      },
    ],
  },
  [`GET /api/migrations/${MAPPING}`]: {
    id: MAPPING,
    tenantId: TENANT,
    name: 'Acme Families — mail',
    status: 'active',
    mode: 'mirror',
    domains: ['email'],
    domainStatus: [
      { domain: 'email', state: 'completed', itemsSynced: 3, itemsFailed: 0, startedAt: new Date().toISOString() },
    ],
    sourceConfig: { type: 'imap-oauth2', host: 'stalwart', port: 993, username: 'source@dev.local', password: '********' },
    targetConfig: { type: 'jmap', baseUrl: 'http://stalwart:8080', username: 'target@dev.local', password: '********' },
  },
  // The pace the organisation's migrations run at (0157 T5): a paid tier's, so
  // the person's page draws no Free line. Its own tests hold the line.
  'GET /api/migrations/pace': { leastMinutesBetweenPasses: 0, nextPassAt: {} },
  // Where each data type is (0154 T1 (b)): the lines on a person's card and page.
  'GET /api/migrations/progress': {
    mappings: [
      {
        mappingId: MAPPING,
        domains: [
          {
            domain: 'email',
            state: 'completed',
            phase: 'active',
            itemsSynced: 3,
            itemsFound: 3,
            bytesTransferred: 3000,
            lastSyncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          },
        ],
        check: { state: 'not_run' },
      },
    ],
  },
  [`GET /api/migrations/${MAPPING}/runs`]: {
    runs: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'succeeded',
        kind: 'incremental',
        trigger: 'schedule',
        startedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
        finishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        itemsProcessed: 3,
        errors: 0,
        events: [],
      },
    ],
  },
  /**
   * THE PAGES A STRANGER OPENS (workplan 0141 T12 (b)): what the API answers
   * for the four links above. The migration's grant link has the shape of
   * `SubjectSchema` and the person's of `PersonSubjectSchema`
   * (`apps/web/src/services/grant-service.ts`), as
   * `apps/api/src/routes/grant.ts` answers them; the two progress links have
   * `view-service.ts`'s, as `apps/api/src/routes/view.ts` answers them.
   * Each page also asks whether a report of its link can reach somebody, and
   * here one can, so *Report this link* is drawn as a tester meets it.
   *
   * Nobody in them is real: the addresses are on reserved example domains.
   */
  [`GET /api/grant/${GRANT_LINK}`]: {
    organisation: 'Acme Families',
    checkedCompany: null,
    askedBy: 'owner-a@demo.openmigrate.test',
    organisationPhone: null,
    domains: ['email', 'calendar'],
    scope: MAIL_AND_CALENDAR_SCOPE,
    readOnlyAtProvider: false,
    from: 'anna@example.com',
    to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna@example.org' },
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  },
  [`GET /api/grant/${GRANT_LINK}/report`]: { available: true },
  [`GET /api/grant/${PERSON_GRANT_LINK}`]: {
    kind: 'person',
    organisation: 'Acme Families',
    checkedCompany: null,
    askedBy: 'owner-a@demo.openmigrate.test',
    organisationPhone: null,
    accounts: [
      {
        ref: 'a0000000000000000000000000000f21',
        account: 'anna@example.com',
        granted: false,
        again: false,
        domains: ['email', 'calendar'],
        scope: MAIL_AND_CALENDAR_SCOPE,
        readOnlyAtProvider: false,
        notReady: null,
        migrations: [
          { domains: ['email'], to: { provider: 'soverin', host: null, account: 'anna@soverin.example' }, granted: false },
          {
            domains: ['calendar'],
            to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna@example.org' },
            granted: false,
          },
        ],
      },
      // A second account, still to connect too, so the link opens on its first
      // screen and has a screen of accounts (workplan 0176 §5.1, §5.3).
      {
        ref: 'a0000000000000000000000000000f22',
        account: 'anna.files@example.com',
        granted: false,
        again: false,
        domains: ['file'],
        scope: `https://www.googleapis.com/auth/drive.readonly ${WHO_SIGNED_IN}`,
        readOnlyAtProvider: true,
        notReady: null,
        migrations: [
          {
            domains: ['file'],
            to: { provider: 'nextcloud', host: 'cloud.example.org', account: 'anna@example.org' },
            granted: false,
          },
        ],
      },
    ],
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  },
  [`GET /api/grant/${PERSON_GRANT_LINK}/report`]: { available: true },
  /**
   * A PERSON'S LINK WITH A PASSWORD CARD (workplan 0174 T4): their IMAP mail,
   * a source, whose server the owner fixed, as `apps/api/src/routes/grant.ts`
   * answers it since 0174 T1; and what `PUT /api/grant/:link/password` answers
   * when the password works (§5.3).
   */
  [`GET /api/grant/${PASSWORD_GRANT_LINK}`]: {
    kind: 'person',
    organisation: 'Acme Families',
    checkedCompany: null,
    askedBy: 'owner-a@demo.openmigrate.test',
    organisationPhone: null,
    accounts: [
      {
        ref: 'a0000000000000000000000000000174',
        role: 'source',
        way: 'password',
        provider: 'imap',
        account: 'anna@example.com',
        server: { hosts: ['imap.example.com'], published: false, domains: ['example.com'], notTheAddressMail: [] },
        fields: [
          { key: 'host', who: 'owner', labelKey: 'account.host', secret: false, value: 'imap.example.com' },
          { key: 'port', who: 'owner', labelKey: 'account.port', secret: false, value: '993' },
          { key: 'username', who: 'owner', labelKey: 'account.sourceUsername', secret: false, value: 'anna@example.com' },
          { key: 'password', who: 'person', labelKey: 'account.sourcePassword', secret: true, autoComplete: 'new-password', revealable: true },
        ],
        tries: { left: 5, locked: false },
        granted: false,
        again: false,
        domains: ['email'],
        scope: null,
        readOnlyAtProvider: false,
        notReady: null,
        migrations: [
          {
            domains: ['email'],
            to: { provider: 'soverin', host: null, account: 'anna@soverin.example' },
            from: { provider: 'imap', account: 'anna@example.com' },
            granted: false,
          },
        ],
      },
    ],
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    addressChanges: [],
  },
  [`GET /api/grant/${PASSWORD_GRANT_LINK}/report`]: { available: true },
  [`PUT /api/grant/${PASSWORD_GRANT_LINK}/password`]: { connected: true, faces: ['email'] },
  [`GET /api/view/${VIEW_LINK}`]: {
    organisation: 'Acme Families',
    state: 'active',
    started: true,
    from: 'gmail',
    domains: [
      {
        domain: 'email',
        state: 'in_progress',
        stage: 'copying',
        itemsSynced: 4211,
        itemsFound: 5000,
        itemsFailed: 0,
        bytesTransferred: 91_000_000,
        itemsRetrying: 0,
        itemsNeedingDecision: 0,
        lastActiveAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
      {
        domain: 'calendar',
        state: 'completed',
        stage: 'kept_in_step',
        itemsSynced: 120,
        itemsFound: 120,
        itemsFailed: 0,
        bytesTransferred: 240_000,
        itemsRetrying: 0,
        itemsNeedingDecision: 0,
        lastSyncedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
        lastActiveAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
    ],
    expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    grant: { state: 'granted' },
  },
  [`GET /api/view/${VIEW_LINK}/report`]: { available: true },
  [`GET /api/view/${PERSON_VIEW_LINK}`]: {
    kind: 'person',
    organisation: 'Acme Families',
    expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    migrations: [
      {
        from: 'gmail',
        to: 'soverin',
        state: 'active',
        started: true,
        domains: [
          {
            domain: 'email',
            state: 'in_progress',
            stage: 'copying',
            itemsSynced: 4211,
            itemsFound: 5000,
            itemsFailed: 0,
            bytesTransferred: 91_000_000,
            itemsRetrying: 0,
            itemsNeedingDecision: 0,
            lastActiveAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          },
        ],
        account: ACCOUNT_REF,
      },
      // Waiting for its first pass: the page says nothing has been copied.
      { from: 'google', to: 'nextcloud', state: 'active', started: false, domains: [], account: ACCOUNT_REF },
    ],
    accounts: [{ ref: ACCOUNT_REF, grant: { state: 'granted' } }],
  },
  [`GET /api/view/${PERSON_VIEW_LINK}/report`]: { available: true },
};

/** Per-test failures: `METHOD /path` -> status. Cleared between tests. */
/**
 * Forced refusals. A bare number is a status with a generic body; the object
 * form carries the BODY too, because one refusal in this product is keyed on
 * its sentence rather than its status — `api.ts` treats
 * `403 {message: 'No active membership for this tenant'}` as a dead session and
 * signs the caller out, and a generic 403 proves nothing about it.
 */
const failures = new Map<string, number | { status: number; body: unknown }>();
/** Every `/api` path the browser asked for, and the ones no fixture knew. */
const apiHits: string[] = [];
const apiMisses: string[] = [];
/** Every body a fixture ANSWERED FROM (`FromBody`), as sent: what a screen posted. */
const apiBodies: Array<{ readonly key: string; readonly body: unknown }> = [];

/**
 * A fixture that answers from the request's JSON body, where one path is
 * asked twice for two things (0174 T6: an iCloud account and a Soverin one,
 * both saved for a person at `POST /api/connections`).
 */
class FromBody {
  readonly answer: (body: unknown) => unknown;
  constructor(answer: (body: unknown) => unknown) {
    this.answer = answer;
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * nginx's job, in one function: static files from the build, `/api` at the
 * same origin, and an index.html fallback so client-side routes reload. The
 * build is `apps/web/dist` unless another is named (the Alpha's, below).
 */
function startServer(dist: string = DIST): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const key = `${req.method} ${url.pathname}`;

    if (url.pathname.startsWith('/api')) {
      apiHits.push(url.pathname);
      const forced = failures.get(key);
      if (forced) {
        const status = typeof forced === 'number' ? forced : forced.status;
        const body =
          typeof forced === 'number'
            ? { error: 'Internal server error', message: 'the database is unreachable' }
            : forced.body;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }
      const body = FIXTURES[key];
      if (body instanceof FromBody) {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const sent: unknown = chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8'));
          apiBodies.push({ key, body: sent });
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body.answer(sent)));
        });
        return;
      }
      if (body === undefined) {
        apiMisses.push(key);
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found', message: `no fixture for ${key}` }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    // Static, with traversal refused the boring way.
    const rel = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    let file = join(dist, rel);
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
      file = join(dist, 'index.html');
    }
    res.writeHead(200, {
      ...nginxHeaders(`/${file.slice(dist.length + 1)}`),
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(res);
  });

  return new Promise((ok) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      ok({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

let browser: Browser;
let server: Server;
let BASE: string;

interface Loaded {
  readonly page: Page;
  readonly errors: string[];
  readonly badResponses: string[];
  readonly origins: Set<string>;
  text(): Promise<string>;
}

/**
 * A PHONE (workplan 0145 T8 (a)): its width and height, and a browser that
 * says it is one, with touch.
 */
const PHONE: BrowserContextOptions = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/**
 * The page fits the phone it is on (workplan 0145 T8 (a)). A phone shows a page
 * wider than itself by zooming out: its layout grows to the page's width, so
 * the window's width follows the page and nothing scrolls. So both are held to
 * the phone's 390 pixels, not the page to the window (which is all
 * `site.ui.test.ts` needs, without `isMobile`). Every fold is opened first: the
 * grant page's *Technical details* holds its widest words, the scope's
 * unbroken addresses, and a closed fold is not laid out, so it would never
 * count.
 */
async function expectItFitsAPhone(page: Page, what: string, phoneWidth = PHONE.viewport!.width): Promise<void> {
  await page.evaluate(() =>
    document.querySelectorAll('details').forEach((d) => {
      d.open = true;
    }),
  );
  const width = await page.evaluate(() => ({
    window: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(width.window, `${what} is wider than a phone, which zoomed out to fit it`).toBe(phoneWidth);
  expect(width.page, `${what} scrolls sideways at ${phoneWidth}px`).toBeLessThanOrEqual(phoneWidth + 1);
}

/**
 * THE NARROW PHONE (workplan 0176 §16): 320 pixels is what 200% zoom lays out
 * on a window of 640, and the width criterion 1.4.10 names.
 */
const NARROW: BrowserContextOptions = { viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true };

/**
 * A new page that reports every policy violation it meets: as a console error
 * the page's own listeners see, and into `violations`. Before any script of
 * the app runs, so a violation while the bundle loads is caught too.
 */
async function newPage(
  locale: 'en-GB' | 'nl-NL' = 'en-GB',
  options: Pick<BrowserContextOptions, 'timezoneId' | 'viewport' | 'isMobile' | 'hasTouch'> = {},
): Promise<Page> {
  const page = await browser.newPage({ ...options, locale });
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().startsWith('csp: ')) violations.push(`${page.url()} ${m.text()}`);
  });
  await page.addInitScript(() => {
    document.addEventListener(
      'securitypolicyviolation',
      (e) => console.error(`csp: ${e.effectiveDirective} ${e.blockedURI || '(inline)'} at ${e.sourceFile}:${e.lineNumber}`),
      true,
    );
  });
  return page;
}

/**
 * Load a route, signed in as an operator unless `signedIn: false`, on a phone
 * when `phone` (PHONE), from another build's server when `base` names one,
 * recording what a user cannot see.
 */
async function open(
  path: string,
  opts: { locale?: 'en' | 'nl'; signedIn?: boolean; clock?: Date; phone?: boolean; narrow?: boolean; base?: string } = {},
): Promise<Loaded> {
  const base = opts.base ?? BASE;
  const page = await newPage(opts.locale === 'nl' ? 'nl-NL' : 'en-GB', {
    // A page held to a moment reads it in the servers' zone, as the pictures
    // taken at that moment did (`scripts/shoot-the-app-screen.mjs`).
    ...(opts.clock ? { timezoneId: 'UTC' } : {}),
    ...(opts.phone ? PHONE : {}),
    ...(opts.narrow ? NARROW : {}),
  });
  if (opts.clock) await page.clock.setFixedTime(opts.clock);
  const errors: string[] = [];
  const badResponses: string[] = [];
  const origins = new Set<string>();

  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  // THE SIGN-IN'S LANDING PAGE IS LET SETTLE before the goto below leaves it.
  // Leaving a page aborts whatever it still had in flight, and the landing page
  // starts its requests a moment after its address changes, which is all
  // waitForURL waits for: the goto then aborted them, in this test's own
  // navigation, in a third to a half of the runs once 0139 T3's gate moved the
  // timing. So the landing page gets what goto gives the page it loads, 500 ms
  // with nothing in flight (settled(), below), and an abort of what it asked
  // for is still let through, should one start in the last moment. An answer
  // of 400 or more, or any other failure, from the landing page still counts.
  const landing = new Set<Request>();
  let signingIn = opts.signedIn !== false;
  let inFlight = 0;
  let lastChange = Date.now();
  page.on('request', (r) => {
    if (signingIn) landing.add(r);
    inFlight += 1;
    lastChange = Date.now();
  });
  page.on('requestfinished', () => {
    inFlight -= 1;
    lastChange = Date.now();
  });
  page.on('requestfailed', (r) => {
    inFlight -= 1;
    lastChange = Date.now();
    const failure = r.failure()?.errorText;
    if (landing.has(r) && failure === 'net::ERR_ABORTED') return;
    badResponses.push(`${r.url()} (${failure})`);
  });
  const settled = async (): Promise<void> => {
    const until = Date.now() + 15_000;
    while ((inFlight > 0 || Date.now() - lastChange < 500) && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  page.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(`${r.url()} -> ${r.status()}`);
  });
  page.on('request', (r) => origins.add(new URL(r.url()).origin));

  await page.addInitScript(
    (locale) => window.localStorage.setItem('openmig.locale', locale as string),
    opts.locale ?? 'en',
  );

  if (opts.signedIn !== false) {
    // Through the product's own front door, rather than by writing its auth
    // store's persisted shape into localStorage. A test that seeds internals
    // keeps passing after sign-in breaks, and the sign-in screen is the first
    // thing every operator meets.
    await page.goto(`${base}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.fill('#token', TOKEN);
    await page.click('form button[type=submit]');
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15_000 });
    await settled();
  }

  signingIn = false;
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 30_000 });
  return { page, errors, badResponses, origins, text: async () => (await page.textContent('body')) ?? '' };
}

function expectClean(l: Loaded, what: string): void {
  expect(l.errors, `${what} raised errors in the browser`).toEqual([]);
  expect(l.badResponses, `${what} had failed requests`).toEqual([]);
}

beforeAll(async () => {
  // The bundle as it SHIPS. VITE_API_URL is deleted rather than merely unset:
  // an exported value in the developer's shell is the exact accident that put
  // an absolute origin into a production build (2026-08-11), and it must not
  // be able to make this suite pass.
  const env = { ...process.env };
  delete env.VITE_API_URL;
  execFileSync('pnpm', ['--filter', '@openmig/web', 'build'], { cwd: REPO, env, stdio: 'pipe' });
  expect(existsSync(join(DIST, 'index.html')), 'the web build produced no index.html').toBe(true);

  ({ server, base: BASE } = await startServer());
  browser = await chromium.launch({
    ...(existsSync(EXPLICIT_CHROMIUM) ? { executablePath: EXPLICIT_CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

describe('the managed UI boots and is styled', () => {
  it('renders the sign-in screen instead of a blank page', async () => {
    const l = await open('/login', { signedIn: false });
    expect(await l.page.locator('#root > *').count(), 'the bundle served but never mounted').toBeGreaterThan(0);
    expect(await l.text()).toContain('Sign in to Ownpace'); // i18n key login.title
    expectClean(l, '/login');
    await l.page.close();
  });

  it('SHIPS A COMPILED STYLESHEET — the defect that reached production', async () => {
    const l = await open('/login', { signedIn: false });

    // An uncompiled index.css still loads and still parses — what it does not
    // have is SIZE. The broken build shipped 3.08 KB of `:root` variables
    // against 35.63 KB of real utilities, so the served bytes separate "a
    // stylesheet arrived" from "the stylesheet was built".
    //
    // Counting `cssRules` was the first attempt and it was wrong: Tailwind v4
    // emits its utilities inside `@layer`, which is ONE top-level rule, so a
    // perfectly good stylesheet counted 55. A metric that fails on working
    // code teaches people to delete the test.
    const cssBytes = await l.page.evaluate(async () => {
      const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')];
      const sizes = await Promise.all(
        links.map(async (link) => (await (await fetch(link.href)).text()).length),
      );
      return sizes.reduce((a, b) => a + b, 0);
    });
    expect(cssBytes, 'the served stylesheet is tiny — Tailwind did not compile').toBeGreaterThan(20_000);

    // And the rules reach the page: a utility-classed button must not be
    // rendering with the browser's default chrome.
    const bg = await l.page.evaluate(() => {
      const el = document.querySelector('form button[type=submit]') ?? document.querySelector('button');
      return el ? getComputedStyle(el).backgroundColor : '';
    });
    expect(bg, 'the submit button has no background — styles are not applied').not.toMatch(
      /rgba\(0, 0, 0, 0\)|transparent|^$/,
    );
    await l.page.close();
  });
});

describe('the managed UI talks to its own origin', () => {
  it('SENDS API REQUESTS SAME-ORIGIN — the defect that broke the live deployment', async () => {
    const l = await open('/mappings');
    await l.page.waitForSelector('[data-migration]', { timeout: 10_000 });

    // Every request, including the API ones, went to the origin that served
    // the page. A bundle with a baked absolute URL fails here by never
    // reaching the fixture server at all.
    expect([...l.origins], 'the app called an origin other than the one serving it').toEqual([BASE]);
    expect(apiHits.some((p) => p.startsWith('/api/')), 'the app made no API call at all').toBe(true);
    expectClean(l, '/mappings');
    await l.page.close();
  });

  it('asks only for endpoints the API actually serves', async () => {
    // apiMisses is filled by the fixture server whenever the UI asks for a
    // path no fixture knows. Every entry is either a route this suite has not
    // modelled or one the API does not serve — both worth seeing, neither
    // worth guessing about.
    expect(apiMisses, 'the UI called endpoints with no fixture').toEqual([]);
  });
});

/**
 * A GUIDE WITHOUT A SESSION (workplan 0152; the owner, 2026-10-04: *"Guide
 * links on the Leaving pages: yes, make public"*). The site's Leaving pages
 * link `/docs/google#gmail` and its like, for people who have no account.
 *
 * The one read the guide could make is forced to answer 401 here, as the API
 * would to a request whose session is gone: through the app's client, a 401
 * signs the browser out and sends it to `/login`. So staying on the guide is
 * the whole property, in the shipped bundle, and not a mock's opinion of it.
 */
describe('a guide opens without a session (0152)', () => {
  it('stays on /docs/google#gmail, in the front door’s look, and asks the API only for the build stamp', async () => {
    failures.set('GET /api/provider-clients', { status: 401, body: { error: 'Unauthorized' } });
    const before = apiHits.length;
    try {
      const l = await open('/docs/google#gmail', { signedIn: false });

      const at = new URL(l.page.url());
      expect(at.pathname + at.hash, 'a visitor without a session was sent away from the guide').toBe(
        '/docs/google#gmail',
      );
      expect(await l.page.locator('article [id="gmail"]').count(), 'the section the link names').toBe(1);
      const text = await l.text();
      expect(text).toContain('Google — Drive, Gmail, Calendar, Contacts and Tasks');
      expect(text).toContain('Setup guides'); // nav.docs, the frame's heading
      // The way back to the site, in the site's teal (0152 T9): drawn, so the
      // palette compiled.
      const back = l.page.getByRole('link', { name: 'ownpace.eu' });
      expect(await back.getAttribute('href')).toBe('https://www.ownpace.eu/');
      expect(await back.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(14, 79, 74)');
      expect(
        apiHits.slice(before).filter((path) => path !== '/api/version'),
        'the guide asked the API for a visitor without a session',
      ).toEqual([]);
      expectClean(l, '/docs/google#gmail without a session');
      await l.page.close();
    } finally {
      failures.delete('GET /api/provider-clients');
    }
  });
});

describe('the migrations list', () => {
  it('renders the migrations the API returned, on the card of the person they are for', async () => {
    const l = await open('/mappings');
    await l.page.waitForSelector('[data-migration]');
    const text = await l.text();
    expect(text).toContain('Acme Families — mail');
    expect(await l.page.getByRole('heading', { name: 'Anna' }).count(), 'no card for the person').toBe(1);
    expect(text).not.toContain('No migrations yet'); // i18n key mappings.empty.title
    expectClean(l, '/mappings');
    await l.page.close();
  });

  it('OPENS THE MIGRATION WHEN THE ROW IS CLICKED — the dead-row defect', async () => {
    const l = await open('/mappings');
    await l.page.waitForSelector('[data-migration]');

    // Its last pass: inside the migration, outside every button and link,
    // which is where the owner clicked a row and nothing happened.
    // The line's sentence since 0154 T1 (b): *3 of ~3 · last pass …*.
    await l.page.locator(`[data-migration="${MAPPING}"]`).getByText(/last pass/i).first().click(); // people.line.lastPass
    await l.page.waitForURL(`**/mappings/${MAPPING}`, { timeout: 10_000 });

    expect(l.page.url()).toContain(`/mappings/${MAPPING}`);
    expect(await l.page.locator('#root > *').count()).toBeGreaterThan(0);
    expectClean(l, 'the migration detail reached by clicking a row');
    await l.page.close();
  });

  it('says a read FAILED rather than showing an empty list (hard rule 9)', async () => {
    failures.set('GET /api/migrations', 500);
    try {
      const l = await open('/mappings');
      // Waited for, not sampled: the client retries a failed read with backoff,
      // so the honest error arrives seconds after the screen first paints.
      // Sampling early reads the spinner and calls it a pass.
      await l.page.locator('text=Could not load the migrations list.').first().waitFor({ timeout: 30_000 });

      // The distinction the product exists to make: "I could not look" must
      // never render as "there is nothing".
      expect(await l.text()).not.toContain('No migrations yet'); // mappings.empty.title
      await l.page.close();
    } finally {
      failures.delete('GET /api/migrations');
    }
  });

  it('says the PEOPLE read failed rather than showing every migration as nobody’s (0153 T3 (d))', async () => {
    failures.set('GET /api/people', 500);
    try {
      const l = await open('/mappings');
      await l.page.locator('text=Could not load who each migration is for.').first().waitFor({ timeout: 30_000 }); // people.loadFailed
      const text = await l.text();
      expect(text).not.toContain('No migrations yet'); // mappings.empty.title
      expect(text).not.toContain('Not with a person yet'); // people.unassigned.title
      await l.page.close();
    } finally {
      failures.delete('GET /api/people');
    }
  });
});

/**
 * What Start a migration asks for, answered as the API would: Anna's saved mail
 * account and a saved Soverin, what this deployment serves, and the create,
 * the count and the start of one migration. The caller adds them to FIXTURES
 * and takes them out after, so no other case sees them. Anna's own domain
 * comes along, so her Soverin account signs in on it: a login on another
 * domain would have *Your new address* ask about her address (workplan 0168,
 * the owner's decision (b)), and these cases walk the six screens without it.
 */
function startFlowFixtures(): { NEW: string; added: Record<string, unknown> } {
  const NEW = 'a0000000-0000-4000-8000-0000000000d9';
  const at = new Date(Date.now() + 60_000).toISOString();
  const detail = {
    id: NEW,
    tenantId: TENANT,
    name: 'Anna — example.nl to Soverin',
    sourceType: 'imap',
    targetType: 'soverin',
    status: 'paused',
    mode: 'mirror',
    syncConfig: { domains: ['email'], schedule: '0 2 * * *' },
    sourceConfig: {},
    targetConfig: {},
    domainStatus: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const added: Record<string, unknown> = {
    'GET /api/connections': {
      connections: [
        { id: 'c0000000-0000-4000-8000-000000000001', role: 'source', kind: 'imap', displayName: 'Anna mail', status: 'connected', createdAt: at, usedByMigrations: 0, knownValues: { host: 'imap.example.nl', port: '993', username: 'anna@example.nl' } },
        { id: 'c0000000-0000-4000-8000-000000000002', role: 'target', kind: 'soverin', displayName: 'Anna Soverin', status: 'connected', createdAt: at, usedByMigrations: 0, knownValues: { username: 'anna@example.nl' } },
      ],
    },
    'GET /api/provider-accounts': {
      google: { domains: ['calendar', 'contact', 'task'], client: 'deployment' },
      microsoft: { domains: ['email', 'calendar', 'contact', 'file', 'task'] },
    },
    'GET /api/provider-clients': { google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' },
    'POST /api/migrations': detail,
    [`POST /api/people/${PERSON}/migrations`]: (FIXTURES['GET /api/people'] as { people: unknown[] }).people[0],
    [`POST /api/migrations/${NEW}/discover`]: {},
    [`GET /api/migrations/${NEW}`]: detail,
    [`GET /api/migrations/${NEW}/discovery`]: {
      mappingId: NEW,
      discovered: true,
      domains: [{ domain: 'email', collections: 12, items: 18734, bytes: 3_400_000_000, discoveredAt: at }],
    },
    'GET /api/scope-manifest': {
      version: 'ui-smoke',
      migrates: [{ item: 'Email', detail: 'Folders, flags and timestamps.' }],
      partial: [],
      doesNotMigrate: [],
    },
    [`POST /api/migrations/${NEW}/start`]: { id: NEW, status: 'active' },
    // The data ceiling (0109 T6): Free with 248 GB moved, so this mailbox's
    // 3.4 GB passes it, and Start says so, and still starts.
    'GET /api/billing/ceiling': {
      tier: { id: 'free', name: 'Free', paths: 1, monthly: 0 },
      ceilingGb: 250,
      topUps: 0,
      gbMoved: 248,
      gbMovedInTheAlpha: 0,
      share: 0.992,
      state: 'near',
      holds: true,
      moveUp: { tierId: 'small', name: 'Small', paths: 4, monthlyEur: 5, ceilingGb: 750 },
      topUp: null,
      breakEven: null,
    },
    // The paths at Start (0109 T6, the path axis): this one migration fits
    // Free's one at the same time, so nothing is asked and Start is as it was.
    'GET /api/billing/paths': {
      holds: true,
      tier: { id: 'free', name: 'Free', paths: 1, monthlyEur: 0 },
      held: 0,
      after: 1,
      past: false,
      needs: null,
      reason: null,
      fits: [NEW],
    },
    // Free space at the destination (0171 T9): Soverin says 20 GB free for
    // the 3.4 GB counted, so the line says it fits and Start stays *Start*.
    [`GET /api/migrations/${NEW}/destination-space`]: {
      pools: [
        {
          pool: 'imap.soverin.net',
          destination: 'imap.soverin.net',
          dataTypes: ['email'],
          needBytes: 3_400_000_000,
          capacity: { known: true, freeBytes: 20_000_000_000, totalBytes: 25_000_000_000, pool: 'imap.soverin.net' },
        },
      ],
    },
  };
  return { NEW, added };
}

describe('the landing page (0153 T3 (b), the owner\'s D7)', () => {
  it('signs a member in to Migrations, with the menu the drawing shows', async () => {
    // Through the front door, as `open` does, but without its second goto:
    // where the sign-in itself lands is the thing under test.
    const page = await newPage();
    await page.addInitScript(() => window.localStorage.setItem('openmig.locale', 'en'));
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.fill('#token', TOKEN);
    await page.click('form button[type=submit]');
    await page.waitForURL((u) => u.pathname === '/mappings', { timeout: 15_000 });
    await page.waitForSelector('[data-migration]');

    const links = await page.$$eval('nav a', (as) => as.map((a) => (a.textContent ?? '').trim()));
    expect(links.slice(0, 5)).toEqual(['Migrations', 'Needs you', 'Accounts', 'Help', 'Team']);
    expect(links, 'the Dashboard went (D7)').not.toContain('Dashboard');
    await page.close();
  });

  it('counts beside Needs you what waits, in the menu (0153 T3 (c))', async () => {
    const saved = FIXTURES['GET /api/attention'] as { mappings: Record<string, unknown>[] };
    FIXTURES['GET /api/attention'] = {
      mappings: [{ ...saved.mappings[0], failuresWaiting: 2, pendingDecisions: 1 }],
    };
    try {
      const l = await open('/mappings');
      await l.page.waitForSelector('#nav-needs-you-count');
      expect(await l.page.textContent('#nav-needs-you-count')).toContain('3 waiting on you');
      const described = await l.page.getAttribute('nav a[href="/decisions"]', 'aria-describedby');
      expect(described, 'the count is not the link\'s description').toBe('nav-needs-you-count');
      expectClean(l, 'the menu with a count');
      await l.page.close();
    } finally {
      FIXTURES['GET /api/attention'] = saved;
    }
  });

  it("opens a person's page from their card, with their steps before they switch (0153 T5)", async () => {
    // Their one migration ran, and waits for them to connect again.
    const waits = `GET /api/people/${PERSON}/awaiting-grant`;
    const saved = FIXTURES[waits];
    FIXTURES[waits] = { migrations: [{ mappingId: MAPPING, then: 'ran_before' }] };
    // A grant waits only on a Google source (the API's `isGrantableSourceKind`),
    // so here Anna's mail reads Gmail, as it must for the page to say so.
    const listKey = 'GET /api/migrations';
    const savedList = FIXTURES[listKey];
    FIXTURES[listKey] = {
      mappings: [{ ...(savedList as { mappings: Record<string, unknown>[] }).mappings[0], sourceType: 'gmail' }],
    };
    try {
      const l = await open('/mappings');
      await l.page.getByRole('link', { name: 'Anna', exact: true }).click();
      await l.page.waitForURL(`**/people/${PERSON}`, { timeout: 10_000 });
      await l.page.getByRole('heading', { name: 'Before you switch' }).waitFor({ timeout: 10_000 });
      expect(await l.page.getByRole('heading', { level: 1, name: 'Anna' }).count()).toBe(1);
      expect(await l.page.locator('[data-step]').count()).toBe(7);
      // Their one grant link (0153 T5 (b)), offered because their mail reads
      // Google, and their progress link: none made yet, read from its own door.
      await l.page.getByRole('heading', { name: 'For Anna' }).waitFor({ timeout: 10_000 });
      await l.page.getByText('No link yet for this person.').waitFor({ timeout: 10_000 });
      await l.page.getByText('No progress link yet for this person.').waitFor({ timeout: 10_000 });
      expect(apiHits).toContain(`/api/people/${PERSON}/links`);
      // What their grant does, beside the migration it waits on.
      await l.page.getByText('Waits for Anna to connect again.').waitFor({ timeout: 10_000 });
      expect(await l.page.locator(`[data-migration="${MAPPING}"] [data-awaiting-grant="ran_before"]`).count()).toBe(1);
      expect(apiHits).toContain(`/api/people/${PERSON}/awaiting-grant`);
      expectClean(l, "a person's page");
      await l.page.close();
    } finally {
      FIXTURES[waits] = saved;
      FIXTURES[listKey] = savedList;
    }
  });

  it('starts a migration for Anna from their card, through six screens and one Start, to their page (0153 T4)', async () => {
    const { NEW, added } = startFlowFixtures();
    Object.assign(FIXTURES, added);
    const missesBefore = apiMisses.length;
    try {
      const l = await open('/mappings');
      const next = () => l.page.getByRole('button', { name: 'Next' }).click();
      await l.page.getByRole('link', { name: 'Add a migration' }).click();
      await l.page.waitForURL(`**/start?person=${PERSON}`, { timeout: 10_000 });
      expect(await l.page.getByRole('radio', { name: 'Anna' }).isChecked()).toBe(true);
      await next();
      await l.page.getByRole('checkbox', { name: 'Another mail provider' }).check();
      await next();
      await l.page.getByRole('heading', { level: 2, name: 'What moves?' }).waitFor({ timeout: 10_000 });
      await next();
      // The one saved account is the default: nothing to type.
      await l.page.getByText('Connected as anna@example.nl').waitFor({ timeout: 10_000 });
      await next();
      await l.page.getByRole('heading', { level: 2, name: 'Where does it go?' }).waitFor({ timeout: 10_000 });
      // Leaving this screen sets the migrations up, and its button says so.
      await l.page.getByRole('button', { name: 'Set up' }).click();
      await l.page.getByRole('heading', { level: 2, name: 'Check, then start' }).waitFor({ timeout: 15_000 });
      // Past the ceiling, the step says so with the price of moving up, and
      // never blocks: Start opens all the same.
      await l.page.getByText(/pass your data ceiling of 250 GB/).waitFor({ timeout: 15_000 });
      await l.page.getByText('Move up to Small: €5 a month.', { exact: false }).waitFor();
      const start = l.page.getByRole('button', { name: 'Start', exact: true });
      await expect.poll(() => start.isEnabled(), { timeout: 15_000 }).toBe(true);
      await start.click();
      await l.page.waitForURL(`**/people/${PERSON}`, { timeout: 15_000 });
      expect(apiHits).toContain(`/api/migrations/${NEW}/start`);
      expect(apiHits).toContain('/api/billing/paths');
      expect(apiMisses.slice(missesBefore), 'the flow called endpoints with no fixture').toEqual([]);
      expectClean(l, 'Start a migration');
      await l.page.close();
    } finally {
      for (const key of Object.keys(added)) delete FIXTURES[key];
    }
  });

  it('lets Anna connect her own iCloud and her own Soverin account, with a link: nothing asks the owner for her passwords (0174 T6)', async () => {
    const { NEW, added } = startFlowFixtures();
    const ICLOUD = 'c0000000-0000-4000-8000-0000000000a1';
    const THEIR_SOVERIN = 'c0000000-0000-4000-8000-0000000000a2';
    Object.assign(FIXTURES, added, {
      // Nothing saved yet: both accounts are made here, for Anna.
      'GET /api/connections': { connections: [] },
      'POST /api/connections': new FromBody((sent) =>
        (sent as { role: string }).role === 'source' ? { id: ICLOUD, forPerson: true } : { id: THEIR_SOVERIN, forPerson: true },
      ),
    });
    const missesBefore = apiMisses.length;
    const bodiesBefore = apiBodies.length;
    const hitsBefore = apiHits.length;
    // Closed whatever happens: the last screen polls the person's links, and
    // a page left open would ask for them during the tests after this one.
    let l: Loaded | undefined;
    try {
      l = await open(`/start?person=${PERSON}`);
      const page = l.page;
      const next = () => page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('radio', { name: 'They do, with a link' }).check();
      await next();
      await page.getByRole('checkbox', { name: /^Apple/ }).check();
      await next();
      await page.getByRole('heading', { level: 2, name: 'What moves?' }).waitFor({ timeout: 10_000 });
      // Mail only, so one destination row.
      const apple = page.getByRole('group', { name: 'From Apple iCloud' });
      for (const type of ['Calendars', 'Contacts', 'Tasks']) {
        const box = apple.getByRole('checkbox', { name: new RegExp(`^${type}`) });
        if ((await box.count()) > 0 && (await box.isChecked())) await box.uncheck();
      }
      await next();
      await page.getByRole('heading', { level: 2, name: 'Connect your accounts' }).waitFor({ timeout: 10_000 });

      // Her iCloud: the account, and no box for a password.
      const icloud = page.locator('[data-for-person="apple"]');
      await icloud.getByText('Anna types the password themselves, on the page your link opens. It never reaches you.').waitFor();
      expect(await icloud.locator('input[type="password"]').count()).toBe(0);
      await icloud.getByRole('textbox').first().fill('anna@icloud.invalid');
      await icloud.getByRole('button', { name: 'Save for Anna' }).click();
      await page.getByText('By link: anna@icloud.invalid').waitFor({ timeout: 10_000 });
      await next();

      // Her own Soverin account: whose is it? Hers, saved with its servers and no password.
      await page.getByRole('heading', { level: 2, name: 'Where does it go?' }).waitFor({ timeout: 10_000 });
      await page.getByRole('combobox', { name: 'Where email goes' }).selectOption('new:soverin');
      const soverin = page.locator('section', { has: page.getByRole('heading', { level: 3, name: 'Add Soverin' }) });
      await soverin.getByRole('radio', { name: 'Anna’s own: they connect it with the link' }).check();
      expect(await soverin.locator('input[type="password"]').count()).toBe(0);
      const theirs = soverin.locator('[data-for-person="soverin"]');
      for (const box of await theirs.getByRole('textbox').all()) {
        if ((await box.inputValue()) === '') await box.fill('anna@soverin.invalid');
      }
      await theirs.getByRole('button', { name: 'Save for Anna' }).click();
      await page.getByText('Anna connects it themselves, with a link you make on the last screen.').waitFor({ timeout: 10_000 });

      await page.getByRole('button', { name: 'Set up' }).click();
      // Her new account's address is on another domain than her old one, so
      // the address step asks first (0168 §6.2): kept as it is.
      await page.getByRole('heading', { level: 2, name: 'Your new address' }).waitFor({ timeout: 15_000 });
      await page.getByRole('radio', { name: 'No, keep it as it is' }).check();
      await next();
      await page.getByRole('heading', { level: 2, name: 'Check, then start' }).waitFor({ timeout: 15_000 });
      await page.getByText(/^The link asks Anna for 2 accounts: /).waitFor({ timeout: 10_000 });
      // Nothing of hers is counted until she has connected, so Start waits.
      expect(await page.getByRole('button', { name: 'Start', exact: true }).isEnabled()).toBe(false);

      // What the screens posted: both saved for Anna, neither with a password.
      const saved = apiBodies.slice(bodiesBefore).filter((b) => b.key === 'POST /api/connections');
      expect(saved.map((b) => (b.body as { role: string; type: string; forPerson: string }))).toEqual([
        expect.objectContaining({ role: 'source', type: 'apple', forPerson: PERSON }),
        expect.objectContaining({ role: 'target', type: 'soverin', forPerson: PERSON }),
      ]);
      for (const b of saved) {
        expect(Object.keys((b.body as { values: Record<string, string> }).values)).not.toContain('password');
      }
      // The migration is set up and added to her; nothing of hers is counted yet.
      const hits = apiHits.slice(hitsBefore);
      expect(hits).toContain('/api/migrations');
      expect(hits).toContain(`/api/people/${PERSON}/migrations`);
      expect(hits).not.toContain(`/api/migrations/${NEW}/start`);
      expect(apiMisses.slice(missesBefore), 'the flow called endpoints with no fixture').toEqual([]);
      expectClean(l, 'They do, with a link, with an iCloud source and a Soverin destination');
    } finally {
      await l?.page.close();
      for (const key of [...Object.keys(added), 'POST /api/connections']) delete FIXTURES[key];
    }
  });

  it('sends an old /dashboard link to Migrations, so a bookmark still lands', async () => {
    const l = await open('/dashboard');
    await l.page.waitForURL((u) => u.pathname === '/mappings', { timeout: 10_000 });
    await l.page.waitForSelector('[data-migration]');
    expectClean(l, 'an old /dashboard link');
    await l.page.close();
  });

  it("sends the retired wizard's address to Start a migration, for the person it named (0153 D5)", async () => {
    // What the flow reads as it opens, as the walk above serves it.
    const added: Record<string, unknown> = {
      'GET /api/connections': { connections: [] },
      'GET /api/provider-accounts': {
        google: { domains: ['calendar', 'contact', 'task'], client: 'deployment' },
        microsoft: { domains: ['email', 'calendar', 'contact', 'file', 'task'] },
      },
      'GET /api/provider-clients': { google: 'deployment', dropbox: 'deployment', microsoft: 'deployment' },
    };
    Object.assign(FIXTURES, added);
    try {
      const l = await open(`/mappings/new?person=${PERSON}`);
      await l.page.waitForURL(`**/start?person=${PERSON}`, { timeout: 10_000 });
      await l.page.getByRole('heading', { level: 2, name: 'Who is it for?' }).waitFor({ timeout: 10_000 });
      expectClean(l, "the wizard's old address");
      await l.page.close();
    } finally {
      for (const key of Object.keys(added)) delete FIXTURES[key];
    }
  });
});

describe('the build stamp', () => {
  it('shows the version the server reports, in a real browser', async () => {
    // The one thing the unit tests structurally cannot check: that the element
    // is mounted, the fetch resolves against a server, and the result reaches
    // the DOM. describeBuild() is pure and covered; this is the wiring.
    const l = await open('/mappings');
    const version = (
      JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string }
    ).version;

    // Rendered by an effect after the fetch settles, so wait for the text
    // rather than reading whatever the first paint happened to contain.
    await l.page.waitForFunction(
      (v: string) => document.body.innerText.includes(`v${v}`),
      version,
      { timeout: 10_000 },
    );

    expect(await l.text()).toContain(`v${version}`);
    // The bundle and the fixture agree here, so it must say it ONCE — the
    // `UI … · API …` form is reserved for a genuine mismatch, and showing it
    // always would train the reader to stop looking at it.
    expect(await l.text(), 'the stamp claimed a mismatch where there is none').not.toContain('UI v');
    expectClean(l, 'the build stamp');
    await l.page.close();
  });
});

describe('Report a problem (workplan 0130)', () => {
  it('opens the form from the link beside Sign out, carrying the page it came from', async () => {
    const l = await open('/mappings');
    await l.page.getByRole('link', { name: 'Report a problem' }).click(); // nav.reportProblem
    await l.page.waitForURL((u) => u.pathname === '/report', { timeout: 10_000 });

    expect(new URL(l.page.url()).searchParams.get('from')).toBe('/mappings');
    // Said before anything is sent: where it goes, and, in the fold, every
    // line that goes with it, the page first.
    await l.page
      .locator('text=Goes to the Ownpace support team, by email to support@example.invalid.') // report.goesTo.mail
      .waitFor({ timeout: 10_000 });
    await l.page.locator('summary', { hasText: 'What we send with this' }).click(); // report.facts
    await l.page.locator('li', { hasText: 'Page: /mappings' }).waitFor({ state: 'visible', timeout: 10_000 });
    expectClean(l, 'the report form');
    await l.page.close();
  });
});

describe('bilingual rendering', () => {
  it('renders Dutch for a Dutch browser, from the same bundle', async () => {
    const en = await open('/login', { signedIn: false, locale: 'en' });
    const enText = await en.text();
    await en.page.close();

    const nl = await open('/login', { signedIn: false, locale: 'nl' });
    const nlText = await nl.text();
    expectClean(nl, '/login (nl)');
    // The document says which language it is in, or a screen reader reads the
    // Dutch with an English voice (WCAG 3.1.1). Asked before the page closes.
    expect(await nl.page.getAttribute('html', 'lang')).toBe('nl');
    await nl.page.close();

    expect(nlText).toContain('Aanmelden bij Ownpace'); // login.title, nl
    expect(nlText).not.toBe(enText);
  });
});

describe("the home page's app screen (0152 T3)", () => {
  // The site's home page shows a person's page of this app, photographed by
  // `scripts/shoot-the-app-screen.mjs`, which recorded the words in it. The
  // owner, 2026-10-05: the screen "will have to move along with changes in
  // text in the future". This opens the same page with the same answers at the
  // same moment, and fails while its words are not the pictures' words: a
  // string changed in the app is a picture to take again, in the same pull
  // request.
  const screen = JSON.parse(readFileSync(join(REPO, 'site/app-screen/screen.json'), 'utf8')) as {
    moment: string;
    words: Record<AppScreenLocale, string>;
  };

  it('was photographed at the moment its answers hold', () => {
    expect(screen.moment).toBe(APP_SCREEN_NOW.toISOString());
  });

  for (const locale of ['en', 'nl'] as const) {
    it(`says, in ${locale === 'en' ? 'English' : 'Dutch'}, the words its pictures show`, async () => {
      const answers = appScreenAnswers(locale);
      const saved = Object.fromEntries(Object.keys(answers).map((k) => [k, FIXTURES[k]]));
      Object.assign(FIXTURES, answers);
      try {
        const l = await open(`/people/${APP_SCREEN_PERSON}`, { locale, clock: APP_SCREEN_NOW });
        await l.page.waitForSelector(APP_SCREEN_READY, { timeout: 15_000 });
        expect(
          await appScreenText(l.page),
          'The person\'s page no longer says what the home page\'s pictures of it show. Take them again ' +
            'with `node scripts/shoot-the-app-screen.mjs`, look at them, and commit site/app-screen/.',
        ).toBe(screen.words[locale]);
        // The picture starts above the name, below the way back to Migrations,
        // and needs room between the two to do so.
        const gap = await l.page.evaluate(() => {
          const head = document.querySelector('[data-app-screen="head"]')!;
          return head.getBoundingClientRect().top - head.previousElementSibling!.getBoundingClientRect().bottom;
        });
        expect(gap, 'the way back to Migrations sits on the person\'s name').toBeGreaterThanOrEqual(16);
        expectClean(l, `the app screen (${locale})`);
        await l.page.close();
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete FIXTURES[k];
          else FIXTURES[k] = v;
        }
      }
    });
  }
});

describe("a sign-in's example (the owner, 2026-09-29)", () => {
  // The owner: stick with "Username" / "Gebruikersnaam" and fill in "a grey
  // example hint of the formatting/syntax that goes away when clicked, like
  // 'someone@example.com'". Whether a placeholder shows is the browser's to
  // decide, so it is asked of one: its colour before and after focus.
  it('shows someone@example.com in grey, and takes it away when the box is clicked', async () => {
    const flowReads: Record<string, unknown> = {
      'GET /api/connections': { connections: [] },
      'GET /api/provider-accounts': { google: { domains: ['calendar', 'contact', 'task'], client: 'deployment' } },
      'GET /api/provider-clients': { google: 'deployment' },
    };
    Object.assign(FIXTURES, flowReads);
    try {
      // On Start a migration's Connect, where an account is added since the
      // wizard retired (0153 D5): Google's calendar, through the account.
      const l = await open('/start');
      const next = () => l.page.getByRole('button', { name: 'Next' }).click();
      await l.page.getByLabel('Name').fill('Anna');
      await next();
      await l.page.getByRole('checkbox', { name: /^Google/ }).check();
      await next();
      await l.page.getByRole('heading', { level: 2, name: 'What moves?' }).waitFor({ timeout: 10_000 });
      for (const type of ['Email', 'Contacts', 'Files', 'Tasks']) {
        await l.page.getByRole('checkbox', { name: new RegExp(`^${type}`) }).uncheck();
      }
      await next();
      await l.page.getByRole('heading', { level: 2, name: 'Connect your accounts' }).waitFor({ timeout: 10_000 });
      const box = l.page.getByRole('textbox', { name: /^Username/ });
      expect(await box.getAttribute('placeholder')).toBe('someone@example.com');

      const exampleColour = () => box.evaluate((el) => getComputedStyle(el, '::placeholder').color);
      const before = await exampleColour();
      expect(before, 'the example is drawn before the box is clicked').not.toBe('rgba(0, 0, 0, 0)');
      await box.click();
      expect(await exampleColour(), 'the example goes once the box is clicked').toBe('rgba(0, 0, 0, 0)');
      await box.blur();
      expect(await exampleColour(), 'and comes back when it is left empty').toBe(before);
      expectClean(l, "Start a migration's Google sign-in");
      await l.page.close();
    } finally {
      for (const key of Object.keys(flowReads)) delete FIXTURES[key];
    }
  });
});

/**
 * THE PERSON THE GATE HAD NEVER SIGNED IN AS.
 *
 * A platform operator belongs to no organisation by design (0093 T6/T7). Every
 * fixture in this file says `operator: false` with one membership, so the suite
 * has only ever walked an ordinary owner's product — and the operator's shipped
 * with six nav entries that each answered
 *
 *     403 { message: 'No active membership for this tenant' }
 *
 * which `api.ts` reads as a dead session and signs them out. Reported from the
 * OTA instance on 2026-08-31: "I see the full menu, and if I click on any menu
 * items, I switch back to login." Unit tests cover both halves now; this is the
 * one that walks it in a real browser, which is where the report came from.
 */
describe('signed in as a platform operator', () => {
  const ME = FIXTURES['GET /api/me'];

  /** Swap the whole deployment's answer for an operator's, and give it back. */
  function asOperator(): () => void {
    FIXTURES['GET /api/me'] = {
      userId: 'op-smoke',
      email: 'operator@demo.openmigrate.test',
      role: 'member',
      // The two facts that make this person an operator and not a customer.
      tenants: [],
      operator: true,
      invitations: [],
    };
    // Every screen they CAN open needs an answer, or `apiMisses` catches it in
    // the sweep below and the failure reads as a missing fixture rather than as
    // what it is.
    FIXTURES['GET /api/access-requests'] = { requests: [] };
    FIXTURES['GET /api/support/tenants'] = { tenants: [] };
    return () => {
      FIXTURES['GET /api/me'] = ME;
    };
  }

  /** The nav's links, by their visible text. */
  async function navLinks(l: Loaded): Promise<string[]> {
    return l.page.$$eval('nav a', (as) => as.map((a) => (a.textContent ?? '').trim()));
  }

  it('is offered only the screens it can open', async () => {
    const restore = asOperator();
    try {
      const l = await open('/access-requests');
      const links = await navLinks(l);

      // Theirs: the queue they came for, the support surface, and the guides —
      // which call no API at all.
      for (const kept of ['Access requests', 'Support', 'Setup guides']) {
        expect(links, `the nav no longer offers ${kept}`).toContain(kept);
      }
      // And not one of the six that would refuse them. Exact strings: "Setup
      // checklist" and "Setup guides" differ by one word, and a substring
      // match cannot tell them apart. The member's words since 0153 T3 (c).
      for (const hidden of [
        'Migrations',
        'Needs you',
        'Accounts',
        'Help',
        'Setup checklist',
        'Team',
      ]) {
        expect(
          links,
          `the nav offers ${hidden} to somebody with no organisation. Its first\n` +
            'request answers 403 "No active membership for this tenant", which\n' +
            'api.ts reads as a dead session — so the entry is not merely a dead\n' +
            'end, it signs the operator out.',
        ).not.toContain(hidden);
      }
      expectClean(l, 'the access queue as an operator');
      await l.page.close();
    } finally {
      restore();
    }
  });

  it('keeps its session when a typed URL reaches a screen that is not its own', async () => {
    // The nav no longer offers those screens, so reaching one now takes a typed
    // URL — and the session must survive it. This is the half that cannot be
    // proved from the nav: the refusal has to actually happen, and the browser
    // has to still be signed in afterwards.
    const restore = asOperator();
    failures.set('GET /api/migrations', {
      status: 403,
      body: { error: 'Forbidden', message: 'No active membership for this tenant' },
    });
    try {
      const l = await open('/mappings');
      // Give the interceptor every chance to redirect before asserting it did
      // not: `onUnauthorized` sets `location.href` synchronously on the
      // response, so if it fires at all it fires within this settle.
      await l.page.waitForTimeout(1000);
      expect(
        new URL(l.page.url()).pathname,
        'a platform operator was signed out by opening a tenant-scoped screen.\n\n' +
          'They belong to no organisation BY DESIGN, so that 403 is what every\n' +
          'such route answers them — it means "that screen is not yours", never\n' +
          '"your session died".',
      ).not.toContain('/login');
      await l.page.close();
    } finally {
      failures.delete('GET /api/migrations');
      restore();
    }
  });
});

/**
 * THE TEXTS, BROUGHT UP BY A DOOR'S REFUSAL (workplan 0139 T3), in a real
 * browser.
 *
 * While the deployment asks (`OWNPACE_STAGE=alpha` on the API, and no text
 * still a draft), every door that stores somebody's access answers 409
 * `conditions_not_accepted` until they accept the texts. The bundle under test
 * is built as CI and the OTA stack build it, without `VITE_OWNPACE_STAGE`, so
 * it asks nothing on load and waits for nothing (review of 2026-09-29): its
 * pages render as before. What it does do is follow the API: the app's own
 * client reports the refusal, and the acceptance screen comes up at once. The
 * bundle built for the Alpha also asks on load; the web guard holds that
 * (`an-acceptance-before-the-first-connection.unit.test.tsx`).
 *
 * The migrations list's own read stands in for a door here, answering the
 * refusal: the client keys on the answer, not the method, and it is the one
 * request every page of this suite already makes. Once the texts are
 * accepted the screen gives way to the page it was in front of.
 */
describe('signed in by somebody who has not accepted the texts yet', () => {
  const ME = FIXTURES['GET /api/me'];
  const VERSIONS = { alpha: '1.0', privacy: '1.5', terms: '1.5' } as const;
  const documents = (accepted: boolean) =>
    (['alpha', 'privacy', 'terms'] as const).map((document) => ({
      document,
      version: VERSIONS[document],
      accepted,
    }));
  const REFUSAL = 'Please accept the Alpha conditions, privacy policy and terms.';

  it('meets the texts at a refusal, linked in their language, and the page after accepting', async () => {
    FIXTURES['GET /api/me'] = { ...(ME as object), acceptance: { due: true, documents: documents(false) } };
    FIXTURES['POST /api/me/acceptance'] = { written: 3, acceptance: { due: false, documents: documents(true) } };
    failures.set('GET /api/migrations', {
      status: 409,
      body: {
        error: 'conditions_not_accepted',
        message: REFUSAL,
        messageNl: REFUSAL,
        reason: REFUSAL,
        reasonNl: REFUSAL,
        documents: documents(false).map(({ document, version }) => ({ document, version })),
      },
    });
    try {
      const l = await open('/mappings');
      await l.page.getByRole('heading', { level: 1, name: 'Before you start' }).waitFor({ timeout: 15_000 });

      const links = await l.page.$$eval('ul[aria-label="The texts to accept"] a', (as) =>
        as.map((a) => (a as HTMLAnchorElement).href),
      );
      expect(links).toEqual([
        'https://www.ownpace.eu/alpha.html',
        'https://www.ownpace.eu/privacy.html',
        'https://www.ownpace.eu/terms.html',
      ]);
      expect(await l.page.getByRole('main').count(), 'the screen is not the page\'s main landmark').toBe(1);
      expect(await l.page.getByRole('link', { name: 'Migrations' }).count(), 'the page shows beside the screen').toBe(
        0,
      );

      failures.delete('GET /api/migrations');
      await l.page.getByRole('button', { name: 'Accept all three' }).click();
      await l.page.getByRole('heading', { level: 1, name: 'Before you start' }).waitFor({
        state: 'detached',
        timeout: 15_000,
      });
      await l.page.getByRole('link', { name: 'Migrations' }).first().waitFor({ timeout: 15_000 });
      // The refusals themselves are the one thing the browser may log.
      expect(
        l.errors.filter((e) => !/status of 409/.test(e)),
        'the acceptance screen raised errors in the browser',
      ).toEqual([]);
      await l.page.close();
    } finally {
      failures.delete('GET /api/migrations');
      FIXTURES['GET /api/me'] = ME;
      delete FIXTURES['POST /api/me/acceptance'];
    }
  });
});

/**
 * THE PAGES A STRANGER OPENS, WITH SOMETHING ON THEM (workplan 0141 T12 (b)).
 *
 * A family member's grant link and their progress link open the two pages of
 * this product whose reader has no account, and who is the least able to say
 * that one is broken. The unit tests draw them with their services mocked, and
 * the policy case below opens them only on a link no fixture knows, so the
 * shipped bundle had only ever drawn their refusal. Here each is opened signed
 * out, on a link the fixtures know, in English and in Dutch, and asked for
 * what its reader must see:
 *
 *  - a grant link: who asks, who asked, the account it reads and where it
 *    goes, the Google button, the line about a chat app's own browser, and the
 *    privacy policy and terms in the reader's language, and below them the
 *    accessibility statement (0145 T9 (b));
 *  - a progress link: where each data type is, and no control but its own
 *    withdrawal and *Report this link*: no field, and no link into the app.
 *    Its only links leave for the site: the privacy policy and the
 *    accessibility statement (the owner, 2026-11-23), under the page's
 *    `Referrer-Policy: no-referrer`, so the link's secret goes nowhere.
 *
 * Each also holds that the page raised nothing in the browser and broke no
 * policy (`open` turns a violation into a console error), and asked the API
 * for its own link, that link's /report and the build stamp only: a
 * stranger's page that called a signed-in route would meet a refusal it could
 * not explain. Then each is opened on a phone, in Dutch, whose words are the
 * longer, and must not scroll sideways (0145 T8 (a), for these two pages).
 *
 * They open the bundle CI and the OTA stack build, without the Alpha
 * (`VITE_OWNPACE_STAGE` unset). The Alpha's build adds `AlphaGoogleLine`, a
 * line and a link to the tester guide, above the Google button; its own unit
 * tests cover its words, and *the Alpha's build on a phone*, below, opens a
 * grant link in that build.
 *
 * They catch a page that does not render, a route that went, a word that left
 * the bundle and a page wider than a phone. They prove nothing about the API,
 * which is absent here; the journey against the real one is T12 (c).
 */
describe('the grant and progress links, opened by the person they were sent to (0141 T12 (b))', () => {
  type Locale = 'en' | 'nl';
  interface LinkPage {
    readonly what: string;
    readonly path: string;
    /** The API paths the page may ask for, the build stamp's apart. */
    readonly asks: readonly string[];
    /**
     * What its reader must find on it, in the words a reader sees (`innerText`:
     * not what CSS hides or a closed fold holds); the first is waited for, as
     * the page's answer.
     */
    readonly says: Readonly<Record<Locale, readonly string[]>>;
    /** Every button on it, in order, by its words. */
    readonly buttons: Readonly<Record<Locale, readonly string[]>>;
    /** Every link on it, as its words and where it goes. */
    readonly links: Readonly<Record<Locale, ReadonlyArray<readonly [string, string]>>>;
    /** Each data type's row, in order: the type, then words its row must say. */
    readonly rows: Readonly<Record<Locale, ReadonlyArray<readonly [string, ...string[]]>>>;
  }

  /** The policy and the terms, in the reader's language (`services/legal-links.ts`). */
  const LEGAL: Readonly<Record<Locale, ReadonlyArray<readonly [string, string]>>> = {
    en: [
      ['Privacy policy', 'https://www.ownpace.eu/privacy.html'], // acceptance.doc.privacy
      ['Terms of service', 'https://www.ownpace.eu/terms.html'], // acceptance.doc.terms
    ],
    nl: [
      ['Privacyverklaring', 'https://www.ownpace.eu/nl/privacy.html'],
      ['Servicevoorwaarden', 'https://www.ownpace.eu/nl/voorwaarden.html'],
    ],
  };
  /** The accessibility statement, at the foot of both pages (0145 T9 (b)). */
  const STATEMENT: Readonly<Record<Locale, readonly [string, string]>> = {
    en: ['Accessibility', 'https://www.ownpace.eu/accessibility.html'], // accessibility.link
    nl: ['Toegankelijkheid', 'https://www.ownpace.eu/nl/toegankelijkheid.html'],
  };
  /** A grant page: the texts a person accepts, then the statement on a line of its own. */
  const GRANT_LINKS: Readonly<Record<Locale, ReadonlyArray<readonly [string, string]>>> = {
    en: [...LEGAL.en, STATEMENT.en],
    nl: [...LEGAL.nl, STATEMENT.nl],
  };
  /** A progress page, on the managed service: the privacy policy, then the statement. */
  const PROGRESS_LINKS: Readonly<Record<Locale, ReadonlyArray<readonly [string, string]>>> = {
    en: [LEGAL.en[0]!, STATEMENT.en],
    nl: [LEGAL.nl[0]!, STATEMENT.nl],
  };
  /** The language switch both pages carry, as `Layout` does (0145 T6). */
  const SWITCH = ['EN', 'NL'] as const;
  /**
   * On a person's own pages, in full words: a target like any other, and a
   * Dutch voice reads a bare *EN* as the word *en* (workplan 0176 T9.7). A
   * migration's own progress page takes the person's sizes with it (§6).
   */
  const LONG_SWITCH = ['English', 'Nederlands'] as const;

  const PAGES: readonly LinkPage[] = [
    {
      what: "a migration's grant link",
      path: `/grant/${GRANT_LINK}`,
      asks: [`/api/grant/${GRANT_LINK}`, `/api/grant/${GRANT_LINK}/report`],
      says: {
        en: [
          'Acme Families is migrating your email, calendar and files to a new provider', // grant.asking
          'Connect your account', // grant.title
          'owner-a@demo.openmigrate.test', // who asked
          'anna@example.com', // from
          'anna@example.org', // to
          'Nextcloud at cloud.example.org', // grant.toWhere
          'You are about to give (read) access to your email — messages, folders and labels and your calendars and their events.', // grant.reads
          // Google does not hold the mail scope to reading, so the box says
          // that Ownpace only reads (0144 T3 (c)).
          'Ownpace only reads.', // grant.readsOnly
          'The permission Google will ask you for:', // grant.scopeIntro
          'Gmail: read, send and permanently delete all your email.', // grant.scope.mail
          'Sign in as anna@example.com.', // grant.signInAs
          "If this page opened inside another app, such as a chat or mail app, use that app's 'Open in browser' option", // grant.inAppBrowser
          'By continuing you accept how your data is handled:', // grant.disclosure
        ],
        nl: [
          'Acme Families migreert uw e-mail, agenda en bestanden naar een nieuwe aanbieder',
          'Verbind uw account',
          'owner-a@demo.openmigrate.test',
          'anna@example.com',
          'anna@example.org',
          'Nextcloud op cloud.example.org',
          'U staat op het punt (lees)toegang te geven tot uw e-mail: berichten, mappen en labels en uw agenda’s en de afspraken daarin.',
          'Ownpace leest alleen.',
          'De toestemming die Google u vraagt:',
          'Gmail: al uw e-mail lezen, verzenden en definitief verwijderen.',
          'Log in als anna@example.com.',
          "Is deze pagina geopend in een andere app, zoals een chat- of mailapp? Kies daar 'Openen in browser'",
          'Door door te gaan gaat u akkoord met hoe uw gegevens worden verwerkt:',
        ],
      },
      buttons: {
        en: [...SWITCH, 'Report this link', 'Continue with Google'], // linkReport.open, grant.connect
        nl: [...SWITCH, 'Deze link melden', 'Doorgaan met Google'],
      },
      links: GRANT_LINKS,
      rows: { en: [], nl: [] },
    },
    {
      what: "a migration's progress link",
      path: `/view/${VIEW_LINK}`,
      asks: [`/api/view/${VIEW_LINK}`, `/api/view/${VIEW_LINK}/report`],
      says: {
        en: [
          'Acme Families is migrating your email, calendar and files to a new provider.', // view.who, an old link's own
          'Your migration', // view.title, an old link's own
          'You do not have to do anything now. You may close this page.', // view.person.first.nothingToDo
          'Copying is in progress.', // view.state.active
          'The access you gave', // view.grant.title
          'This page refreshes by itself.', // view.refresh.at
          'This page only shows numbers; it holds nothing from your account.', // view.readOnly
        ],
        nl: [
          'Acme Families migreert uw e-mail, agenda en bestanden naar een nieuwe aanbieder.',
          'Uw migratie',
          'U hoeft nu niets te doen. U mag deze pagina sluiten.',
          'Het kopiëren is bezig.',
          'De toegang die u gaf',
          'Deze pagina ververst vanzelf.',
          'Deze pagina toont alleen aantallen; er staat niets uit uw account op.',
        ],
      },
      buttons: {
        en: [...LONG_SWITCH, 'Stop copying', 'Report this link'], // view.grant.withdraw
        nl: [...LONG_SWITCH, 'Kopiëren stoppen', 'Deze link melden'],
      },
      links: PROGRESS_LINKS,
      rows: {
        en: [
          ['email', 'Email', 'Being copied', '4,211 of ~5,000'], // domain.email, view.person.stage.copying
          ['calendar', 'Calendar', 'Copied, and kept up to date'], // view.person.stage.kept_in_step
        ],
        nl: [
          ['email', 'E-mail', 'Wordt gekopieerd', '4.211 van ~5.000'],
          ['calendar', 'Agenda', 'Gekopieerd, en wordt bijgehouden'],
        ],
      },
    },
    {
      what: "a person's progress link",
      path: `/view/${PERSON_VIEW_LINK}`,
      asks: [`/api/view/${PERSON_VIEW_LINK}`, `/api/view/${PERSON_VIEW_LINK}/report`],
      says: {
        en: [
          'Acme Families copies your email, calendar and files to a new provider. This page shows how far that is.', // view.person.who
          'How far is the copying?', // view.person.title
          'You do not have to do anything now. You may close this page.', // view.person.first.nothingToDo
          'Your Google account', // view.person.account.only
          'Google to Soverin', // view.person.route
          'Google to Nextcloud',
          'Nothing has been copied yet.', // view.notStarted
          'The access you gave',
          'Copying is in progress.', // view.state.active
          'This page refreshes by itself.', // view.refresh.at
          'This page only shows numbers; it holds nothing from your account.', // view.readOnly
        ],
        nl: [
          'Acme Families kopieert uw e-mail, agenda en bestanden naar een nieuwe aanbieder. Op deze pagina ziet u hoe ver dat is.',
          'Hoe ver is het kopiëren?',
          'U hoeft nu niets te doen. U mag deze pagina sluiten.',
          'Uw Google-account',
          'Google naar Soverin',
          'Google naar Nextcloud',
          'Er is nog niets gekopieerd.',
          'De toegang die u gaf',
          'Het kopiëren is bezig.',
          'Deze pagina ververst vanzelf.',
          'Deze pagina toont alleen aantallen; er staat niets uit uw account op.',
        ],
      },
      buttons: {
        en: [...LONG_SWITCH, 'Stop copying', 'Report this link'],
        nl: [...LONG_SWITCH, 'Kopiëren stoppen', 'Deze link melden'],
      },
      links: PROGRESS_LINKS,
      rows: {
        en: [['email', 'Email', 'Being copied', '4,211 of ~5,000']],
        nl: [['email', 'E-mail', 'Wordt gekopieerd', '4.211 van ~5.000']],
      },
    },
  ];

  /** Open a link signed out, as its reader does, and wait for the page's answer. */
  async function openLink(p: LinkPage, locale: Locale, phone = false): Promise<Loaded> {
    const l = await open(p.path, { signedIn: false, locale, phone });
    await l.page.getByText(p.says[locale][0]!).first().waitFor({ timeout: 15_000 });
    return l;
  }

  for (const p of PAGES) {
    for (const locale of ['en', 'nl'] as const) {
      it(`opens ${p.what} in ${locale === 'en' ? 'English' : 'Dutch'}, with what its reader must see`, async () => {
        const before = apiHits.length;
        const missesBefore = apiMisses.length;
        const l = await openLink(p, locale);

        expect(new URL(l.page.url()).pathname, `${p.what} sent its reader away`).toBe(p.path);
        expect(await l.page.getAttribute('html', 'lang')).toBe(locale);
        const text = await l.page.innerText('body');
        for (const words of p.says[locale]) expect(text, `${p.what} does not say it`).toContain(words);

        const buttons = await l.page.$$eval('button', (bs) => bs.map((b) => (b.textContent ?? '').trim()));
        expect(buttons, `the controls on ${p.what}`).toEqual(p.buttons[locale]);
        expect(await l.page.locator('input, textarea, select').count(), `a field on ${p.what}`).toBe(0);
        const links = await l.page.$$eval('a[href]', (as) =>
          as.map((a) => [(a.textContent ?? '').trim(), (a as HTMLAnchorElement).href]),
        );
        expect(links, `the links on ${p.what}`).toEqual(p.links[locale]);
        const rows = await l.page.$$eval('[data-domain]', (rs) =>
          rs.map((r) => [(r as HTMLElement).dataset.domain ?? '', r.textContent ?? ''] as const),
        );
        expect(rows.map(([domain]) => domain), `the data types on ${p.what}`).toEqual(
          p.rows[locale].map(([domain]) => domain),
        );
        p.rows[locale].forEach(([domain, ...words], i) => {
          for (const w of words) expect(rows[i]![1], `the ${domain} row on ${p.what}`).toContain(w);
        });

        const asked = [...new Set(apiHits.slice(before))].filter((path) => path !== '/api/version').sort();
        expect(asked, `what ${p.what} asked the API for`).toEqual([...p.asks].sort());
        expect(apiMisses.slice(missesBefore), `${p.what} called endpoints with no fixture`).toEqual([]);
        expectClean(l, `${p.what} (${locale})`);
        await l.page.close();
      });
    }
  }

  for (const p of PAGES) {
    it(`opens ${p.what} on a phone, in Dutch, without scrolling sideways (0145 T8 (a))`, async () => {
      const l = await openLink(p, 'nl', true);
      await expectItFitsAPhone(l.page, p.what);
      expectClean(l, `${p.what} on a phone`);
      await l.page.close();
    });
  }
});

/**
 * A PERSON'S LINK, ONE THING AT A TIME (workplan 0176 T1, §5, §16): walked as
 * its reader walks it, from the first screen to the provider's button, in both
 * languages, on a phone of 390 pixels and on one of 320, which is what 200%
 * zoom lays out on a window of 640. Each screen has one `h1`, says which step
 * it is in words, carries the controls it should and no others, and fits; and
 * the whole walk asks the API for the link, its report and the build stamp,
 * and nothing else: a step is a place in the page, not a request.
 */
type WalkLocale = 'en' | 'nl';
interface WalkScreen {
  readonly h1: Readonly<Record<WalkLocale, string>>;
  readonly step: Readonly<Record<WalkLocale, string>>;
  /** What its reader must find on it, in the words a reader sees. */
  readonly says: Readonly<Record<WalkLocale, readonly string[]>>;
  /** Every button on it, in order, by its words. */
  readonly buttons: Readonly<Record<WalkLocale, readonly string[]>>;
  /** The button that leads on, pressed once the screen is read; none on the last. */
  readonly next?: Readonly<Record<WalkLocale, string>>;
}

const ASKED_BY = 'owner-a@demo.openmigrate.test';
const PERSON_LINK_WALK: readonly WalkScreen[] = [
  {
    h1: { en: `${ASKED_BY} asks for your permission`, nl: `${ASKED_BY} vraagt uw toestemming` }, // grant.person.title
    step: { en: 'Step 1 of 5', nl: 'Stap 1 van 5' }, // grant.step
    says: {
      en: [
        'This page is from Ownpace, the service that makes the copy.', // grant.person.ownpace
        'Sender', // grant.person.sender
        // An English list takes the serial comma, as every list the app joins (`formatList`, 0145 T6).
        `${ASKED_BY} wants to copy your email, calendar, and files. The next screen shows from where and to where.`, // grant.person.whatMany
        'Everything also stays in Google.', // grant.person.fact.stays
        'Ownpace only reads there. It deletes nothing and changes nothing.', // grant.person.fact.reads
        'There is no hurry. You can do this until', // grant.person.fact.noHurry
        `Did ${ASKED_BY} tell you about this link themselves?`, // grant.person.told
      ],
      nl: [
        'Deze pagina is van Ownpace, de dienst die de kopie maakt.',
        'Afzender',
        `${ASKED_BY} wil uw e-mail, agenda en bestanden kopiëren. Op het volgende scherm staat waarvandaan en waarnaartoe.`,
        'Alles blijft ook in Google staan.',
        'Ownpace leest daar alleen. Het verwijdert niets en wijzigt niets.',
        'Er is geen haast. Dit kan tot',
        `Heeft ${ASKED_BY} u zelf over deze link verteld?`,
      ],
    },
    buttons: {
      en: ['English', 'Nederlands', 'Yes, that is right', 'No, not yet', 'Report this link'],
      nl: ['English', 'Nederlands', 'Ja, dat klopt', 'Nee, nog niet', 'Deze link melden'],
    },
    next: { en: 'Yes, that is right', nl: 'Ja, dat klopt' },
  },
  {
    h1: { en: 'Your accounts', nl: 'Uw accounts' }, // grant.person.accounts.title
    step: { en: 'Step 2 of 5', nl: 'Stap 2 van 5' },
    says: {
      en: [
        'The accounts your data is copied from', // grant.group.from
        'To anna@soverin.example, Soverin: your email — messages, folders and labels.', // grant.person.migration
        'To anna@example.org, Nextcloud at cloud.example.org: your calendars and their events.',
        'Waiting', // grant.state.waiting
      ],
      nl: [
        'De accounts waaruit uw gegevens worden gekopieerd',
        'Naar anna@soverin.example, Soverin: uw e-mail: berichten, mappen en labels.',
        'Naar anna@example.org, Nextcloud op cloud.example.org: uw agenda’s en de afspraken daarin.',
        'Nog niet verbonden',
      ],
    },
    buttons: {
      en: ['English', 'Nederlands', 'Connect anna@example.com', 'Connect anna.files@example.com', 'Back', 'Report this link'],
      nl: ['English', 'Nederlands', 'anna@example.com verbinden', 'anna.files@example.com verbinden', 'Terug', 'Deze link melden'],
    },
    next: { en: 'Connect anna@example.com', nl: 'anna@example.com verbinden' },
  },
  {
    h1: { en: 'Have this ready', nl: 'Leg dit klaar' }, // grant.person.ready.title
    step: { en: 'Step 3 of 5', nl: 'Stap 3 van 5' },
    says: {
      en: [
        'The address anna@example.com.', // grant.person.ready.address
        'The password of your Google account.', // grant.person.ready.password
        `You type it only on Google’s own page. Ownpace never sees it. ${ASKED_BY} does not either.`, // grant.person.ready.typeIt
        'Your phone. Google may send a code to it.', // grant.person.ready.phone
        `Give that code to nobody. Not to ${ASKED_BY} either.`, // grant.person.ready.code
        `Do you not know the password? Then stop here, and do this together with ${ASKED_BY}.`, // grant.person.ready.unknownPassword
        "If this page opened inside another app, such as a chat or mail app, use that app's 'Open in browser' option", // grant.inAppBrowser
      ],
      nl: [
        'Het adres anna@example.com.',
        'Het wachtwoord van uw Google-account.',
        `U typt het alleen op de pagina van Google zelf. Ownpace ziet het nooit. ${ASKED_BY} ook niet.`,
        'Uw telefoon. Google kan daar een code naartoe sturen.',
        `Geef die code aan niemand. Ook niet aan ${ASKED_BY}.`,
        `Weet u het wachtwoord niet? Stop dan hier, en doe dit samen met ${ASKED_BY}.`,
        "Is deze pagina geopend in een andere app, zoals een chat- of mailapp? Kies daar 'Openen in browser'",
      ],
    },
    buttons: {
      en: ['English', 'Nederlands', 'Next', 'Back', 'Report this link'],
      nl: ['English', 'Nederlands', 'Verder', 'Terug', 'Deze link melden'],
    },
    next: { en: 'Next', nl: 'Verder' },
  },
  {
    h1: { en: 'What you will see at Google', nl: 'Dit ziet u straks bij Google' }, // grant.person.see.title
    step: { en: 'Step 4 of 5', nl: 'Stap 4 van 5' },
    says: {
      en: [
        'To anna@soverin.example, Soverin: your email — messages, folders and labels.',
        'Google asks you to sign in.', // grant.person.see.signIn
        'Sign in as anna@example.com.', // grant.signInAs
        'Gmail: read, send and permanently delete all your email.', // grant.scope.mail
        'Google’s words are broader than what Ownpace does. Ownpace only reads. It sends nothing and deletes nothing.', // grant.person.see.broader
        'Make sure everything Ownpace asks for is ticked.', // grant.person.see.ticks
        'You can stop this at any time, on the page you get afterwards.', // grant.person.see.stop
        'This link works until', // grant.until
        'By continuing you accept how your data is handled:', // grant.disclosure
        'The next step is on Google’s own page.', // grant.person.see.next
      ],
      nl: [
        'Naar anna@soverin.example, Soverin: uw e-mail: berichten, mappen en labels.',
        'Google vraagt u in te loggen.',
        'Log in als anna@example.com.',
        'Gmail: al uw e-mail lezen, verzenden en definitief verwijderen.',
        'Google beschrijft het ruimer dan wat Ownpace doet. Ownpace leest alleen. Het verzendt niets en verwijdert niets.',
        'Zorg dat alles wat Ownpace vraagt een vinkje heeft.',
        'U kunt dit altijd weer stoppen, op de pagina die u hierna krijgt.',
        'Deze link werkt tot',
        'Door door te gaan gaat u akkoord met hoe uw gegevens worden verwerkt:',
        'De volgende stap doet u op de pagina van Google zelf.',
      ],
    },
    buttons: {
      en: ['English', 'Nederlands', 'Sign in with Google', 'No, rather not', 'Back', 'Report this link'],
      nl: ['English', 'Nederlands', 'Inloggen met Google', 'Nee, liever niet', 'Terug', 'Deze link melden'],
    },
  },
];

describe("a person's link, walked one thing at a time (0176 T1)", () => {
  for (const locale of ['en', 'nl'] as const) {
    for (const narrow of [false, true]) {
      const width = narrow ? 320 : 390;
      it(`walks it in ${locale === 'en' ? 'English' : 'Dutch'} at ${width} pixels, from the first screen to Google's button`, async () => {
        const before = apiHits.length;
        const missesBefore = apiMisses.length;
        const l = await open(`/grant/${PERSON_GRANT_LINK}`, { signedIn: false, locale, phone: !narrow, narrow });
        for (const screen of PERSON_LINK_WALK) {
          const what = `${screen.h1.en} (${locale}, ${width})`;
          await l.page.getByRole('heading', { level: 1, name: screen.h1[locale] }).waitFor({ timeout: 15_000 });
          expect(await l.page.locator('h1').count(), `the h1s on ${what}`).toBe(1);
          expect(await l.page.title(), `the tab on ${what}`).toBe(`${screen.h1[locale]} — Ownpace`);
          const text = await l.page.innerText('body');
          expect(text, `${what} does not say its step`).toContain(screen.step[locale]);
          for (const words of screen.says[locale]) expect(text, `${what} does not say it`).toContain(words);
          const buttons = await l.page.$$eval('button', (bs) => bs.map((b) => (b.textContent ?? '').trim()));
          expect(buttons, `the controls on ${what}`).toEqual(screen.buttons[locale]);
          await expectItFitsAPhone(l.page, what, width);
          if (screen.next) await l.page.getByRole('button', { name: screen.next[locale], exact: true }).click();
        }
        expect(new URL(l.page.url()).pathname, 'the walk left the page').toBe(`/grant/${PERSON_GRANT_LINK}`);
        const asked = [...new Set(apiHits.slice(before))].filter((path) => path !== '/api/version').sort();
        expect(asked, 'what the walk asked the API for').toEqual(
          [`/api/grant/${PERSON_GRANT_LINK}`, `/api/grant/${PERSON_GRANT_LINK}/report`].sort(),
        );
        expect(apiMisses.slice(missesBefore), 'the walk called endpoints with no fixture').toEqual([]);
        expectClean(l, `a person's link walked in ${locale} at ${width}`);
        await l.page.close();
      });
    }
  }

  it("goes one step back with the browser's Back, and No, not yet asks nothing of the API", async () => {
    const l = await open(`/grant/${PERSON_GRANT_LINK}`, { signedIn: false, locale: 'en', phone: true });
    await l.page.getByRole('heading', { level: 1, name: PERSON_LINK_WALK[0]!.h1.en }).waitFor({ timeout: 15_000 });
    const before = apiHits.length;
    await l.page.getByRole('button', { name: 'No, not yet', exact: true }).click();
    await l.page.getByRole('heading', { level: 1, name: 'Then wait a moment' }).waitFor({ timeout: 10_000 });
    expect(apiHits.slice(before), 'what No, not yet asked for').toEqual([]);
    await l.page.goBack();
    await l.page.getByRole('heading', { level: 1, name: PERSON_LINK_WALK[0]!.h1.en }).waitFor({ timeout: 10_000 });
    await l.page.getByRole('button', { name: 'Yes, that is right', exact: true }).click();
    await l.page.getByRole('heading', { level: 1, name: 'Your accounts' }).waitFor({ timeout: 10_000 });
    await l.page.goBack();
    await l.page.getByRole('heading', { level: 1, name: PERSON_LINK_WALK[0]!.h1.en }).waitFor({ timeout: 10_000 });
    expect(new URL(l.page.url()).pathname).toBe(`/grant/${PERSON_GRANT_LINK}`);
    expectClean(l, "a person's link, back and not yet");
    await l.page.close();
  });
});

/**
 * NOTHING SMALL ON A PERSON'S PAGES (workplan 0176 T9, §13), asked of the
 * browser rather than read off a class name: a class can say `text-sm` and
 * draw 18 pixels, or the other way round.
 *
 * - no visible text under 16 pixels, and a sentence at 18;
 * - a sentence at 7 to 1 or better against what it sits on, other text at 4.5;
 * - every target that stands alone at least 44 by 44, a link inside a sentence
 *   apart (criterion 2.5.8 exempts it); a main button at least 60 pixels high
 *   and as wide as the column; two answers to one question of one size;
 * - an outlined control's edge, and a filled one's fill, at 3 to 1 or better
 *   (criterion 1.4.11);
 * - the focus drawn as an outline of 2 pixels at least.
 *
 * Every fold is opened first, so what it holds is measured too.
 */
async function smallThings(page: Page): Promise<string[]> {
  await page.evaluate(() =>
    document.querySelectorAll('details').forEach((d) => {
      d.open = true;
    }),
  );
  // A keyboard's focus, so the focus is drawn as a reader with a keyboard sees it.
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const problems: string[] = [];
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    /** Any colour the browser computed, as sRGB and alpha: a canvas reads oklch() too. */
    const rgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'rgba(0, 0, 0, 0)';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const luminance = ([r, g, b]: readonly number[]): number => {
      const [lr = 0, lg = 0, lb = 0] = [r ?? 0, g ?? 0, b ?? 0].map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const ratio = (a: readonly number[], b: readonly number[]): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    /** What an element sits on: the first background behind it that is drawn. */
    const behind = (el: Element | null): readonly number[] => {
      for (let e = el; e; e = e.parentElement) {
        const c = rgba(getComputedStyle(e).backgroundColor);
        if (c[3] > 0.5) return c;
      }
      return [255, 255, 255, 1];
    };
    const shown = (el: Element): boolean => {
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };
    const named = (el: Element): string =>
      ((el.textContent ?? '').trim() || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').slice(0, 50);

    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('svg, script, style, [aria-hidden="true"]')) continue;
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (own === '' || !shown(el)) continue;
      const s = getComputedStyle(el);
      const size = parseFloat(s.fontSize);
      const sentence = /[.?!:]$/.test(own);
      const label = own.replace(/\s+/g, ' ').slice(0, 50);
      if (size < 16) problems.push(`${size}px text: ${label}`);
      else if (sentence && size < 18) problems.push(`a ${size}px sentence: ${label}`);
      const contrast = ratio(rgba(s.color), behind(el));
      if (contrast < (sentence ? 7 : 4.5)) problems.push(`${contrast.toFixed(2)} to 1: ${label}`);
    }

    for (const el of document.querySelectorAll('button, a[href], summary, input:not([type="hidden"]), select, textarea')) {
      if (!shown(el)) continue;
      if (el.tagName === 'A') {
        // A link inside a sentence is exempt; one beside only other links and dots stands alone.
        const block = el.closest('p, li, dd');
        const around = block
          ? [...block.childNodes]
              .filter((n) => n !== el && !(n instanceof Element && (n.tagName === 'A' || n.querySelector('a'))))
              .map((n) => n.textContent ?? '')
              .join('')
              .replace(/[\s·]/g, '')
          : '';
        if (around !== '') continue;
      }
      const box = el.getBoundingClientRect();
      if (box.width < 44 || box.height < 44) problems.push(`a ${Math.round(box.width)} by ${Math.round(box.height)} target: ${named(el)}`);
      if (el.matches('[data-main]')) {
        const main = el.closest('main');
        const m = main ? getComputedStyle(main) : null;
        const column = main && m ? main.clientWidth - parseFloat(m.paddingLeft) - parseFloat(m.paddingRight) : 0;
        if (box.height < 60) problems.push(`a main button ${Math.round(box.height)} pixels high: ${named(el)}`);
        if (box.width < column - 1) problems.push(`a main button ${Math.round(box.width)} of ${Math.round(column)} pixels wide: ${named(el)}`);
      }
      const s = getComputedStyle(el);
      const fill = rgba(s.backgroundColor);
      const under = behind(el.parentElement);
      if (fill[3] > 0.5 && ratio(fill, under) >= 1.1) {
        if (ratio(fill, under) < 3) problems.push(`a fill at ${ratio(fill, under).toFixed(2)} to 1: ${named(el)}`);
      } else if (parseFloat(s.borderTopWidth) >= 1) {
        const edge = rgba(s.borderTopColor);
        if (edge[3] > 0.5 && ratio(edge, under) < 3) problems.push(`an edge at ${ratio(edge, under).toFixed(2)} to 1: ${named(el)}`);
      }
    }

    for (const group of document.querySelectorAll('[data-answers]')) {
      const boxes = [...group.querySelectorAll('button')].filter(shown).map((b) => b.getBoundingClientRect());
      const first = boxes[0];
      if (first && boxes.some((b) => Math.abs(b.width - first.width) > 0.5 || Math.abs(b.height - first.height) > 0.5)) {
        problems.push(`two answers of different sizes: ${named(group)}`);
      }
    }

    const focused = document.activeElement;
    if (focused && focused !== document.body) {
      const s = getComputedStyle(focused);
      if (s.outlineStyle === 'none' || parseFloat(s.outlineWidth) < 2) problems.push(`no focus outline on ${named(focused)}`);
    }
    return problems;
  });
}

describe("nothing small on a person's pages (0176 T9)", () => {
  for (const narrow of [false, true]) {
    const width = narrow ? 320 : 390;

    it(`a person's link page, at each step, in Dutch at ${width} pixels`, async () => {
      const l = await open(`/grant/${PERSON_GRANT_LINK}`, { signedIn: false, locale: 'nl', phone: !narrow, narrow });
      await l.page.locator('h1').first().waitFor({ timeout: 15_000 });
      await l.page.waitForLoadState('networkidle');
      for (const [i, screen] of PERSON_LINK_WALK.entries()) {
        if (i > 0) {
          await l.page.getByRole('button', { name: PERSON_LINK_WALK[i - 1]!.next!.nl, exact: true }).click();
          await l.page.getByRole('heading', { level: 1, name: screen.h1.nl }).waitFor({ timeout: 10_000 });
        }
        expect(await smallThings(l.page), `small or pale on ${screen.h1.en} at ${width}`).toEqual([]);
      }
      expectClean(l, `a person's link page measured at ${width}`);
      await l.page.close();
    });

    it(`a person's progress page, and its stop's own screen, in Dutch at ${width} pixels`, async () => {
      const l = await open(`/view/${PERSON_VIEW_LINK}`, { signedIn: false, locale: 'nl', phone: !narrow, narrow });
      await l.page.locator('h1').first().waitFor({ timeout: 15_000 });
      await l.page.waitForLoadState('networkidle');
      expect(await smallThings(l.page), `small or pale on the progress page at ${width}`).toEqual([]);
      await l.page.getByRole('button', { name: 'Kopiëren stoppen', exact: true }).click();
      await l.page.getByRole('heading', { level: 1, name: 'Kopiëren uit uw Google-account stoppen?' }).waitFor({ timeout: 10_000 });
      expect(await smallThings(l.page), `small or pale on the stop's screen at ${width}`).toEqual([]);
      await expectItFitsAPhone(l.page, `the stop's screen at ${width}`, width);
      expectClean(l, `a person's progress page measured at ${width}`);
      await l.page.close();
    });
  }
});

/**
 * THE OWN-PASSWORD CARD, UNDER THE POLICY (workplan 0174 §5.3, §7.3, T4).
 *
 * The page's policy has `form-action 'none'`. The card's form must never be
 * submitted by the browser, which would be refused and, worse, would put the
 * boxes into a URL: the password goes by `fetch`, as a JSON body of a `PUT`.
 * This presses the button in a real Chromium under that policy and asks the
 * browser what it did: one request, of type `fetch`, `PUT`, JSON, with the
 * password in its body and in no URL; the page's address the same after as
 * before; no policy violation; and the card connected.
 */
describe('a person types their own password on their grant link (0174 T4)', () => {
  for (const how of ['the button', 'Enter'] as const) {
    it(`sends it by fetch, in a body, with nothing in the URL after a submit, by ${how}`, async () => {
      const path = `/grant/${PASSWORD_GRANT_LINK}`;
      const l = await open(path, { signedIn: false, locale: 'en' });
      // The first screen asks whether the sender told them; one account, so
      // *Have this ready* follows, with the card (workplan 0176 §5.4).
      await l.page.getByRole('button', { name: 'Yes, that is right', exact: true }).click();
      await l.page.getByText('Your password is checked with').waitFor({ timeout: 15_000 });
      const before = l.page.url();
      const sent: Array<{ url: string; method: string; type: string; contentType: string; body: string }> = [];
      l.page.on('request', (r) => {
        if (new URL(r.url()).pathname.startsWith('/api/') && r.method() !== 'GET') {
          sent.push({
            url: r.url(),
            method: r.method(),
            type: r.resourceType(),
            contentType: r.headers()['content-type'] ?? '',
            body: r.postData() ?? '',
          });
        }
      });
      const navigations: string[] = [];
      l.page.on('framenavigated', (f) => {
        if (f === l.page.mainFrame()) navigations.push(f.url());
      });

      const box = l.page.getByLabel('Password', { exact: true });
      await box.fill(TYPED_IN_THE_BOX);
      if (how === 'the button') await l.page.getByRole('button', { name: 'Check and connect' }).click();
      else await box.press('Enter');
      await l.page.getByText('Connected. Your password works and is stored encrypted.').waitFor({ timeout: 15_000 });

      expect(sent, 'what the card sent').toHaveLength(1);
      const [put] = sent;
      expect(put!.type, 'sent by fetch').toBe('fetch');
      expect(put!.method).toBe('PUT');
      expect(new URL(put!.url).pathname).toBe(`/api/grant/${PASSWORD_GRANT_LINK}/password`);
      expect(new URL(put!.url).search).toBe('');
      expect(put!.url).not.toContain(TYPED_IN_THE_BOX);
      expect(put!.contentType).toContain('application/json');
      expect(JSON.parse(put!.body)).toEqual({
        ref: 'a0000000000000000000000000000174',
        values: { password: TYPED_IN_THE_BOX },
        locale: 'en',
      });
      // Nothing in the URL after the submit: the same address, no navigation.
      expect(l.page.url()).toBe(before);
      expect(new URL(l.page.url()).search).toBe('');
      expect(l.page.url()).not.toContain(TYPED_IN_THE_BOX);
      expect(navigations, 'the page navigated on submit').toEqual([]);
      // And nothing left in the box.
      expect(await l.page.locator('input').count()).toBe(0);
      expectClean(l, `the own-password card, sent by ${how}`);
      await l.page.close();
    });
  }

  it('fits a phone, in Dutch, with the server line before the box', async () => {
    const l = await open(`/grant/${PASSWORD_GRANT_LINK}`, { signedIn: false, locale: 'nl', phone: true });
    await l.page.getByRole('button', { name: 'Ja, dat klopt', exact: true }).click();
    await l.page.getByText('Uw wachtwoord wordt gecontroleerd bij').waitFor({ timeout: 15_000 });
    expect(await l.page.locator('[data-server-line] strong').innerText()).toBe('example.com');
    expect(await l.page.locator('[data-no-phone]').count()).toBe(1);
    await expectItFitsAPhone(l.page, 'the own-password card');
    expectClean(l, 'the own-password card on a phone');
    await l.page.close();
  });
});

describe("the app's own pages on a phone, in Dutch (0145 T8 (a))", () => {
  it('the sign-in page fits a phone', async () => {
    const l = await open('/login', { signedIn: false, locale: 'nl', phone: true });
    await l.page.waitForSelector('#token');
    await expectItFitsAPhone(l.page, 'the sign-in page');
    expectClean(l, 'the sign-in page on a phone');
    await l.page.close();
  });

  it('the request-access page fits a phone', async () => {
    const l = await open('/request-access?locale=nl', { signedIn: false, locale: 'nl', phone: true });
    await l.page.locator('form').first().waitFor({ timeout: 15_000 });
    await expectItFitsAPhone(l.page, 'the request-access page');
    expectClean(l, 'the request-access page on a phone');
    await l.page.close();
  });

  it('Migrations fits a phone, and its menu takes focus and gives it back on Escape (0145 T1)', async () => {
    const l = await open('/mappings', { locale: 'nl', phone: true });
    await l.page.waitForSelector('[data-migration]');
    await expectItFitsAPhone(l.page, 'Migrations');

    const menu = l.page.getByRole('button', { name: 'Menu', exact: true });
    expect(await menu.getAttribute('aria-expanded'), 'the menu starts closed').toBe('false');
    await menu.click();
    // Focus lands on the drawer's own close button, so a keyboard and a
    // screen reader start inside the menu they opened, not on the page behind.
    await expect
      .poll(() => l.page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null), { timeout: 5_000 })
      .toBe('Sluiten');
    expect(await menu.getAttribute('aria-expanded')).toBe('true');
    await expectItFitsAPhone(l.page, 'Migrations with its menu open');

    await l.page.keyboard.press('Escape');
    await expect
      .poll(() => l.page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null), { timeout: 5_000 })
      .toBe('Menu');
    expect(await menu.getAttribute('aria-expanded'), 'Escape closed the menu').toBe('false');
    expectClean(l, 'Migrations on a phone');
    await l.page.close();
  });

  it('Start a migration fits a phone on every screen, and each next screen starts at the top (0145 T3 (a))', async () => {
    const { added } = startFlowFixtures();
    Object.assign(FIXTURES, added);
    const missesBefore = apiMisses.length;
    try {
      const l = await open(`/start?person=${PERSON}`, { locale: 'nl', phone: true });
      const page = l.page;
      // The press that moves on is made from the bottom of the screen, where
      // the button is: the next screen must not open where this one ended.
      // These fixtures' screens fit in the phone's height, and a page that
      // fits cannot be scrolled, so it would read 0 whether or not the app
      // moved it. Room is made below the app, outside its root, as a longer
      // screen or a larger text size would make it, so the press is made from
      // further down and the next screen's position is the app's doing.
      const onToTheNext = async (name: string, what: string): Promise<void> => {
        await page.evaluate(() => {
          if (!document.getElementById('room-below')) {
            const room = document.createElement('div');
            room.id = 'room-below';
            room.style.height = '2000px';
            document.body.appendChild(room);
          }
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
        expect(await page.evaluate(() => window.scrollY), `${what}: pressed from below the top`).toBeGreaterThan(0);
        await page.getByRole('button', { name, exact: true }).click();
        await page.waitForTimeout(50);
        await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000, message: `${what} opened below its top` }).toBe(0);
        // And a screen reader starts on the new screen's heading, not on the
        // button that is gone.
        await expect
          .poll(() => page.evaluate(() => document.activeElement?.tagName ?? null), { timeout: 5_000, message: `focus after the press, on ${what}` })
          .toBe('H2');
      };
      await page.getByRole('radio', { name: 'Anna' }).waitFor({ timeout: 15_000 });
      await expectItFitsAPhone(page, 'Start a migration, who');
      await onToTheNext('Volgende', 'the screen after who');
      await page.getByRole('checkbox', { name: 'Een andere mailaanbieder' }).waitFor({ timeout: 10_000 });
      await expectItFitsAPhone(page, 'Start a migration, from where');
      await page.getByRole('checkbox', { name: 'Een andere mailaanbieder' }).check();
      await onToTheNext('Volgende', 'the screen after from where');
      await page.getByRole('heading', { level: 2, name: 'Wat wilt u migreren?' }).waitFor({ timeout: 10_000 });
      await expectItFitsAPhone(page, 'Start a migration, what moves');
      await onToTheNext('Volgende', 'the screen after what moves');
      await page.getByText('anna@example.nl').first().waitFor({ timeout: 10_000 });
      await expectItFitsAPhone(page, 'Start a migration, the account');
      await onToTheNext('Volgende', 'the screen after the account');
      await page.getByRole('heading', { level: 2, name: 'Waar gaat het naartoe?' }).waitFor({ timeout: 10_000 });
      await expectItFitsAPhone(page, 'Start a migration, where it goes');
      await onToTheNext('Klaarzetten', 'the screen after where it goes');
      await page.getByRole('heading', { level: 2, name: 'Controleren, dan starten' }).waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Starten', exact: true }).waitFor({ timeout: 15_000 });
      await expectItFitsAPhone(page, 'Start a migration, check, then start');
      expect(apiMisses.slice(missesBefore), 'the flow called endpoints with no fixture').toEqual([]);
      expectClean(l, 'Start a migration on a phone');
      await page.close();
    } finally {
      for (const key of Object.keys(added)) delete FIXTURES[key];
    }
  });
});

/**
 * YOUR NEW ADDRESS, ON A PHONE, IN DUTCH (workplan 0168 T7, §6.2). The same
 * flow, from a mailbox at an address nobody can take along: after
 * *Klaarzetten* the step *Uw nieuwe adres* asks before the check, fits the
 * phone, and the check says one line for the Yes. Nothing is written before
 * Start, so there is no fixture for a write: one made on Next would be a call
 * with no fixture, and fail this.
 */
describe('Start a migration, from an address nobody can take along, on a phone (0168 T7)', () => {
  it('asks for the new address between where it goes and the check, and the check says it', async () => {
    const { added } = startFlowFixtures();
    const at = new Date(Date.now() + 60_000).toISOString();
    added['GET /api/connections'] = {
      connections: [
        { id: 'c0000000-0000-4000-8000-000000000001', role: 'source', kind: 'imap', displayName: 'Old mail', status: 'connected', createdAt: at, usedByMigrations: 0, knownValues: { host: 'imap.gmail.com', port: '993', username: 'name@gmail.com' } },
        { id: 'c0000000-0000-4000-8000-000000000002', role: 'target', kind: 'soverin', displayName: 'New mail', status: 'connected', createdAt: at, usedByMigrations: 0, knownValues: { username: 'first@example.org' } },
      ],
    };
    Object.assign(FIXTURES, added);
    const missesBefore = apiMisses.length;
    try {
      const l = await open(`/start?person=${PERSON}`, { locale: 'nl', phone: true });
      const page = l.page;
      const next = (name: string) => page.getByRole('button', { name, exact: true }).click();
      await page.getByRole('radio', { name: 'Anna' }).waitFor({ timeout: 15_000 });
      await next('Volgende');
      await page.getByRole('checkbox', { name: 'Een andere mailaanbieder' }).check({ timeout: 10_000 });
      await next('Volgende');
      await page.getByRole('heading', { level: 2, name: 'Wat wilt u migreren?' }).waitFor({ timeout: 10_000 });
      await next('Volgende');
      await page.getByText('name@gmail.com').first().waitFor({ timeout: 10_000 });
      await next('Volgende');
      await page.getByRole('heading', { level: 2, name: 'Waar gaat het naartoe?' }).waitFor({ timeout: 10_000 });
      await page.getByText('Stap 5 van 7').waitFor({ timeout: 10_000 });
      await next('Klaarzetten');
      await page.getByRole('heading', { level: 2, name: 'Uw nieuwe adres' }).waitFor({ timeout: 15_000 });
      await page.getByText('Dat adres blijft bij Google en kan dus niet mee.', { exact: false }).waitFor();
      await expectItFitsAPhone(page, 'Start a migration, your new address');
      await page.getByRole('radio', { name: 'Ja', exact: true }).check();
      // Others moving along: a row of two boxes, which must fit too.
      await page.getByRole('button', { name: 'Adreswijziging toevoegen', exact: true }).click();
      await expectItFitsAPhone(page, 'Start a migration, your new address, with somebody moving along');
      await page.getByRole('button', { name: 'Weghalen', exact: true }).click();
      await next('Volgende');
      await page.getByRole('heading', { level: 2, name: 'Controleren, dan starten' }).waitFor({ timeout: 15_000 });
      // Anna is not the one signed in, who confirms it for her (0168 D6).
      await page
        .getByText("name@gmail.com wordt first@example.org in contacten, agenda's, taken en deelrechten, bevestigd door u voor Anna")
        .waitFor({ timeout: 10_000 });
      await expectItFitsAPhone(page, 'Start a migration, check, with the new address');
      expect(apiMisses.slice(missesBefore), 'the flow called endpoints with no fixture').toEqual([]);
      expectClean(l, 'Start a migration with a new address on a phone');
      await page.close();
    } finally {
      for (const key of Object.keys(added)) delete FIXTURES[key];
    }
  });
});

/**
 * A NEW LOGIN ON ANOTHER DOMAIN, ON A PHONE, IN DUTCH (workplan 0168; the
 * owner, 2026-11-23, decision (b)). An address at an own domain, leaving for
 * an account that signs in on another: the step asks by itself, says the new
 * address is on another domain with the owner's hint, fits the phone, and a
 * No goes on to the check with nothing written.
 */
describe('Start a migration, from an own domain to a login on another domain, on a phone (0168)', () => {
  it('asks by itself, with the hint, and a No writes nothing', async () => {
    const { added } = startFlowFixtures();
    const at = new Date(Date.now() + 60_000).toISOString();
    added['GET /api/connections'] = {
      connections: [
        { id: 'c0000000-0000-4000-8000-000000000001', role: 'source', kind: 'imap', displayName: 'Old mail', status: 'connected', createdAt: at, usedByMigrations: 0, knownValues: { host: 'imap.example.nl', port: '993', username: 'name@example.nl' } },
        { id: 'c0000000-0000-4000-8000-000000000002', role: 'target', kind: 'soverin', displayName: 'New mail', status: 'connected', createdAt: at, usedByMigrations: 0, knownValues: { username: 'first@example.org' } },
      ],
    };
    Object.assign(FIXTURES, added);
    const missesBefore = apiMisses.length;
    try {
      const l = await open(`/start?person=${PERSON}`, { locale: 'nl', phone: true });
      const page = l.page;
      const next = (name: string) => page.getByRole('button', { name, exact: true }).click();
      await page.getByRole('radio', { name: 'Anna' }).waitFor({ timeout: 15_000 });
      await next('Volgende');
      await page.getByRole('checkbox', { name: 'Een andere mailaanbieder' }).check({ timeout: 10_000 });
      await next('Volgende');
      await page.getByRole('heading', { level: 2, name: 'Wat wilt u migreren?' }).waitFor({ timeout: 10_000 });
      await next('Volgende');
      await page.getByText('name@example.nl').first().waitFor({ timeout: 10_000 });
      await next('Volgende');
      await page.getByRole('heading', { level: 2, name: 'Waar gaat het naartoe?' }).waitFor({ timeout: 10_000 });
      expect(await page.getByRole('checkbox', { name: 'Ik krijg ook een ander e-mailadres' }).isChecked()).toBe(false);
      await page.getByText('Stap 5 van 7').waitFor({ timeout: 10_000 });
      await next('Klaarzetten');
      await page.getByRole('heading', { level: 2, name: 'Uw nieuwe adres' }).waitFor({ timeout: 15_000 });
      await page
        .getByText(
          'first@example.org staat op een ander domein dan name@example.nl. Kies Nee als first@example.org maar tijdelijk is, tot uw eigen domein meekomt.',
        )
        .waitFor({ timeout: 10_000 });
      expect(await page.getByRole('radio', { checked: true }).count(), 'no answer is chosen for the person').toBe(0);
      await expectItFitsAPhone(page, 'Start a migration, your new address, a login on another domain');
      await page.getByRole('radio', { name: 'Nee, laat het zoals het is', exact: true }).check();
      await next('Volgende');
      await page.getByRole('heading', { level: 2, name: 'Controleren, dan starten' }).waitFor({ timeout: 15_000 });
      expect(await page.getByText(/ wordt first@example\.org in contacten/).count()).toBe(0);
      expect(apiMisses.slice(missesBefore), 'the flow called endpoints with no fixture').toEqual([]);
      expectClean(l, 'Start a migration with a login on another domain on a phone');
      await page.close();
    } finally {
      for (const key of Object.keys(added)) delete FIXTURES[key];
    }
  });
});

/**
 * THE ALPHA'S BUILD ON A PHONE (workplan 0145 T8 (a), its last part). Live
 * serves the bundle built with `VITE_OWNPACE_STAGE=alpha`, and that build adds
 * what every tester sees first: the Alpha note above every signed-in page
 * (0131 T1), and `AlphaGoogleLine`, the line and the guide's link above the
 * Google cards of *Start a migration* and above a grant page's Google button
 * (0140 T2 (a)). The rest of this file opens the bundle CI and the OTA stack
 * build, which has neither. So this block builds the Alpha's too, into a
 * folder of its own, serves it the same way, and opens those three places on
 * a phone, in Dutch, whose words are the longer.
 */
describe("the Alpha's build on a phone, in Dutch (0145 T8 (a))", () => {
  let alphaDist: string;
  let alphaServer: Server;
  let ALPHA: string;

  beforeAll(async () => {
    alphaDist = mkdtempSync(join(tmpdir(), 'ownpace-web-alpha-'));
    const env: NodeJS.ProcessEnv = { ...process.env, VITE_OWNPACE_STAGE: 'alpha' };
    delete env.VITE_API_URL;
    // vite alone: the type check ran with the first build, and the two builds
    // differ only in this variable.
    execFileSync('pnpm', ['--filter', '@openmig/web', 'exec', 'vite', 'build', '--outDir', alphaDist, '--emptyOutDir'], {
      cwd: REPO,
      env,
      stdio: 'pipe',
    });
    expect(existsSync(join(alphaDist, 'index.html')), "the Alpha's build produced no index.html").toBe(true);
    ({ server: alphaServer, base: ALPHA } = await startServer(alphaDist));
  }, 300_000);

  afterAll(() => {
    alphaServer?.close();
    if (alphaDist) rmSync(alphaDist, { recursive: true, force: true });
  });

  it('Migrations fits a phone with the Alpha note above it', async () => {
    const l = await open('/mappings', { locale: 'nl', phone: true, base: ALPHA });
    await l.page.waitForSelector('[data-migration]');
    await l.page.getByText('Welkom bij de Alpha!').waitFor({ timeout: 10_000 });
    expect(await l.page.getByRole('link', { name: /Handleiding voor de Alpha/ }).count(), "the note's link to the guide").toBeGreaterThan(0);
    await expectItFitsAPhone(l.page, 'Migrations with the Alpha note');
    expectClean(l, "Migrations in the Alpha's build on a phone");
    await l.page.close();
  });

  it("Start a migration's accounts fit a phone with the Alpha's Google line above the Google card", async () => {
    const { added } = startFlowFixtures();
    Object.assign(FIXTURES, added);
    const missesBefore = apiMisses.length;
    try {
      const l = await open(`/start?person=${PERSON}`, { locale: 'nl', phone: true, base: ALPHA });
      const next = () => l.page.getByRole('button', { name: 'Volgende', exact: true }).click();
      await l.page.getByRole('radio', { name: 'Anna' }).waitFor({ timeout: 15_000 });
      await next();
      // A Google account to leave, so the screen that connects it asks for a
      // Google sign-in: the line stands above that card.
      await l.page.getByRole('checkbox', { name: 'Google' }).check();
      await next();
      await l.page.getByRole('heading', { level: 2, name: 'Wat wilt u migreren?' }).waitFor({ timeout: 10_000 });
      await next();
      await l.page.getByText('Koppelt u Google tijdens de Alpha? Lees eerst:').waitFor({ timeout: 10_000 });
      expect(await l.page.getByRole('link', { name: /Als u Google koppelt/ }).count(), "the line's link to the guide").toBe(1);
      await expectItFitsAPhone(l.page, "Start a migration's accounts with the Alpha's Google line");
      expect(apiMisses.slice(missesBefore), 'the flow called endpoints with no fixture').toEqual([]);
      expectClean(l, "Start a migration in the Alpha's build on a phone");
      await l.page.close();
    } finally {
      for (const key of Object.keys(added)) delete FIXTURES[key];
    }
  });

  // On a person's link the steps say it on the page, and the line to the
  // guide goes (workplan 0176 D9, D12 (a)); a migration's own link keeps it.
  it("a person's link tells Google's warning in a step of its own, in our own words, with no line to the guide", async () => {
    const l = await open(`/grant/${PERSON_GRANT_LINK}`, { signedIn: false, locale: 'nl', phone: true, base: ALPHA });
    for (const name of ['Ja, dat klopt', 'anna@example.com verbinden']) {
      await l.page.getByRole('button', { name, exact: true }).click();
    }
    await l.page.getByRole('heading', { level: 1, name: 'Leg dit klaar' }).waitFor({ timeout: 15_000 });
    expect(await l.page.innerText('body')).toContain(
      'Doe dit het liefst samen met owner-a@demo.openmigrate.test: aan de telefoon, of aan tafel.',
    );
    await l.page.getByRole('button', { name: 'Verder', exact: true }).click();
    await l.page.getByRole('heading', { level: 1, name: 'Dit ziet u straks bij Google' }).waitFor({ timeout: 10_000 });
    const text = await l.page.innerText('body');
    expect(text).toContain('Google heeft Ownpace nog niet gecontroleerd. Daarom waarschuwt Google, en dat is terecht.');
    expect(text).toContain('Ga daar verder naar Ownpace.');
    expect(text).toContain('Laat Google de verbinding niet toe?');
    expect(text).not.toMatch(/[«»“”]/);
    expect(await l.page.getByRole('link', { name: /Als u Google koppelt/ }).count(), 'a line to the guide').toBe(0);
    expect(await smallThings(l.page), "small or pale on the Alpha's Google step").toEqual([]);
    await expectItFitsAPhone(l.page, "a person's link's Google step in the Alpha's build");
    expectClean(l, "a person's link in the Alpha's build on a phone");
    await l.page.close();
  });

  it("a migration's grant link fits a phone with the Alpha's Google line above its button", async () => {
    const l = await open(`/grant/${GRANT_LINK}`, { signedIn: false, locale: 'nl', phone: true, base: ALPHA });
    await l.page.getByText('Koppelt u Google tijdens de Alpha? Lees eerst:').first().waitFor({ timeout: 15_000 });
    await expectItFitsAPhone(l.page, "a grant link with the Alpha's Google line");
    expectClean(l, "a grant link in the Alpha's build on a phone");
    await l.page.close();
  });
});

describe('the app runs under the policy nginx serves it with (workplan 0158)', () => {
  it('is served with the policy the template names', async () => {
    // The fixture server reads its headers from the template; this holds that
    // it found a policy there, so nothing below passes because none was sent.
    const res = await fetch(`${BASE}/grant/a-link`);
    const policy = res.headers.get('content-security-policy') ?? '';
    expect(policy).toMatch(/^default-src 'none'; script-src 'self';/);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it.each(['/login', '/request-access', '/grant/a-link', '/view/a-link', '/docs'])(
    'opens %s, a page a stranger can reach, with no violation',
    async (path) => {
      // The grant and view pages ask the API about a link no fixture knows,
      // and show their refusal: the browser logs that 404, so only the
      // policy is asked here, and that the page mounted. Opened on links the
      // fixtures know, with what they say, they are 0141 T12 (b)'s above.
      const page = await newPage();
      const own: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && m.text().startsWith('csp: ')) own.push(m.text());
      });
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30_000 });
      expect(await page.locator('#root > *').count(), `${path} never mounted`).toBeGreaterThan(0);
      expect(own, `${path} broke the policy`).toEqual([]);
      await page.close();
    },
  );

  it('broke it on no page this file opened', () => {
    expect(violations).toEqual([]);
  });
});
