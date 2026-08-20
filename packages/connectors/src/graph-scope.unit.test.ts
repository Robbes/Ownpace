// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Whose mailbox a Graph connector reads (workplan 0027 T0).
 *
 * The default matters as much as the new capability: every existing mapping
 * relies on `/me`, and this seam must not change what any of them do.
 *
 * The rest of these tests are about ONE failure. Under application
 * permissions the app can address any mailbox its Application Access Policy
 * allows, so an address that silently degrades into `/users/` would aim a
 * request at the tenant's user COLLECTION — a listing of everybody, from code
 * that meant to read one person's mail. That is why an unusable address is a
 * throw at construction rather than a URL nobody inspected.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveMailboxScope,
  scopePrefix,
  graphScopePrefix,
  directoryNotEnumerable,
} from './graph-scope.ts';

const BASE = 'https://graph.microsoft.com/v1.0';

describe('the default is unchanged', () => {
  it('reads /me when no mailbox is configured', () => {
    expect(resolveMailboxScope()).toEqual({ kind: 'me' });
    expect(graphScopePrefix(BASE)).toBe('https://graph.microsoft.com/v1.0/me');
  });

  it('tolerates a trailing slash on the base url', () => {
    expect(graphScopePrefix('https://graph.microsoft.com/v1.0/')).toBe(
      'https://graph.microsoft.com/v1.0/me',
    );
  });
});

describe('a configured mailbox', () => {
  it('addresses that user instead', () => {
    expect(graphScopePrefix(BASE, 'gedeeld@example.nl')).toBe(
      'https://graph.microsoft.com/v1.0/users/gedeeld%40example.nl',
    );
  });

  it('percent-encodes the address', () => {
    // A guest account's UPN carries `#`, which would otherwise terminate the
    // path and turn the rest of the URL into a fragment.
    expect(graphScopePrefix(BASE, 'gast_example.com#EXT#@tenant.nl')).toContain('%23EXT%23');
  });

  it('trims incidental whitespace rather than refusing over it', () => {
    expect(resolveMailboxScope('  shared@example.nl  ')).toEqual({
      kind: 'user',
      address: 'shared@example.nl',
    });
  });
});

describe('an address that would aim somewhere nobody chose', () => {
  it('refuses an empty string, and says why it is not the same as unset', () => {
    expect(() => resolveMailboxScope('')).toThrow(/empty/);
    // The distinction is the whole point: unset means /me, empty means a
    // configuration mistake that would have addressed the user collection.
    expect(() => resolveMailboxScope('   ')).toThrow(/user collection/);
  });

  it('refuses a value carrying a slash', () => {
    // `a@b.nl/../../` would walk out of the mailbox and into another endpoint.
    expect(() => resolveMailboxScope('a@b.nl/messages')).toThrow(/not a usable user/);
  });

  it('refuses query and fragment characters', () => {
    expect(() => resolveMailboxScope('a@b.nl?$filter=x')).toThrow(/not a usable user/);
    expect(() => resolveMailboxScope('a@b.nl#frag')).toThrow(/not a usable user/);
  });

  it('refuses something that is plainly not an address', () => {
    expect(() => resolveMailboxScope('shared mailbox')).toThrow(/name@domain\.tld/);
    expect(() => resolveMailboxScope('nodomain@')).toThrow();
    expect(() => resolveMailboxScope('@nolocal.nl')).toThrow();
  });

  it('names the offending value, so the fix is obvious', () => {
    expect(() => resolveMailboxScope('oops')).toThrow(/"oops"/);
  });
});

describe('scopePrefix', () => {
  it('renders a pre-resolved scope without re-validating', () => {
    expect(scopePrefix(BASE, { kind: 'me' })).toBe(`${BASE}/me`);
    expect(scopePrefix(BASE, { kind: 'user', address: 'a@b.nl' })).toBe(`${BASE}/users/a%40b.nl`);
  });
});

describe('what a source says when it cannot enumerate a directory', () => {
  it('carries the reason and refuses to read as "nothing found"', () => {
    const said = directoryNotEnumerable('IMAP has no directory endpoint');
    expect(said).toContain('IMAP has no directory endpoint');
    // The sentence 0028's detector needs, and hard rule 9's whole point: the
    // difference between looking and finding nothing, and never looking.
    expect(said).toContain('nothing was looked at');
    expect(said).not.toMatch(/no new mailboxes found[^"]*$/);
  });
});
