// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE CLIENT NOBODY SHOULD HAVE TO PASTE — and the row it must never reach.
 *
 * Every Google source demanded three things: a client id, a client secret and
 * a refresh token. Only the third is per-account; the first two are the
 * deployment's own registered application, identical on every connection on
 * the box, and typing them into a wizard is transcription work with a secret
 * in it.
 *
 * Two properties carry the whole design and both are asserted here.
 *
 * **A connection's own values always win.** ADR-0041's point is that owning a
 * Google client is a real choice; a deployment-wide default that replaced
 * somebody's own would take it away silently, and they would find out when a
 * consent screen showed the wrong application name.
 *
 * **It is never handed to a non-Google connection.** `clientId` and
 * `clientSecret` are SHARED KEY NAMES — Dropbox stores its App key and App
 * secret under exactly those (`STORED_DROPBOX_CREDENTIAL_NAMES`), and Box its
 * own client pair. A fallback that filled in whatever was missing would give a
 * Dropbox row Google's application credentials, and the failure would arrive
 * at Dropbox naming nothing useful.
 */

import { describe, it, expect } from 'vitest';
import {
  googleDeploymentClient,
  googleDeploymentClientProblem,
  withDeploymentGoogleClient,
} from './google-deployment-client.ts';

const CONFIGURED = {
  GOOGLE_OAUTH_CLIENT_ID: 'deployment.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'deployment-secret',
};

describe('the client a deployment configured', () => {
  it('is the pair when both are set', () => {
    expect(googleDeploymentClient(CONFIGURED)).toEqual({
      clientId: 'deployment.apps.googleusercontent.com',
      clientSecret: 'deployment-secret',
    });
  });

  it('is null when neither is, which is the ordinary case', () => {
    expect(googleDeploymentClient({})).toBeNull();
    expect(googleDeploymentClientProblem({})).toBeNull();
  });

  it('is null for HALF a pair, and says which half is missing', () => {
    // A client id without its secret cannot exchange an authorization code.
    // Returning half would turn a typo into a failure at Google's token
    // endpoint hours later, with nothing on this side to explain it.
    expect(googleDeploymentClient({ GOOGLE_OAUTH_CLIENT_ID: 'x' })).toBeNull();
    expect(googleDeploymentClient({ GOOGLE_OAUTH_CLIENT_SECRET: 'y' })).toBeNull();

    const noSecret = googleDeploymentClientProblem({ GOOGLE_OAUTH_CLIENT_ID: 'x' });
    expect(noSecret).toContain('GOOGLE_OAUTH_CLIENT_SECRET');
    expect(noSecret, 'and the remedy, not just the diagnosis').toContain('restart the API');
    expect(googleDeploymentClientProblem({ GOOGLE_OAUTH_CLIENT_SECRET: 'y' })).toContain(
      'GOOGLE_OAUTH_CLIENT_ID',
    );
  });

  it('never prints either value, because one of them is a secret', () => {
    const said = googleDeploymentClientProblem({ GOOGLE_OAUTH_CLIENT_SECRET: 'the-secret' }) ?? '';
    expect(said).not.toContain('the-secret');
  });

  it('treats blank and whitespace as unset', () => {
    // An operator who cleared a value meant to clear it. `GOOGLE_OAUTH_CLIENT_ID=`
    // in a .env is the normal way to say "not this deployment".
    expect(googleDeploymentClient({ GOOGLE_OAUTH_CLIENT_ID: '  ', GOOGLE_OAUTH_CLIENT_SECRET: '' })).toBeNull();
    expect(googleDeploymentClientProblem({ GOOGLE_OAUTH_CLIENT_ID: '   ' })).toBeNull();
  });
});

describe('filling it in, and refusing to', () => {
  it('fills a Google connection that carries neither', () => {
    expect(withDeploymentGoogleClient(true, { refreshToken: 'rt' }, CONFIGURED)).toEqual({
      refreshToken: 'rt',
      clientId: 'deployment.apps.googleusercontent.com',
      clientSecret: 'deployment-secret',
    });
  });

  it("NEVER overrides the connection's own — ADR-0041 is a choice, not a default", () => {
    const own = { clientId: 'theirs.apps.googleusercontent.com', clientSecret: 'theirs', refreshToken: 'rt' };
    expect(withDeploymentGoogleClient(true, own, CONFIGURED)).toEqual(own);
  });

  it('fills only the half that is missing', () => {
    // Not a shape anybody should reach, and if they do, the honest answer is
    // to complete the pair rather than to replace the value they typed.
    const half = { clientId: 'theirs.apps.googleusercontent.com', refreshToken: 'rt' };
    expect(withDeploymentGoogleClient(true, half, CONFIGURED)).toEqual({
      ...half,
      clientSecret: 'deployment-secret',
    });
  });

  it('GIVES A NON-GOOGLE CONNECTION NOTHING, which is the one that would hurt', () => {
    // Dropbox's App key and App secret ride `clientId`/`clientSecret`. A
    // Dropbox row missing them must stay missing them and refuse in Dropbox's
    // own words — not carry a Google application to Dropbox's token endpoint.
    const dropbox = { refreshToken: 'rt' };
    expect(withDeploymentGoogleClient(false, dropbox, CONFIGURED)).toEqual(dropbox);
  });

  it('changes nothing when the deployment configured no client', () => {
    const bare = { refreshToken: 'rt' };
    expect(withDeploymentGoogleClient(true, bare, {})).toEqual(bare);
    expect(withDeploymentGoogleClient(true, bare, { GOOGLE_OAUTH_CLIENT_ID: 'x' })).toEqual(bare);
  });

  it('does not mutate what it was given', () => {
    // The credentials object is read again by the caller in at least one path;
    // a function that edited it in place would make the layering unprovable.
    const given = { refreshToken: 'rt' };
    withDeploymentGoogleClient(true, given, CONFIGURED);
    expect(given).toEqual({ refreshToken: 'rt' });
  });
});
