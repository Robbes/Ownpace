// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT BOTH LINK PAGES SAY ALIKE (workplan 0176 T1): a migration's own link,
 * sent before 2026-10-03, and a person's link, which since step A asks one
 * thing at a time (`PersonGrant.tsx`). Each provider's words, the permission
 * in words with its scope behind a fold, the names of a source and a
 * destination, and the sentence for a failure. Lifted out of `Grant.tsx` as
 * they were, so the two pages cannot say two things about one permission; on
 * a person's own page the scope is drawn at a person's sizes.
 */

import React from 'react';
import type { DiscoveryDomain } from '@openmig/shared';
import type { CardProvider, GrantProvider, PersonGrantCard } from '../services/grant-service.ts';
import { linkRefusal } from '../services/link-refusal.ts';
import { useT } from '../i18n/index.tsx';
import type { Locale, StringKey } from '../i18n/strings.ts';
import { SOURCE_CARDS, TARGET_CARDS } from '../components/front-door-cards.ts';
import { scopeWordKeys } from '../i18n/google-scope-words.ts';
import { usePersonsPage } from '../components/persons-page.tsx';

/**
 * A failure that is no request: the address the API answered is not the
 * provider's own page (workplan 0163 T4; per provider since 0171).
 */
export class NotTheProvider {
  constructor(readonly name: string) {}
}

/** What a failure says: the refusal above, or the server's sentence in the page's language. */
export function failureSentence(error: unknown, locale: Locale, t: ReturnType<typeof useT>): string {
  return error instanceof NotTheProvider
    ? t('account.consent.notTheProvider', { provider: error.name })
    : linkRefusal(error, locale, t);
}

/**
 * THE PAGE IN EACH PROVIDER'S WORDS (workplan 0171 §3.4). Google's are the
 * page as it was; a Microsoft account's link says Microsoft wherever they say
 * Google, and since alpha.21 a Dropbox link says Dropbox (workplan 0174 §6).
 * Apple adds its own with its task; the API offers it no link until then, and
 * the page would say Google's words for it, so `wordsOf` refuses to guess and
 * falls back only for Google.
 */
export interface ProviderWords {
  readonly name: string;
  /** The box above the scope: read-only where the provider holds it so, else what Ownpace does. */
  readonly readOnly: (readOnlyAtProvider: boolean) => StringKey;
  readonly scopeIntro: StringKey;
  readonly technicalLine: StringKey;
  readonly signInAs: StringKey;
  readonly connecting: StringKey;
  readonly withdraw: StringKey;
  /** A migration's page: the button. A person's link says *Sign in with {provider}* (0176 §15). */
  readonly connect: StringKey;
  /** Files, in the provider's own product's name. */
  readonly readsFile: StringKey;
}

export const PROVIDER_WORDS: Readonly<Record<'google' | 'microsoft' | 'dropbox', ProviderWords>> = {
  google: {
    name: 'Google',
    readOnly: (held) => (held ? 'grant.readOnly' : 'grant.readsOnly'),
    scopeIntro: 'grant.scopeIntro',
    technicalLine: 'grant.scope.technical.line',
    signInAs: 'grant.signInAs',
    connecting: 'grant.connecting',
    withdraw: 'grant.withdraw',
    connect: 'grant.connect',
    readsFile: 'grant.reads.file',
  },
  microsoft: {
    name: 'Microsoft',
    // Every Graph scope a link asks for is a `.Read` one (`microsoftLinkAsk`).
    readOnly: () => 'grant.readOnly.microsoft',
    scopeIntro: 'grant.scopeIntro.microsoft',
    technicalLine: 'grant.scope.technical.line.microsoft',
    signInAs: 'grant.signInAs.microsoft',
    connecting: 'grant.connecting.microsoft',
    withdraw: 'grant.withdraw.microsoft',
    connect: 'grant.continue.microsoft',
    readsFile: 'grant.reads.file.microsoft',
  },
  dropbox: {
    name: 'Dropbox',
    // Every scope a Dropbox link asks for reads (`dropboxLinkAsk`), and the
    // exchange refuses a grant that carries more.
    readOnly: () => 'grant.readOnly.dropbox',
    scopeIntro: 'grant.scopeIntro.dropbox',
    technicalLine: 'grant.scope.technical.line.dropbox',
    signInAs: 'grant.signInAs.dropbox',
    connecting: 'grant.connecting.dropbox',
    withdraw: 'grant.withdraw.dropbox',
    connect: 'grant.continue.dropbox',
    readsFile: 'grant.reads.file.dropbox',
  },
};

export function wordsOf(provider: GrantProvider | CardProvider | undefined): ProviderWords {
  // Absent is Google: an answer from before the seam (the service defaults it
  // when it parses one; a page handed data directly may not have).
  if (provider === undefined || provider === 'google' || provider === 'microsoft' || provider === 'dropbox') {
    return PROVIDER_WORDS[provider ?? 'google'];
  }
  throw new Error(`the grant page has no words for ${provider} yet`);
}

/** What each data type reads, in this provider's words. */
export function readsKey(d: DiscoveryDomain, words: ProviderWords): StringKey {
  return d === 'file' ? words.readsFile : READS_KEY[d];
}
/**
 * What each data type reads, as the dictionary says it (workplan 0145 T6). A
 * total record, so a sixth data type is a compile error here rather than a
 * gap in what a person is told they are giving access to.
 */
export const READS_KEY: Readonly<Record<DiscoveryDomain, StringKey>> = {
  email: 'grant.reads.email',
  calendar: 'grant.reads.calendar',
  contact: 'grant.reads.contact',
  file: 'grant.reads.file',
  task: 'grant.reads.task',
};

/**
 * THE PERMISSION, IN WORDS, AND THE SCOPE BEHIND A FOLD (the owner,
 * 2026-10-14). Each scope the link asks for is said as what it allows
 * (`google-scope-words.ts`), in the reader's language; the exact string Google
 * records stays on the page, inside a closed *Technical details*, for whoever
 * wants to compare it with their account (ADR-0041 *Decision* 4: the scopes
 * as scopes, not only a paraphrase).
 */
export const GrantScope: React.FC<{ scope: string; className: string; provider?: GrantProvider }> = ({
  scope,
  className,
  provider = 'google',
}) => {
  const t = useT();
  const words = wordsOf(provider);
  // A person's own page: 18-pixel sentences at 7 to 1, the fold a target (0176 T9).
  const personsPage = usePersonsPage() !== null;
  const size = personsPage ? 'text-lg' : 'text-sm';
  return (
    <div className={className}>
      <p className={`${size} ${personsPage ? 'text-gray-900' : 'text-gray-600'}`}>{t(words.scopeIntro)}</p>
      {/* On a person's page the scope sits inside a numbered step (`PersonGrant`),
          so its words are lines of that step, not a list inside the list. */}
      {personsPage ? (
        <div className={`mt-1 space-y-1 border-l-2 border-gray-400 pl-3 ${size} text-gray-900`}>
          {scopeWordKeys(scope, provider).map((key) => (
            <p key={key}>{t(key)}</p>
          ))}
        </div>
      ) : (
        <ul className={`mt-1 list-disc pl-5 space-y-0.5 ${size} text-gray-900`}>
          {scopeWordKeys(scope, provider).map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      )}
      <details className={`mt-2 ${size}`}>
        <summary
          className={`cursor-pointer select-none ${personsPage ? 'inline-flex min-h-[44px] items-center underline text-gray-900' : 'text-gray-500'}`}
        >
          {t('grant.scope.technical')}
        </summary>
        <p className={`mt-1 ${personsPage ? 'text-gray-800' : 'text-gray-600'}`}>{t(words.technicalLine)}</p>
        <p className="mt-1 font-mono break-all text-gray-900">{scope}</p>
      </details>
    </div>
  );
};

/** A destination's kind, by the name its card carries; the kind itself otherwise. */
export function providerName(kind: string): string {
  return TARGET_CARDS.find((c) => c.id === kind)?.name ?? kind;
}

/** A source's kind, by the name its card carries; the kind itself otherwise (0174 §4.5). */
export function sourceName(kind: string): string {
  const card = SOURCE_CARDS.find((c) => c.id === kind);
  return (card && 'name' in card ? card.name : undefined) ?? kind;
}

/**
 * What each data type is, on a card that is no Google or Microsoft sign-in
 * (0174 §4.5): a password card, or a destination. Files are *your files*,
 * not Google Drive's.
 */
export function cardReadsKey(card: PersonGrantCard, d: DiscoveryDomain): StringKey {
  if (wayOf(card) === 'sign-in' && roleOf(card) === 'source') return readsKey(d, wordsOf(card.provider));
  return d === 'file' ? 'grant.reads.file.other' : READS_KEY[d];
}

/**
 * A card's role and way. Absent is a Google sign-in source: an answer from
 * before 0174, as the service's defaults read it, and as a page handed data
 * directly may hold it.
 */
export const roleOf = (a: PersonGrantCard): 'source' | 'target' => a.role ?? 'source';
export const wayOf = (a: PersonGrantCard): 'sign-in' | 'password' => a.way ?? 'sign-in';
