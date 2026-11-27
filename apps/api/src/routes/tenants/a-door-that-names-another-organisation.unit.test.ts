// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY DOOR THAT NAMES AN ORGANISATION REFUSES ONE THAT IS NOT THE CALLER'S
 * (workplan 0178 T10's reading, the maintainer's answer of 2026-11-26).
 *
 * The doors under `/api/tenants/{tenantId}` acted on the caller's own
 * organisation whatever their path named (`a-door-that-names-its-own`
 * holds that on a real database). This holds it for every such door the API
 * description lists, so a door added later is held too: asked about another
 * organisation by a member signed in to theirs, each answers 403 with
 * `requireTenantMatch`'s refusal, before its handler runs (no database is
 * configured here, so a handler that ran would answer otherwise).
 */

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const OURS = '0e260000-e29b-41d4-a716-446655440178';
const THEIRS = '0e260000-e29b-41d4-a716-446655440179';

vi.mock('../../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
      req.userId = 'user-1';
      req.userEmail = 'someone@example.invalid';
      req.tenantId = OURS;
      req.userRole = 'owner';
      next();
    },
  };
});

vi.stubEnv('DATABASE_URL', '');
vi.stubEnv('APP_DATABASE_URL', '');

const { app } = await import('../../index.ts');

const doc = parse(readFileSync(join(import.meta.dirname, '../../../docs/openapi.yaml'), 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};
const METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;

/** Every operation of the description under /api/tenants/{tenantId}, its other ids filled with a UUID. */
const doors = Object.entries(doc.paths)
  .filter(([path]) => path.startsWith('/api/tenants/{tenantId}'))
  .flatMap(([path, item]) => METHODS.filter((m) => item[m]).map((m) => [m, path] as const));

describe('a door under /api/tenants/{tenantId}', () => {
  it('is found in the description, every one of them', () => {
    expect(doors.length).toBeGreaterThanOrEqual(10);
  });

  for (const [method, path] of doors) {
    const url = (tenant: string) => path.replace('{tenantId}', tenant).replace(/\{[^}]+\}/g, '0e260000-e29b-41d4-a716-4466554401aa');
    it(`${method.toUpperCase()} ${path} refuses another organisation's id, before its handler`, async () => {
      const res = await request(app)[method](url(THEIRS)).send({});
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Forbidden', message: 'Access denied to this tenant' });
    });

    it(`${method.toUpperCase()} ${path} lets the caller's own organisation through`, async () => {
      const res = await request(app)[method](url(OURS.toUpperCase())).send({});
      expect(res.body?.message).not.toBe('Access denied to this tenant');
    });
  }
});
