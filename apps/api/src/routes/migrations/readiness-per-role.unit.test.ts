// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * READINESS PER ROLE (workplan 0174 §4.2, T1).
 *
 * A person's link asks for accounts, not sources: each migration's source and
 * its destination are judged apart, and a migration starts only when both have
 * a way in. This holds, from the rows' booleans and key names alone:
 *
 *  - `targetGrantAsk`, per destination kind: nothing to ask when it has a way
 *    in; its password when it has none; Cirrux Drive when files go there
 *    without it (refused until 0174 T5 gives Cirrux an entry); no
 *    destination; a kind no link can connect;
 *  - `sourceGrantAsk`: a sign-in source exactly as `grantLinkAsk` answers, a
 *    password source asked for its password, and refused without a named
 *    account or a destination;
 *  - `awaitingGrantRefusal`, for a password source, a password destination
 *    and Cirrux files, and silent where it was before when the new inputs
 *    are not given.
 */

import { describe, it, expect } from 'vitest';
import {
  awaitingGrantRefusal,
  grantLinkAsk,
  sourceGrantAsk,
  targetGrantAsk,
  targetPasswordKeysNeeded,
} from './grant-link-readiness.ts';
import { PASSWORD_SOURCE_KINDS, PASSWORD_TARGET_KINDS } from '../grant-providers.ts';

const target = (targetKind: string | null, targetCredentialKeys: string[], includedDomains: string[] = ['email']) => ({
  targetKind,
  includedDomains,
  targetCredentialKeys,
});

describe('targetGrantAsk: what a link asks of a destination', () => {
  it('asks nothing of a destination that has its password', () => {
    for (const kind of PASSWORD_TARGET_KINDS) {
      const keys = targetPasswordKeysNeeded(kind, ['email', 'calendar']);
      expect(targetGrantAsk(target(kind, [...keys], ['email', 'calendar'])), kind).toEqual({ ok: true, asks: [] });
    }
  });

  it('asks for the password of every password kind saved with none', () => {
    for (const kind of PASSWORD_TARGET_KINDS) {
      expect(targetGrantAsk(target(kind, [])), kind).toEqual({ ok: true, asks: [{ way: 'password', kind }] });
    }
  });

  it('asks Infomaniak for the password of the faces it writes: the mail password for mail, the sync one for the rest', () => {
    expect(targetPasswordKeysNeeded('infomaniak', ['email'])).toEqual(['mailPassword']);
    expect(targetPasswordKeysNeeded('infomaniak', ['calendar'])).toEqual(['password']);
    expect(targetPasswordKeysNeeded('infomaniak', ['email', 'contact'])).toEqual(['password', 'mailPassword']);
    // A sync password alone does not open its mail.
    expect(targetGrantAsk(target('infomaniak', ['password'], ['email']))).toEqual({
      ok: true,
      asks: [{ way: 'password', kind: 'infomaniak' }],
    });
    expect(targetGrantAsk(target('infomaniak', ['mailPassword'], ['email']))).toEqual({ ok: true, asks: [] });
  });

  it('asks Cirrux files without Drive for its sign-in, beside the password when that is missing too (0174 T5), and nothing when Drive is there', () => {
    expect(targetGrantAsk(target('cirrux', ['password'], ['file']))).toEqual({
      ok: true,
      asks: [{ way: 'sign-in', provider: 'cirrux' }],
    });
    expect(targetGrantAsk(target('cirrux', [], ['file', 'email']))).toEqual({
      ok: true,
      asks: [
        { way: 'password', kind: 'cirrux' },
        { way: 'sign-in', provider: 'cirrux' },
      ],
    });
    expect(targetGrantAsk(target('cirrux', ['password', 'driveRefreshToken'], ['file']))).toEqual({ ok: true, asks: [] });
    // Mail into Cirrux needs no Drive.
    expect(targetGrantAsk(target('cirrux', ['password'], ['email']))).toEqual({ ok: true, asks: [] });
  });

  it('refuses a migration with no destination, and a destination kind no link connects', () => {
    const none = targetGrantAsk(target(null, []));
    expect(none.ok ? null : none.refusal.code).toBe('no_target');
    const unknown = targetGrantAsk(target('proton', []));
    expect(unknown.ok ? null : unknown.refusal.code).toBe('target_not_grantable');
  });
});

describe('sourceGrantAsk: what a person’s link asks of a source', () => {
  const READY = {
    sourceKind: 'gmail',
    includedDomains: ['email'],
    hasNamedAccount: true,
    hasTarget: true,
    hasClientId: false,
    hasClientSecret: false,
    hasDeploymentClient: true,
    scopeClass: 'restricted',
    namesItsAccount: true,
  };

  it('answers a sign-in source exactly as grantLinkAsk does', () => {
    const decided = sourceGrantAsk(READY);
    const asked = grantLinkAsk(READY);
    expect(decided.ok && decided.way === 'sign-in' && asked.ok ? decided.ask : null).toEqual(asked.ok ? asked.ask : 'x');
  });

  it('asks each password source kind for its password', () => {
    for (const kind of PASSWORD_SOURCE_KINDS) {
      // `hasNamedAccount` is Google's address check; a password card needs a user name.
      expect(sourceGrantAsk({ ...READY, sourceKind: kind, hasNamedAccount: false }), kind).toEqual({
        ok: true,
        way: 'password',
        kind,
      });
    }
  });

  it('refuses a password source that names no account, or has no destination', () => {
    const unnamed = sourceGrantAsk({ ...READY, sourceKind: 'imap', namesItsAccount: false });
    expect(unnamed.ok ? null : unnamed.refusal.code).toBe('no_named_account');
    const nowhere = sourceGrantAsk({ ...READY, sourceKind: 'apple', hasTarget: false });
    expect(nowhere.ok ? null : nowhere.refusal.code).toBe('no_target');
  });

  it('still refuses what neither way connects, and a migration’s own link stays sign-in only (§13)', () => {
    for (const kind of ['box', 'graph', 'oauth2', 'archive']) {
      const decided = sourceGrantAsk({ ...READY, sourceKind: kind });
      expect(decided.ok ? null : decided.refusal.code, kind).toBe('source_not_grantable');
    }
    const own = grantLinkAsk({ ...READY, sourceKind: 'imap' });
    expect(own.ok ? null : own.refusal.code).toBe('source_not_grantable');
  });
});

describe('awaitingGrantRefusal, per role', () => {
  const none = { hasRefreshToken: false, hasServiceAccountKey: false };

  it('holds a password source with no password, and lets one with a password or an app password go', () => {
    for (const kind of PASSWORD_SOURCE_KINDS) {
      expect(awaitingGrantRefusal({ ...none, sourceKind: kind, sourceCredentialKeys: ['username'] }), kind).toMatch(
        /nobody has given the password of the account it copies from/,
      );
      expect(awaitingGrantRefusal({ ...none, sourceKind: kind, sourceCredentialKeys: ['password'] }), kind).toBeNull();
    }
    expect(awaitingGrantRefusal({ ...none, sourceKind: 'imap', sourceCredentialKeys: ['appPassword'] })).toBeNull();
  });

  it('judges no password source when its keys were not read, as before 0174', () => {
    expect(awaitingGrantRefusal({ ...none, sourceKind: 'imap' })).toBeNull();
  });

  it('holds a password destination with no password', () => {
    const refusal = awaitingGrantRefusal({
      ...none,
      sourceKind: 'imap',
      sourceCredentialKeys: ['password'],
      target: target('soverin', []),
    });
    expect(refusal).toMatch(/its destination has no password/);
    expect(
      awaitingGrantRefusal({ ...none, sourceKind: 'imap', sourceCredentialKeys: ['password'], target: target('soverin', ['password']) }),
    ).toBeNull();
  });

  it('holds Cirrux files with no Drive grant, and names it', () => {
    const refusal = awaitingGrantRefusal({
      ...none,
      sourceKind: 'imap',
      sourceCredentialKeys: ['password'],
      target: target('cirrux', ['password'], ['file']),
    });
    expect(refusal).toMatch(/Cirrux Drive is not connected on its destination/);
    expect(
      awaitingGrantRefusal({
        ...none,
        sourceKind: 'imap',
        sourceCredentialKeys: ['password'],
        target: target('cirrux', ['password', 'driveRefreshToken'], ['file']),
      }),
    ).toBeNull();
  });

  it('says the source first when both sides wait', () => {
    const refusal = awaitingGrantRefusal({
      sourceKind: 'gmail',
      ...none,
      target: target('jmap', []),
    });
    expect(refusal).toMatch(/nobody has connected its Google account/);
  });

  it('holds nothing for a migration with no destination: Start has its own refusal for that', () => {
    expect(
      awaitingGrantRefusal({ ...none, sourceKind: 'imap', sourceCredentialKeys: ['password'], target: target(null, []) }),
    ).toBeNull();
  });
});
