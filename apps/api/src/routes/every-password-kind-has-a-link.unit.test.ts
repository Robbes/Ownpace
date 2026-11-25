// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * EVERY PASSWORD KIND HAS A LINK (workplan 0174 §5.1, T1).
 *
 * The owner, 2026-11-25: *"I want all sources/targets that supports granting
 * to be able to use the others-grant-page."* The password kinds a link can ask
 * for are two lists on the seam (`PASSWORD_SOURCE_KINDS`,
 * `PASSWORD_TARGET_KINDS`), and the field table (`credentialFieldsFor`) is
 * where a kind is born. Two lists beside a table drift the day a kind is
 * added to the table only. So this holds them together:
 *
 *  - a kind whose fields carry a secret password, and that no provider's
 *    consent fills (an OAuth kind), is in its role's list, or is named below
 *    with the reason 0174 §13 gives;
 *  - every kind in a list really has such a field in that role;
 *  - the person's card for each kind asks the person for its secrets and
 *    shows the owner's other values, never a secret's value (§5.2, D2).
 */

import { describe, it, expect } from 'vitest';
import { connectableTypes, credentialFieldsFor, secretFieldKeys } from '@openmig/shared';
import {
  PASSWORD_SOURCE_KINDS,
  PASSWORD_TARGET_KINDS,
  isPasswordKind,
  passwordGrantOf,
  passwordServerOf,
  type GrantRole,
} from './grant-providers.ts';

/** Kinds with a secret password that a link does not ask for, each with 0174 §13's reason. */
const NOT_ON_A_LINK: Readonly<Record<string, string>> = {
  // Gmail is granted by Google's sign-in; its app password is the owner's fallback for IMAP.
  gmail: 'granted by the Google sign-in; the app password stays the owner’s (§13)',
};

/** Whether a role's kind asks for a password: a secret whose key names one, filled by no consent. */
function asksForAPassword(role: GrantRole, kind: string): boolean {
  const fields = credentialFieldsFor(role, kind);
  if (fields.some((f) => f.consent !== undefined)) return false;
  return fields.some((f) => f.secret === true && /password/i.test(f.key));
}

const ROLES: ReadonlyArray<[GrantRole, ReadonlyArray<string>]> = [
  ['source', PASSWORD_SOURCE_KINDS],
  ['target', PASSWORD_TARGET_KINDS],
];

describe('every password kind in the field table is on the link, or named with its reason', () => {
  for (const [role, listed] of ROLES) {
    it(`${role}s`, () => {
      const kinds = connectableTypes(role).filter((k) => asksForAPassword(role, k));
      // Not vacuous: the table has password kinds in both roles.
      expect(kinds.length, role).toBeGreaterThan(3);
      const missing = kinds.filter((k) => !listed.includes(k) && !Object.hasOwn(NOT_ON_A_LINK, k));
      expect(missing, `${role} password kinds neither on the link nor named in NOT_ON_A_LINK`).toEqual([]);
    });

    it(`${role}s: every listed kind really asks for a password`, () => {
      for (const kind of listed) {
        expect(asksForAPassword(role, kind), `${role} ${kind}`).toBe(true);
        expect(isPasswordKind(role, kind)).toBe(true);
        expect(passwordGrantOf(role, kind)?.kind).toBe(kind);
      }
    });
  }

  it('names no excluded kind that has no password in the table any more', () => {
    // Gmail's consent already keeps it off by the rule above; named all the
    // same, because its app password is a secret password the rule would
    // otherwise have to be read closely to see excluded.
    const hasAPassword = (role: GrantRole, kind: string) =>
      credentialFieldsFor(role, kind).some((f) => f.secret === true && /password/i.test(f.key));
    for (const kind of Object.keys(NOT_ON_A_LINK)) {
      expect(hasAPassword('source', kind) || hasAPassword('target', kind), kind).toBe(true);
    }
  });

  it('is no password kind of a role it is not listed in, and no sign-in kind', () => {
    expect(isPasswordKind('source', 'nextcloud')).toBe(false);
    expect(isPasswordKind('target', 'apple')).toBe(false);
    for (const kind of ['google', 'gmail', 'microsoft', 'dropbox', 'box', 'graph', 'archive', 'toString']) {
      expect(isPasswordKind('source', kind), kind).toBe(false);
    }
  });
});

describe('the person’s card per kind (0174 §5.2, D2)', () => {
  it('asks the person for every secret, and never carries a secret’s value', () => {
    for (const [role, listed] of ROLES) {
      for (const kind of listed) {
        // An owner's config with a value under every key, secrets included,
        // as a careless caller could hand it: no secret value may come out.
        const stored = Object.fromEntries(
          credentialFieldsFor(role, kind).map((f) => [f.key, f.secret ? 'SENTINEL-SECRET' : `v-${f.key}`]),
        );
        stored.mailHost ??= 'imap.example.org';
        const fields = passwordGrantOf(role, kind)!.personFields(stored);
        const persons = fields.filter((f) => f.who === 'person').map((f) => f.key);
        for (const secret of secretFieldKeys(role, kind)) expect(persons, `${role} ${kind}`).toContain(secret);
        expect(JSON.stringify(fields), `${role} ${kind}`).not.toContain('SENTINEL-SECRET');
        for (const f of fields.filter((x) => x.who === 'owner')) expect(f.value, `${role} ${kind} ${f.key}`).toBeTruthy();
      }
    }
  });

  it('shows Apple’s address as the owner’s, asks for the app-specific password, and names Apple’s own servers', () => {
    const fields = passwordGrantOf('source', 'apple')!.personFields({ username: 'anna@icloud.com' });
    expect(fields.map((f) => [f.key, f.who, f.value])).toEqual([
      ['username', 'owner', 'anna@icloud.com'],
      ['password', 'person', undefined],
    ]);
    expect(fields[1]!.labelKey).toBe('account.appleAppPassword');
    expect(passwordServerOf('apple', { host: 'imap.attacker.example' })).toEqual({
      hosts: ['imap.mail.me.com', 'caldav.icloud.com', 'contacts.icloud.com'],
      published: true,
    });
  });

  it('lets the person fill Infomaniak’s sync username only when the owner left it empty, and asks the mail login only with a mail server', () => {
    const empty = passwordGrantOf('target', 'infomaniak')!.personFields({ host: 'sync.infomaniak.com' });
    expect(empty.filter((f) => f.who === 'person').map((f) => f.key)).toEqual(['username', 'password']);
    const named = passwordGrantOf('target', 'infomaniak')!.personFields({
      host: 'sync.infomaniak.com',
      username: 'AB12345',
      mailHost: 'mail.infomaniak.com',
      mailUsername: 'anna@example.org',
    });
    expect(named.filter((f) => f.who === 'person').map((f) => f.key)).toEqual(['password', 'mailPassword']);
    expect(named.find((f) => f.key === 'username')).toMatchObject({ who: 'owner', value: 'AB12345' });
  });

  it('names the owner’s own server for a generic kind, the DAV address and the mail server each once', () => {
    expect(
      passwordServerOf('soverin', {
        host: 'caldav.soverin.net',
        url: 'https://caldav.soverin.net/dav',
        mailHost: 'imap.soverin.net',
      }),
    ).toEqual({ hosts: ['caldav.soverin.net', 'imap.soverin.net'], published: false });
    expect(passwordServerOf('nextcloud', { url: 'https://cloud.example.org/remote.php/dav' })).toEqual({
      hosts: ['cloud.example.org'],
      published: false,
    });
  });

  it('has no test yet: T3 builds it, and until then it fails loudly rather than answering', async () => {
    await expect(
      passwordGrantOf('source', 'imap')!.test({ role: 'source', kind: 'imap', config: {}, credentials: {}, faces: [] }),
    ).rejects.toThrow(/workplan 0174 T3/);
  });
});
