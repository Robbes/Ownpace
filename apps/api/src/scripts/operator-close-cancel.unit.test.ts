// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CLOSE CANCELS ON PG-BOSS FROM THE HOST (workplan 0167 T7).
 *
 * `operator.sh close` runs operator.ts on the host with `.env` exported, and
 * `JOBS_DATABASE_URL` is composed only in `managed.yml`, for the containers.
 * So on pg-boss the close's `cancelRun` had no URL, and cancelled nothing: it
 * refused every pass, and the close left them to the erasure's quiesce. The
 * close now hands `cancelRun` an environment whose `JOBS_DATABASE_URL` is
 * composed as `operator.sh jobs` composes it.
 */

import { describe, it, expect } from 'vitest';
import { cancelEnvForTheClose } from './operator-close.ts';
import { jobsConnectionString } from './operator-jobs.ts';
import { TRIGGER_REMOVED } from '../job-runner.ts';

const OWNER = 'postgresql://openmigrate:owner-pw@localhost:55432/openmigrate';

describe('cancelEnvForTheClose', () => {
  it('on pg-boss, composes JOBS_DATABASE_URL as the jobs role from the host .env', async () => {
    const env = await cancelEnvForTheClose(
      { OWNPACE_JOB_RUNNER: 'pg-boss', DATABASE_URL: OWNER, JOBS_DB_PASSWORD: 'jobs-pw' },
      async () => jobsConnectionString,
    );
    const url = new URL(env.JOBS_DATABASE_URL!);
    expect(url.username).toBe('ownpace_jobs');
    expect(url.password).toBe('jobs-pw');
    expect(url.host).toBe('localhost:55432');
    // The owner's URL is not changed, and is not what the cancel connects on.
    expect(env.DATABASE_URL).toBe(OWNER);
  });

  it('on pg-boss, keeps a JOBS_DATABASE_URL that is given, as the jobs role', async () => {
    const given = 'postgresql://ownpace_jobs:x@pgbouncer:6432/openmigrate';
    const env = await cancelEnvForTheClose({ OWNPACE_JOB_RUNNER: 'pg-boss', JOBS_DATABASE_URL: given }, async () => jobsConnectionString);
    expect(env.JOBS_DATABASE_URL).toBe(given);
  });

  it('on pg-boss without a way to compose it, adds nothing, so cancelRun refuses in its own sentence', async () => {
    const env = await cancelEnvForTheClose({ OWNPACE_JOB_RUNNER: 'pg-boss', DATABASE_URL: OWNER }, async () => jobsConnectionString);
    expect(env.JOBS_DATABASE_URL).toBeUndefined();
  });

  it.each([[{}], [{ OWNPACE_JOB_RUNNER: '' }]])('unset or empty (%j) is pg-boss: the URL is composed', async (mode) => {
    const env = await cancelEnvForTheClose(
      { ...mode, DATABASE_URL: OWNER, JOBS_DB_PASSWORD: 'jobs-pw' },
      async () => jobsConnectionString,
    );
    expect(new URL(env.JOBS_DATABASE_URL!).username).toBe('ownpace_jobs');
  });

  it('trigger, from an old .env, is refused in its own sentence before operator-jobs.ts is loaded (0167 T9)', async () => {
    let loaded = false;
    await expect(
      cancelEnvForTheClose({ OWNPACE_JOB_RUNNER: 'trigger', DATABASE_URL: OWNER }, async () => {
        loaded = true;
        return jobsConnectionString;
      }),
    ).rejects.toThrow(TRIGGER_REMOVED);
    expect(loaded).toBe(false);
  });

  it('refuses any other value, as the API does', async () => {
    await expect(cancelEnvForTheClose({ OWNPACE_JOB_RUNNER: 'both' })).rejects.toThrow(/may only be "pg-boss"/);
  });
});
