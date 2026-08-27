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
      'src/routes/migrations/link-routes.ts',
    ],
  },
  { prefix: '/api/decisions', files: ['src/routes/decisions.ts'] },
  { prefix: '/api/shared-addresses', files: ['src/routes/shared-addresses.ts'] },
  { prefix: '/api/permissions', files: ['src/routes/permissions.ts'] },
  { prefix: '/api/billing', files: ['src/routes/billing/index.ts'] },
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
