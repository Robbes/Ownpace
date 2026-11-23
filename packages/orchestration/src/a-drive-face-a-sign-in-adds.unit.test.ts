// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A DRIVE FACE A SIGN-IN ADDS (workplan 0160 T5; ADR-0052).
 *
 * A `cirrux` account's file face is Cirrux Drive, reached through a person's
 * OAuth sign-in stored beside the app password. It used to be a measured no
 * for every account ("this service has no such app yet"). It now answers by
 * what is true, in this order:
 *
 * - the deployment has NO CIRRUX CLIENT: a measured no that says so, and the
 *   build seam refuses a pass by name;
 * - the account has NO DRIVE GRANT: a measured no, `notGranted`, naming the
 *   button that gives it; the build seam refuses by the same sentence;
 * - a grant is stored: measured through it, who and where and how much, or
 *   `unknown` with Cirrux's own words when it refuses.
 *
 * And the face is refused as a NEW destination's and taken as a connected
 * one's, at the pass's own question (`refuseDomainTheTargetCannotCarry`).
 */

import { describe, it, expect } from 'vitest';
import { CIRRUX_DRIVE_GRANT_KEY, classifyFailure, grantedTargetFacesOf, statedFailureCategoryOf } from '@openmig/shared';
import { qualifyCirruxDrive, type CirruxDriveReach } from './account-qualification.ts';
import { cirruxDriveDepsFor } from './build-deps-from-mapping.ts';
import { buildFileTargetFor, fileTargetProtocol } from './file-target-factory.ts';
import { refuseDomainTheTargetCannotCarry } from './pass-domain-refusal.ts';

const WITH_CLIENT = { CIRRUX_OAUTH_CLIENT_ID: 'ownpace-ota' };
const NO_CLIENT = { CIRRUX_OAUTH_CLIENT_ID: '' };
const APP_PASSWORD = { username: 'anna@example.com', password: 'app-password' };
const GRANTED = { ...APP_PASSWORD, [CIRRUX_DRIVE_GRANT_KEY]: 'rt-stored' };

function reach(over: Partial<CirruxDriveReach> = {}): () => CirruxDriveReach {
  return () => ({
    profile: async () => ({ user: { username: 'anna' }, workspace: { name: 'Family' } }),
    listFolder: async () => ({ folders: [{ uuid: 'f1', name: 'Photos' }, { uuid: 'f2', name: 'Taxes' }], files: [{ uuid: 'a', name: 'notes.txt' }] }),
    storage: async () => ({ used_bytes: 12_000_000_000, pool_bytes: 20_000_000_000 }),
    ...over,
  });
}

describe('what the face answers', () => {
  it('without a Cirrux client on this deployment: a measured no that says so', async () => {
    const face = await qualifyCirruxDrive(GRANTED, { env: NO_CLIENT, cirruxDrive: reach() });
    expect(face).toMatchObject({ answer: 'no', reason: 'structural' });
    expect(face.detail).toContain('no Cirrux client on this deployment');
  });

  it('without a Drive grant on the account: a measured no that names the button', async () => {
    const face = await qualifyCirruxDrive(APP_PASSWORD, { env: WITH_CLIENT, cirruxDrive: reach() });
    expect(face).toMatchObject({ answer: 'no', reason: 'notGranted' });
    expect(face.detail).toContain('Connect Cirrux Drive');
  });

  it('with a grant: measured, who signed in and where, the top of the Drive and the pool', async () => {
    const face = await qualifyCirruxDrive(GRANTED, { env: WITH_CLIENT, cirruxDrive: reach() });
    expect(face).toEqual({
      answer: 'yes',
      detail: 'Cirrux Drive connected as anna, in the workspace Family: 3 items at the top level.',
      count: 2,
      unit: 'folder',
      volume: { bytes: 12_000_000_000 },
    });
  });

  it('a refusal is not a no: unknown, with Cirrux’s words', async () => {
    const face = await qualifyCirruxDrive(GRANTED, {
      env: WITH_CLIENT,
      cirruxDrive: reach({
        profile: async () => {
          throw new Error('Cirrux no longer accepts this account’s Drive sign-in');
        },
      }),
    });
    expect(face).toMatchObject({ answer: 'unknown', reason: 'refused' });
    expect(face.detail).toContain('no longer accepts');
  });

  it('a pool that cannot be read costs the measure, not the face', async () => {
    const face = await qualifyCirruxDrive(GRANTED, {
      env: WITH_CLIENT,
      cirruxDrive: reach({
        storage: async () => {
          throw new Error('insufficient_scope');
        },
      }),
    });
    expect(face.answer).toBe('yes');
    expect(face.volume?.failed).toContain('insufficient_scope');
  });
});

describe('the pass refuses by the same facts, before anything is built', () => {
  it('writes a cirrux account’s files over its Drive, never over WebDAV', () => {
    expect(fileTargetProtocol('cirrux')).toBe('cirrux-drive');
    expect(fileTargetProtocol('nextcloud')).toBe('webdav');
    expect(() => buildFileTargetFor('cirrux-drive', { url: '', username: '', password: '' }, {} as never)).toThrow(
      /wiring gap/,
    );
  });

  it('refuses without a client, naming the variable and where the worker gets it', () => {
    expect(() => cirruxDriveDepsFor({} as never, 't', { creds: GRANTED, id: 'c' }, NO_CLIENT)).toThrow(
      /CIRRUX_OAUTH_CLIENT_ID is not set for the worker[\s\S]*deploy\/compose\/\.env and bring the stack up again/,
    );
  });

  it('refuses without a grant, naming the button', () => {
    expect(() => cirruxDriveDepsFor({} as never, 't', { creds: APP_PASSWORD, id: 'c' }, WITH_CLIENT)).toThrow(
      /Connect Cirrux Drive/,
    );
  });

  it('builds with both, on the account’s own row', () => {
    const deps = cirruxDriveDepsFor({} as never, 'tenant-1', { creds: GRANTED, id: 'conn-1' }, WITH_CLIENT);
    expect(deps).toMatchObject({ clientId: 'ownpace-ota', row: { tenantId: 'tenant-1', connectionId: 'conn-1' } });
  });

  it('a file face needs the grant stored: refused without, taken with', () => {
    expect(grantedTargetFacesOf('cirrux', APP_PASSWORD)).toEqual([]);
    expect(grantedTargetFacesOf('cirrux', GRANTED)).toEqual(['file']);
    expect(grantedTargetFacesOf('nextcloud', GRANTED)).toEqual([]);
    expect(() => refuseDomainTheTargetCannotCarry('file', 'cirrux', grantedTargetFacesOf('cirrux', APP_PASSWORD))).toThrow(
      /no Cirrux Drive connected/,
    );
    expect(() => refuseDomainTheTargetCannotCarry('file', 'cirrux', grantedTargetFacesOf('cirrux', GRANTED))).not.toThrow();
  });

  it('a pass after Disconnect Cirrux Drive writes no file anywhere and says so, under auth_expired (workplan 0160)', () => {
    let thrown: unknown;
    try {
      refuseDomainTheTargetCannotCarry('file', 'cirrux', grantedTargetFacesOf('cirrux', APP_PASSWORD));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toBe(
      "This Cirrux account has no Cirrux Drive connected, so nothing was written for 'file', here or to any " +
        "other destination. On the Accounts page, press Connect Cirrux Drive on this account, and 'file' " +
        'carries on at the next pass.',
    );
    // Stated by the throw site, so the status row and the Accounts row name
    // the button: no rule reads this sentence of ours as an expired sign-in.
    expect(statedFailureCategoryOf(thrown)).toBe('auth_expired');
    expect(classifyFailure(message)).toBe('unknown');
    expect(classifyFailure(message, undefined, statedFailureCategoryOf(thrown))).toBe('auth_expired');
  });
});
