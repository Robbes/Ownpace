// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TEST PASSED, THE RUN REFUSED — the deployment's Entra application, filled
 * everywhere except where the migration actually runs.
 *
 * The owner connected a Microsoft 365 account with the grant button, and the
 * connection card came back green and specific: *Can carry: Email ✓ 8 folders
 * · Calendar ✓ 3 calendars · Contacts ✓ 1 address book · Files ✓ 4 folders ·
 * Tasks ✓ 1 task list*, with *Measured: Email 25 messages · Files 3.8 GB*.
 * Every one of those numbers came off Microsoft Graph, so the credentials
 * reached Microsoft and Microsoft answered.
 *
 * Then the wizard ran its preflight over the same connection and every domain
 * came back at zero:
 *
 *     graph-calendar source: clientId is not set (the Entra app registration id).
 *     graph-contacts source: clientId is not set (the Entra app registration id).
 *     graph-mail source credentials must include clientId (the Entra app registration id)
 *     graph-drive source: clientId is not set (the Entra app registration id).
 *
 * ## Why the same row answered twice, differently
 *
 * A row that took the grant button stores the refresh token and NOTHING ELSE:
 * the application is the deployment's (ADR-0041), and its id and secret live
 * in `MICROSOFT_OAUTH_CLIENT_ID`/`MICROSOFT_OAUTH_CLIENT_SECRET`. Every path
 * that reaches Microsoft has to put them back, and the fill is one function
 * per provider — `withDeployment{Google,Dropbox,Microsoft}Client`.
 *
 * The probe called all three. The qualification called all three. And
 * `sourceCredentialsFor` — the ONE seam every sync pass and every discovery
 * goes through — called two:
 *
 *     withDeploymentDropboxClient(
 *       kind === DROPBOX_CONNECTION_KIND,
 *       withDeploymentGoogleClient(isGoogleGrantKind(kind), connectionCreds),
 *     )
 *
 * Microsoft arrived in workplan 0114, three functions were written, and this
 * nesting kept the two it was born with. Adding a provider is not a compile
 * error against a hand-nested chain — the same sentence
 * `source-face-builders.ts` and `provider-clients.ts` each open with, and the
 * third time this week it has cost a day.
 *
 * The result is the exact inverse of the lie `probe-connection.ts` exists to
 * prevent, and it reads worse: **Test passes and the migration refuses.**
 *
 * ## What this file pins
 *
 * That the build path and the probe path fill the SAME application for EVERY
 * provider in `GRANT_PROVIDERS` — derived from that list, so a fourth
 * provider is covered on the day it is added rather than on the day a
 * customer finds it. And that the kind gate still holds in both: Dropbox and
 * Box store their own app key and secret under `clientId`/`clientSecret`, so
 * a fill that ignored the kind would hand Google's application to a Dropbox
 * row and fail at Dropbox naming nothing useful.
 */

import { describe, it, expect } from 'vitest';
import { GRANT_PROVIDERS, type GrantProvider } from '@openmig/shared';
import {
  withDeploymentApplication,
  DEPLOYMENT_APPLICATION_KINDS,
} from './deployment-application.ts';
import { sourceCredentialsFor } from './build-deps-from-mapping.ts';
import { credentialsForProbe } from './probe-connection.ts';
import {
  buildCalendarSourceFromConnection,
  buildContactSourceFromConnection,
  buildFileSourceFromConnection,
  buildTaskSourceFromConnection,
  buildSourceConnectorFromCredentials,
} from './build-deps-from-mapping.ts';

/**
 * A deployment that carries all three applications, with values distinct per
 * provider — so "filled with the right one" is a different assertion from
 * "filled with something".
 */
const DEPLOYMENT = {
  GOOGLE_OAUTH_CLIENT_ID: 'google-deployment-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'google-deployment-secret',
  DROPBOX_OAUTH_CLIENT_ID: 'dropbox-deployment-key',
  DROPBOX_OAUTH_CLIENT_SECRET: 'dropbox-deployment-secret',
  MICROSOFT_OAUTH_CLIENT_ID: 'microsoft-deployment-id',
  MICROSOFT_OAUTH_CLIENT_SECRET: 'microsoft-deployment-secret',
  MICROSOFT_TENANT_ID: 'contoso-tenant',
} as NodeJS.ProcessEnv;

/** The id this deployment configured for each provider, per row. */
const CONFIGURED_ID: Readonly<Record<GrantProvider, string>> = {
  google: 'google-deployment-id',
  dropbox: 'dropbox-deployment-key',
  microsoft: 'microsoft-deployment-id',
};

/** What a row of that provider's kind holds after a consent: the token alone. */
const GRANTED_ROW = { refreshToken: 'the-refresh-token' };

/** One kind per provider that a consent can actually produce. */
function kindFor(provider: GrantProvider): string {
  const kinds = DEPLOYMENT_APPLICATION_KINDS[provider];
  expect(kinds.length, `${provider} claims no connection kind at all`).toBeGreaterThan(0);
  return kinds[0] as string;
}

describe('every provider whose consent a screen offers is filled on the run path', () => {
  it('covers every grant provider — this file is not passing vacuously', () => {
    expect(GRANT_PROVIDERS.length).toBeGreaterThan(2);
    expect(Object.keys(DEPLOYMENT_APPLICATION_KINDS).sort()).toEqual([...GRANT_PROVIDERS].sort());
  });

  for (const provider of GRANT_PROVIDERS) {
    it(`fills the deployment's ${provider} application on a row that stores only its token`, () => {
      const kind = kindFor(provider);
      const filled = sourceCredentialsFor(kind, 'source', GRANTED_ROW, null, DEPLOYMENT);
      expect(
        filled.clientId,
        `a '${kind}' row that took the grant button reaches its provider with no application: ` +
          'every face refuses inside the pass, hours after a Test that passed',
      ).toBe(CONFIGURED_ID[provider]);
      // The token the person granted is never replaced by the fill.
      expect(filled.refreshToken).toBe('the-refresh-token');
    });

    it(`fills the same ${provider} application at Test as at run time`, () => {
      const kind = kindFor(provider);
      expect(
        credentialsForProbe(kind, GRANTED_ROW, DEPLOYMENT),
        'the probe and the pass disagreeing about the application is "test passed, run refused"',
      ).toEqual(sourceCredentialsFor(kind, 'source', GRANTED_ROW, null, DEPLOYMENT));
    });

    it(`leaves a ${provider} row that carries its own registration alone`, () => {
      // ADR-0041's rule: a customer who registered their own application keeps
      // using it, and a deployment-wide default must never quietly replace it.
      const own = { clientId: 'the-customers-own-id', clientSecret: 'their-secret' };
      const filled = sourceCredentialsFor(kindFor(provider), 'source', own, null, DEPLOYMENT);
      expect(filled.clientId).toBe('the-customers-own-id');
      expect(filled.clientSecret).toBe('their-secret');
    });
  }
});

describe('the kind gate holds — an application never crosses providers', () => {
  /**
   * `clientId` and `clientSecret` are SHARED KEY NAMES. Dropbox stores its App
   * key and App secret under them and Box its own pair, so a fill that filled
   * every row would hand Google's application to a Dropbox connection, which
   * then fails at Dropbox with an error naming nothing useful.
   */
  for (const provider of GRANT_PROVIDERS) {
    for (const other of GRANT_PROVIDERS) {
      if (other === provider) continue;
      it(`never gives a ${provider} row the ${other} application`, () => {
        const filled = withDeploymentApplication(kindFor(provider), GRANTED_ROW, DEPLOYMENT);
        expect(filled.clientId).not.toBe(CONFIGURED_ID[other]);
      });
    }
  }

  it('leaves a kind no provider claims exactly as it found it', () => {
    const imap = { username: 'someone@example.test', password: 'the-password' };
    expect(withDeploymentApplication('imap', imap, DEPLOYMENT)).toEqual(imap);
    expect(withDeploymentApplication('box', imap, DEPLOYMENT)).toEqual(imap);
  });

  it('changes nothing on a deployment that carries no application at all', () => {
    // The appliance, and the managed deployment whose operator set none: every
    // connection carries its own pair and the fill has nothing to add.
    const bare = {} as NodeJS.ProcessEnv;
    for (const provider of GRANT_PROVIDERS) {
      expect(withDeploymentApplication(kindFor(provider), GRANTED_ROW, bare)).toEqual(GRANTED_ROW);
    }
  });
});

describe('the five Graph faces build from what the run path hands them', () => {
  /**
   * The end of the chain, and the thing the owner actually saw. "Did not
   * throw" is the assertion for the same reason the sibling guards give: these
   * builders construct a token provider and a source and reach no network, so
   * construction is exactly the boundary the refusal lived at.
   */
  const runPathCreds = (): Record<string, string> =>
    sourceCredentialsFor('microsoft', 'source', GRANTED_ROW, null, DEPLOYMENT);
  const row = () => ({
    config: { user: 'someone@contoso.example' } as Record<string, unknown>,
    creds: runPathCreds(),
    kind: 'microsoft',
  });

  it('builds the calendar face', () => {
    expect(() => buildCalendarSourceFromConnection(row())).not.toThrow();
  });
  it('builds the contact face', () => {
    expect(() => buildContactSourceFromConnection(row())).not.toThrow();
  });
  it('builds the file face', () => {
    expect(() => buildFileSourceFromConnection(row())).not.toThrow();
  });
  it('builds the task face', () => {
    expect(() => buildTaskSourceFromConnection(row())).not.toThrow();
  });
  it('builds the mail face', () => {
    expect(() =>
      buildSourceConnectorFromCredentials(
        { type: 'microsoft', user: 'someone@contoso.example' },
        runPathCreds(),
      ),
    ).not.toThrow();
  });
});
