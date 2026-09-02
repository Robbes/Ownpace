// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import providerClientRoutes from './provider-clients.ts';

const app = express();
app.use('/api/provider-clients', providerClientRoutes);

afterEach(() => {
  for (const k of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'DROPBOX_OAUTH_CLIENT_ID', 'DROPBOX_OAUTH_CLIENT_SECRET']) {
    delete process.env[k];
  }
});

describe('GET /api/provider-clients', () => {
  it('reads the environment at the moment it is asked, one fact per provider, never a value', async () => {
    let res = await request(app).get('/api/provider-clients');
    expect(res.body).toEqual({ google: 'connection', dropbox: 'connection' });
    process.env.DROPBOX_OAUTH_CLIENT_ID = 'dbx-key';
    process.env.DROPBOX_OAUTH_CLIENT_SECRET = 'dbx-secret';
    res = await request(app).get('/api/provider-clients');
    expect(res.body).toEqual({ google: 'connection', dropbox: 'deployment' });
    expect(res.text).not.toContain('dbx-');
  });
});
