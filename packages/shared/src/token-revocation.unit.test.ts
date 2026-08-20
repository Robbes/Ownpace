// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What we may claim about a credential we deleted (workplan 0085 T4a).
 *
 * The dangerous failure here is not a revocation that does not happen — it is a
 * receipt that says one did. A customer reads `revoked` as "done" and anything
 * else as "go and remove this yourself", so a green tick on a provider we
 * cannot actually revoke would stop them doing the one thing that works.
 *
 * Hence the shape of these tests: they care most about what is claimed, and
 * about an unknown kind defaulting to "we could not" rather than to silence.
 */

import { describe, it, expect } from 'vitest';
import {
  NO_REVOCATION,
  REVOCATION_CAPABILITIES,
  revocationCapability,
  revocationSummaryText,
  summariseRevocations,
  type RevocationOutcome,
} from './token-revocation.ts';

describe('revocationCapability', () => {
  it.each(['gmail', 'google_drive', 'google_calendar', 'google_contacts'])(
    '%s is revocable — Google publishes an endpoint we can call',
    (kind) => {
      expect(revocationCapability(kind).revocable).toBe(true);
    },
  );

  it.each([
    ['o365', /no OAuth revocation endpoint/i],
    ['dropbox', /access token/i],
    ['box', /client secret/i],
  ])('%s is not revocable, and the reason is a fact about the provider', (kind, reason) => {
    const cap = revocationCapability(kind);
    expect(cap.revocable).toBe(false);
    expect(cap.reason).toMatch(reason);
  });

  it.each(['imap', 'jmap', 'caldav', 'carddav', 'webdav', 'nextcloud', 'proton', 'soverin', 'selfhosted_mail'])(
    '%s authenticates with a password, which only its owner can change',
    (kind) => {
      const cap = revocationCapability(kind);
      expect(cap.revocable).toBe(false);
      expect(cap.reason).toMatch(/password/i);
    },
  );

  it('an unknown kind is unsupported, never silently fine', () => {
    // A connection kind added later without a decision here must surface as one
    // we do not know how to revoke — which is true, and prompts the decision.
    // Inheriting a quiet "nothing to do" would read as success.
    const cap = revocationCapability('some_future_provider');

    expect(cap.revocable).toBe(false);
    expect(cap.reason).toContain('some_future_provider');
    expect(cap.reason).toMatch(/withdrawn by the customer/i);
  });

  it('every declared capability carries a reason', () => {
    for (const [kind, cap] of Object.entries(REVOCATION_CAPABILITIES)) {
      expect(cap.reason.length, `${kind} has no reason`).toBeGreaterThan(20);
    }
  });
});

describe('NO_REVOCATION', () => {
  it('produces the same shaped receipt, saying no attempt was made', async () => {
    // The appliance has no revoker. Nothing downstream should have to
    // special-case its absence, and the receipt must not imply an attempt.
    const outcome = await NO_REVOCATION.revoke({ kind: 'gmail', credentials: {} });

    expect(outcome).toEqual({
      kind: 'gmail',
      status: 'unsupported',
      reason: 'This deployment does not attempt provider-side revocation.',
    });
  });
});

describe('summariseRevocations', () => {
  it('counts every status, including the ones that are zero', () => {
    const outcomes: RevocationOutcome[] = [
      { kind: 'gmail', status: 'revoked' },
      { kind: 'o365', status: 'unsupported', reason: 'x' },
      { kind: 'dropbox', status: 'unsupported', reason: 'x' },
      { kind: 'google_drive', status: 'failed', reason: 'x' },
    ];
    expect(summariseRevocations(outcomes)).toEqual({
      revoked: 1,
      failed: 1,
      unsupported: 2,
      no_credential: 0,
    });
  });
});

describe('revocationSummaryText', () => {
  it('counts failed and unsupported together, because to the customer they are the same job', () => {
    // The distinction matters to us (one is a provider fact, one is an
    // outage). It does not change what they have to do: go and withdraw it.
    const outcomes: RevocationOutcome[] = [
      { kind: 'gmail', status: 'revoked' },
      { kind: 'o365', status: 'unsupported', reason: 'x' },
      { kind: 'dropbox', status: 'failed', reason: 'x' },
    ];

    const en = revocationSummaryText(outcomes, 'en');
    expect(en).toContain('revoked 1');
    expect(en).toContain('2 other(s)');
    expect(en).toMatch(/you must withdraw those in your own account/i);
  });

  it('does not soften the sentence that sends somebody to go and do it', () => {
    const outcomes: RevocationOutcome[] = [{ kind: 'o365', status: 'unsupported', reason: 'x' }];
    const en = revocationSummaryText(outcomes, 'en');

    expect(en).toMatch(/could not revoke/i);
    // Never a phrasing that lets a reader stop here.
    expect(en).not.toMatch(/no action|nothing further|all set|complete/i);
  });

  it('says nothing was stored rather than pretending nothing needed doing', () => {
    expect(revocationSummaryText([], 'en')).toMatch(/no stored credentials to revoke/i);
    expect(revocationSummaryText([], 'nl')).toMatch(/geen opgeslagen inloggegevens/i);
  });

  it('is a translation in Dutch, not the English with numbers in it', () => {
    const outcomes: RevocationOutcome[] = [
      { kind: 'gmail', status: 'revoked' },
      { kind: 'o365', status: 'unsupported', reason: 'x' },
    ];
    const en = revocationSummaryText(outcomes, 'en');
    const nl = revocationSummaryText(outcomes, 'nl');

    expect(nl).not.toBe(en);
    expect(nl).toMatch(/ingetrokken/);
    // The counts are findings and appear in both.
    expect(nl).toContain('1');
  });

  it('reports credential-less connections separately from ones we failed on', () => {
    // "There was nothing to revoke" and "we could not revoke it" are different
    // facts, and collapsing them would overstate what is outstanding.
    const outcomes: RevocationOutcome[] = [
      { kind: 'imap', status: 'no_credential' },
      { kind: 'o365', status: 'unsupported', reason: 'x' },
    ];
    const en = revocationSummaryText(outcomes, 'en');

    expect(en).toContain('1 other(s)');
    expect(en).toMatch(/for 1 there were no stored credentials/i);
  });
});
