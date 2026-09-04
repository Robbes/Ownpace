// Copyright 2026 The Ownpace authors (Apache-2.0)

import { describe, it, expect } from 'vitest';
import {
  dropboxDeploymentClient,
  dropboxDeploymentClientProblem,
  halfDropboxClientPairProblem,
  resolveDropboxClient,
  withDeploymentDropboxClient,
} from './dropbox-deployment-client.ts';
import { providerClientFacts } from './provider-clients.ts';

const PAIR = { DROPBOX_OAUTH_CLIENT_ID: 'dbx-key', DROPBOX_OAUTH_CLIENT_SECRET: 'dbx-secret' };
const NONE = {};

describe("the Dropbox app a deployment configured (mirrors Google's module)", () => {
  it('is the pair when both are set, null when neither', () => {
    expect(dropboxDeploymentClient(PAIR)).toEqual({ clientId: 'dbx-key', clientSecret: 'dbx-secret' });
    expect(dropboxDeploymentClient(NONE)).toBeNull();
    expect(dropboxDeploymentClient({ DROPBOX_OAUTH_CLIENT_ID: '  ' })).toBeNull();
  });

  it('half a pair is null, and the problem names the missing half without printing a value', () => {
    const env = { DROPBOX_OAUTH_CLIENT_ID: 'dbx-key' };
    expect(dropboxDeploymentClient(env)).toBeNull();
    const problem = dropboxDeploymentClientProblem(env)!;
    expect(problem).toContain('DROPBOX_OAUTH_CLIENT_SECRET empty');
    expect(problem).not.toContain('dbx-key');
    expect(dropboxDeploymentClientProblem(PAIR)).toBeNull();
    expect(dropboxDeploymentClientProblem(NONE)).toBeNull();
  });
});

describe('filling it in, and refusing to', () => {
  it('fills a Dropbox connection that carries neither, and never a non-Dropbox one', () => {
    expect(withDeploymentDropboxClient(true, { refreshToken: 'rt' }, PAIR)).toEqual({
      refreshToken: 'rt',
      clientId: 'dbx-key',
      clientSecret: 'dbx-secret',
    });
    expect(withDeploymentDropboxClient(false, { refreshToken: 'rt' }, PAIR)).toEqual({ refreshToken: 'rt' });
  });

  it("never overrides the connection's own pair", () => {
    expect(
      withDeploymentDropboxClient(true, { clientId: 'own', clientSecret: 'own-s', refreshToken: 'rt' }, PAIR),
    ).toEqual({ clientId: 'own', clientSecret: 'own-s', refreshToken: 'rt' });
  });

  it('half a pair is refused where the deployment could complete it wrongly, and only there', () => {
    expect(halfDropboxClientPairProblem({ clientId: 'own' }, PAIR)).toContain('clientId was sent without clientSecret');
    expect(halfDropboxClientPairProblem({ clientSecret: 'own-s' }, PAIR)).toContain('clientSecret was sent without clientId');
    expect(halfDropboxClientPairProblem({ clientId: 'own' }, NONE)).toBeNull();
    expect(halfDropboxClientPairProblem({ clientId: 'own', clientSecret: 'own-s' }, PAIR)).toBeNull();
    expect(halfDropboxClientPairProblem({}, PAIR)).toBeNull();
  });
});

describe('the app a request may use', () => {
  it("the caller's whole pair, else the deployment's, else a refusal naming both ways forward", () => {
    expect(resolveDropboxClient({ clientId: 'own', clientSecret: 'own-s' }, PAIR)).toEqual({
      ok: true,
      clientId: 'own',
      clientSecret: 'own-s',
    });
    expect(resolveDropboxClient({}, PAIR)).toEqual({ ok: true, clientId: 'dbx-key', clientSecret: 'dbx-secret' });
    const none = resolveDropboxClient({}, NONE);
    expect(none).toMatchObject({ ok: false, error: 'no_dropbox_client' });
    expect((none as { reason: string }).reason).toContain('DROPBOX_OAUTH_CLIENT_ID');
    expect(resolveDropboxClient({ clientId: 'own' }, PAIR)).toMatchObject({ ok: false, error: 'half_client_pair' });
  });

  it('a half-configured deployment answers with its own sentence, not as one that configured nothing', () => {
    const r = resolveDropboxClient({}, { DROPBOX_OAUTH_CLIENT_SECRET: 's' });
    expect(r).toMatchObject({ ok: false, error: 'no_dropbox_client' });
    expect((r as { reason: string }).reason).toContain('DROPBOX_OAUTH_CLIENT_ID empty');
  });
});

describe('the provider-clients facts', () => {
  it('says which providers this deployment carries an application for, never the values', () => {
    // Every provider, every time — `GRANT_PROVIDERS` is what the answer is
    // derived from, so a third one arriving (Microsoft, workplan 0114) shows
    // up here rather than being silently absent from a hand-written object.
    // That absence was the defect: an unknown key reads `undefined`, which is
    // not `'deployment'`, so the client pair never folds and the form asks a
    // customer for an application id and secret beside the button that made
    // them unnecessary.
    expect(providerClientFacts({ ...PAIR })).toEqual({
      google: 'connection',
      dropbox: 'deployment',
      microsoft: 'connection',
    });
    expect(
      providerClientFacts({ GOOGLE_OAUTH_CLIENT_ID: 'g', GOOGLE_OAUTH_CLIENT_SECRET: 'gs' }),
    ).toEqual({ google: 'deployment', dropbox: 'connection', microsoft: 'connection' });
    expect(
      providerClientFacts({
        MICROSOFT_OAUTH_CLIENT_ID: 'm',
        MICROSOFT_OAUTH_CLIENT_SECRET: 'ms',
      }),
    ).toEqual({ google: 'connection', dropbox: 'connection', microsoft: 'deployment' });
    expect(JSON.stringify(providerClientFacts({ ...PAIR }))).not.toContain('dbx');
    expect(
      JSON.stringify(
        providerClientFacts({
          MICROSOFT_OAUTH_CLIENT_ID: 'm',
          MICROSOFT_OAUTH_CLIENT_SECRET: 'ms',
        }),
      ),
    ).not.toContain('ms');
  });
});
