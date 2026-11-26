// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DOOR PUBLIC IN ONE PLACE ONLY: every route the API registers either signs
 * a session in, or is public in the code and in `apps/api/docs/openapi.yaml`
 * alike, with its reason (workplan 0178 §5.1, G3; the owner's D2 of
 * 2026-11-26).
 *
 * WHY. There is no gate in front of every route: each router calls
 * `authenticate` (or `authenticateSubject`, the operator's) itself, in
 * `apps/api/src/routes`. A route that forgets it is open, and row security is
 * the backstop for tenant data only. `apps/api/src/openapi-spec.unit.test.ts`
 * holds the API description to the routes and makes sign-in the default, but
 * nothing tied an operation's `security: []` to whether its handler signs in.
 * The day this guard was written it found two that did not agree, each public
 * on purpose in the code and described as needing sign-in: the gift code's
 * door and the scope manifest. The description was wrong, so a client
 * generated from it would have sent a token nobody reads, and a test of the
 * running API (0178 §6, Schemathesis's `ignored_auth`) would have reported a
 * hole that is a decision.
 *
 * THE RULE. Each `router.<method>('<path>', …)` in a non-test file under
 * `apps/api/src/routes`, and each `app.<method>(…)` in `apps/api/src/index.ts`,
 * parsed (`scripts/sast-guard-source.ts`), signs in when a handler before the
 * last is `authenticate` or `authenticateSubject`. One that does not must be in
 * PUBLIC, by file, method and path, with the description's operations it
 * serves and its reason. Then:
 *   - every PUBLIC entry is a route that exists and does not sign in;
 *   - a PUBLIC entry that says a link is its credential has `linkAuth` before
 *     its handler;
 *   - every operation a PUBLIC entry names has `security: []`;
 *   - every operation with `security: []` is named by a PUBLIC entry.
 * Every Express route under `apps/api/src` is registered through a name
 * called `router` or `app`, or it would be read by nobody, and a case holds it.
 *
 * WHAT IT DOES NOT SEE. A router that signs in with `router.use(authenticate)`
 * reads as public, route by route, and fails until it is written per route as
 * every router is today. A handler that signs in itself, inside its body, is
 * public here. Which prefix a router is mounted on is
 * `openapi-spec.unit.test.ts`'s `MOUNTS`; PUBLIC names each operation by hand,
 * and the four checks above fail when the two drift.
 */

import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { doorsOf, isTestSource, readSource, trackedSources, type Door } from './sast-guard-source.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'apps/api/src';

interface Public {
  /** `<file under apps/api/src> <METHOD> <path as the file writes it>` */
  door: string;
  /** The description's operations this route serves: one per prefix it is mounted on. */
  operations: string[];
  /** `linkAuth` when the link in the path is the credential: it must be checked before the handler. */
  holds?: 'linkAuth';
  reason: string;
}

const LINK = 'The link in the path is the credential; linkAuth checks it before the handler.';
const PROBE = 'A probe: it says the process answers, and carries no tenant’s data.';
const CALLBACK = 'A provider sends the browser back here, with no session; the signed state names the migration (the OAuth callback page).';

/** Every route that signs no session in, and why. */
const PUBLIC: Public[] = [
  { door: 'index.ts GET /health', operations: ['GET /health'], reason: PROBE },
  { door: 'index.ts GET /api/health', operations: ['GET /api/health'], reason: PROBE },
  { door: 'index.ts GET /version', operations: ['GET /version'], reason: 'The build’s version, the same for everyone.' },
  { door: 'index.ts GET /api/version', operations: ['GET /api/version'], reason: 'The build’s version, the same for everyone.' },
  { door: 'index.ts GET /api/auth/mode', operations: ['GET /api/auth/mode'], reason: 'Which sign-in the login screen offers, asked before anyone has signed in.' },
  { door: 'index.ts GET /metrics', operations: ['GET /metrics'], reason: 'Counts and durations only, behind the ingress (index.ts says so above the route).' },
  { door: 'routes/ready.ts GET /', operations: ['GET /ready', 'GET /api/ready'], reason: PROBE },
  { door: 'routes/ready.ts GET /scheduler', operations: ['GET /ready/scheduler', 'GET /api/ready/scheduler'], reason: PROBE },
  {
    door: 'routes/access-requests.ts POST /',
    operations: ['POST /api/access-requests'],
    reason: 'The asker has no account yet. An INSERT-only grant under row security, capped fields, a refusing rate limit, one answer whatever happens (the file’s header).',
  },
  {
    door: 'routes/gifts.ts POST /redeem',
    operations: ['POST /api/gifts/redeem'],
    reason: 'A gift code’s door, for a person with no account yet, like an access request: its own refusing rate limit, the trap field, one refusal for every bad code.',
  },
  { door: 'routes/scope-manifest.ts GET /', operations: ['GET /api/scope-manifest'], reason: 'What the product carries: the same static rows for everyone, no tenant’s data.' },
  { door: 'routes/provider-accounts.ts GET /', operations: ['GET /api/provider-accounts'], reason: 'Which provider accounts the deployment offers, never their values (the file’s header).' },
  { door: 'routes/provider-clients.ts GET /', operations: ['GET /api/provider-clients'], reason: 'Which provider clients the deployment has, never their secrets.' },
  { door: 'routes/redirect-uris.ts GET /', operations: ['GET /api/redirect-uris'], reason: 'The addresses to register at a provider: the deployment’s own, the same for everyone.' },
  {
    door: 'routes/billing/webhooks.ts POST /mollie',
    operations: ['POST /api/billing/webhooks/mollie'],
    reason: 'The payment provider’s call. The body is untrusted: the payment is fetched from the provider by its id (the file’s header).',
  },
  { door: 'routes/billing/webhooks.ts GET /mollie/test', operations: ['GET /api/billing/webhooks/mollie/test'], reason: 'A test of the webhook’s address; it answers 404 in production.' },
  { door: 'routes/migrations/google-oauth-routes.ts GET /google/callback', operations: ['GET /api/migrations/google/callback'], reason: CALLBACK },
  { door: 'routes/migrations/dropbox-oauth-routes.ts GET /dropbox/callback', operations: ['GET /api/migrations/dropbox/callback'], reason: CALLBACK },
  { door: 'routes/migrations/microsoft-oauth-routes.ts GET /microsoft/callback', operations: ['GET /api/migrations/microsoft/callback'], reason: CALLBACK },
  { door: 'routes/migrations/cirrux-oauth-routes.ts GET /cirrux/callback', operations: ['GET /api/migrations/cirrux/callback'], reason: CALLBACK },
  { door: 'routes/grant.ts GET /:link', operations: ['GET /api/grant/{link}'], holds: 'linkAuth', reason: LINK },
  { door: 'routes/grant.ts POST /:link/:provider/authorize', operations: ['POST /api/grant/{link}/{provider}/authorize'], holds: 'linkAuth', reason: LINK },
  { door: 'routes/grant.ts PUT /:link/address-changes/:ref', operations: ['PUT /api/grant/{link}/address-changes/{ref}'], holds: 'linkAuth', reason: LINK },
  { door: 'routes/grant.ts PUT /:link/password', operations: ['PUT /api/grant/{link}/password'], holds: 'linkAuth', reason: `${LINK} A refusing rate limit comes first.` },
  { door: 'routes/view.ts GET /:link', operations: ['GET /api/view/{link}'], holds: 'linkAuth', reason: LINK },
  { door: 'routes/view.ts POST /:link/withdraw', operations: ['POST /api/view/{link}/withdraw'], holds: 'linkAuth', reason: LINK },
  { door: 'routes/view.ts PUT /:link/address-changes/:ref', operations: ['PUT /api/view/{link}/address-changes/{ref}'], holds: 'linkAuth', reason: LINK },
  { door: 'routes/link-reports.ts GET /:link/report', operations: ['GET /api/grant/{link}/report', 'GET /api/view/{link}/report'], holds: 'linkAuth', reason: LINK },
  { door: 'routes/link-reports.ts POST /:link/report', operations: ['POST /api/grant/{link}/report', 'POST /api/view/{link}/report'], holds: 'linkAuth', reason: LINK },
];

const keyOf = (file: string, d: Pick<Door, 'method' | 'path'>) => `${file} ${d.method.toUpperCase()} ${d.path}`;

/** Every route on the tree, by `<file under apps/api/src> <METHOD> <path>`. */
function doorsOnTheTree(): Map<string, Door> {
  const out = new Map<string, Door>();
  const files = trackedSources(ROOT, [`${API}/routes`], /\.ts$/).filter((f) => !isTestSource(f));
  for (const file of files) for (const d of doorsOf(file, readSource(ROOT, file), 'router')) out.set(keyOf(file.slice(API.length + 1), d), d);
  for (const d of doorsOf('index.ts', readSource(ROOT, `${API}/index.ts`), 'app')) out.set(keyOf('index.ts', d), d);
  return out;
}

/** The description's operations, each with whether it opts out of sign-in. */
function operations(): Map<string, { public: boolean }> {
  const spec = parse(readSource(ROOT, 'apps/api/docs/openapi.yaml')) as { paths?: Record<string, Record<string, { security?: unknown[] }>> };
  const out = new Map<string, { public: boolean }>();
  for (const [path, item] of Object.entries(spec.paths ?? {}))
    for (const method of ['get', 'post', 'put', 'patch', 'delete'])
      if (item[method]) out.set(`${method.toUpperCase()} ${path}`, { public: Array.isArray(item[method]!.security) && item[method]!.security!.length === 0 });
  return out;
}

/** The four checks, over any routes, list and description: what the tree cases and the fixture cases share. */
function disagreements(doors: Map<string, Door>, publicList: Public[], ops: Map<string, { public: boolean }>): string[] {
  const problems: string[] = [];
  const listed = new Map(publicList.map((p) => [p.door, p]));
  for (const [key, d] of doors)
    if (!d.signsIn && !listed.has(key)) problems.push(`${key} (line ${d.line}) signs no session in and is not in PUBLIC: add authenticate, or list it with its reason and give its operation security: []`);
  for (const p of publicList) {
    const d = doors.get(p.door);
    if (!d) problems.push(`${p.door}: in PUBLIC, and no such route: take it out`);
    else if (d.signsIn) problems.push(`${p.door}: in PUBLIC, and it signs a session in: take it out`);
    else if (p.holds && !d.before.includes(p.holds)) problems.push(`${p.door}: PUBLIC says ${p.holds} holds it, and the route has no ${p.holds}`);
    for (const op of p.operations) {
      const o = ops.get(op);
      if (!o) problems.push(`${p.door}: names ${op}, which the description does not have`);
      else if (!o.public) problems.push(`${op} is public in the code (${p.door}) and the description says it needs sign-in: give it security: []`);
    }
  }
  const named = new Set(publicList.flatMap((p) => p.operations));
  for (const [op, o] of ops) if (o.public && !named.has(op)) problems.push(`${op} has security: [] and no PUBLIC entry names it: a route that signs in, described as public, or a door nobody listed`);
  return problems;
}

describe('a door public in one place only (0178 G3)', () => {
  it('refuses a route that forgets sign-in, and one described as secured that is public', () => {
    const fixture = [
      "router.get('/mine', authenticate, async (req, res) => res.json([]));",
      "router.post('/open', async (req, res) => res.json({}));",
      "router.get('/:link', linkAuth, async (req, res) => res.json({}));",
    ].join('\n');
    const doors = new Map(doorsOf('fixture.ts', fixture, 'router').map((d) => [keyOf('routes/fixture.ts', d), d]));
    const ops = new Map([
      ['GET /api/f/mine', { public: false }],
      ['POST /api/f/open', { public: false }],
      ['GET /api/f/{link}', { public: true }],
    ]);
    const list: Public[] = [{ door: 'routes/fixture.ts GET /:link', operations: ['GET /api/f/{link}'], holds: 'linkAuth', reason: LINK }];
    const found = disagreements(doors, list, ops);
    expect(found.join('\n')).toContain('routes/fixture.ts POST /open (line 2) signs no session in and is not in PUBLIC');
    expect(found).toHaveLength(1);

    const listedButSecured = disagreements(doors, [...list, { door: 'routes/fixture.ts POST /open', operations: ['POST /api/f/open'], reason: 'x' }], ops);
    expect(listedButSecured).toEqual(['POST /api/f/open is public in the code (routes/fixture.ts POST /open) and the description says it needs sign-in: give it security: []']);

    const noLinkCheck = new Map(doorsOf('fixture.ts', "router.get('/:link', async (req, res) => res.json({}));", 'router').map((d) => [keyOf('routes/fixture.ts', d), d]));
    expect(disagreements(noLinkCheck, list, new Map([['GET /api/f/{link}', { public: true }]]))).toEqual([
      'routes/fixture.ts GET /:link: PUBLIC says linkAuth holds it, and the route has no linkAuth',
    ]);

    const describedPublic = disagreements(new Map(), [], new Map([['GET /api/f/x', { public: true }]]));
    expect(describedPublic[0]).toContain('GET /api/f/x has security: [] and no PUBLIC entry names it');
  });

  it('reads sign-in from the handlers before the last, wherever the call breaks its lines', () => {
    const [d] = doorsOf('f.ts', "router.post(\n  '/x',\n  // a comment\n  authenticate,\n  requireRole('owner'),\n  async (req, res) => {},\n);", 'router');
    expect(d).toMatchObject({ method: 'post', path: '/x', line: 1, signsIn: true, before: ['authenticate', 'requireRole'] });
    const [e] = doorsOf('f.ts', "router.get('/y', async (req, res) => { authenticate; });", 'router');
    expect(e?.signsIn).toBe(false);
  });

  it('finds the API’s routes, so the checks are not vacuous', () => {
    const doors = doorsOnTheTree();
    expect(doors.size).toBeGreaterThan(150);
    expect([...doors.values()].filter((d) => d.signsIn).length).toBeGreaterThan(120);
  });

  it('every route signs in, or is public in the code and in the description alike', () => {
    expect(disagreements(doorsOnTheTree(), PUBLIC, operations())).toEqual([]);
  });

  it('registers every Express route through a name it reads, router or app', () => {
    const others: string[] = [];
    for (const file of trackedSources(ROOT, [API], /\.ts$/).filter((f) => !isTestSource(f))) {
      for (const m of readSource(ROOT, file).matchAll(/\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete)\(\s*['"`]\//g))
        if (m[1] !== 'router' && m[1] !== 'app') others.push(`${file}: ${m[0]}`);
    }
    expect(others).toEqual([]);
  });

  it('gives each public door a reason', () => {
    for (const p of PUBLIC) expect(p.reason.length, p.door).toBeGreaterThan(30);
  });
});
