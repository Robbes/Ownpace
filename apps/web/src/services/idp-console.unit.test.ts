// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The link out to the account, and the four ways it refuses to be one.
 *
 * The support screen can send an operator to the person's account at the
 * identity provider, because that is where the account-level work is done and
 * ADR-0042 keeps it there. The link is a DEPLOYMENT variable rather than
 * `${issuer}` plus a path, and `no-issuer-lock-in.unit.test.ts` now refuses all
 * three providers' console paths in shipped source so it stays that way.
 *
 * What is pinned here is the other half: given a template, what comes out — and
 * given a template that cannot work, that nothing does.
 */

import { describe, it, expect } from 'vitest';
import {
  idpConsoleUserUrl,
  isPendingSubject,
  localSubjectKind,
  LOCAL_SUBJECT_PREFIXES,
  SUBJECT_PLACEHOLDER,
} from './idp-console.ts';

/**
 * The environment is handed in, never stubbed. `import.meta.env` is not shared
 * between modules under vitest — the lesson `oidc.ts` records — so a stubbed
 * value would set it on THIS file and the module under test would go on reading
 * its own empty one, and every positive case would quietly assert null.
 * Measured, after writing it the other way.
 */
const at = (VITE_IDP_CONSOLE_USER_URL: string) => ({ VITE_IDP_CONSOLE_USER_URL });

describe('idpConsoleUserUrl', () => {
  it('substitutes the subject into the deployment’s template', () => {
    expect(
      idpConsoleUserUrl(
        '388706935093854213',
        at(`https://id.example.test/ui/console/users/${SUBJECT_PLACEHOLDER}`),
      ),
    ).toBe('https://id.example.test/ui/console/users/388706935093854213');
  });

  it('works for a provider whose console is shaped nothing like the last one', () => {
    // The whole point of the variable: this is Keycloak's shape, and no code in
    // apps/web knows it. Swapping issuer stays four variables and a rebuild.
    expect(
      idpConsoleUserUrl(
        'abc-123',
        at(
          `https://id.example.test/admin/master/console/#/ownpace/users/${SUBJECT_PLACEHOLDER}/settings`,
        ),
      ),
    ).toContain('/users/abc-123/settings');
  });

  it('escapes a subject rather than trusting its shape', () => {
    // `sub` is opaque and the provider decides what is in it. Nothing here may
    // assume it is URL-safe.
    expect(
      idpConsoleUserUrl('a b/c?d', at(`https://id.example.test/u/${SUBJECT_PLACEHOLDER}`)),
    ).toBe('https://id.example.test/u/a%20b%2Fc%3Fd');
  });

  it('answers null when the deployment has not been told', () => {
    // The ordinary case, and it must render a screen rather than a dead anchor:
    // the appliance has no issuer at all (hard rule 5), and a stack mid-upgrade
    // has not been given the variable yet.
    expect(idpConsoleUserUrl('u1')).toBeNull();
    expect(idpConsoleUserUrl('u1', at('   '))).toBeNull();
  });

  it('refuses a template that carries no subject', () => {
    // Worse than no link, because it looks like it worked: every person on the
    // screen would go to the same page.
    expect(idpConsoleUserUrl('u1', at('https://id.example.test/ui/console/users'))).toBeNull();
  });

  it('refuses a scheme that is not http(s)', () => {
    // This value reaches an href. Build-time config is not user input, but a
    // refusal costs nothing and closes it.
    expect(idpConsoleUserUrl('u1', at(`javascript:alert(${SUBJECT_PLACEHOLDER})`))).toBeNull();
  });

  it('refuses when there is no subject to link to', () => {
    const template = at(`https://id.example.test/u/${SUBJECT_PLACEHOLDER}`);
    expect(idpConsoleUserUrl('', template)).toBeNull();
    expect(idpConsoleUserUrl('   ', template)).toBeNull();
  });

  it('refuses a template that is not a URL at all', () => {
    expect(idpConsoleUserUrl('u1', at(`not a url ${SUBJECT_PLACEHOLDER}`))).toBeNull();
  });
});

describe('a subject the provider never minted', () => {
  const TEMPLATE = { VITE_IDP_CONSOLE_USER_URL: 'https://id.example.test/ui/console/users/{sub}' };

  it('refuses a pending: invitation, which has no account to link to', () => {
    // Granting writes `pending:<uuid>` because the person has not signed in
    // yet. Linking it sends an operator to a console page about a user that
    // does not exist — which looks like a broken product, not like somebody
    // who has not arrived.
    expect(idpConsoleUserUrl('pending:6b1f0f1e-0000-4000-8000-000000000001', TEMPLATE)).toBeNull();
  });

  it('still links a real subject that merely CONTAINS the word', () => {
    // The prefix, not a substring: refusing anything with "pending" in it
    // would drop real accounts for a coincidence of spelling.
    expect(idpConsoleUserUrl('388706935093854213-pending', TEMPLATE)).toContain(
      '388706935093854213-pending',
    );
    expect(idpConsoleUserUrl('user-pending:1', TEMPLATE)).toContain('user-pending');
  });

  it('refuses it however it is spaced, since the value is trimmed anyway', () => {
    expect(idpConsoleUserUrl('  pending:abc  ', TEMPLATE)).toBeNull();
  });

  it('still links the ordinary case — a provider subject', () => {
    // The control. A refusal that also refused real users would hide the
    // feature rather than fix it.
    expect(idpConsoleUserUrl('388706935093854213', TEMPLATE)).toBe(
      'https://id.example.test/ui/console/users/388706935093854213',
    );
  });
});

describe('isPendingSubject — which KIND of "no link" this is', () => {
  it('is true for what granting writes', () => {
    expect(isPendingSubject('pending:6b1f0f1e-0000-4000-8000-000000000001')).toBe(true);
  });

  it('is false for a provider subject, however it is spelled', () => {
    // The screen shows a reason only when there is one. Saying "has not signed
    // in yet" about somebody who has would be worse than saying nothing.
    expect(isPendingSubject('387865757964304395')).toBe(false);
    expect(isPendingSubject('user-pending:1')).toBe(false);
    expect(isPendingSubject('388706935093854213-pending')).toBe(false);
  });

  it('agrees with idpConsoleUserUrl, which is the point of exporting it', () => {
    // Two readings of one rule that must not drift: the link refuses exactly
    // the subjects the screen explains, or an operator gets a reason beside a
    // working link, or no reason beside a missing one.
    const TEMPLATE = { VITE_IDP_CONSOLE_USER_URL: 'https://id.example.test/users/{sub}' };
    for (const sub of ['pending:abc', '  pending:abc  ', '387865757964304395', 'x-pending:1']) {
      expect(idpConsoleUserUrl(sub, TEMPLATE) === null, sub).toBe(isPendingSubject(sub));
    }
  });
});

/**
 * AND THE OTHER SUBJECT NO PROVIDER EVER MINTED.
 *
 * `pending:` was found on 2026-08-31 and fixed; `seed:` was found the same way
 * on 2026-09-01, by the same person, one row further down the same screen. The
 * owner clicked `owner-a@demo.openmigrate.test` on the support screen and
 * landed on the identity provider's full user list — because the demo seed
 * writes its owners straight into `tenant_member`, and no provider has ever
 * heard of them.
 *
 * The lesson the second one carries is that this is a CATEGORY rather than a
 * case, so the link is now refused for anything in `LOCAL_SUBJECT_PREFIXES`
 * rather than for `pending:` by name. A third kind added later is refused by
 * default instead of by somebody remembering this file exists.
 */
describe('every subject that is ours rather than theirs', () => {
  const TEMPLATE = { VITE_IDP_CONSOLE_USER_URL: 'https://id.example.test/users/{sub}' };

  it('refuses a seeded demo fixture, which is nobody at all', () => {
    expect(idpConsoleUserUrl('seed:demo-owner-a', TEMPLATE)).toBeNull();
    expect(localSubjectKind('seed:demo-owner-a')).toBe('seed');
  });

  it('tells the two kinds apart, because the screen says different things', () => {
    // "Has not signed in yet" is true of an invitation and false of a fixture.
    // One changes by itself when they arrive; the other never changes.
    expect(localSubjectKind('pending:9a1f')).toBe('pending');
    expect(isPendingSubject('pending:9a1f')).toBe(true);
    expect(isPendingSubject('seed:demo-owner-a')).toBe(false);
  });

  it('leaves real subjects alone, however they are spelled', () => {
    // THE HALF THAT MATTERS MOST. A prefix match that caught a real subject
    // would silently remove the way through to a real account.
    for (const sub of ['387865757964304395', 'user-seed:1', 'seeded', 'aseed:x', 'SEED:x']) {
      expect(localSubjectKind(sub), sub).toBeNull();
      expect(idpConsoleUserUrl(sub, TEMPLATE), sub).not.toBeNull();
    }
  });

  it('refuses every declared prefix, so a third kind is safe by default', () => {
    // Read from the exported list rather than restated: adding an entry there
    // and forgetting the link is the failure this shape exists to make
    // impossible, and a test that hard-coded two names would not notice.
    for (const prefix of Object.values(LOCAL_SUBJECT_PREFIXES)) {
      expect(idpConsoleUserUrl(`${prefix}whoever`, TEMPLATE), prefix).toBeNull();
      expect(localSubjectKind(`${prefix}whoever`), prefix).not.toBeNull();
    }
  });
});
