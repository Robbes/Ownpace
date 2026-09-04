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
  PROVIDER_ACCOUNT_DOMAINS,
  PROVIDER_ACCOUNT_KINDS,
  isProviderAccountKind,
  providerAccountDomains,
  providerAccountServes,
  providerAccountFacts,
} from './provider-accounts.ts';
import { SOURCE_TYPE_DOMAINS } from './target-domains.ts';

describe('a provider account serves the faces its row names', () => {
  it('google serves calendar and contacts today', () => {
    expect(providerAccountDomains('google')).toEqual(['calendar', 'contact']);
    expect(providerAccountServes('google', 'calendar')).toBe(true);
    expect(providerAccountServes('google', 'contact')).toBe(true);
  });

  it('google does NOT serve mail or files yet — the assessment, not the code', () => {
    // Google prices calendar and carddav as sensitive (free brand
    // verification) and Gmail and drive.readonly as restricted (annual
    // third-party assessment). A consent inviting all four would push the
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

  it('google serves no task face, and no scope class buys one', () => {
    // Not a pricing decision like mail and files: Google's CalDAV supports
    // neither VTODO nor VJOURNAL at all, so a restricted-scope deployment
    // gets exactly the same answer (0113 T5/T6).
    expect(providerAccountServes('google', 'task')).toBe(false);
    expect(providerAccountServes('google', 'task', { GOOGLE_ACCOUNT_SCOPE_CLASS: 'restricted' })).toBe(
      false,
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
      domains: ['calendar', 'contact'],
      client: 'connection',
    });
    expect(providerAccountFacts('google', pair)).toEqual({
      domains: ['calendar', 'contact'],
      client: 'deployment',
    });
    expect(providerAccountFacts('soverin', pair)).not.toHaveProperty('client');
  });

  it('carries the domains ceiling unchanged — one answer, not two routes', () => {
    expect(providerAccountFacts('google', { ...pair, GOOGLE_ACCOUNT_SCOPE_CLASS: 'restricted' })).toEqual(
      { domains: ['email', 'calendar', 'contact', 'file'], client: 'deployment' },
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
  it('serves four faces — the asymmetry with Google running the other way', () => {
    const faces = providerAccountDomains('microsoft', {});
    expect(faces).toEqual(['email', 'calendar', 'contact', 'file']);
    // Google offers two by default because mail and files are restricted
    // scopes; Microsoft's delegated equivalents carry no such tier.
    expect(providerAccountDomains('google', {})).toEqual(['calendar', 'contact']);
  });

  it('does not claim a task face it has no connector for', () => {
    // Microsoft HAS one at /me/todo/lists — unlike Google, which has none at
    // any scope tier. Ours is missing, not theirs, and 0114 T9 is where it
    // arrives. Claiming it here would offer a tick nothing could carry.
    expect(providerAccountServes('microsoft', 'task', {})).toBe(false);
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
