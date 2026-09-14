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

import { describe, it, expect } from 'vitest';
import {
  resolveMeasurementCredentials,
  type MeasurementEnv,
} from './drive-export-credentials.ts';

const APPLIANCE: MeasurementEnv = {
  GOOGLE_CLIENT_ID: 'appliance-id',
  GOOGLE_CLIENT_SECRET: 'appliance-secret',
  GOOGLE_REFRESH_TOKEN: 'appliance-token',
};

const MANAGED: MeasurementEnv = {
  GOOGLE_OAUTH_CLIENT_ID: 'deployment-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'deployment-secret',
  DRIVE_CONNECTION_ID: 'conn-1',
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
