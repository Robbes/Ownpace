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

  it('soverin already serves three, and file is the row a future edit adds', () => {
    expect(providerAccountDomains('soverin')).toEqual(['email', 'calendar', 'contact']);
    // Expected later in 2026 — and it must be MEASURED against the live
    // provider before it is added (0105's never-guess rule), never added on
    // an announcement.
    expect(providerAccountServes('soverin', 'file')).toBe(false);
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
