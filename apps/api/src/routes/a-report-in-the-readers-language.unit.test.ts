// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The permission report in the reader's language, at the door (workplan 0144).
 *
 * `GET /api/permissions/report` takes `lang`. Only `nl` and `en` are
 * languages; nothing, or anything else, is English, the language the report
 * was first written in and the one every other caller (the smoke script, an
 * operator's curl) still reads. Anything else is English rather than a 400:
 * a report a reader cannot choose the words of is still the report, and
 * refusing it would hold back the one document that warns about cutover.
 *
 * Through the real route, the real inventory pass and the real renderer, with
 * an organisation that has no stored connection: every section is then a
 * stated blind spot, which is enough to read the document's language.
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../closed-organisation.ts', () => ({
  refusedAsClosed: async () => false,
  closedOrganisation: async () => null,
}));

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  const { Pool } = await import('pg');
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      // A member of their own per request, so no case spends another's tests.
      Object.assign(req, { tenantId: 'a-tenant', userId: `member-${Math.random()}`, userRole: 'owner' });
      next();
    },
    withTenantDb: vi.fn(async () => []),
    getDbPool: () => new Pool(),
  };
});

// No stored connection of any kind: every lookup answers nothing.
vi.mock('pg', () => ({
  Pool: class {
    async connect() {
      return { query: async () => ({ rows: [] }), release() {} };
    }
    async end() {}
  },
}));

const { default: permissionRoutes } = await import('./permissions.ts');

const app = express();
app.use('/api/permissions', permissionRoutes);

const report = (query: string) => request(app).get(`/api/permissions/report?mailbox=pat@example.test${query}`);

describe('GET /api/permissions/report?lang=', () => {
  it('is English when no language is asked for', async () => {
    const res = await report('');
    expect(res.status).toBe(200);
    expect(res.text).toContain('# Who can see what, and what happens to it');
    expect(res.text).toContain('### Who else had access to the mailbox');
  });

  it('is English when English is asked for', async () => {
    const res = await report('&lang=en');
    expect(res.status).toBe(200);
    expect(res.text).toContain('# Who can see what, and what happens to it');
  });

  it('is Dutch when Dutch is asked for', async () => {
    const res = await report('&lang=nl');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toContain('# Wie kan wat zien, en wat gebeurt ermee');
    expect(res.text).toContain('## Lees dit eerst: wat NIET kon worden geïnventariseerd');
    expect(res.text).toContain('### Wie verder toegang had tot het postvak');
    expect(res.text).not.toContain('Who can see what');
    // The address asked about is a value, and stays as it was typed.
    expect(res.text).toContain('pat@example.test');
  });

  it.each(['fr', 'NL', 'nl-NL', ''])('is English for lang=%s, never a refusal', async (lang) => {
    const res = await report(`&lang=${lang}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('# Who can see what, and what happens to it');
  });
});
