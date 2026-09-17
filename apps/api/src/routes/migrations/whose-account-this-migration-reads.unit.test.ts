// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHICH ACCOUNT A MIGRATION SIGNS IN AS, on each side.
 *
 * The owner read his migration's own page on 2026-09-17: *"in the migration
 * overview or 'Migration Details' view ... it doesnt list the username within
 * the source and username within target ... please that those in this
 * overview."*
 *
 * The screen printed neither — and for HIS migration this route could not have
 * supplied them if it had. The detail route read the account out of the
 * encrypted credential record alone, and an OAuth connection stores no
 * username there at all: `sourceCredentialRecord` writes the client pair and
 * the refresh token, and the address goes in the connection's own config as
 * `user`. So every Google, Microsoft and Apple row — the doors most customers
 * now come through — answered `undefined`.
 *
 * Both places, in the right order, is the whole of what this pins. A name on
 * that screen is what somebody typed and can be anything; the address is the
 * fact.
 */

import { describe, it, expect } from 'vitest';
import { accountOnConnection } from './index.ts';

describe('the account is wherever that kind of connection keeps it', () => {
  it('reads the config of an OAuth row, which stores no username in its secret', () => {
    // A `google` account connection, as `sourceConnectionConfig` writes it.
    expect(
      accountOnConnection({ config: { type: 'google', user: 'owner@acme.example' } }),
    ).toBe('owner@acme.example');
  });

  it('reads it for a row whose secret cannot be opened at all', () => {
    // A secret this process has no key for is a fact the connection card
    // reports (0094 T5); it is not a reason for this screen to say nothing.
    expect(
      accountOnConnection({
        secretRef: 'not-a-decryptable-ref',
        config: { type: 'microsoft', user: 'anna@acme.example' },
      }),
    ).toBe('anna@acme.example');
  });

  it('says nothing rather than something empty', () => {
    // The screen renders "name (account)" and must not print "name ()" — that
    // reads as a connection with no account rather than a page that cannot
    // say which one.
    expect(accountOnConnection({ config: { type: 'google' } })).toBeUndefined();
    expect(accountOnConnection({ config: { type: 'google', user: '' } })).toBeUndefined();
    expect(accountOnConnection({ config: {} })).toBeUndefined();
    expect(accountOnConnection(null)).toBeUndefined();
    expect(accountOnConnection(undefined)).toBeUndefined();
  });

  it('is not fooled by a config that carries something else under `user`', () => {
    // The config column is untyped JSON. A non-string there is not an address.
    expect(accountOnConnection({ config: { user: 42 } })).toBeUndefined();
    expect(accountOnConnection({ config: { user: { address: 'a@b.c' } } })).toBeUndefined();
  });
});
