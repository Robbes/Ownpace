// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PERSON'S ENDING WITH ACCOUNTS LEFT TO CONNECT (the owner's decisions of
 * 2026-11-26).
 *
 * Every sign-in provider's ending on a person's link (Microsoft and Dropbox
 * through `decideLinkEnding`, Google through its own route, which
 * `a-progress-page-for-a-person` drives end to end) said *this link will not
 * work again*, also to a person with a second account still to connect. It
 * says how many are left and offers the way back, while the link is not
 * spent, and only then.
 */

import { describe, it, expect } from 'vitest';
import { decideLinkEnding, moreToConnect, type LinkEndingEffects } from './link-ending.ts';

const BACK = 'https://app.example/grant/p.an-id.a-secret';
const PERSON = { linkId: 'l', tenantId: 't', personId: 'p', account: 'a@example.org', mappingIds: ['m'], backUrl: BACK };

function effects(stored: { linkSpent: boolean; left: number }): LinkEndingEffects {
  return {
    closedOrganisation: async () => null,
    finish: async () =>
      ({ ok: true, secret: { refreshToken: 'r' }, signedInAs: 'a@example.org', grantedScopes: [] }) as never,
    storeGrantedToken: async () => {
      throw new Error('a person’s ending stores no migration’s grant');
    },
    storePersonGrant: async () => ({ ok: true, granted: ['m'], ...stored }),
    afterMigration: async () => null,
    afterPerson: async () => null,
  };
}

const decide = (stored: { linkSpent: boolean; left: number }, personLink: typeof PERSON | Omit<typeof PERSON, 'backUrl'> = PERSON) =>
  decideLinkEnding(
    { id: 'microsoft', name: 'Microsoft', recordedPermission: () => 'read-only' },
    { clientId: 'c', clientSecret: 's', redirectUri: 'https://api.example/cb', personLink },
    { code: 'a-code' },
    effects(stored),
  );

describe('what a person’s ending says is left', () => {
  it('one or more accounts left on a live link: how many, and the way back', async () => {
    expect(await decide({ linkSpent: false, left: 1 })).toMatchObject({ ok: true, more: { left: 1, backUrl: BACK } });
    expect(await decide({ linkSpent: false, left: 2 })).toMatchObject({ ok: true, more: { left: 2, backUrl: BACK } });
  });

  it('a spent link, none left, or no web address: nothing, and the ending it always was', async () => {
    expect(await decide({ linkSpent: true, left: 0 })).not.toHaveProperty('more');
    expect(await decide({ linkSpent: false, left: 0 })).not.toHaveProperty('more');
    const { backUrl: _none, ...noAddress } = PERSON;
    expect(await decide({ linkSpent: false, left: 1 }, noAddress)).not.toHaveProperty('more');
  });

  it('a migration’s own link has none', () => {
    expect(moreToConnect(undefined, { ok: true })).toBeUndefined();
  });
});
