// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CREDENTIAL THE RECORD DROPPED ON ITS WAY TO THE STORE.
 *
 * Found on 2026-09-06, at the first live Test of the Microsoft 365 account
 * kind. The consent worked, the token reached the form, the row was saved —
 * and the row held `{username}`. `sourceCredentialRecord` decides, per
 * source type, which of the form's values are the credential to encrypt,
 * and it had no branch for `microsoft`: the body fell to the Azure catch-all
 * at the bottom, whose shape is a customer's own registration (tenant, client
 * id, client secret) and has no `refreshToken` in it. `JSON.stringify` then
 * dropped the three undefineds, and what remained was the address.
 *
 * Nothing was red. The descriptor marked the token `required`, and the
 * create door checked it was SENT; nothing checked it was KEPT. The deployment's
 * fill later added a client pair to the stored row, the token provider took
 * the application flow against `common`, and MSAL refused with
 * `missing_tenant_id_error` — a sentence about a tenant, for a row that had
 * lost its token two functions earlier. `apple` had the same fall-through and
 * lost its password the same way.
 *
 * So this pins the record against the descriptors, for every source type the
 * door offers: a value the descriptor calls a secret, or a consent hands over,
 * must come out of the record with the value it went in with. The three
 * account shapes that store ALTERNATIVES (a service-account key instead of
 * the trio, an app password instead of it) are honoured by filling one secret
 * at a time beside the required fields, so the rule reads "each secret, on
 * its own, survives" rather than "all secrets at once", which no shape promises.
 */

import { describe, it, expect } from 'vitest';
import { connectableTypes, credentialFieldsFor, type CredentialField } from '@openmig/shared';
import { sourceCredentialRecord } from './index.ts';

/** A value that names its own field, so a swap between two would show. */
const sentinel = (key: string) => `${key}-value`;

/** What a consent hands over or a person keeps to themselves. */
const isSecret = (f: CredentialField) => f.secret === true || f.consent !== undefined;

function record(type: string, values: Record<string, string>): Record<string, string> {
  return sourceCredentialRecord({
    sourceType: type as never,
    sourceConfig: { useSsl: true, ...values } as never,
  });
}

describe('every secret a source descriptor asks for survives the credential record', () => {
  const types = connectableTypes('source');

  it('reads a door with types on it, and at least one secret among them', () => {
    // The loop below is only as good as what it walks over.
    expect(types.length).toBeGreaterThan(5);
    const secrets = types.flatMap((t) => credentialFieldsFor('source', t).filter(isSecret));
    expect(secrets.length).toBeGreaterThan(5);
  });

  it.each([...types])('%s keeps each of its secrets, one at a time beside the required fields', (type) => {
    const fields = credentialFieldsFor('source', type);
    const required = Object.fromEntries(
      fields.filter((f) => f.required && !isSecret(f)).map((f) => [f.key, sentinel(f.key)]),
    );
    for (const secret of fields.filter(isSecret)) {
      // A paired id travels with its secret, as the form sends them.
      const paired = fields.find((f) => f.pairedWith === secret.key);
      const values = {
        ...required,
        [secret.key]: sentinel(secret.key),
        ...(paired ? { [paired.key]: sentinel(paired.key) } : {}),
      };
      const stored = record(type, values);
      expect(
        stored[secret.key],
        `sourceCredentialRecord dropped '${secret.key}' for a '${type}' source. The descriptor ` +
          'asks for it as a secret, the door checks it was sent, and the record never wrote it — ' +
          'the row saves fine and every build from it fails somewhere else, in other words ' +
          '(2026-09-06: a Microsoft grant stored as {username}).',
      ).toBe(sentinel(secret.key));
    }
  });
});

describe('the two account shapes that fell through, pinned in full', () => {
  it('a microsoft row that took the grant button stores the token ALONE', () => {
    // The deployment's registration is filled in at build time (0114 T1);
    // storing an empty pair here would read later as "configured, and wrong".
    expect(record('microsoft', { username: 'someone@contoso.example', refreshToken: 'the-token' })).toEqual({
      refreshToken: 'the-token',
    });
  });

  it('a microsoft row with its own registration stores the pair, the token and the tenant', () => {
    expect(
      record('microsoft', {
        username: 'someone@contoso.example',
        clientId: 'entra-app-id',
        clientSecret: 'entra-secret',
        refreshToken: 'the-token',
        tenantId: 'contoso.onmicrosoft.com',
      }),
    ).toEqual({
      refreshToken: 'the-token',
      clientId: 'entra-app-id',
      clientSecret: 'entra-secret',
      tenantId: 'contoso.onmicrosoft.com',
    });
  });

  it('an apple row stores the address and the app-specific password — the imap shape', () => {
    expect(record('apple', { username: 'you@icloud.com', password: 'abcd-efgh-ijkl-mnop' })).toEqual({
      username: 'you@icloud.com',
      password: 'abcd-efgh-ijkl-mnop',
    });
  });

  it('neither stores a tenant, a client or a secret it was not given', () => {
    // The catch-all's shape, and why falling into it was invisible: the keys
    // it writes are undefined for these rows, and JSON drops undefined.
    const stored = record('microsoft', { username: 'someone@contoso.example', refreshToken: 't' });
    expect(Object.keys(stored)).toEqual(['refreshToken']);
  });
});
