// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * What a stored connection may hand back so a rotation only asks for what
 * changed (workplan 0078, owner decision 2026-08-18).
 *
 * The owner asked why *Inloggegevens vervangen* presents every field empty,
 * and chose the boundary: prefill from `connection.config` ONLY. `config` is
 * plain JSONB holding which server a migration talks to and where it is
 * rooted; the encrypted credential record is never opened. So the posture
 * sentence — *SECRETS NEVER COME BACK OUT* — needs no exception carved into
 * it, and the first test here is the one that keeps that true.
 *
 * The second thing pinned is the vocabulary gap. The config builders write
 * the ENGINE's names (`user`, `mailbox`); the descriptor and every form speak
 * their own (`username`). One translation, tested, beats two that agree by
 * hand until they don't.
 */

import { describe, it, expect } from 'vitest';
import { credentialFieldsFor } from '@openmig/shared';
import { knownConnectionValues } from './index';

describe('knownConnectionValues', () => {
  it('NEVER returns a field the descriptor marks secret', () => {
    /**
     * The property that lets this function exist at all, protected TWICE and
     * deliberately so:
     *
     *  1. the candidate map names only non-secret keys, so a config carrying
     *     a password has nowhere to be read from;
     *  2. the descriptor filter drops anything marked `secret`, whatever the
     *     candidate map says.
     *
     * Mutation-verified, and the result is worth writing down because it is
     * not the obvious one: removing the descriptor filter ALONE does not fail
     * this test — layer 1 still holds. What fails it is the realistic future
     * mistake, adding a secret to the candidate map: with the filter present
     * the test still passes, and with the filter removed too it fails by
     * name (`source/imap handed back 'password'`). So the filter is not
     * decoration; it is what makes layer 1 safe to edit.
     */
    const poisoned = {
      host: 'mail.acme.example',
      user: 'anna@acme.example',
      password: 'hunter2',
      clientSecret: 'shh',
      refreshToken: '1//nope',
      serviceAccountKey: '{"type":"service_account"}',
    };

    for (const [role, type] of [
      ['source', 'imap'],
      ['source', 'google-drive'],
      ['source', 'dropbox'],
      ['source', 'graph'],
      ['target', 'jmap'],
    ] as const) {
      const known = knownConnectionValues(role, type, poisoned);
      for (const field of credentialFieldsFor(role, type)) {
        if (!field.secret) continue;
        expect(
          known[field.key],
          `${role}/${type} handed back '${field.key}', which is a secret`,
        ).toBeUndefined();
      }
    }
  });

  it('translates the engine vocabulary into the form vocabulary', () => {
    // `user` is what the IMAP builder writes; `username` is what the form and
    // the descriptor call it. This mapping is the reason this lives beside
    // the builders rather than in the client.
    expect(
      knownConnectionValues('source', 'imap', {
        type: 'imap-oauth2',
        host: 'mail.acme.example',
        port: 993,
        user: 'anna@acme.example',
      }),
    ).toEqual({ host: 'mail.acme.example', port: '993', username: 'anna@acme.example' });
  });

  it("reads Graph's mailbox as the account, because that is what it is", () => {
    expect(
      knownConnectionValues('source', 'graph', {
        type: 'graph-mail',
        tenantId: 'acme.onmicrosoft.com',
        mailbox: 'anna@acme.example',
      }),
    ).toEqual({ tenantId: 'acme.onmicrosoft.com', username: 'anna@acme.example' });
  });

  it('returns a port as a STRING, because a form field holds text', () => {
    // The config stores a number; an input's value is a string, and the
    // difference is how a prefilled port becomes `NaN` on submit (0072 T4).
    const known = knownConnectionValues('target', 'jmap', { host: 'x', port: 443 });
    expect(known.port).toBe('443');
  });

  it('offers nothing it does not have, rather than empty strings', () => {
    // Dropbox keeps only `rootPath` in config — its App key lives encrypted,
    // so this returns nothing for it. That is the cost of the chosen
    // boundary, and it is asserted rather than left to be discovered.
    const known = knownConnectionValues('source', 'dropbox', { type: 'dropbox' });
    expect(known).toEqual({});
    expect('clientId' in known, 'an App key cannot come from config').toBe(false);
  });

  it('survives a null or malformed config without throwing', () => {
    expect(knownConnectionValues('source', 'imap', null)).toEqual({});
    expect(knownConnectionValues('source', 'imap', 'not-an-object')).toEqual({});
  });
});
