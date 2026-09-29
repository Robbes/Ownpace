// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * START A MIGRATION (workplan 0153 T4, with T7's defaults; drawn in
 * `docs/design/0152-0154/wf-start-a-migration.svg`).
 *
 * Six screens that ask a person what the four-step wizard asks a builder, in
 * the order a family thinks it: who it is for, which accounts they are
 * leaving, what moves, connecting those accounts, where each thing goes, and
 * one screen that checks and starts. What each answer means for the server is
 * `start-plan.ts`'s, which a test holds; this page asks, and draws what that
 * module returns.
 *
 * - **Who is it for?** Somebody already on Migrations, or a new name. A
 *   person's page opens this with `?person=`, and that person is chosen.
 *   Nobody is created here: the person is created with their migrations, on
 *   the last screen, so leaving half-way leaves no empty card behind.
 * - **Which account are you leaving?** Six tiles, none ticked, more than one
 *   allowed (D1). A tile that has not met a real account says so (0131 D6).
 *   An export archive and a server by its protocol are added by hand, in the
 *   wizard, which stays as *Add one migration by hand* until this flow
 *   carries every card (T4, *The four-step wizard stays reachable*).
 * - **What moves?** Per provider, the data types it can give on this
 *   deployment, all ticked; the ones it cannot give in a line of their own,
 *   blamed on the provider (T7 (e)). Asked before any sign-in, so each sign-in
 *   asks for exactly what was ticked (T1 (c)). Google's Docs and Dropbox's
 *   Paper docs have no file to copy, so their format is chosen here, with the
 *   wizard's own choosers and the wizard's own defaults.
 *
 * Each screen starts at the top with focus on its heading (0145 T3 (a)).
 */
import React from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ARCHIVE_PROVIDER_NAMES,
  ARCHIVE_PROVIDER_ORIGINS,
  sourceCardIsExperimental,
  sourceFaceIsExperimental,
  type DiscoveryDomain,
  type DropboxPaperPolicy,
  type Person,
} from '@openmig/shared';
import { fetchPeople } from '../services/operating-service.ts';
import { providerAccountsApi } from '../services/mapping-service.ts';
import {
  START_PROVIDERS,
  cannotGive,
  carrierOf,
  connectionsFor,
  offers,
  photosThrough,
  type ServedFacts,
  type StartProvider,
} from '../services/start-plan.ts';
import ProviderTile, { providerName } from '../components/ProviderTile.tsx';
import { DataTypeIcon, DataTypeLabel } from '../components/icons/data-type-icons.tsx';
import { ExperimentalTag, ExperimentalWhy } from '../components/ExperimentalTag.tsx';
import { Hint } from '../components/Hint.tsx';
import {
  LEAVE_ALL_BEHIND,
  NativeFilePolicyChooser,
  type NativeFilePolicyByKind,
} from '../components/NativeFilePolicyChooser.tsx';
import { PaperFormatChooser, SUGGESTED_PAPER_FORMAT } from '../components/PaperFormatChooser.tsx';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { useLocale, useFormatters, type StringKey } from '../i18n/index.tsx';

/** The six screens, in the drawing's order. */
const STEPS = ['who', 'from', 'what', 'connect', 'to', 'check'] as const;
type Step = (typeof STEPS)[number];

const HEADING: Readonly<Record<Step, StringKey>> = {
  who: 'start.who.heading',
  from: 'start.from.heading',
  what: 'start.what.heading',
  connect: 'start.connect.heading',
  to: 'start.to.heading',
  check: 'start.check.heading',
};

/** Whom the migrations are for: somebody on Migrations already, or a new name. */
export interface Who {
  /** An existing person's id; null for somebody new, named by `name`. */
  readonly personId: string | null;
  readonly name: string;
}

/**
 * The tile's name, where the flow says it otherwise than the card: *Another
 * mail provider* is the IMAP card, named for what a person has rather than
 * how it is reached.
 */
function useProviderLabel(): (provider: StartProvider) => string {
  const { t } = useLocale();
  return (provider) => (provider === 'imap' ? t('start.from.otherMail') : providerName(provider, 'source'));
}

/**
 * Whether the reader's browser says motion is fine: the step change scrolls
 * smoothly only then, as the wizard's does (0145 T3 (a)).
 */
const motionWelcome = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

const StartMigration: React.FC = () => {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const peopleQuery = useQuery({ queryKey: ['people'], queryFn: fetchPeople });
  // What this deployment serves per provider account, as the wizard reads it.
  // A failed or pending read falls back to the static tables, which ask for
  // the narrow set: the direction that cannot over-ask (ADR-0041).
  const { data: providerAccounts } = useQuery({
    queryKey: ['provider-accounts'],
    queryFn: providerAccountsApi.get,
    retry: false,
    staleTime: Infinity,
  });
  const served: ServedFacts = React.useMemo(() => {
    const facts: { google?: DiscoveryDomain[]; microsoft?: DiscoveryDomain[] } = {};
    if (providerAccounts?.google) facts.google = providerAccounts.google.domains;
    if (providerAccounts?.microsoft) facts.microsoft = providerAccounts.microsoft.domains;
    return facts;
  }, [providerAccounts]);

  const [step, setStep] = React.useState<Step>('who');
  const [who, setWho] = React.useState<Who>({ personId: searchParams.get('person'), name: '' });
  const [providers, setProviders] = React.useState<ReadonlyArray<StartProvider>>([]);
  const [ticked, setTicked] = React.useState<Partial<Record<StartProvider, ReadonlyArray<DiscoveryDomain>>>>({});
  const [nativeFormats, setNativeFormats] = React.useState<NativeFilePolicyByKind>(LEAVE_ALL_BEHIND);
  const [paperFormat, setPaperFormat] = React.useState<DropboxPaperPolicy>(SUGGESTED_PAPER_FORMAT);

  const people: ReadonlyArray<Person> = (peopleQuery.data?.people ?? []).filter(
    (p) => !p.implicit && p.displayName !== null,
  );

  /** What each ticked provider moves: what was ticked, or everything it offers until it is touched. */
  const movesFrom = (provider: StartProvider): ReadonlyArray<DiscoveryDomain> =>
    ticked[provider] ?? offers(provider, served);

  // A NEW SCREEN STARTS AT THE TOP, with focus on its heading (0145 T3 (a)).
  // Not on the first render: opening the page is `Layout`'s to scroll.
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const shownStep = React.useRef(step);
  React.useLayoutEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: motionWelcome() ? 'smooth' : 'instant' });
  }, [step]);

  const index = STEPS.indexOf(step);
  const next = STEPS[index + 1];
  const back = STEPS[index - 1];

  /** Why Next cannot be pressed yet, in words under it (T7 (a)); undefined when it can. */
  const notYet = ((): string | undefined => {
    switch (step) {
      case 'who':
        return who.personId === null && who.name.trim() === '' ? t('start.who.needName') : undefined;
      case 'from':
        return providers.length === 0 ? t('start.from.needOne') : undefined;
      case 'what':
        return providers.every((p) => movesFrom(p).length === 0) ? t('start.what.needOne') : undefined;
      default:
        // The screens after *What moves?* arrive in the pull requests that build them.
        return t('start.notYet');
    }
  })();

  /** The wizard, for a card this flow does not carry yet; the person comes along. */
  const byHand = who.personId === null ? '/mappings/new' : `/mappings/new?person=${encodeURIComponent(who.personId)}`;

  const reasonId = React.useId();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('mappings.new')}</h1>
        <p className="mt-1 text-sm font-medium text-gray-600">
          {t('start.step', { n: index + 1, total: STEPS.length })}
        </p>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-gray-900 focus:outline-none">
          {t(HEADING[step])}
        </h2>
        <div className="mt-4">
          {step === 'who' && (
            <WhoStep people={people} peopleFailed={peopleQuery.isError} who={who} onWho={setWho} />
          )}
          {step === 'from' && <FromStep providers={providers} onProviders={setProviders} byHand={byHand} />}
          {step === 'what' && (
            <WhatStep
              providers={providers}
              served={served}
              movesFrom={movesFrom}
              onTicked={(provider, types) => setTicked((prev) => ({ ...prev, [provider]: types }))}
              nativeFormats={nativeFormats}
              onNativeFormats={setNativeFormats}
              paperFormat={paperFormat}
              onPaperFormat={setPaperFormat}
              byHand={byHand}
            />
          )}
          {step === 'connect' && <ConnectStep providers={providers} served={served} movesFrom={movesFrom} />}
        </div>
      </section>

      <div className="flex flex-wrap items-start justify-between gap-3">
        {back !== undefined ? (
          <button
            type="button"
            onClick={() => setStep(back)}
            className="min-h-[44px] px-5 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50"
          >
            {t('wizard.back')}
          </button>
        ) : (
          <span />
        )}
        {next !== undefined && (
          <div className="flex flex-col items-end">
            <button
              type="button"
              onClick={() => setStep(next)}
              disabled={notYet !== undefined}
              aria-describedby={notYet === undefined ? undefined : reasonId}
              className="min-h-[44px] px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('wizard.next')}
            </button>
            {notYet !== undefined && (
              <p id={reasonId} className="mt-2 text-sm text-gray-600">
                {notYet}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** Screen 1: somebody on Migrations already, or a new name. */
export const WhoStep: React.FC<{
  people: ReadonlyArray<Person>;
  peopleFailed: boolean;
  who: Who;
  onWho: (who: Who) => void;
}> = ({ people, peopleFailed, who, onWho }) => {
  const { t } = useLocale();
  const nameId = React.useId();
  const nameField = (
    <div>
      <label htmlFor={nameId} className="block text-sm font-medium text-gray-700">
        {t('people.new.name')}
      </label>
      <input
        id={nameId}
        value={who.name}
        onChange={(e) => onWho({ personId: null, name: e.target.value })}
        maxLength={200}
        autoComplete="off"
        className="mt-1 w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg"
      />
    </div>
  );
  return (
    <div className="space-y-4">
      {peopleFailed && (
        // The list is an offer, not a need: a new name still works, and the
        // failure says so rather than showing nobody (hard rule 9).
        <p role="alert" className="text-sm text-red-800">
          {t('start.who.peopleFailed')}
        </p>
      )}
      {people.length === 0 ? (
        nameField
      ) : (
        <fieldset>
          <legend className="sr-only">{t('start.who.heading')}</legend>
          <div className="space-y-2">
            {people.map((p) => (
              <label key={p.id} className="flex min-h-[44px] items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="start-who"
                  checked={who.personId === p.id}
                  onChange={() => onWho({ personId: p.id, name: '' })}
                  className="h-4 w-4"
                />
                <span className="text-gray-900">{p.displayName}</span>
              </label>
            ))}
            <label className="flex min-h-[44px] items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="start-who"
                checked={who.personId === null}
                onChange={() => onWho({ personId: null, name: who.name })}
                className="h-4 w-4"
              />
              <span className="text-gray-900">{t('start.who.someoneNew')}</span>
            </label>
          </div>
          {who.personId === null && <div className="mt-2 pl-7">{nameField}</div>}
        </fieldset>
      )}
    </div>
  );
};

/** Screen 2: the accounts being left, as tiles; none ticked, more than one allowed. */
export const FromStep: React.FC<{
  providers: ReadonlyArray<StartProvider>;
  onProviders: (providers: ReadonlyArray<StartProvider>) => void;
  byHand: string;
}> = ({ providers, onProviders, byHand }) => {
  const { t } = useLocale();
  const label = useProviderLabel();
  const toggle = (provider: StartProvider) =>
    onProviders(
      providers.includes(provider)
        ? providers.filter((p) => p !== provider)
        : START_PROVIDERS.filter((p) => p === provider || providers.includes(p)),
    );
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm text-gray-600">{t('start.from.hint')}</legend>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {START_PROVIDERS.map((provider) => {
            const on = providers.includes(provider);
            const experimental = sourceCardIsExperimental(provider);
            return (
              <div key={provider} className="flex flex-col">
                <label
                  className={`flex flex-1 min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg border-2 p-3 focus-within:ring-2 focus-within:ring-blue-500 ${
                    on ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="flex items-center gap-1 font-medium text-gray-900">
                    <ProviderTile type={provider} role="source" size={48} name={label(provider)} />
                    {experimental && <ExperimentalTag />}
                  </span>
                  <input type="checkbox" checked={on} onChange={() => toggle(provider)} className="h-5 w-5 shrink-0" />
                </label>
                {experimental && <ExperimentalWhy />}
              </div>
            );
          })}
        </div>
      </fieldset>
      <Link
        to={byHand}
        className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 hover:bg-gray-100"
      >
        <span className="font-medium text-gray-900">
          <ProviderTile type="archive" role="source" size={28} name={t('start.from.archive')} />
        </span>
        <span className="text-sm text-blue-700">{t('start.byHand')}</span>
      </Link>
      <details>
        <summary className="cursor-pointer text-sm text-blue-700">{t('start.from.other')}</summary>
        <p className="mt-2 text-sm text-gray-700">
          {t('start.from.other.line')}{' '}
          <Link to={byHand} className="text-blue-700 underline hover:no-underline">
            {t('start.byHand')}
          </Link>
        </p>
      </details>
    </div>
  );
};

/** Screen 3: per provider, what it can give here, all ticked; what it cannot, said beside it. */
export const WhatStep: React.FC<{
  providers: ReadonlyArray<StartProvider>;
  served: ServedFacts;
  movesFrom: (provider: StartProvider) => ReadonlyArray<DiscoveryDomain>;
  onTicked: (provider: StartProvider, types: ReadonlyArray<DiscoveryDomain>) => void;
  nativeFormats: NativeFilePolicyByKind;
  onNativeFormats: (next: NativeFilePolicyByKind) => void;
  paperFormat: DropboxPaperPolicy;
  onPaperFormat: (next: DropboxPaperPolicy) => void;
  byHand: string;
}> = ({
  providers,
  served,
  movesFrom,
  onTicked,
  nativeFormats,
  onNativeFormats,
  paperFormat,
  onPaperFormat,
  byHand,
}) => {
  const { t, locale } = useLocale();
  const { list } = useFormatters();
  const label = useProviderLabel();
  const typeWords = (types: ReadonlyArray<DiscoveryDomain>) =>
    list(types.map((d) => t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale)));
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">{t('start.what.hint')}</p>
      {providers.map((provider) => {
        const moves = movesFrom(provider);
        const missing = cannotGive(provider, served);
        const photos = photosThrough(provider);
        const why: Partial<Record<StartProvider, StringKey>> = {
          apple: 'start.what.notFrom.apple.why',
          imap: 'start.what.notFrom.imap.why',
        };
        const whyKey = why[provider];
        return (
          <fieldset key={provider}>
            <legend className="font-semibold text-gray-900">
              <ProviderTile type={provider} role="source" size={28} name={t('start.what.from', { provider: label(provider) })} />
            </legend>
            <div className="mt-2 space-y-1">
              {offers(provider, served).map((type) => {
                const on = moves.includes(type);
                const experimental = sourceFaceIsExperimental(carrierOf(provider, type, served), type);
                return (
                  <div key={type}>
                    <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          onTicked(provider, on ? moves.filter((d) => d !== type) : [...moves, type])
                        }
                        className="h-5 w-5"
                      />
                      <span className="text-gray-900">
                        <DataTypeLabel domain={type} />
                        {experimental && <ExperimentalTag />}
                      </span>
                    </label>
                    {experimental && <ExperimentalWhy />}
                    {on && type === 'file' && provider === 'google' && (
                      <div className="ml-8 mt-1 mb-3">
                        <NativeFilePolicyChooser
                          value={nativeFormats}
                          onChange={onNativeFormats}
                          id="start-native-file-policy"
                        />
                      </div>
                    )}
                    {on && type === 'file' && provider === 'dropbox' && (
                      <div className="ml-8 mt-1 mb-3">
                        <PaperFormatChooser value={paperFormat} onChange={onPaperFormat} id="start-paper-format" />
                      </div>
                    )}
                  </div>
                );
              })}
              {photos !== undefined && (
                // Photos take no sign-in and no tick: they come through an
                // export the person asks for, which this flow cannot wait
                // for, so the line says how and the wizard adds it later.
                <div className="flex items-start gap-3 py-2">
                  <span className="mt-0.5 inline-flex w-5 shrink-0 justify-center text-gray-500">
                    <DataTypeIcon name="photos" size={20} />
                  </span>
                  <p className="text-sm text-gray-700">
                    <span className="font-medium text-gray-900">{t('start.what.photos')}</span>
                    {' · '}
                    {t('start.what.photos.line')}{' '}
                    <a
                      href={ARCHIVE_PROVIDER_ORIGINS[photos]}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline hover:no-underline"
                    >
                      {t('start.what.photos.ask', { export: ARCHIVE_PROVIDER_NAMES[photos] })}
                    </a>
                    {' · '}
                    <Link to={byHand} className="text-blue-700 underline hover:no-underline">
                      {t('start.byHand')}
                    </Link>
                  </p>
                </div>
              )}
              {missing.length > 0 && (
                <Hint
                  className="mt-2"
                  text={t('start.what.notFrom', { provider: label(provider), types: typeWords(missing) })}
                  {...(whyKey === undefined ? {} : { why: t(whyKey) })}
                />
              )}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
};

/**
 * Screen 4: one sign-in per provider for exactly what was ticked, and where
 * Google's restricted scopes are not declared, mail and files apart, said
 * before the first (T4).
 */
export const ConnectStep: React.FC<{
  providers: ReadonlyArray<StartProvider>;
  served: ServedFacts;
  movesFrom: (provider: StartProvider) => ReadonlyArray<DiscoveryDomain>;
}> = ({ providers, served, movesFrom }) => {
  const { t, locale } = useLocale();
  const { list } = useFormatters();
  const needs = providers.flatMap((provider) => connectionsFor(provider, movesFrom(provider), served));
  const google = needs.filter((n) => n.provider === 'google');
  return (
    <div className="space-y-4">
      {google.length > 1 && (
        <p className="text-sm text-gray-700">{t('start.connect.googleApart', { n: google.length })}</p>
      )}
      <ul className="space-y-3">
        {needs.map((need) => (
          <li key={need.card} className="rounded-lg border border-gray-200 p-3">
            <ProviderTile type={need.card} role="source" size={28} />
            <p className="mt-1 text-sm text-gray-600">
              {t('start.connect.asks', {
                types: list(need.types.map((d) => t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale))),
              })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default StartMigration;
