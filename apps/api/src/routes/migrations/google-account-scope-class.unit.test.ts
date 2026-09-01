// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A DEPLOYMENT'S OWN APPLICATION CARRIES IS NOT THE PRODUCT'S TO DECIDE.
 *
 * `PROVIDER_ACCOUNT_DOMAINS.google` was `['calendar', 'contact']` and read as
 * a law about Google. It was a law about ONE CLIENT — the one Ownpace
 * publishes to strangers, which may not offer restricted scopes until the
 * annual third-party assessment is paid for (ADR-0041). The reference
 * deployment runs its own application, registered by its own owner, in Testing
 * with listed users; the population the restricted tier would be imposed on is
 * that owner and the people they named.
 *
 * So the answer became a declaration (owner decision, 2026-09-01), and this
 * pins the three properties that make a declaration safe:
 *
 *  1. IT DEFAULTS NARROW, and every unrecognised value defaults with it. Unset,
 *     mistyped, and never-heard-of all mean "sensitive only" — the answer that
 *     cannot over-ask. Getting this backwards would widen every consent screen
 *     on every deployment that never answered the question.
 *  2. IT REACHES THE CONSENT, and the same answer reaches the sentence printed
 *     beside a missing credential. Two readings of one fact: a fallback naming
 *     scopes the gate would then refuse is a fallback that lies.
 *  3. IT NEVER TOUCHES ANOTHER PROVIDER. `soverin` is not Google's to widen.
 *
 * AND IT IS NOT A CAPABILITY. Nothing here makes Google grant anything — the
 * application must actually carry the scopes. What the declaration changes is
 * which consent this product is willing to BUILD, so a wrong answer costs a
 * refusal at Google's own screen with the scope string in hand, rather than a
 * consent silently narrowed to two faces and a migration that turns out weeks
 * later to have never included mail.
 */

import { describe, it, expect } from 'vitest';
import {
  providerAccountDomains,
  providerAccountServes,
  PROVIDER_ACCOUNT_DOMAINS,
} from '@openmig/shared';
import {
  googleAccountConsent,
  googleAccountScopeSentence,
  isRefusal,
} from './google-account-consent.ts';

const RESTRICTED = { GOOGLE_ACCOUNT_SCOPE_CLASS: 'restricted' };
const ALL_FOUR = ['email', 'calendar', 'contact', 'file'];

describe('the narrow answer is the one you get by not answering', () => {
  it.each([
    ['unset', {}],
    ['empty', { GOOGLE_ACCOUNT_SCOPE_CLASS: '' }],
    ['the other value', { GOOGLE_ACCOUNT_SCOPE_CLASS: 'sensitive' }],
    ['a typo', { GOOGLE_ACCOUNT_SCOPE_CLASS: 'restrictd' }],
    ['shouting', { GOOGLE_ACCOUNT_SCOPE_CLASS: 'RESTRICTED' }],
    ['nonsense', { GOOGLE_ACCOUNT_SCOPE_CLASS: 'yes please' }],
  ])('%s means sensitive only', (_label, env) => {
    // THE DIRECTION MATTERS MORE THAN THE VALUES. A default that widened would
    // put mail and Drive on the consent screen of every deployment that never
    // heard of this setting — including the appliance, which has no Google
    // application at all and could not honour it (hard rule 5).
    expect(providerAccountDomains('google', env)).toEqual(['calendar', 'contact']);
    expect(providerAccountServes('google', 'email', env)).toBe(false);
    expect(providerAccountServes('google', 'file', env)).toBe(false);
  });

  it('the exact word, and only trimmed whitespace, widens it', () => {
    expect(providerAccountDomains('google', RESTRICTED)).toEqual(ALL_FOUR);
    expect(providerAccountDomains('google', { GOOGLE_ACCOUNT_SCOPE_CLASS: '  restricted  ' }))
      .toEqual(ALL_FOUR);
  });

  it('leaves every other provider alone', () => {
    // `soverin`'s faces are a measured fact about Soverin (0105's never-guess
    // rule). A Google setting reaching it would be the widening this whole
    // shape exists to make impossible.
    expect(providerAccountDomains('soverin', RESTRICTED)).toEqual(
      PROVIDER_ACCOUNT_DOMAINS.soverin,
    );
    expect(providerAccountDomains('imap', RESTRICTED), 'not an account kind').toEqual([]);
  });
});

describe('the declaration reaches the consent, and the sentence beside it', () => {
  it('refuses mail and files by default, naming the way through', () => {
    const refused = googleAccountConsent(ALL_FOUR, {});
    expect(isRefusal(refused)).toBe(true);
    if (!isRefusal(refused)) return;
    expect(refused.error).toBe('not_on_this_account');
    // The refusal must keep naming the single-purpose sources: they still work,
    // and a wall without a door is the failure this message was written for.
    expect(refused.reason).toContain('the gmail source');
    expect(refused.reason).toContain('the google-drive source');
  });

  it('asks for all four when the deployment says its application carries them', () => {
    const ask = googleAccountConsent(ALL_FOUR, RESTRICTED);
    expect(isRefusal(ask), 'the declaration did not reach the consent gate').toBe(false);
    if (isRefusal(ask)) return;
    for (const scope of [
      'https://mail.google.com/',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/carddav',
      'https://www.googleapis.com/auth/drive.readonly',
    ]) {
      expect(ask.scope, `${scope} is not in the ask`).toContain(scope);
    }
    expect(ask.domains).toEqual(ALL_FOUR);
  });

  it('never asks for a scope nobody ticked, however wide the declaration', () => {
    // Least privilege survives the widening: the tick decides the ask, and the
    // declaration only decides what MAY be ticked.
    const ask = googleAccountConsent(['contact'], RESTRICTED);
    expect(isRefusal(ask)).toBe(false);
    if (isRefusal(ask)) return;
    expect(ask.scope).toBe('https://www.googleapis.com/auth/carddav');
    expect(ask.scope).not.toContain('mail.google.com');
  });

  it('the fallback sentence follows the same answer as the gate', () => {
    // Two readings of one fact. A sentence naming scopes the gate would then
    // refuse is worse than no sentence — it is a promise the next step breaks.
    expect(googleAccountScopeSentence([], {})).not.toContain('mail.google.com');
    expect(googleAccountScopeSentence([], RESTRICTED)).toContain('mail.google.com');
  });
});

