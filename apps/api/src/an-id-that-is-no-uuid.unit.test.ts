// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ID THAT IS NO UUID WAS A SERVER ERROR (workplan 0178, the owner's answer
 * A1 of 2026-11-26: "fix now").
 *
 * Every row an API path names by id has a `uuid` key. A path id that was no
 * UUID (`/api/migrations/pace`, a typo, a link pasted whole) reached Postgres
 * as it was, Postgres refused it (`invalid input syntax for type uuid`), and
 * the API answered 500: a server error for a caller's mistake, and an alarm
 * for the operator about nothing. Found by Schemathesis against a running
 * API (0178 T7).
 *
 * Now one place answers it: `an-id-that-is-no-uuid.ts`. Each router passes
 * its path ids through `idsThatAreNoUuid(router)`, Express's own
 * `router.param`, which runs only when a route with that parameter matched,
 * and an id that is no UUID is answered as a row that is not there is: 404,
 * in the API's `Error` shape, before any handler runs and before the
 * database is asked. So this holds:
 *
 *  1. A FEW NAMED OPERATIONS, through the real app, with an id that is no
 *     UUID: each answers 404 with `{ error, message }`, and no handler runs
 *     (no database is configured here, so a handler that ran would answer
 *     500, which is what each of them answered before).
 *     The one query id that reached the database the same way,
 *     `GET /api/permissions/report?mappingId=`, answers the same, as the
 *     description's 404 for a migration that is not there.
 *  2. A UUID STILL PASSES: the same operations with a well-formed id are not
 *     answered by the check.
 *  3. EVERY ROUTE THAT TAKES ONE PASSES THROUGH IT. The real app is walked,
 *     router by router: each route whose path has a parameter named in
 *     `UUID_PATH_PARAMS` belongs to a router that has the check for that
 *     name. A new route, or a new router, cannot forget it.
 *  4. THE LIST IS THE DESCRIPTION'S. Every path parameter
 *     `apps/api/docs/openapi.yaml` declares `format: uuid` is in the list,
 *     and no parameter the code fills with something else (a link, a hash, a
 *     subject) is.
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { NO_SUCH_MIGRATION_HERE } from '@openmig/shared';
import { NOT_FOUND, UUID_PATH_PARAMS, checkedByItsRoutes, isTheCheck, isUuid } from './an-id-that-is-no-uuid.ts';

vi.mock('./middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./middleware/auth.ts')>();
  const signedIn = (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.userId = 'user-1';
    req.userEmail = 'someone@example.invalid';
    req.tenantId = '0e260000-e29b-41d4-a716-446655440001';
    req.role = 'owner';
    next();
  };
  return { ...actual, authenticate: signedIn };
});

vi.stubEnv('DATABASE_URL', '');
vi.stubEnv('APP_DATABASE_URL', '');

const { app } = await import('./index.ts');

const NO_UUID = 'not-a-uuid';
const A_UUID = '0e260000-e29b-41d4-a716-4466554400aa';

/** Operations that answered 500 for an id that is no UUID before this (Schemathesis, 2026-11-26). */
const NAMED: ReadonlyArray<readonly ['get' | 'post' | 'put' | 'patch' | 'delete', (id: string) => string]> = [
  ['get', (id) => `/api/migrations/${id}`],
  ['get', (id) => `/api/migrations/${id}/runs`],
  ['delete', (id) => `/api/migrations/${id}`],
  ['get', (id) => `/api/connections/${id}/folders`],
  ['get', (id) => `/api/billing/invoices/${id}`],
  ['get', (id) => `/api/tenants/${A_UUID}/members/${id}`],
  ['post', (id) => `/api/decisions/${id}/dismiss`],
  ['delete', (id) => `/api/migrations/${A_UUID}/links/${id}`],
];

describe('an id that is no UUID is a row that is not there (1, 2)', () => {
  for (const [method, path] of NAMED) {
    it(`${method.toUpperCase()} ${path(':id')} answers 404 in the Error shape`, async () => {
      const res = await request(app)[method](path(NO_UUID)).send({});
      expect(res.status).toBe(404);
      // In the API's Error shape, or in the router's own words for a row that is not there.
      expect([NOT_FOUND, NO_SUCH_MIGRATION_HERE.en, undefined]).toContain(res.body.message);
      expect(['Not found', 'not_found']).toContain(res.body.error);
    });

    it(`${method.toUpperCase()} ${path(':id')} lets a UUID through to its handler`, async () => {
      const res = await request(app)[method](path(A_UUID)).send({});
      expect(res.status).not.toBe(404);
    });
  }

  it('answers a query id that is no UUID as the description answers a migration that is not there: GET /api/permissions/report?mappingId=', async () => {
    const res = await request(app).get(`/api/permissions/report?mappingId=${NO_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', message: NOT_FOUND });
  });

  it('reads a UUID as Postgres writes one, in either case, and nothing else', () => {
    expect(isUuid(A_UUID)).toBe(true);
    expect(isUuid(A_UUID.toUpperCase())).toBe(true);
    for (const v of ['', NO_UUID, A_UUID.replaceAll('-', ''), `{${A_UUID}}`, `${A_UUID} `, `${A_UUID}0`, 'null,null']) expect(isUuid(v)).toBe(false);
  });
});

interface Layer {
  readonly route?: { readonly path: string | string[] };
  readonly handle?: Router;
}
interface Router {
  readonly stack?: Layer[];
  readonly params?: Record<string, unknown[]>;
}

/** Every route of the real app, with the router it belongs to. */
function routes(): Array<{ path: string; router: Router }> {
  const out: Array<{ path: string; router: Router }> = [];
  const walk = (router: Router) => {
    for (const layer of router.stack ?? []) {
      if (layer.route) for (const p of [layer.route.path].flat()) out.push({ path: p, router });
      else if (layer.handle?.stack) walk(layer.handle);
    }
  };
  walk((app as unknown as { router: Router }).router);
  return out;
}

describe('every route that takes an id passes through the check (3, 4)', () => {
  it('walks the real app and finds its routes', () => {
    expect(routes().length).toBeGreaterThan(150);
  });

  it('gives each route with a parameter in UUID_PATH_PARAMS a router that checks it, or whose routes check it themselves and say why', () => {
    const missing: string[] = [];
    let checked = 0;
    let ownChecks = 0;
    for (const { path, router } of routes()) {
      for (const name of [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]!)) {
        if (!(UUID_PATH_PARAMS as readonly string[]).includes(name)) continue;
        if ((router.params?.[name] ?? []).some(isTheCheck)) checked += 1;
        else if (checkedByItsRoutes(router, name)) ownChecks += 1;
        else missing.push(`${path} (:${name})`);
      }
    }
    expect(missing, 'these routes take an id that reaches the database unchecked: call idsThatAreNoUuid(router) on their router').toEqual([]);
    expect(checked).toBeGreaterThan(50);
    expect(ownChecks).toBeGreaterThan(0);
  });

  it('lists every path parameter the description declares a UUID, and none it fills with something else', () => {
    const doc = parse(readFileSync(join(import.meta.dirname, '../docs/openapi.yaml'), 'utf8')) as {
      paths: Record<string, Record<string, { parameters?: Array<{ in?: string; name?: string; schema?: { format?: string } }> }>>;
    };
    const declared = new Set<string>();
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item)) {
        for (const p of op?.parameters ?? []) if (p.in === 'path' && p.schema?.format === 'uuid' && p.name) declared.add(p.name);
      }
    }
    expect([...declared].filter((n) => !(UUID_PATH_PARAMS as readonly string[]).includes(n))).toEqual([]);
    for (const other of ['link', 'hash', 'ref', 'userId', 'oldKey', 'domain', 'side', 'provider', 'action', 'category', 'stepKey']) {
      expect(UUID_PATH_PARAMS).not.toContain(other);
    }
  });
});
