// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The consent asks for exactly what was ticked (workplan 0106 T1b).
 *
 * The owner's ask, verbatim: *"grant access to what they want and not
 * more/all."* This file is that sentence turned into something CI insists on.
 *
 * WHY THE GUARD IS NOT OBVIOUS. A too-BROAD scope is invisible in every way a
 * test normally notices: every feature works, no request fails, no error is
 * logged — the only trace is on a consent screen a person reads once, and on
 * an audit somebody runs later. The failure has no red. So the invariant is
 * asserted directly, twice: once on what the function returns, and once
 * against the table itself, so that adding a broader scope in the wrong field
 * is red before it reaches a consent screen.
 */

import { describe, it, expect } from 'vitest';
import {
  GOOGLE_SCOPES_ASKED_BY_DOMAIN,
  domainsToScopes,
  type GoogleGrantDomain,
} from './account-qualification.ts';

const ALL: ReadonlyArray<GoogleGrantDomain> = ['mail', 'calendar', 'contact', 'file'];

/** Every scope Google publishes that is BROADER than something we ask for.
 *  Written out rather than derived, so the guard has an independent opinion:
 *  a table that widened itself could not also widen this list. */
const BROADER_THAN_WE_NEED = [
  'https://www.googleapis.com/auth/drive',
  'https://mail.google.com/feed/atom',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/cloud-platform',
];

describe('the ask is exactly the ticks', () => {
  it('asks one scope for one domain', () => {
    expect(domainsToScopes(['mail'])).toEqual(['https://mail.google.com/']);
    expect(domainsToScopes(['contact'])).toEqual([
      'https://www.googleapis.com/auth/carddav',
    ]);
  });

  it('asks nothing for a domain that was not ticked', () => {
    const asked = domainsToScopes(['mail', 'file']);
    expect(asked).not.toContain('https://www.googleapis.com/auth/calendar');
    expect(asked).not.toContain('https://www.googleapis.com/auth/carddav');
  });

  it('never returns more scopes than domains ticked', () => {
    // The arithmetic version of the invariant: two ticks can never become
    // three scopes, however the table is shaped.
    for (const ticks of [['mail'], ['mail', 'calendar'], ALL] as GoogleGrantDomain[][]) {
      expect(domainsToScopes(ticks).length).toBe(ticks.length);
    }
  });

  it('is stable and deduplicated, so the same ticks give the same screen', () => {
    // A person approving a consent should recognise today's screen as
    // yesterday's. Set order and duplicates must not reach the URL.
    expect(domainsToScopes(['file', 'mail', 'mail'])).toEqual(
      domainsToScopes(['mail', 'file']),
    );
    expect(domainsToScopes(new Set<GoogleGrantDomain>(['calendar', 'mail']))).toEqual([
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/calendar',
    ]);
  });

  it('returns NOTHING for no ticks — a caller must refuse, not substitute', () => {
    // The tempting alternative is a default scope set. A default here is a
    // path to a consent screen nobody asked for.
    expect(domainsToScopes([])).toEqual([]);
  });
});

describe('the ask can never be a superset — proved against the table', () => {
  it('asks for the READ-ONLY Drive scope, never the read-write one', () => {
    // The one domain where a broader scope exists and works. `auth/drive`
    // grants write access to every file in the account; a migration reads.
    expect(domainsToScopes(['file'])).toEqual([
      'https://www.googleapis.com/auth/drive.readonly',
    ]);
    expect(domainsToScopes(ALL)).not.toContain('https://www.googleapis.com/auth/drive');
  });

  it('no domain asks for a scope on the broader list', () => {
    // BREAK THIS to see it work: move `auth/drive` from `alsoAccepted` into
    // `asked` for the file domain and this goes red, at the table, before any
    // consent screen is built from it.
    for (const domain of ALL) {
      expect(
        BROADER_THAN_WE_NEED,
        `${domain} must not ASK for a scope broader than it needs`,
      ).not.toContain(GOOGLE_SCOPES_ASKED_BY_DOMAIN[domain]);
    }
  });

  it('every asked scope is one the product actually mints tokens with', () => {
    // The other direction of the same worry: a scope that is narrow but wrong
    // produces a token Google refuses at the endpoint, mid-pass, as an auth
    // error that reads like the provider is down.
    expect(new Set(Object.values(GOOGLE_SCOPES_ASKED_BY_DOMAIN))).toEqual(
      new Set([
        'https://mail.google.com/',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/carddav',
        'https://www.googleapis.com/auth/drive.readonly',
      ]),
    );
  });
});
