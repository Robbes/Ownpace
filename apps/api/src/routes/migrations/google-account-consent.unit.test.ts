// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The tick decides the ask (workplan 0106 T3b).
 *
 * Two properties carry everything here, and they fail in opposite directions:
 *
 *  - **Never more than was ticked.** A consent that quietly widened would put
 *    a scope in front of somebody who did not ask for it, and — because this
 *    is the MANAGED client — would put every other customer's consent screen
 *    into Google's restricted tier along with it.
 *  - **Never less than was ticked, silently.** The worse failure of the two.
 *    Somebody ticks four faces, approves a screen showing two, and finds out
 *    weeks later that mail was never in the grant. So a face this account
 *    cannot serve is a REFUSAL naming the way through, not a quiet narrowing.
 */

import { describe, it, expect } from 'vitest';
import { googleAccountConsent, isRefusal } from './google-account-consent.ts';
import { PROVIDER_ACCOUNT_DOMAINS } from '@openmig/shared';
import { GOOGLE_SCOPES_ASKED_BY_DOMAIN } from '@openmig/orchestration/account-qualification';

const ask = (domains: string[]) => {
  const result = googleAccountConsent(domains);
  if (isRefusal(result)) throw new Error(`refused: ${result.error} — ${result.reason}`);
  return result;
};

const refusal = (domains: string[]) => {
  const result = googleAccountConsent(domains);
  if (!isRefusal(result)) throw new Error(`expected a refusal, got scope "${result.scope}"`);
  return result;
};

describe('never more than was ticked', () => {
  it('asks for one scope for one face', () => {
    expect(ask(['calendar']).scope).toBe(GOOGLE_SCOPES_ASKED_BY_DOMAIN.calendar);
    expect(ask(['contact']).scope).toBe(GOOGLE_SCOPES_ASKED_BY_DOMAIN.contact);
  });

  it('asks for exactly two when two are ticked, and nothing else', () => {
    const { scope } = ask(['calendar', 'contact']);
    expect(scope.split(' ')).toEqual([
      GOOGLE_SCOPES_ASKED_BY_DOMAIN.calendar,
      GOOGLE_SCOPES_ASKED_BY_DOMAIN.contact,
    ]);
  });

  it('never lets a restricted scope into the string', () => {
    // The single check that would have caught the expensive mistake: the
    // managed client is pushed into Google's restricted tier — an annual
    // third-party security assessment — by ONE consent screen asking for
    // mail or drive. There is no tick set reachable here that does it.
    for (const ticks of [['calendar'], ['contact'], ['calendar', 'contact']]) {
      const { scope } = ask(ticks);
      expect(scope).not.toContain('https://mail.google.com/');
      expect(scope).not.toContain('drive');
    }
  });

  it('is stable and deduplicated, so the same ticks are the same screen twice running', () => {
    // A scope string that varies run to run is one a person cannot recognise
    // as the same request they approved yesterday.
    expect(ask(['contact', 'calendar']).scope).toBe(ask(['calendar', 'contact']).scope);
    expect(ask(['contact', 'contact', 'calendar']).scope).toBe(ask(['calendar', 'contact']).scope);
  });
});

describe('never less than was ticked, silently', () => {
  it('refuses mail and names the source that still serves it', () => {
    const { error, reason } = refusal(['calendar', 'email']);
    expect(error).toBe('not_on_this_account');
    expect(reason).toContain('gmail');
  });

  it('refuses files and names the source that still serves them', () => {
    const { error, reason } = refusal(['file']);
    expect(error).toBe('not_on_this_account');
    expect(reason).toContain('google-drive');
  });

  it('refuses rather than dropping the face and asking for the rest', () => {
    // The narrowing this exists to prevent: `['calendar','email']` must NOT
    // come back as a calendar-only ask. If it ever does, somebody approves a
    // screen that does not match what they ticked.
    const result = googleAccountConsent(['calendar', 'email']);
    expect(isRefusal(result)).toBe(true);
  });
});

describe('the refusals that are not about scopes at all', () => {
  it('refuses an empty tick set rather than defaulting to something', () => {
    // `domainsToScopes` deliberately returns [] for an empty set and says
    // callers must refuse rather than substitute. This is that caller.
    expect(refusal([]).error).toBe('no_domains_ticked');
  });

  it('refuses a domain this product does not migrate', () => {
    const { error, reason } = refusal(['tasks']);
    expect(error).toBe('unknown_domain');
    expect(reason).toContain('tasks');
  });
});

describe('the table is what decides, not this file', () => {
  it('serves exactly what PROVIDER_ACCOUNT_DOMAINS.google says, no more and no less', () => {
    // The point of 0106 T3b's table: a provider gaining a face is a row edit,
    // reviewed in a diff, with no new branch anywhere. This asserts the branch
    // really is absent — every served face asks, and every unserved one is
    // refused, both read off the table rather than listed here.
    const all = ['email', 'calendar', 'contact', 'file'] as const;
    const served = PROVIDER_ACCOUNT_DOMAINS.google;
    for (const domain of all) {
      const result = googleAccountConsent([domain]);
      expect(isRefusal(result), `${domain} should be ${served.includes(domain) ? 'served' : 'refused'}`)
        .toBe(!served.includes(domain));
    }
    // And the whole served set asks in one go — the owner's "tick google and
    // pick the object types" in its intended form.
    expect(ask([...served]).domains).toEqual([...served]);
  });
});
