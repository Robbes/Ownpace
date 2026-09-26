// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The spec describes THIS API, and keeps describing it.
 *
 * `docs/openapi.yaml` spent its life as markdown prose in a file named
 * `openapi.yaml`, announcing itself as an "OpenAPI 3.0 specification" while
 * containing no `openapi:`, `info:` or `paths:` key. Nothing could read it, so
 * nothing noticed when it drifted: it documented `PUT` for a member role the
 * code serves with `PATCH`, and knew nothing of verify, apply-deletions, runs,
 * discovery, shared addresses or the permission report — roughly half the
 * surface, missing, in the file a client generator would trust.
 *
 * Rewriting it fixed today. This test is what stops it happening again, and it
 * checks the two directions separately because they fail differently:
 *
 *  - **Documented but absent** builds a client against an endpoint that 404s.
 *  - **Present but undocumented** is the quiet one: the spec still parses,
 *    still looks complete, and simply omits the route somebody needed. That is
 *    exactly how the old file rotted, so it is asserted rather than trusted.
 *
 * It parses the file with a real YAML parser instead of pattern-matching the
 * text, because "a tool can read this" is the property being claimed.
 *
 * ## The guard itself drifted, which is the failure it was written to stop
 *
 * Both checks below run only over the mounts named in `MOUNTS`, and a router
 * absent from that table is not "undocumented" — it is INVISIBLE. Three arrived
 * afterwards and none was added: `/api/me`, `/api/access-requests` and
 * readiness, seven operations between them, including the only unauthenticated
 * WRITE in the whole surface. The spec looked complete and the test agreed,
 * exactly as the markdown-in-a-yaml-suit did.
 *
 * So the table is not the source of truth about what exists — `index.ts` is.
 * `everyRouterMountIsListed` reads the mounts straight out of it and fails when
 * one is missing here, which turns the next forgotten `app.use` into a red test
 * rather than a silently narrower guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { GOOGLE_ACCOUNT_CONSENT_DOMAINS } from './routes/migrations/google-account-consent.ts';
import { MICROSOFT_CONSENT_DOMAINS } from './routes/migrations/microsoft-consent.ts';

const API_ROOT = join(import.meta.dirname, '..');

/**
 * Where each URL prefix is served from — the same table `src/index.ts` builds
 * with `app.use(...)`. Longest prefix wins, so `/api/billing/webhooks` is not
 * swallowed by `/api/billing`, and the members router (mounted INSIDE the
 * tenants router) is not swallowed by `/api/tenants`.
 *
 * Mount strings are asserted against index.ts below, so moving a router in the
 * code fails here rather than silently making the checks vacuous.
 */
const MOUNTS: ReadonlyArray<{ prefix: string; files: string[]; mountedIn?: string }> = [
  { prefix: '/api/tenants/{tenantId}/members', files: ['src/routes/tenants/members.ts'], mountedIn: 'src/routes/tenants/index.ts' },
  { prefix: '/api/billing/webhooks', files: ['src/routes/billing/webhooks.ts'] },
  { prefix: '/api/tenants', files: ['src/routes/tenants/index.ts'] },
  // One router, two prefixes — `/ready` for a probe that speaks to the API
  // directly and `/api/ready` for a browser going through the web front, the
  // same pairing `/health` and `/version` have.
  { prefix: '/ready', files: ['src/routes/ready.ts'] },
  { prefix: '/api/ready', files: ['src/routes/ready.ts'] },
  { prefix: '/api/me', files: ['src/routes/me.ts'] },
  { prefix: '/api/invitations', files: ['src/routes/invitations.ts'] },
  { prefix: '/api/access-requests', files: ['src/routes/access-requests.ts'] },
  { prefix: '/api/scope-manifest', files: ['src/routes/scope-manifest.ts'] },
  { prefix: '/api/provider-accounts', files: ['src/routes/provider-accounts.ts'] },
  { prefix: '/api/provider-clients', files: ['src/routes/provider-clients.ts'] },
  { prefix: '/api/redirect-uris', files: ['src/routes/redirect-uris.ts'] },
  { prefix: '/api/setup', files: ['src/routes/setup.ts'] },
  { prefix: '/api/connections', files: ['src/routes/connections.ts'] },
  // Four files, not one: `migrations/index.ts` mounts three SUB-routers on
  // itself, and each is a separate file the extractor has to be pointed at.
  // `everySubRouterIsListed` below reads those mounts out of the code so a
  // fourth cannot arrive unlisted — which is how `google-oauth-routes.ts`
  // served two operations nothing checked.
  {
    prefix: '/api/migrations',
    files: [
      'src/routes/migrations/index.ts',
      'src/routes/migrations/operating-routes.ts',
      'src/routes/migrations/google-oauth-routes.ts',
      'src/routes/migrations/dropbox-oauth-routes.ts',
      'src/routes/migrations/microsoft-oauth-routes.ts',
      'src/routes/migrations/link-routes.ts',
    ],
  },
  { prefix: '/api/decisions', files: ['src/routes/decisions.ts'] },
  // Every queue at once, for the screen that showed only the one above.
  { prefix: '/api/attention', files: ['src/routes/attention.ts'] },
  { prefix: '/api/shared-addresses', files: ['src/routes/shared-addresses.ts'] },
  { prefix: '/api/permissions', files: ['src/routes/permissions.ts'] },
  { prefix: '/api/billing', files: ['src/routes/billing/index.ts'] },
  // The migrator's surface (workplan 0108 T4). Its own prefix because nothing
  // under it authenticates a session — the link in the path is the credential.
  // With "report this link" beside each kind of link (0108 T8 (d)): one
  // router file, mounted under both prefixes, each authenticating its own.
  { prefix: '/api/grant', files: ['src/routes/grant.ts', 'src/routes/link-reports.ts'] },
  // The same population's SECOND surface (workplan 0122): the progress page.
  // Its own prefix, not a route under `/api/grant`, because the purposes carry
  // different lifetimes and `verifyMappingLink` refuses a token at the wrong one.
  { prefix: '/api/view', files: ['src/routes/view.ts', 'src/routes/link-reports.ts'] },
  // The operator's support surface (workplan 0110 T4). Its own prefix because
  // nothing under it resolves a tenant — these read across all of them.
  { prefix: '/api/support', files: ['src/routes/support.ts'] },
  // The operator hold (managed migration 0023). Its own prefix because the
  // READ is a customer's — the sentence explaining their own screen — while
  // the writes are an operator's, and everything under `/api/support` is
  // unreachable by anyone else.
  { prefix: '/api/platform-pause', files: ['src/routes/platform-pause.ts'] },
  // "Report a problem" (workplan 0130). Mounted ahead of the global JSON
  // parser, with a larger limit of its own, for the screenshot.
  { prefix: '/api/problem-reports', files: ['src/routes/problem-reports.ts'] },
];

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Method = (typeof METHODS)[number];

const read = (rel: string): string => readFileSync(join(API_ROOT, rel), 'utf-8');

/** `:mappingId` in Express is `{mappingId}` in a spec path. One vocabulary for comparing. */
const toSpecPath = (expressPath: string): string => expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/** Every `router.<method>('<path>')` in a router file, as full spec-shaped paths. */
function routesInFile(rel: string, prefix: string): Array<{ method: Method; path: string }> {
  const src = read(rel);
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']*)'/gm;
  const out: Array<{ method: Method; path: string }> = [];
  for (const m of src.matchAll(re)) {
    const tail = m[2] === '/' ? '' : m[2]!;
    out.push({ method: m[1] as Method, path: toSpecPath(prefix + tail) });
  }
  return out;
}

/** The routes `index.ts` registers directly on the app (health, version, metrics). */
function appLevelRoutes(): Array<{ method: Method; path: string }> {
  const src = read('src/index.ts');
  const re = /app\.(get|post|put|patch|delete)\(\s*'([^']*)'/gm;
  return [...src.matchAll(re)].map((m) => ({ method: m[1] as Method, path: toSpecPath(m[2]!) }));
}

function codeRoutes(): Array<{ method: Method; path: string }> {
  const all = [...appLevelRoutes()];
  for (const { prefix, files } of MOUNTS) {
    for (const f of files) all.push(...routesInFile(f, prefix));
  }
  return all;
}

const spec = parse(read('docs/openapi.yaml')) as {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, unknown>>;
  components?: { securitySchemes?: Record<string, unknown> };
  security?: unknown[];
};

function specOperations(): Array<{ method: Method; path: string }> {
  const out: Array<{ method: Method; path: string }> = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of METHODS) {
      if (item && Object.prototype.hasOwnProperty.call(item, method)) out.push({ method, path });
    }
  }
  return out;
}

const key = (r: { method: Method; path: string }) => `${r.method.toUpperCase()} ${r.path}`;

describe('openapi.yaml is a real OpenAPI document', () => {
  it('parses as YAML into an object', () => {
    // The claim the old file could not have survived: a tool can read this.
    expect(spec).toBeTypeOf('object');
    expect(spec).not.toBeNull();
  });

  it('declares an OpenAPI version, info and paths', () => {
    expect(spec.openapi).toMatch(/^3\.\d+\.\d+$/);
    expect(spec.info?.title).toBeTruthy();
    expect(spec.info?.version).toBeTruthy();
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(20);
  });

  it('declares the bearer scheme and applies it by default', () => {
    const bearer = spec.components?.securitySchemes?.bearerAuth as
      | { type?: string; scheme?: string }
      | undefined;
    expect(bearer?.type).toBe('http');
    expect(bearer?.scheme).toBe('bearer');
    // Default-on, so an operation is authenticated unless it opts out with
    // `security: []` — the safe direction for a spec somebody generates a
    // client from.
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });

  it('every path is absolute and free of Express parameter syntax', () => {
    for (const path of Object.keys(spec.paths ?? {})) {
      expect(path.startsWith('/'), `${path} must be absolute`).toBe(true);
      expect(path, `${path} uses Express ':param' instead of '{param}'`).not.toMatch(/\/:/);
    }
  });
});

describe('the spec and the routers agree', () => {
  it('mounts the routers where MOUNTS says they are', () => {
    const index = read('src/index.ts');
    for (const { prefix, files, mountedIn } of MOUNTS) {
      if (mountedIn) {
        // Nested router: asserted where it is actually mounted.
        expect(read(mountedIn)).toContain("router.use('/:tenantId/members'");
        continue;
      }
      expect(index, `index.ts should mount ${prefix}`).toContain(`app.use('${prefix}'`);
      expect(files.length).toBeGreaterThan(0);
    }
  });

  it('documents nothing that does not exist', () => {
    const inCode = new Set(codeRoutes().map(key));
    const undocumentedTruth = specOperations()
      .filter((op) => !inCode.has(key(op)))
      .map(key);
    expect(undocumentedTruth, 'documented in openapi.yaml but no such route in the code').toEqual([]);
  });

  it('documents everything that does exist', () => {
    const inSpec = new Set(specOperations().map(key));
    const missing = codeRoutes()
      .filter((r) => !inSpec.has(key(r)))
      .map(key);
    expect(missing, 'route exists in the code but is absent from openapi.yaml').toEqual([]);
  });

  it('finds the surface it claims to cover, so the checks are not vacuous', () => {
    // Both directions above pass trivially if the extractors return nothing.
    expect(codeRoutes().length).toBeGreaterThan(40);
    expect(specOperations().length).toBe(codeRoutes().length);
  });

  it('lists EVERY router index.ts mounts, so a new one cannot slip past both checks', () => {
    // The hole this file itself fell into. Both checks above run only over
    // MOUNTS, so a router missing from that table is not undocumented — it is
    // invisible, and the suite stays green while the guard quietly covers less.
    // Three had arrived that way (`/api/me`, `/api/access-requests`, readiness:
    // seven operations, including the only unauthenticated WRITE in the API).
    //
    // index.ts is the truth about what is served, so it is read directly rather
    // than compared against a second hand-kept list. `app.use(express.json())`
    // and friends are excluded by requiring a quoted path.
    const mounted = [...read('src/index.ts').matchAll(/app\.use\(\s*'([^']+)'/gm)].map((m) =>
      toSpecPath(m[1]!),
    );
    expect(mounted.length, 'index.ts should mount several routers').toBeGreaterThan(5);

    const listed = new Set(MOUNTS.map((m) => m.prefix));
    const forgotten = mounted.filter((prefix) => !listed.has(prefix));
    expect(forgotten, 'mounted in index.ts but absent from MOUNTS — its routes are unchecked').toEqual(
      [],
    );
  });

  it('lists every SUB-router a listed router mounts on itself', () => {
    // The same hole, one level down, and it had already swallowed something.
    // `everyRouterMountIsListed` reads `app.use('/prefix', …)` out of the API's
    // own index.ts — but `/api/migrations` is not one router, it is a router
    // that mounts three more on itself with `router.use('/', …)`. Those files
    // are reachable only through the `files` array above, and
    // `google-oauth-routes.ts` was never added to it: `POST /google/authorize`
    // and `GET /google/callback` — one of them the beginning of an OAuth
    // consent — existed, served, and were checked by nothing.
    //
    // A router file is read for its OWN routes only, so listing the parent is
    // not enough and never was. This resolves the imports the parent actually
    // mounts, which makes the next sub-router's arrival a red test.
    //
    // Covered ANYWHERE in MOUNTS counts: `members.ts` is mounted inside the
    // tenants router but carries its own prefix entry, because its paths are
    // nested rather than shared. What is being asserted is that the file is
    // read by something, not that it is read under its parent.
    const everyListedFile = new Set(MOUNTS.flatMap((m) => m.files));
    for (const { prefix, files } of MOUNTS) {
      const parent = files[0]!;
      if (!parent.endsWith('/index.ts')) continue;
      const src = read(parent);
      const dir = parent.slice(0, parent.lastIndexOf('/'));
      const mountedNames = [...src.matchAll(/router\.use\(\s*'[^']*'\s*,\s*(\w+)\s*\)/gm)].map(
        (m) => m[1]!,
      );
      for (const name of mountedNames) {
        const imported = src.match(
          new RegExp(`import\\s+${name}\\s+from\\s+'\\.\\/([^']+)'`),
        );
        // A sub-router imported from elsewhere is out of this check's reach;
        // say so rather than pass quietly.
        expect(imported, `${parent} mounts ${name} but does not import it from ./`).toBeTruthy();
        const file = `${dir}/${imported![1]!}`;
        expect(
          [...everyListedFile],
          `${file} is mounted under ${prefix} but is not in MOUNTS — its routes are unchecked`,
        ).toContain(file);
      }
    }
  });
});

describe('the spec says the things a reader would otherwise get wrong', () => {
  it('documents tenant creation as the 501 it really is', () => {
    const post = spec.paths?.['/api/tenants']?.post as { responses?: Record<string, unknown> };
    expect(Object.keys(post?.responses ?? {})).toContain('501');
  });

  it('keeps applying a deletion behind a refusal path', () => {
    const apply = spec.paths?.['/api/migrations/{mappingId}/deletions/{hash}/apply']?.post as {
      responses?: Record<string, unknown>;
    };
    expect(Object.keys(apply?.responses ?? {})).toEqual(expect.arrayContaining(['202', '403']));
  });

  it('marks every stored secret write-only', () => {
    // Reads the component the create body $refs, rather than the ref itself.
    const components = (spec as { components?: { schemas?: Record<string, unknown> } }).components;
    const create = components?.schemas?.CreateMappingRequest;
    const schema = JSON.stringify(create ?? {});
    // A generated client must not be told it will get these back; the API
    // masks them on every read.
    expect(schema).toContain('"writeOnly":true');
    for (const secret of ['password', 'clientSecret']) {
      expect(schema, `${secret} must be writeOnly`).toMatch(
        new RegExp(`"${secret}":\\{[^}]*"writeOnly":true`),
      );
    }
  });
});

/**
 * The consent doors a wizard starts from, and where each one's refusals come
 * from: `error: <name>.error` in a handler passes on another module's refusal,
 * and `passedOn` says which module that is, so its codes are read too.
 */
interface ConsentDoor {
  readonly path: string;
  readonly provider: string;
  readonly handler: string;
  /** What `domains` may carry, for a door that takes the account ask. */
  readonly domains?: ReadonlyArray<string>;
  readonly passedOn: Readonly<Record<string, string>>;
}

const CONSENT_DOORS: ReadonlyArray<ConsentDoor> = [
  {
    path: '/api/migrations/google/authorize',
    provider: 'google',
    handler: 'src/routes/migrations/google-oauth-routes.ts',
    domains: GOOGLE_ACCOUNT_CONSENT_DOMAINS,
    passedOn: {
      client: '../../packages/shared/src/google-deployment-client.ts',
      consent: 'src/routes/migrations/google-account-consent.ts',
    },
  },
  {
    path: '/api/migrations/microsoft/authorize',
    provider: 'microsoft',
    handler: 'src/routes/migrations/microsoft-oauth-routes.ts',
    domains: MICROSOFT_CONSENT_DOMAINS,
    passedOn: { client: '../../packages/shared/src/microsoft-deployment-client.ts' },
  },
  {
    // Files only, so no `domains`: the server puts the read scopes on the URL
    // itself, the same for every ask (workplan 0140 T7 (b)).
    path: '/api/migrations/dropbox/authorize',
    provider: 'dropbox',
    handler: 'src/routes/migrations/dropbox-oauth-routes.ts',
    passedOn: { client: '../../packages/shared/src/dropbox-deployment-client.ts' },
  },
];

interface DocumentedPost {
  requestBody?: {
    content?: Record<
      string,
      { schema?: { required?: string[]; properties?: Record<string, { items?: { enum?: string[] } }> } }
    >;
  };
  responses?: Record<string, { description?: string }>;
}

const documentedPost = (path: string) => spec.paths?.[path]?.post as DocumentedPost | undefined;
const documentedBody = (path: string) =>
  documentedPost(path)?.requestBody?.content?.['application/json']?.schema;

/** Every refusal code a door answers with: its handler's own, and those it passes on. */
function refusalsOf(door: ConsentDoor): { codes: string[]; passedOn: string[] } {
  const src = read(door.handler);
  const start = src.indexOf(`router.post('/${door.provider}/authorize'`);
  const end = src.indexOf(`router.get('/${door.provider}/callback'`);
  expect(start, `${door.handler} should serve the authorize route`).toBeGreaterThan(-1);
  expect(end, `${door.handler} should serve the callback after it`).toBeGreaterThan(start);
  const handler = src.slice(start, end);
  const literal = (text: string) => [...text.matchAll(/error: '([a-z_]+)'/g)].map((m) => m[1]!);
  const codes = [
    ...literal(handler),
    ...Object.values(door.passedOn).flatMap((file) => literal(read(file))),
  ];
  return {
    codes: [...new Set(codes)].sort(),
    passedOn: [...handler.matchAll(/error: (\w+)\.error/g)].map((m) => m[1]!).sort(),
  };
}

describe('each consent door documents what its route does', () => {
  // Both routes were right and both specs were behind. Microsoft's `domains`
  // enum stayed at four when To Do's scope row arrived; Google's body went on
  // requiring a client pair after ADR-0041 made the deployment's own client
  // the fallback, and its refusals stopped at the ones it had before that. So
  // each fact below is read from the code, not from a second list kept here.
  for (const door of CONSENT_DOORS) {
    describe(door.path, () => {
      const { domains } = door;
      if (domains) {
        it('offers every face its route accepts, and no other', () => {
          const documented = documentedBody(door.path)?.properties?.domains?.items?.enum;
          expect([...(documented ?? [])].sort()).toEqual([...domains].sort());
        });
      }

      it("requires no client pair: with none sent, the deployment's own client serves", () => {
        const body = documentedBody(door.path);
        expect(body, 'the request body schema should be found').toBeDefined();
        expect(body?.required ?? []).not.toContain('clientId');
        expect(body?.required ?? []).not.toContain('clientSecret');
      });

      it('names exactly the refusals the route answers with', () => {
        const { codes, passedOn } = refusalsOf(door);
        // A refusal passed on from a module the table does not name would keep
        // that module's codes out of the comparison below.
        expect(passedOn, 'each passed-on refusal needs its module in CONSENT_DOORS').toEqual(
          Object.keys(door.passedOn).sort(),
        );
        expect(codes.length, 'the extractor should find the refusals').toBeGreaterThanOrEqual(5);
        const said = documentedPost(door.path)?.responses?.['400']?.description ?? '';
        const documented = [...new Set([...said.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!))].sort();
        expect(documented).toEqual(codes);
      });
    });
  }
});
