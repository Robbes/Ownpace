// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A ROLE THAT PROMISES LESS THAN IT ALLOWS (workplan 0137 T7).
 *
 * The Team page called a viewer read-only, and the API let a viewer delete a
 * migration or replace a target's credentials: 36 write routes check only that
 * the caller belongs to the organisation (0137 §1). Until every write names its
 * roles (T2), the owner chose on 2026-09-28 that the product grants owner and
 * admin only, answering 0137 T0 with *"b"*.
 *
 * What this holds, against a real database (PGlite as `app_user`, so row level
 * security is in force) and reading the table after every call:
 *
 * - an owner inviting a `viewer` or a `member` gets 400, the alpha's sentence
 *   under the code the Team page translates, and no row;
 * - a role change to `viewer` or `member` gets the same, and the row keeps its
 *   role;
 * - owner and admin are still granted, and a row that already holds `member`
 *   can be moved up to admin;
 * - an admin still cannot invite somebody as owner (T3 (a), #1137);
 * - the owner-only acts in `apps/api/src/routes` are the ones the Team page's
 *   admin line names, read from the source, so a new one fails here.
 *
 * T2's PR widens the schemas again and replaces this file with T6's suite.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { pgliteDriver, runMigrations } from '@openmig/ledger';
import type { LedgerDriver } from '@openmig/ledger';
import { runManagedMigrations } from '@openmig/managed';

// UUID family 5f610000-…, unused elsewhere in the repo.
const TENANT = '5f610000-e29b-41d4-a716-446655441701';
const OWNER = { tenantId: TENANT, userId: 'sub-owner-0137', userRole: 'owner' };
const ADMIN = { tenantId: TENANT, userId: 'sub-admin-0137', userRole: 'admin' };

const SENTENCE = 'During the alpha, a person can only be an owner or an admin.';

let driver: LedgerDriver;
/** Set per test — the session `authenticate` pretends to have verified. */
let caller: { tenantId?: string; userId?: string; userRole?: string } = {};

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    // The only stubs: a caller with a tenant and a role, and the database.
    // `requireRole` is the real one.
    authenticate: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!caller.tenantId) return void res.status(401).json({ error: 'Unauthorized' });
      Object.assign(req, caller);
      next();
    },
    getDbPool: () => driver,
  };
});

const { default: memberRoutes } = await import('./members.ts');

const app = express();
app.use(express.json());
app.use('/api/tenants/:tenantId/members', memberRoutes);

async function rows(sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> {
  const conn = await driver.acquire();
  try {
    return (await conn.query(sql, params)).rows as Array<Record<string, unknown>>;
  } finally {
    await conn.release();
  }
}

const rowsFor = (email: string) =>
  rows('SELECT role, status FROM tenant_member WHERE tenant_id = $1 AND email = $2', [
    TENANT,
    email,
  ]);

/** The id of the row holding `email`, seeded with `role`. */
async function seeded(email: string, role: string): Promise<string> {
  const [row] = await rows(
    `INSERT INTO tenant_member (tenant_id, user_id, email, role, status, joined_at)
     VALUES ($1, $2, $3, $4, 'active', now()) RETURNING id`,
    [TENANT, `sub-${email}`, email, role],
  );
  return row!.id as string;
}

beforeAll(async () => {
  driver = pgliteDriver({ role: 'app_user' });
  await runMigrations({ driver, logger: () => {} });
  await runManagedMigrations({ driver, logger: () => {} });
  await rows('INSERT INTO tenant (id, name) VALUES ($1, $2)', [TENANT, 'Acme Families']);
  // 120s for the reason every PGlite fixture here carries it: both migration
  // chains run before the first test, and a loaded runner is slow.
}, 120_000);

afterAll(async () => {
  await driver?.end();
});

beforeEach(async () => {
  caller = OWNER;
  await rows('DELETE FROM tenant_member WHERE tenant_id = $1', [TENANT]);
  // The owner and the admin the calls are made as, so the last-owner guard
  // has an owner to count and nothing here trips it by accident.
  await seeded('owner@acme.test', 'owner');
  await seeded('admin@acme.test', 'admin');
});

describe('nobody is invited below admin', () => {
  it.each(['viewer', 'member'])('an owner inviting a %s gets 400 and no row', async (role) => {
    const res = await request(app)
      .post(`/api/tenants/${TENANT}/members`)
      .send({ email: `${role}@acme.test`, role });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'owner_or_admin_only', message: SENTENCE });
    expect(
      await rowsFor(`${role}@acme.test`),
      `inviting a ${role} wrote a row: the schema in members.ts admits a role below admin again`,
    ).toEqual([]);
  });

  it('the same for a role the database has never heard of', async () => {
    const res = await request(app)
      .post(`/api/tenants/${TENANT}/members`)
      .send({ email: 'guest@acme.test', role: 'guest' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('owner_or_admin_only');
    expect(await rowsFor('guest@acme.test')).toEqual([]);
  });

  it('an address that is not one is still refused for what it is', async () => {
    // The alpha's sentence answers the role only. A bad address with a good
    // role keeps the validation answer it always had.
    const res = await request(app)
      .post(`/api/tenants/${TENANT}/members`)
      .send({ email: 'not an address', role: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
  });

  it('a bad address AND a role below admin are named together, in one answer', async () => {
    // The sentence answered any body with an issue on `role`, and hid the
    // rest: fixing the role then met a second 400 for the address.
    const res = await request(app)
      .post(`/api/tenants/${TENANT}/members`)
      .send({ email: 'not an address', role: 'viewer' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    const paths = (res.body.details as Array<{ path: unknown[] }>).map((d) => d.path[0]).sort();
    expect(paths).toEqual(['email', 'role']);
    expect(await rowsFor('not an address')).toEqual([]);
  });

  it.each([
    ['no role at all', { email: 'norole@acme.test' }],
    ['a role that is not a string', { email: 'norole@acme.test', role: 3 }],
  ])('%s is told the role is wrong, not about the alpha', async (_what, body) => {
    const res = await request(app).post(`/api/tenants/${TENANT}/members`).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(res.body.details[0].path).toEqual(['role']);
    expect(await rowsFor('norole@acme.test')).toEqual([]);
  });

  it.each(['admin', 'owner'])('an owner may still invite an %s', async (role) => {
    const res = await request(app)
      .post(`/api/tenants/${TENANT}/members`)
      .send({ email: `new-${role}@acme.test`, role });
    expect(res.status).toBe(201);
    expect(await rowsFor(`new-${role}@acme.test`)).toEqual([{ role, status: 'invited' }]);
  });

  it('an admin still cannot invite somebody as owner (T3 (a), #1137)', async () => {
    caller = ADMIN;
    const res = await request(app)
      .post(`/api/tenants/${TENANT}/members`)
      .send({ email: 'escalate@acme.test', role: 'owner' });
    expect(res.status).toBe(403);
    expect(await rowsFor('escalate@acme.test')).toEqual([]);
  });
});

describe('nobody is moved below admin', () => {
  it.each(['viewer', 'member'])('a role change to %s gets 400 and the row keeps its role', async (role) => {
    const id = await seeded('colleague@acme.test', 'admin');

    const res = await request(app).patch(`/api/tenants/${TENANT}/members/${id}`).send({ role });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'owner_or_admin_only', message: SENTENCE });
    expect(await rowsFor('colleague@acme.test')).toEqual([{ role: 'admin', status: 'active' }]);
  });

  it('a change with no role is told the role is missing, not about the alpha', async () => {
    const id = await seeded('colleague@acme.test', 'admin');

    const res = await request(app).patch(`/api/tenants/${TENANT}/members/${id}`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation error');
    expect(await rowsFor('colleague@acme.test')).toEqual([{ role: 'admin', status: 'active' }]);
  });

  it('a row that already holds member can be moved up to admin', async () => {
    // Existing rows keep working: the stack may hold one from before, and the
    // way out of it is up.
    const id = await seeded('older@acme.test', 'member');

    const res = await request(app)
      .patch(`/api/tenants/${TENANT}/members/${id}`)
      .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(await rowsFor('older@acme.test')).toEqual([{ role: 'admin', status: 'active' }]);
  });
});

/**
 * WHAT ONLY AN OWNER CAN DO, READ FROM THE ROUTES.
 *
 * The Team page says, in `tenants.invite.adminCan`, that an admin can do
 * everything an owner can except close or reopen the organisation, turn
 * deleting by hand or the automatic removal of moved files' old copies on or
 * off (`allowApplyDeletions`, `autoApplyRelocations`), and make somebody an
 * owner. That sentence is true only while the owner-only doors are exactly
 * those, and the web test that holds it compares the string with a copy of
 * itself. T2 adding a `requireRole('owner')` route, or T3 (b) making "an admin
 * cannot demote or remove an owner" true, would make it false with every test
 * green. So the doors are read here from `apps/api/src/routes`: every
 * `requireRole` whose roles are `owner` alone, and every place a route reads
 * the caller's role itself (`req.userRole`), which is how granting owner is
 * refused to an admin.
 */
describe('what only an owner can do, as the admin line says', () => {
  const ROUTES = join(dirname(fileURLToPath(import.meta.url)), '..');
  const REVISIT =
    'the owner-only acts changed: revisit `tenants.invite.adminCan` (EN and NL) in ' +
    'apps/web/src/i18n/strings.ts and its literal in ' +
    'apps/web/src/pages/a-role-that-promises-less-than-it-allows.unit.test.tsx, ' +
    'then this list and 0137\'s Status block';

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return entry.name.endsWith('.ts') && !/\.test\.ts$/.test(entry.name) ? [path] : [];
    });

  /** "<METHOD> <path>" of the `router.<method>(...)` call `at` sits inside, or null. */
  const routeAt = (text: string, at: number): string | null => {
    const before = text.slice(0, at);
    const calls = [...before.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)['"`]/g)];
    const last = calls.at(-1);
    if (last?.index === undefined) return null;
    // A statement ended at column 0 between the call and `at`: not inside it.
    if (/\n\);|\n\}/.test(before.slice(last.index))) return null;
    return `${last[1]!.toUpperCase()} ${last[2]}`;
  };

  /** The roles a `requireRole(...)` admits, with a spread of a same-file `const` resolved. */
  const rolesOf = (text: string, args: string): string[] | null => {
    const roles: string[] = [];
    for (const arg of args.split(',').map((a) => a.trim()).filter(Boolean)) {
      const literal = /^['"](\w+)['"]$/.exec(arg);
      const spread = /^\.\.\.(\w+)$/.exec(arg);
      if (literal) roles.push(literal[1]!);
      else if (spread) {
        const list = new RegExp(`const ${spread[1]}\\b[^=]*=\\s*\\[([^\\]]*)\\]`).exec(text);
        if (!list) return null;
        roles.push(...[...list[1]!.matchAll(/['"](\w+)['"]/g)].map((m) => m[1]!));
      } else return null;
    }
    return roles;
  };

  const found: string[] = [];
  const unreadable: string[] = [];
  for (const file of sources(ROUTES)) {
    const text = readFileSync(file, 'utf8');
    const name = relative(ROUTES, file).split('\\').join('/');
    const line = (at: number) => text.slice(0, at).split('\n').length;

    for (const call of text.matchAll(/requireRole\(([^)]*)\)/g)) {
      const roles = rolesOf(text, call[1]!);
      if (roles === null) unreadable.push(`${name}:${line(call.index)} requireRole(${call[1]})`);
      else if (roles.length === 1 && roles[0] === 'owner') {
        const route = routeAt(text, call.index);
        found.push(`owner only: ${name} ${route ?? `requireRole('owner') outside a route, line ${line(call.index)}`}`);
      }
    }
    for (const read of text.matchAll(/\.userRole\b/g)) {
      const lineStart = text.lastIndexOf('\n', read.index) + 1;
      const via = /(\w+)\([^()]*$/.exec(text.slice(lineStart, read.index))?.[1] ?? 'inline';
      const route = routeAt(text, read.index) ?? `outside a route, line ${line(read.index)}`;
      found.push(`reads the caller's role: ${name} ${route} (${via})`);
    }
  }

  it('reads every requireRole it finds', () => {
    expect(unreadable, 'a requireRole whose roles this guard cannot read: teach it, or name them').toEqual([]);
  });

  it('finds closing, reopening, deleting, the two deletion flags and granting owner, and nothing else', () => {
    expect(found.sort(), REVISIT).toEqual(
      [
        // Deleting answers the owner 410: closing is how an organisation ends.
        'owner only: tenants/index.ts DELETE /:tenantId',
        'owner only: tenants/index.ts POST /:tenantId/close',
        'owner only: tenants/index.ts POST /:tenantId/reopen',
        // allowApplyDeletions and autoApplyRelocations, on and off alike.
        'owner only: migrations/operating-routes.ts PATCH /:mappingId/apply-deletions',
        // Granting owner, by invitation or by a role change.
        "reads the caller's role: tenants/members.ts POST / (grantsOwnerWithoutPermission)",
        "reads the caller's role: tenants/members.ts PATCH /:memberId (grantsOwnerWithoutPermission)",
        // Not a door: a problem report writes the caller's role into its facts
        // (0130 T6), and neither route decides anything by it.
        "reads the caller's role: problem-reports.ts GET /preview (serverFacts)",
        "reads the caller's role: problem-reports.ts POST / (serverFacts)",
      ].sort(),
    );
  });
});
