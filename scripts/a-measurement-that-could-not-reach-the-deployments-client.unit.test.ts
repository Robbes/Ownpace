// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MEASUREMENT THAT CANNOT READ THE CREDENTIALS ITS OWN DEPLOYMENT HOLDS
 * WILL NOT BE RUN, AND THE DECISION IT GATES STAYS OPEN.
 *
 * Found by the owner on 2026-09-14, asking the obvious question: "why do you
 * need the Google client id and secret, the app already has those?" It did.
 * `drive-export-stability.ts` read `GOOGLE_CLIENT_ID` straight off
 * `process.env` — the appliance's name — while the managed deployment holds
 * the same pair under `GOOGLE_OAUTH_CLIENT_ID`, and holds the refresh token
 * encrypted on a connection rather than in the environment at all.
 *
 * So the one measurement gating workplan 0042 T0 Q3 could not be run by the
 * person whose Drive it needed, on the deployment that already held every
 * value, and the workaround was reading a secret out of the database by hand.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveMeasurementCredentials,
  type MeasurementEnv,
} from './drive-export-credentials.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const APPLIANCE: MeasurementEnv = {
  GOOGLE_CLIENT_ID: 'appliance-id',
  GOOGLE_CLIENT_SECRET: 'appliance-secret',
  GOOGLE_REFRESH_TOKEN: 'appliance-token',
};

const MANAGED: MeasurementEnv = {
  GOOGLE_OAUTH_CLIENT_ID: 'deployment-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'deployment-secret',
  DRIVE_CONNECTION_ID: 'conn-1',
  DATABASE_URL: 'postgresql://openmigrate@localhost:55432/openmigrate',
};

describe('the managed deployment already has the client', () => {
  it('takes the pair from GOOGLE_OAUTH_* and the token from a connection', () => {
    // THE HEADLINE. Nothing here is typed by a person: the pair is the one the
    // app already uses for Connect with Google, and the token is named by the
    // row that holds it.
    expect(resolveMeasurementCredentials(MANAGED)).toEqual({
      route: 'connection',
      clientId: 'deployment-id',
      clientSecret: 'deployment-secret',
      connectionId: 'conn-1',
    });
  });

  it('never carries a secret value on the connection route', () => {
    const resolved = resolveMeasurementCredentials(MANAGED);
    // The client secret is a deployment-wide value the operator set; a
    // REFRESH TOKEN is a customer's grant, and this must never hold one.
    expect(JSON.stringify(resolved)).not.toContain('refreshToken');
  });
});

describe('the appliance keeps working exactly as it did', () => {
  it('takes all three from the environment', () => {
    expect(resolveMeasurementCredentials(APPLIANCE)).toEqual({
      route: 'env',
      clientId: 'appliance-id',
      clientSecret: 'appliance-secret',
      refreshToken: 'appliance-token',
    });
  });

  it('lets an explicit pair override the deployment client', () => {
    // Measuring a Drive against an application that is NOT the deployment's is
    // a thing an operator may need — comparing two clients, or a Drive with no
    // connection row yet — so the explicit names win where both are present.
    const both = { ...MANAGED, ...APPLIANCE };
    expect(resolveMeasurementCredentials(both)).toMatchObject({
      route: 'env',
      clientId: 'appliance-id',
    });
  });

  it('prefers an explicit refresh token over a connection id', () => {
    const both: MeasurementEnv = { ...MANAGED, GOOGLE_REFRESH_TOKEN: 'explicit' };
    expect(resolveMeasurementCredentials(both)).toMatchObject({ route: 'env' });
  });
});

describe('half a pair is refused, never completed', () => {
  it.each([
    ['GOOGLE_CLIENT_SECRET', { GOOGLE_CLIENT_ID: 'only-id' }],
    ['GOOGLE_CLIENT_ID', { GOOGLE_CLIENT_SECRET: 'only-secret' }],
  ])('refuses when %s is missing, rather than falling back', (missing, half) => {
    // The hazard: silently completing the pair from the deployment's client
    // would run the measurement against a DIFFERENT Google application than the
    // operator named, and the entire output of this script is a verdict about
    // one application's export behaviour.
    const resolved = resolveMeasurementCredentials({ ...MANAGED, ...half });
    expect(resolved.route).toBe('refuse');
    if (resolved.route !== 'refuse') throw new Error('unreachable');
    expect(resolved.reason).toContain(missing);
    expect(resolved.reason).not.toContain('deployment-secret');
  });
});

describe('a refusal names a remedy the operator can actually apply', () => {
  it('names BOTH editions when there is no client at all', () => {
    const resolved = resolveMeasurementCredentials({ DRIVE_CONNECTION_ID: 'conn-1' });
    expect(resolved.route).toBe('refuse');
    if (resolved.route !== 'refuse') throw new Error('unreachable');
    // Rule 9, and the reason `GoogleCredentialNaming` exists: a fix the
    // operator cannot apply is not one. The script runs in both editions, so
    // it cannot know which set of names its reader has.
    expect(resolved.reason).toContain('GOOGLE_OAUTH_CLIENT_ID');
    expect(resolved.reason).toContain('GOOGLE_CLIENT_ID');
  });

  it('names both ways to a Google account when neither is given', () => {
    const resolved = resolveMeasurementCredentials({
      GOOGLE_OAUTH_CLIENT_ID: 'deployment-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'deployment-secret',
    });
    expect(resolved.route).toBe('refuse');
    if (resolved.route !== 'refuse') throw new Error('unreachable');
    expect(resolved.reason).toContain('DRIVE_CONNECTION_ID');
    expect(resolved.reason).toContain('GOOGLE_REFRESH_TOKEN');
  });

  it('reports a half-configured DEPLOYMENT pair as the half it is', () => {
    const resolved = resolveMeasurementCredentials({
      GOOGLE_OAUTH_CLIENT_ID: 'deployment-id',
      DRIVE_CONNECTION_ID: 'conn-1',
    });
    expect(resolved.route).toBe('refuse');
    if (resolved.route !== 'refuse') throw new Error('unreachable');
    expect(resolved.reason).toContain('GOOGLE_OAUTH_CLIENT_SECRET');
  });
});

/**
 * ...AND THEN IT COST THREE COMMANDS ANYWAY.
 *
 * Reported by the owner 2026-09-17. The resolver above was right — the managed
 * route works and reads nothing by hand — but the SENTENCE it refuses with only
 * said which variables to set, and stopped there. So all three measurements
 * died on the same line:
 *
 *   ✖ This needs a Google OAuth client and there is none. On a managed
 *     deployment set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET …
 *
 * and the two facts that would have ended it in one were nowhere in it: the
 * pair is ALREADY SET, in `deploy/compose/.env`, on the machine reading the
 * refusal — and this script reads the environment and never that file. Rule 9
 * again, one turn further in: a remedy the operator can apply is not the same
 * as a remedy that says where the value already is.
 *
 * `docs/google-workspace-setup.md` had said both since the managed route was
 * built. Nobody reaching a refusal in a terminal is reading a guide.
 */
describe('the refusal says the values are already on the box, and where', () => {
  it('names the file that holds the pair, and that this script does not read it', () => {
    const resolved = resolveMeasurementCredentials({ DRIVE_CONNECTION_ID: 'conn-1' });
    expect(resolved.route).toBe('refuse');
    if (resolved.route !== 'refuse') throw new Error('unreachable');
    // THE HEADLINE, in three parts: where the pair is, that this does not read
    // it, and the one line that fixes it.
    // Asserted as the CLAIM, not as the path: `deploy/compose/.env` alone is
    // also in the shell line below, so a location sentence that went missing
    // would still have found the string and this would have proved nothing.
    expect(resolved.reason).toContain('are in deploy/compose/.env');
    expect(resolved.reason).toContain('never reads that file');
    expect(resolved.reason).toContain('set -a; . deploy/compose/.env; set +a');
  });

  it('still tells an appliance there is no such file to load', () => {
    // The script runs in both editions and cannot know which reader it has, so
    // the managed half must not read as an instruction to an appliance operator
    // who has no compose directory at all.
    const resolved = resolveMeasurementCredentials({ DRIVE_CONNECTION_ID: 'conn-1' });
    if (resolved.route !== 'refuse') throw new Error('unreachable');
    expect(resolved.reason).toContain('no such file');
    expect(resolved.reason).toContain('GOOGLE_CLIENT_ID');
  });

  it('refuses a connection route with no database, naming the derivation', () => {
    // The third thing, and the one LOADING THE FILE DOES NOT GIVE YOU: the
    // stack's own DATABASE_URL names `pgbouncer:6432`, which does not resolve
    // from the host, and `deploy/compose/.env` carries no host-usable one. Left
    // alone this reached `new Pool(undefined)` and came back as libpq's
    // default-socket error naming a user nobody set.
    const { DATABASE_URL: _dropped, ...noDatabase } = MANAGED;
    const resolved = resolveMeasurementCredentials(noDatabase);
    expect(resolved.route).toBe('refuse');
    if (resolved.route !== 'refuse') throw new Error('unreachable');
    expect(resolved.reason).toContain('DATABASE_URL');
    expect(resolved.reason).toContain('port postgres 5432');
    // And the way out that needs no database at all.
    expect(resolved.reason).toContain('GOOGLE_REFRESH_TOKEN');
  });

  it('does not ask an appliance for a database it never reads', () => {
    // The `env` route resolves the token itself, so a missing DATABASE_URL is
    // not a defect there and must not be reported as one.
    expect(resolveMeasurementCredentials(APPLIANCE)).toMatchObject({ route: 'env' });
  });
});

/**
 * ...AND THEN THE REFUSAL ITSELF CRASHED.
 *
 * Reported by the owner 2026-09-15, running the managed route for the first
 * time. Every environment refusal above — the ones this whole file exists to
 * get right — died before printing:
 *
 *   ReferenceError: Cannot access 'recorder' before initialization
 *       at writeCapture (scripts/drive-export-stability.ts:373:3)
 *       at fail (scripts/drive-export-stability.ts:113:3)
 *
 * `fail()` writes a partial capture first, deliberately, so a refusal from
 * inside `main()` still leaves the recording. But `fail()` is ALSO how the
 * module refuses a bad environment, and that runs at import time — above the
 * `const`s `writeCapture` reads. A `const` read before its line has run does
 * not answer `undefined`; it throws.
 *
 * So the operator asking for help got a stack trace naming a line they had
 * nothing to do with, instead of the sentence naming the variable they were
 * missing. Both of this module's import-time refusals had it, and neither
 * could be reached by a unit test of `resolveMeasurementCredentials` — the
 * resolver was right the whole time. It has to be RUN.
 */
describe('an environment refusal prints its sentence, rather than crashing on the recorder', () => {
  const made: string[] = [];
  afterAll(() => {
    for (const d of made) rmSync(d, { recursive: true, force: true });
  });

  /** The real script, in a process, with a clean environment. No network. */
  function run(extra: Record<string, string>): { out: string; code: number } {
    const env = { ...process.env, ...extra };
    // A developer's own shell may carry these; the case decides what is set.
    for (const k of [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'DRIVE_CONNECTION_ID',
      'DRIVE_EXPORT_POLICY',
      'DRIVE_EXPORT_SAMPLES',
      'DRIVE_CAPTURE_FILE',
      'DATABASE_URL',
    ]) {
      if (!(k in extra)) delete env[k];
    }
    const r = spawnSync('pnpm', ['exec', 'tsx', join(HERE, 'drive-export-stability.ts')], {
      encoding: 'utf8',
      env,
      cwd: join(HERE, '..'),
    });
    return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? -1 };
  }

  it('says which variables are missing, with no credentials at all', () => {
    const { out, code } = run({});
    // THE HEADLINE: the sentence, not a stack.
    expect(out).toContain('GOOGLE_OAUTH_CLIENT_ID');
    expect(out).toContain('GOOGLE_CLIENT_ID');
    expect(out).not.toContain('ReferenceError');
    // Said on its own, because this is the exact wording the crash replaced and
    // it deserves its own line when it comes back.
    expect(out).not.toContain('before initialization');
    // The exit code was ALREADY 1 while it was crashing — an uncaught throw
    // exits 1 too. Asserting only on the code would have passed on the bug.
    expect(code).toBe(1);
  });

  it('refuses a single sample, which would turn every policy green', () => {
    // The third import-time refusal, added when two draws turned out to be too
    // few (see two-draws-that-could-agree-by-accident.unit.test.ts). One export
    // cannot disagree with anything, so SAMPLES=1 is a switch that reports
    // STABLE over a renderer nobody measured.
    const { out, code } = run({
      GOOGLE_OAUTH_CLIENT_ID: 'sentinel-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'sentinel-secret',
      DRIVE_CONNECTION_ID: 'sentinel-connection',
      // Never connected to: every refusal below is reached before the pool is
      // built. It is here because the credential resolver now refuses a
      // connection route with no database, and that refusal would otherwise
      // pre-empt the one this case is about.
      DATABASE_URL: 'postgresql://sentinel@localhost:1/sentinel',
      DRIVE_EXPORT_SAMPLES: '1',
    });
    expect(out).toContain('DRIVE_EXPORT_SAMPLES');
    expect(out).not.toContain('ReferenceError');
    expect(code).toBe(1);
  });

  it('refuses an unknown export policy, even with a capture requested', () => {
    // The second import-time refusal, and the interesting interaction: asking
    // for a recording is what BUILDS the recorder, so a refusal that comes
    // before it exists is where the two eras of this module meet.
    const dir = mkdtempSync(join(tmpdir(), 'drive-capture-'));
    made.push(dir);
    const capture = join(dir, 'capture.json');
    const { out, code } = run({
      GOOGLE_OAUTH_CLIENT_ID: 'sentinel-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'sentinel-secret',
      DRIVE_CONNECTION_ID: 'sentinel-connection',
      // Never connected to: every refusal below is reached before the pool is
      // built. It is here because the credential resolver now refuses a
      // connection route with no database, and that refusal would otherwise
      // pre-empt the one this case is about.
      DATABASE_URL: 'postgresql://sentinel@localhost:1/sentinel',
      DRIVE_EXPORT_POLICY: 'nonsense',
      DRIVE_CAPTURE_FILE: capture,
    });
    expect(out).toContain('DRIVE_EXPORT_POLICY');
    expect(out).toContain('export-odf');
    expect(out).not.toContain('ReferenceError');
    expect(code).toBe(1);
    // Nothing was recorded, so nothing is written — and in particular no empty
    // file that a later replay would read as "Drive answered nothing".
    expect(existsSync(capture)).toBe(false);
  });
});
