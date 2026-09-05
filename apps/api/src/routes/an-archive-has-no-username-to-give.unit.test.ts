// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * AN ARCHIVE HAS NO USERNAME TO GIVE, AND THE DOOR MUST NOT ASK FOR ONE.
 *
 * Workplan 0116 T1 made the export archive the one source kind whose
 * credential is a LOCATION: its descriptor carries `provider` and `path`, and
 * the row it stores holds no secret at all. Every other source is an account,
 * and every account has a username — it names whose mailbox, whose Drive —
 * which is why the create door's config object demands one of everybody.
 *
 * The connections door validates `values` through that same object. So the
 * first honest archive body ever posted to it — the managed gate's, in
 * E2E (managed) #154 — was refused with `invalid_values: username`, for a
 * field no screen shows for this kind. The unit test that pinned the kind's
 * storage had never met the refusal, because it passed `username: ''` along;
 * the browser's add-form posts only the descriptor's fields, so it was refused
 * the same way. A card that could be offered and not added.
 *
 * The rule this file holds: THE DEMAND FOLLOWS THE DESCRIPTOR. A kind whose
 * fields include no `username` is not refused for lacking one — at the add
 * door and at the rotation door alike — and a kind whose fields do include it
 * is refused by name exactly as before. And WHICH export is checked by name
 * here too, because past this door the shared parser throws on an unknown
 * one, and a throw there is a 500 wearing the wrong sentence.
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ARCHIVE_PROVIDERS } from '@openmig/shared';

// The add door encrypts what it stores, even an empty credential record.
process.env.SECRET_ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

vi.mock('../middleware/auth.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth.ts')>();
  return {
    ...actual,
    authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { tenantId: 'a-tenant', userId: 'a-user', userRole: 'owner' });
      next();
    },
    // One archive row, for the rotation door to look up; the same array
    // answers the add door's insert, whose `.returning({ id })` it satisfies.
    withTenantDb: async () => [
      {
        id: 'conn-1',
        tenantId: 'a-tenant',
        role: 'source',
        kind: 'archive',
        displayName: 'x',
        config: { type: 'archive', provider: 'google-takeout', path: '/nowhere' },
        secretRef: '{}',
      },
    ],
    getDbPool: () => ({}),
  };
});

// Past the shape check the door probes. An archive's probe opens a folder and
// touches no network, but a stub keeps this file about the DOOR and not about
// what `/nowhere` looks like on the machine running it.
vi.mock('@openmig/orchestration/probe-connection', () => ({
  probeSourceConnection: async () => ({ ok: false, reason: 'probe stubbed' }),
  probeTargetConnection: async () => ({ ok: false, reason: 'probe stubbed' }),
}));

const { default: connectionRoutes } = await import('./connections.ts');

const app = express();
app.use(express.json());
app.use('/api/connections', connectionRoutes);

/** The archive body exactly as the managed gate posts it: no username. */
const ARCHIVE = {
  role: 'source',
  type: 'archive',
  displayName: 'gate: takeout fixture',
  values: { provider: 'google-takeout', path: '/nowhere' },
};

describe('POST /api/connections — the add door', () => {
  it('adds an archive from its descriptor fields alone, asking for no username', async () => {
    const res = await request(app).post('/api/connections').send(ARCHIVE);
    expect(
      res.body.fields ?? [],
      'the door demanded a username of a kind whose descriptor has none — the exact 400 the ' +
        'managed gate met in E2E #154',
    ).not.toContain('username');
    expect(res.body.error).not.toBe('invalid_values');
    // Past the shape: probed (stubbed), stored, answered as created.
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('still refuses an account kind without one, by name — the descriptor decides', async () => {
    // The control. `imap` carries `username` in its descriptor, so the SAME
    // omission is refused before anything is probed, exactly as before.
    const res = await request(app)
      .post('/api/connections')
      .send({
        role: 'source',
        type: 'imap',
        displayName: 'no name',
        values: { host: 'mail.example.invalid', port: '993', password: 'x' },
      });
    expect(res.status).toBe(400);
    expect(res.body.fields).toContain('username');
  });

  it('refuses an export it does not read by name, before the parser can throw on it', async () => {
    const res = await request(app)
      .post('/api/connections')
      .send({ ...ARCHIVE, values: { ...ARCHIVE.values, provider: 'google-photos' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_values');
    expect(res.body.fields).toEqual(['provider']);
    for (const p of ARCHIVE_PROVIDERS) expect(res.body.reason).toContain(p);
  });
});

describe('PUT /api/connections/:id/credentials — the rotation door', () => {
  it('takes an archive row through its shape check without a username too', async () => {
    const res = await request(app)
      .put('/api/connections/conn-1/credentials')
      .send({ values: { provider: 'google-takeout', path: '/nowhere' } });
    expect(res.body.fields ?? []).not.toContain('username');
    expect(res.body.error).not.toBe('invalid_values');
    // The stubbed probe says no, so nothing is rotated — and that answer is
    // a 200 with `rotated: false`, which is the door working.
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.rotated).toBe(false);
  });
});
