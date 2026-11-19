// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One account, several faces (workplan 0106 T3b).
 *
 * The owner asked for the general shape rather than a Google one — *"since we
 * will have this more often… Soverin will add Nextcloud for files later this
 * year"* — so what is pinned here is that adding a face is a ROW EDIT and
 * nothing else. A test that only checked Google's two domains would pass
 * happily while somebody reintroduced a `switch (kind)` beside it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAIL_LOGIN_APART_KINDS,
  PROVIDER_ACCOUNT_DOMAINS,
  PROVIDER_ACCOUNT_KINDS,
  halfMailLogin,
  halfMailLoginRefusal,
  isProviderAccountKind,
  keepingTheMailLogin,
  mailLoginOf,
  missingMailLogin,
  providerAccountDomains,
  providerAccountServes,
  providerAccountFacts,
  signsInToMailApart,
  storesItsMailServer,
  targetCredentialRecord,
} from './provider-accounts.ts';
import { SOURCE_TYPE_DOMAINS } from './target-domains.ts';

describe('a provider account serves the faces its row names', () => {
  it('google serves calendar, contacts and tasks today', () => {
    expect(providerAccountDomains('google')).toEqual(['calendar', 'contact', 'task']);
    expect(providerAccountServes('google', 'calendar')).toBe(true);
    expect(providerAccountServes('google', 'contact')).toBe(true);
    expect(providerAccountServes('google', 'task')).toBe(true);
  });

  it('google does NOT serve mail or files yet — the assessment, not the code', () => {
    // Google prices calendar, carddav and tasks.readonly as sensitive (free
    // brand verification) and Gmail and drive.readonly as restricted (annual
    // third-party assessment). A consent inviting all five would push the
    // managed client into the restricted tier for every customer, including
    // one who only wanted contacts.
    expect(providerAccountServes('google', 'email')).toBe(false);
    expect(providerAccountServes('google', 'file')).toBe(false);
  });

  it('soverin serves four — tasks ride its CalDAV face — and file is the row a future edit adds', () => {
    expect(providerAccountDomains('soverin')).toEqual(['email', 'calendar', 'contact', 'task']);
    // 'task' joined on 2026-09-03 under the never-guess rule rather than
    // around it: the owner has a Tasks list in his own Soverin account, and a
    // task list IS a calendar collection declaring VTODO — the CalDAV face
    // this row already claimed (0113 T5).
    expect(providerAccountServes('soverin', 'task')).toBe(true);
    // Files are still expected later in 2026 — and must be MEASURED against
    // the live provider before they are added, never added on an
    // announcement.
    expect(providerAccountServes('soverin', 'file')).toBe(false);
  });

  it('google serves its task face at both tiers, over the Tasks API (0126 T2)', () => {
    // Until 2026-09-23 this pinned the opposite: Google's CalDAV supports
    // neither VTODO nor VJOURNAL (0113 T5), and the Tasks API was not driven.
    // It is now, under the sensitive tasks.readonly, so a deployment that
    // declares the restricted tier must keep the face rather than lose it for
    // having asked for more.
    expect(providerAccountServes('google', 'task')).toBe(true);
    expect(providerAccountServes('google', 'task', { GOOGLE_ACCOUNT_SCOPE_CLASS: 'restricted' })).toBe(
      true,
    );
  });

  it('answers "not a provider account" rather than throwing', () => {
    // Callers ask about arbitrary kinds. An IMAP host is a protocol somebody
    // typed, not an account that told us what else it does.
    for (const kind of ['imap', 'jmap', 'nextcloud', '', 'GOOGLE', 'google_drive']) {
      expect(isProviderAccountKind(kind)).toBe(false);
      expect(providerAccountDomains(kind)).toEqual([]);
      expect(providerAccountServes(kind, 'email')).toBe(false);
    }
  });
});

describe('one table, not two', () => {
  it('the wizard source vocabulary READS the provider table, never a copy', () => {
    // Two copies of a capability list disagree in exactly one way — the wizard
    // offers a face the provider row does not serve, or refuses one it does —
    // and 0106 T1b just removed that same drift from the Google SCOPE tables.
    expect(SOURCE_TYPE_DOMAINS.google).toBe(PROVIDER_ACCOUNT_DOMAINS.google);
  });

  it('adding a face is a row edit — no kind fork anywhere in shared', () => {
    // The #597 defect was a kind-fork divergence. This reads the sources
    // rather than trusting the comment above them.
    const dir = import.meta.dirname;
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.includes('.test.')) continue;
      const src = readFileSync(join(dir, f), 'utf-8');
      // A switch on a provider-account kind is the shape that must not appear.
      for (const kind of PROVIDER_ACCOUNT_KINDS) {
        if (new RegExp(`case\\s+['"\`]${kind}['"\`]\\s*:`).test(src)) {
          offenders.push(`${f} switches on '${kind}'`);
        }
      }
    }
    expect(offenders, 'a provider face must be a row, not a branch').toEqual([]);
  });
});

describe('the vocabulary itself', () => {
  it('every kind in the list has a domain row, and vice versa', () => {
    // A kind with no row serves nothing and would silently offer no faces; a
    // row with no kind is a face nobody can reach.
    expect(Object.keys(PROVIDER_ACCOUNT_DOMAINS).sort()).toEqual([...PROVIDER_ACCOUNT_KINDS].sort());
  });

  it('no provider row is empty — a row that serves nothing is a lie', () => {
    for (const kind of PROVIDER_ACCOUNT_KINDS) {
      expect(PROVIDER_ACCOUNT_DOMAINS[kind].length, `${kind} serves nothing`).toBeGreaterThan(0);
    }
  });

  it('no row repeats a face', () => {
    for (const kind of PROVIDER_ACCOUNT_KINDS) {
      const domains = PROVIDER_ACCOUNT_DOMAINS[kind];
      expect(new Set(domains).size, `${kind} lists a face twice`).toBe(domains.length);
    }
  });
});

describe('the client fact beside the domains (ADR-0041, owner decision 2026-09-01)', () => {
  const none = {};
  const pair = { GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'not-a-real-secret' };

  it('google answers where its client comes from; soverin has no such thing to answer', () => {
    expect(providerAccountFacts('google', none)).toEqual({
      domains: ['calendar', 'contact', 'task'],
      client: 'connection',
    });
    expect(providerAccountFacts('google', pair)).toEqual({
      domains: ['calendar', 'contact', 'task'],
      client: 'deployment',
    });
    expect(providerAccountFacts('soverin', pair)).not.toHaveProperty('client');
  });

  it('carries the domains ceiling unchanged — one answer, not two routes', () => {
    expect(providerAccountFacts('google', { ...pair, GOOGLE_ACCOUNT_SCOPE_CLASS: 'restricted' })).toEqual(
      { domains: ['email', 'calendar', 'contact', 'file', 'task'], client: 'deployment' },
    );
  });

  it('half a pair is no client', () => {
    // `googleDeploymentClient`'s rule, seen from the screen's side: a wizard
    // told 'deployment' drops two required fields, and must not on a typo.
    expect(providerAccountFacts('google', { GOOGLE_OAUTH_CLIENT_ID: 'cid' }).client).toBe('connection');
    expect(providerAccountFacts('google', { GOOGLE_OAUTH_CLIENT_SECRET: 's' }).client).toBe('connection');
    expect(providerAccountFacts('google', { GOOGLE_OAUTH_CLIENT_ID: '  ', GOOGLE_OAUTH_CLIENT_SECRET: 's' }).client).toBe('connection');
  });

  it('answers "not a provider account" with no client either', () => {
    expect(providerAccountFacts('imap', pair)).toEqual({ domains: [] });
  });
});

/**
 * THE THIRD PROVIDER ACCOUNT, AND THE FAN-OUT ITS ARRIVAL CREATED.
 *
 * Workplan 0114 T3. `microsoft` joining the table is one row and needs no
 * branch — that is what the table is for. What DID need care is
 * `providerAccountFacts`: it answered `client` with `if (kind !== 'google')`,
 * which is a condition while there are two providers and a fan-out the moment
 * there are three. It is now a probe table, and the last test here is the one
 * that keeps it honest when a fourth arrives.
 */
describe('the microsoft account kind (0114 T3)', () => {
  it('serves five faces — the asymmetry with Google running the other way', () => {
    const faces = providerAccountDomains('microsoft', {});
    expect(faces).toEqual(['email', 'calendar', 'contact', 'file', 'task']);
    // Google offers three by default because mail and files are restricted
    // scopes; Microsoft's delegated equivalents carry no such tier.
    expect(providerAccountDomains('google', {})).toEqual(['calendar', 'contact', 'task']);
  });

  it('claims the task face since 0114 T9 — and Google since 0126 T2', () => {
    // Microsoft HAS one at /me/todo/lists, and `graph-todo-source` now reads
    // it. Until T9 this line pinned the opposite, because claiming a face
    // nothing could carry would have offered a tick that ran against nothing.
    // Google's followed on 2026-09-23, over its Tasks API.
    expect(providerAccountServes('microsoft', 'task', {})).toBe(true);
    expect(providerAccountServes('google', 'task', {})).toBe(true);
  });

  it('answers where its OAuth application comes from, like google and unlike soverin', () => {
    const withPair = {
      MICROSOFT_OAUTH_CLIENT_ID: 'id',
      MICROSOFT_OAUTH_CLIENT_SECRET: 'secret',
    };
    expect(providerAccountFacts('microsoft', withPair).client).toBe('deployment');
    expect(providerAccountFacts('microsoft', {}).client).toBe('connection');
    // Soverin has no OAuth client to speak of; claiming 'connection' would be
    // a claim about a thing that does not exist.
    expect(providerAccountFacts('soverin', withPair).client).toBeUndefined();
  });

  it('half a pair is not a deployment client, here as everywhere', () => {
    expect(
      providerAccountFacts('microsoft', { MICROSOFT_OAUTH_CLIENT_ID: 'id' }).client,
    ).toBe('connection');
  });

  it("does not answer google's client from microsoft's application, or the reverse", () => {
    // `clientId`/`clientSecret` are shared key names across providers; the
    // env vars are not, and this is what keeps them apart.
    const onlyMicrosoft = {
      MICROSOFT_OAUTH_CLIENT_ID: 'id',
      MICROSOFT_OAUTH_CLIENT_SECRET: 'secret',
    };
    expect(providerAccountFacts('google', onlyMicrosoft).client).toBe('connection');
    const onlyGoogle = { GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' };
    expect(providerAccountFacts('microsoft', onlyGoogle).client).toBe('connection');
  });

  it('every kind gets an answer, and no kind gets a crash', () => {
    // The fan-out guard. A fourth provider kind added to
    // PROVIDER_ACCOUNT_KINDS without a row in PROVIDER_ACCOUNT_DOMAINS, or
    // one whose facts throw, fails HERE rather than on a screen.
    for (const kind of PROVIDER_ACCOUNT_KINDS) {
      const facts = providerAccountFacts(kind, {});
      expect(facts.domains.length, `${kind} serves no face`).toBeGreaterThan(0);
      // `client` is undefined or one of the two sources — never a third thing.
      if (facts.client !== undefined) {
        expect(['deployment', 'connection']).toContain(facts.client);
      }
    }
  });
});

/**
 * THE ACCOUNT THAT SIGNS IN TO ITS MAIL APART (workplan 0161 T1).
 *
 * Infomaniak's calendars and contacts sign in with the account's sync login
 * (a short username and an app password), and its mail with the mailbox's
 * own (the address and the password made on its Devices tab), because an app
 * password "ne permettra pas de synchroniser une adresse mail". So one secret
 * holds two logins, and every seam that signs in to mail asks `mailLoginOf`.
 * What is pinned here is the table and the four functions every seam and door
 * reads, and that Soverin and Cirrux, which sign in with one login, answer
 * exactly as before.
 */
describe('the infomaniak account kind and its two logins (0161 T1)', () => {
  // Obvious dummies: no real login is ever written into a test.
  const STORED = {
    username: 'AB12345',
    password: 'dummy-sync-app-password',
    mailUsername: 'someone@example.com',
    mailPassword: 'dummy-mailbox-device-password',
  };

  it('serves four faces, files not among them, and stores its mail server as Soverin does', () => {
    expect(providerAccountDomains('infomaniak')).toEqual(['email', 'calendar', 'contact', 'task']);
    expect(providerAccountServes('infomaniak', 'file')).toBe(false);
    expect(storesItsMailServer('infomaniak')).toBe(true);
    // No OAuth client to speak of.
    expect(providerAccountFacts('infomaniak', {})).toEqual({ domains: ['email', 'calendar', 'contact', 'task'] });
  });

  it('is the one kind that signs in to its mail apart', () => {
    expect([...MAIL_LOGIN_APART_KINDS]).toEqual(['infomaniak']);
    expect(signsInToMailApart('infomaniak')).toBe(true);
    for (const kind of ['soverin', 'cirrux', 'apple', 'imap', 'jmap', 'nextcloud', '']) {
      expect(signsInToMailApart(kind), kind).toBe(false);
    }
  });

  it('mailLoginOf: the mailbox’s own login for infomaniak, never its sync login', () => {
    expect(mailLoginOf('infomaniak', STORED)).toEqual({
      username: 'someone@example.com',
      password: 'dummy-mailbox-device-password',
    });
    // Without a mail login, nothing: never the sync pair in its place.
    expect(mailLoginOf('infomaniak', { username: 'AB12345', password: 'dummy-sync-app-password' })).toEqual({
      username: '',
      password: '',
    });
  });

  it('mailLoginOf: every other kind keeps its one login exactly as stored', () => {
    for (const kind of ['soverin', 'cirrux', 'imap', 'jmap', 'apple']) {
      expect(mailLoginOf(kind, STORED), kind).toEqual({ username: 'AB12345', password: 'dummy-sync-app-password' });
      // Never the mailbox keys, even where a record happens to carry them.
      expect(mailLoginOf(kind, { mailUsername: 'x', mailPassword: 'y' }), kind).toEqual({ username: '', password: '' });
    }
    // A number is not a value (a create body's config has ports in it).
    expect(mailLoginOf('imap', { username: 'a', password: 7 })).toEqual({ username: 'a', password: '' });
  });

  it('missingMailLogin names each half the record lacks, and nothing for a kind with one login', () => {
    expect(missingMailLogin('infomaniak', STORED)).toEqual([]);
    expect(missingMailLogin('infomaniak', { username: 'AB12345', password: 'p' })).toEqual(['mailUsername', 'mailPassword']);
    expect(missingMailLogin('infomaniak', { mailUsername: 'someone@example.com', mailPassword: '   ' })).toEqual(['mailPassword']);
    expect(missingMailLogin('soverin', {})).toEqual([]);
  });

  it('halfMailLogin: the missing half when one was given, nothing for both or neither', () => {
    expect(halfMailLogin('infomaniak', { mailUsername: 'someone@example.com' })).toBe('mailPassword');
    expect(halfMailLogin('infomaniak', { mailPassword: 'p' })).toBe('mailUsername');
    expect(halfMailLogin('infomaniak', { mailUsername: '', mailPassword: '' })).toBeUndefined();
    expect(halfMailLogin('infomaniak', STORED)).toBeUndefined();
    // A kind with one login has no half to refuse, whatever it is sent.
    expect(halfMailLogin('cirrux', { mailUsername: 'someone@example.com' })).toBeUndefined();
    const sentence = halfMailLoginRefusal('mailPassword');
    expect(sentence).toContain('mailUsername was sent without mailPassword');
  });

  it('targetCredentialRecord: the pair as every door stored it, and the mail login beside it for infomaniak', () => {
    const typed = { host: 'sync.infomaniak.com', port: 443, ...STORED };
    expect(targetCredentialRecord('infomaniak', typed)).toEqual(STORED);
    // Without a mail login: the sync pair alone, no empty keys.
    expect(targetCredentialRecord('infomaniak', { username: 'AB12345', password: 'p', mailUsername: ' ', mailPassword: '' })).toEqual({
      username: 'AB12345',
      password: 'p',
    });
    // Every other kind stores exactly the pair, as `{ username, password }` by hand did.
    for (const kind of ['soverin', 'cirrux', 'imap', 'jmap', 'caldav', 'nextcloud']) {
      expect(targetCredentialRecord(kind, typed), kind).toEqual({ username: 'AB12345', password: 'dummy-sync-app-password' });
    }
    expect(targetCredentialRecord('caldav', {})).toEqual({ username: '', password: '' });
  });

  it('keepingTheMailLogin: blank mail boxes keep the stored login; both typed replace it', () => {
    const renewed = { username: 'AB12345', password: 'dummy-renewed-app-password' };
    expect(keepingTheMailLogin('infomaniak', STORED, renewed)).toEqual({
      ...renewed,
      mailUsername: 'someone@example.com',
      mailPassword: 'dummy-mailbox-device-password',
    });
    // Kept whichever sync login replaces the old one: it is the mailbox's.
    expect(keepingTheMailLogin('infomaniak', STORED, { username: 'CD67890', password: 'p' }).mailUsername).toBe(
      'someone@example.com',
    );
    const newMail = { ...renewed, mailUsername: 'other@example.com', mailPassword: 'dummy-new-device-password' };
    expect(keepingTheMailLogin('infomaniak', STORED, newMail)).toEqual(newMail);
    // Nothing stored, nothing kept.
    expect(keepingTheMailLogin('infomaniak', {}, renewed)).toEqual(renewed);
    // A kind with one login keeps nothing it was not sent.
    expect(keepingTheMailLogin('cirrux', STORED, renewed)).toEqual(renewed);
  });
});
