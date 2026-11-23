// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A TICK THAT NEVER SAID IT RAN (workplan 0142 T2): the route that says so.
 *
 * `GET /api/ready/scheduler` answers `{ "scheduler": "up" | "down" | "off" }`
 * and nothing else, by the rule `/api/ready` follows: a status page reads it
 * without a credential, so the reason goes to the log. The beat's own reading
 * (`readTickBeat`) is proved against the database in `@openmig/managed`; here
 * it is stubbed, and the route is called through Express.
 *
 * - no orchestrator configured answers `off`, and reads nothing: no
 *   `JOBS_DATABASE_URL` (0167 T6; pg-boss is the only runner since alpha.18
 *   removed Trigger.dev, 0167 T9, and an old switch that says `trigger` is
 *   refused, as any value but `pg-boss` is);
 * - the beat's answer is the body's one field;
 * - a read that fails answers `down`, logs why, and says nothing of it.
 *
 * It fails today: the route does not exist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { log } from '@openmig/shared';

const readTickBeat = vi.fn();
vi.mock('@openmig/managed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openmig/managed')>()),
  readTickBeat: (...args: unknown[]) => readTickBeat(...args),
}));

const { default: readyRoutes, __setPoolForTests } = await import('./ready.ts');

const app = express();
app.use('/api/ready', readyRoutes);

let runner: string | undefined;
let jobsUrl: string | undefined;

beforeEach(() => {
  runner = process.env.OWNPACE_JOB_RUNNER;
  jobsUrl = process.env.JOBS_DATABASE_URL;
  delete process.env.OWNPACE_JOB_RUNNER;
  process.env.JOBS_DATABASE_URL = 'postgres://ownpace_jobs@pgbouncer:6432/ownpace';
  // Never connected: the beat's reader is stubbed.
  __setPoolForTests(new Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' }));
  readTickBeat.mockReset();
});

afterEach(() => {
  if (runner === undefined) delete process.env.OWNPACE_JOB_RUNNER;
  else process.env.OWNPACE_JOB_RUNNER = runner;
  if (jobsUrl === undefined) delete process.env.JOBS_DATABASE_URL;
  else process.env.JOBS_DATABASE_URL = jobsUrl;
  __setPoolForTests(null);
  vi.restoreAllMocks();
});

describe('GET /api/ready/scheduler', () => {
  it('says up when the tick beat lately, in one field', async () => {
    readTickBeat.mockResolvedValue('up');
    const res = await request(app).get('/api/ready/scheduler');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scheduler: 'up' });
  });

  it('says down when it did not', async () => {
    readTickBeat.mockResolvedValue('down');
    const res = await request(app).get('/api/ready/scheduler');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scheduler: 'down' });
  });

  it('says off, and reads nothing, where no orchestrator is configured', async () => {
    delete process.env.JOBS_DATABASE_URL;
    const res = await request(app).get('/api/ready/scheduler');
    expect(res.body).toEqual({ scheduler: 'off' });
    expect(readTickBeat).not.toHaveBeenCalled();
  });

  describe('on the switch (0167 T6)', () => {
    it('on pg-boss, with JOBS_DATABASE_URL: reads the shared beat', async () => {
      process.env.OWNPACE_JOB_RUNNER = 'pg-boss';
      readTickBeat.mockResolvedValue('up');
      const res = await request(app).get('/api/ready/scheduler');
      expect(res.body).toEqual({ scheduler: 'up' });
      expect(readTickBeat).toHaveBeenCalledTimes(1);
      // The shared beat, `managed-sync-tick`, which Gatus's row reads: no task named.
      expect(readTickBeat.mock.calls[0]).toHaveLength(2);
    });

    it('on pg-boss without JOBS_DATABASE_URL: off', async () => {
      process.env.OWNPACE_JOB_RUNNER = 'pg-boss';
      delete process.env.JOBS_DATABASE_URL;
      const res = await request(app).get('/api/ready/scheduler');
      expect(res.body).toEqual({ scheduler: 'off' });
      expect(readTickBeat).not.toHaveBeenCalled();
    });

    it('an old switch that says trigger: down, the alpha.18 sentence in the log only, and nothing read (0167 T9)', async () => {
      const logged = vi.spyOn(log, 'error').mockImplementation(() => {});
      process.env.OWNPACE_JOB_RUNNER = 'trigger';
      const res = await request(app).get('/api/ready/scheduler');
      expect(res.body).toEqual({ scheduler: 'down' });
      expect(readTickBeat).not.toHaveBeenCalled();
      expect(String(logged.mock.calls[0]?.[1])).toContain('Trigger.dev was removed in alpha.18');
    });

    it('a switch it may not hold: down, the sentence in the log only, and nothing read', async () => {
      const logged = vi.spyOn(log, 'error').mockImplementation(() => {});
      process.env.OWNPACE_JOB_RUNNER = 'pgboss';
      const res = await request(app).get('/api/ready/scheduler');
      expect(res.body).toEqual({ scheduler: 'down' });
      expect(readTickBeat).not.toHaveBeenCalled();
      expect(String(logged.mock.calls[0]?.[1])).toContain('may only be "pg-boss"');
    });
  });

  it('says down when the beat cannot be read, and the reason goes to the log only', async () => {
    const logged = vi.spyOn(log, 'error').mockImplementation(() => {});
    readTickBeat.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:5432'));
    const res = await request(app).get('/api/ready/scheduler');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scheduler: 'down' });
    expect(JSON.stringify(res.body)).not.toContain('db.internal');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]?.[1])).toContain('db.internal');
  });

  it('leaves /api/ready as it was', async () => {
    readTickBeat.mockResolvedValue('down');
    const res = await request(app).get('/api/ready');
    // The readiness answer does not grow a field: a stopped tick does not stop
    // this service serving a customer.
    expect(Object.keys(res.body).sort()).toEqual(['database', 'signIn', 'status']);
    expect(readTickBeat).not.toHaveBeenCalled();
  });
});
