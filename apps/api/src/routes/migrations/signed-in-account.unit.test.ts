// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The account that signed in, and whether it is the one the page named
 * (workplan 0108 T8 (b), the owner's decision of 2026-09-23).
 *
 * The claims that matter are the refusals: an ID token that is not Google's, is
 * not for this application, or carries an address Google did not verify
 * vouches for nobody; and two addresses are the same account only where Google
 * itself says so. A fold too many is a wrong account let through.
 */

import { describe, it, expect } from 'vitest';
import {
  SIGNED_IN_ACCOUNT_SCOPES,
  accountInIdToken,
  namesAGoogleAccount,
  sameGoogleAccount,
  signedInAccountRefusal,
} from './signed-in-account.ts';

const CLIENT_ID = 'client.apps.googleusercontent.com';

/** An ID token as Google's token endpoint answers it. Unsigned: nothing here checks one. */
function idToken(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}.signature`;
}

const GOOD = {
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: '1234567890',
  email: 'someone@example.org',
  email_verified: true,
};

describe('what the link asks Google for, beside the data', () => {
  it('is who signed in, and nothing that needs a verification', () => {
    expect(SIGNED_IN_ACCOUNT_SCOPES).toEqual(['openid', 'https://www.googleapis.com/auth/userinfo.email']);
  });
});

describe('the account in Google’s ID token', () => {
  it('is the verified address Google issued for this application', () => {
    expect(accountInIdToken(idToken(GOOD), CLIENT_ID)).toBe('someone@example.org');
    // Google writes its issuer both ways.
    expect(accountInIdToken(idToken({ ...GOOD, iss: 'accounts.google.com' }), CLIENT_ID)).toBe(
      'someone@example.org',
    );
  });

  it('is nobody when anyone but Google issued it', () => {
    expect(accountInIdToken(idToken({ ...GOOD, iss: 'https://accounts.example.org' }), CLIENT_ID)).toBeNull();
    expect(accountInIdToken(idToken({ ...GOOD, iss: undefined }), CLIENT_ID)).toBeNull();
  });

  it('is nobody when it was issued to another application', () => {
    expect(accountInIdToken(idToken({ ...GOOD, aud: 'other.apps.googleusercontent.com' }), CLIENT_ID)).toBeNull();
    expect(accountInIdToken(idToken({ ...GOOD, aud: [CLIENT_ID, 'other'] }), CLIENT_ID)).toBeNull();
  });

  it('is nobody when Google has not verified the address', () => {
    for (const email_verified of [false, 'true', undefined]) {
      expect(accountInIdToken(idToken({ ...GOOD, email_verified }), CLIENT_ID), String(email_verified)).toBeNull();
    }
  });

  it('is nobody when it carries no address', () => {
    expect(accountInIdToken(idToken({ ...GOOD, email: undefined }), CLIENT_ID)).toBeNull();
    expect(accountInIdToken(idToken({ ...GOOD, email: 'not an address' }), CLIENT_ID)).toBeNull();
  });

  it('is nobody when there is no token, or it is not one', () => {
    for (const bad of [undefined, null, 42, '', 'a.b', 'a.b.c.d', 'x.!!!.y', `x.${Buffer.from('[1]').toString('base64url')}.y`]) {
      expect(accountInIdToken(bad, CLIENT_ID), String(bad)).toBeNull();
    }
    expect(accountInIdToken(`x.${Buffer.from('null').toString('base64url')}.y`, CLIENT_ID)).toBeNull();
  });
});

describe('the same Google account', () => {
  it('whatever the case', () => {
    expect(sameGoogleAccount('Someone@Example.org', 'someone@example.org')).toBe(true);
    expect(sameGoogleAccount('  someone@example.org ', 'someone@example.org')).toBe(true);
  });

  it('for Gmail, whatever the dots, a +suffix, or googlemail.com, because Google says so', () => {
    expect(sameGoogleAccount('first.last@gmail.com', 'firstlast@gmail.com')).toBe(true);
    expect(sameGoogleAccount('firstlast+migration@gmail.com', 'firstlast@gmail.com')).toBe(true);
    expect(sameGoogleAccount('first.last@googlemail.com', 'firstlast@gmail.com')).toBe(true);
  });

  it('elsewhere, NOT whatever the dots or a +suffix: two Workspace users can differ by one', () => {
    expect(sameGoogleAccount('a.b@acme.example', 'ab@acme.example')).toBe(false);
    expect(sameGoogleAccount('a+b@acme.example', 'a@acme.example')).toBe(false);
  });

  it('never two different accounts', () => {
    expect(sameGoogleAccount('someone@example.org', 'someone-else@example.org')).toBe(false);
    expect(sameGoogleAccount('someone@example.org', 'someone@example.net')).toBe(false);
    expect(sameGoogleAccount('someone@gmail.com', 'someone@example.org')).toBe(false);
  });

  it('never two things that are not addresses, however alike', () => {
    expect(sameGoogleAccount('me', 'me')).toBe(false);
    // Nothing before the +suffix is no Gmail name at all, not one shared name.
    expect(sameGoogleAccount('+a@gmail.com', '+b@gmail.com')).toBe(false);
  });
});

describe('whether a migration names an account a sign-in can be held to', () => {
  it('does when it names an address', () => {
    expect(namesAGoogleAccount('someone@example.org')).toBe(true);
  });

  it('does not when it names nothing, or something that is not an address', () => {
    for (const named of [null, undefined, '', '   ', 'me', 'someone', 'a@', '@b', 'a@b@c', 'a b@c.example']) {
      expect(namesAGoogleAccount(named), String(named)).toBe(false);
    }
  });
});

describe('what the person who signed in is told', () => {
  it('nothing, when it is the account the page named', () => {
    expect(signedInAccountRefusal('Someone@Example.org', 'someone@example.org')).toBeNull();
  });

  it('both addresses, and to choose the named one, when it is another account', () => {
    const said = signedInAccountRefusal('someone@example.org', 'personal@gmail.com');
    expect(said?.code).toBe('another_account');
    expect(said?.reason).toMatch(/You signed in to Google as personal@gmail\.com/);
    expect(said?.reason).toMatch(/this migration reads someone@example\.org/);
    expect(said?.reason).toMatch(/choose someone@example\.org at Google/);
  });

  it('which account to sign in as, when Google did not say who signed in', () => {
    const said = signedInAccountRefusal('someone@example.org', null);
    expect(said?.code).toBe('unconfirmed');
    expect(said?.reason).toMatch(/Google did not confirm which account you signed in with/);
    expect(said?.reason).toMatch(/sign in as someone@example\.org/);
  });

  it('whom to tell, when the migration no longer names an account', () => {
    for (const named of [null, '', 'me']) {
      const said = signedInAccountRefusal(named, 'someone@example.org');
      expect(said?.code).toBe('no_named_account');
      expect(said?.reason).toMatch(
        /no longer names the Google account it reads.*tell the person who sent you the link/,
      );
    }
  });
});
