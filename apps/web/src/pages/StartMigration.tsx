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
 *   A server by its protocol is IMAP, which is *Another mail provider*: the
 *   fold under the tiles says so, and ticks it (0153 open question 5). An
 *   export has no line of its own: it sits under its provider (item 2).
 * - **What moves?** Per provider, the data types it can give on this
 *   deployment, all ticked; the ones it cannot give in a line of their own,
 *   blamed on the provider (T7 (e)). Asked before any sign-in, so each sign-in
 *   asks for exactly what was ticked (T1 (c)). Google's Docs and Dropbox's
 *   Paper docs have no file to copy, so their format is chosen here, with the
 *   wizard's own choosers and the wizard's own defaults. Under Google, its
 *   photos *from a Takeout export*, unticked: the person asks Google for it,
 *   and the migration it makes waits for it, in a folder of the destination's
 *   own files, until it is started there (`exportMigration`).
 *
 * Each screen starts at the top with focus on its heading (0145 T3 (a)).
 */
import React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ARCHIVE_PROVIDER_NAMES,
  ARCHIVE_PROVIDER_ORIGINS,
  TARGET_TYPE_DOMAINS,
  formDefaultsFor,
  scopeFamilyOf,
  scopeManifestFor,
  providerDisplayName,
  qualifiedAnswerFor,
  sourceCardIsExperimental,
  sourceFaceIsExperimental,
  wizardTypeForConnectionKind,
  type ArchiveProvider,
  type DiscoveryDomain,
  type DropboxPaperPolicy,
  type Person,
  type ScopeFamily,
  type WizardTargetType,
} from '@openmig/shared';
import { addMigrationToPerson, createPerson, fetchPeople } from '../services/operating-service.ts';
import {
  connectionsApi,
  mappingApi,
  providerAccountsApi,
  scopeManifestApi,
  type ConnectionSummary,
  type CreateMappingInput,
  type FolderListing,
  type TestConnectionResult,
} from '../services/mapping-service.ts';
import { serverMessage } from '../services/api.ts';
import { forgetMappingLifecycle } from '../services/mapping-cache.ts';
import {
  START_PROVIDERS,
  TYPE_ORDER,
  cannotGive,
  carrierOf,
  connectionsFor,
  destinationsFor,
  grantableByLink,
  migrationsFor,
  offers,
  EXPORT_CARD,
  TAKEOUT_FOLDER,
  exportDestinations,
  exportMigration,
  exportOf,
  folderKeyOf,
  folderValue,
  foldersListable,
  offersOneFolder,
  sharesItsDestination,
  type ConnectionNeed,
  type MicrosoftMailThrough,
  type PlanChoices,
  type PlannedMigration,
  type Route,
  type ServedFacts,
  type StartProvider,
} from '../services/start-plan.ts';
import { MigrationCountSection, useMigrationCount } from '../components/ConfirmMigration.tsx';
import { CeilingAtStartNote, measuredBytes } from '../components/CeilingAtStartNote.tsx';
import { PathsAtStartNote } from '../components/PathsAtStartNote.tsx';
import { needsAcknowledgement } from '../components/confirm/native-refusals.tsx';
import ScopeManifestPanel from '../components/confirm/ScopeManifestPanel.tsx';
import { PersonGrantLinkSection } from '../components/MappingLinksPanel.tsx';
import { personLinkApi } from '../services/grant-link-service.ts';
import { AccountForm } from '../components/AccountForm.tsx';
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
  /**
   * The accounts are somebody else's (T4, *Who is it for?*): where a grant
   * link can reach them, they connect them themselves, and the one starting
   * never holds that password (0108).
   */
  readonly someoneElse: boolean;
}

/**
 * An account one of the flow's sign-ins is done with: saved before, or added
 * on its screens. What a migration's create names besides the account.
 */
export interface Signed {
  readonly connectionId: string;
  /** The card it was added with (`gmail`, `soverin`): what a create names as its type. */
  readonly card: string;
  /**
   * Whether it can read now: its last check passed. An account saved by its
   * address alone, for somebody else to connect by a link, cannot yet.
   */
  readonly ready: boolean;
  /** Whose data it is: the address a create names (`sourceConfig.username`). */
  readonly username: string;
  /**
   * What a reused account must say again for each migration, as the account
   * holds it: Box's `userId`, a root folder or path (ADR-0033: one subject
   * per migration).
   */
  readonly perMapping: Readonly<Record<string, string>>;
}

/** The values each migration states again when it reuses an account (the create door's per-mapping keys). */
const PER_MAPPING_KEYS = ['userId', 'rootFolderId', 'rootPath'] as const;

const pickPerMapping = (values: Readonly<Record<string, string>> | undefined): Record<string, string> =>
  Object.fromEntries(
    PER_MAPPING_KEYS.flatMap((key) => {
      const value = values?.[key]?.trim();
      return value ? [[key, value] as const] : [];
    }),
  );

/** A saved account, as a migration's create names it. */
const signedFrom = (c: ConnectionSummary): Signed => ({
  connectionId: c.id,
  card: wizardTypeForConnectionKind(c.kind),
  ready: c.status === 'connected',
  username: c.knownValues?.username ?? '',
  perMapping: pickPerMapping(c.knownValues),
});

/**
 * THE ACCOUNT YOU ALREADY HAVE IS THE DEFAULT, where there is no doubt (the
 * owner, 2026-09-17, as the wizard has it): exactly one saved account of the
 * card, and one whose last check passed. None means a new one; several mean
 * the person chooses, since an account decides whose data is read.
 */
function defaultChoice(saved: ReadonlyArray<ConnectionSummary>): string | undefined {
  if (saved.length === 0) return 'new';
  if (saved.length === 1 && saved[0]!.status === 'connected') return saved[0]!.id;
  return undefined;
}

/** What screens 4 and 5 share: the saved accounts, what each form holds, and what was chosen. */
export interface Accounts {
  readonly saved: ReadonlyArray<ConnectionSummary>;
  readonly loading: boolean;
  /** The saved accounts could not be read: said on screen, and a new account still works (hard rule 9). */
  readonly failed: boolean;
  /** Whose accounts they are, for the name each new one is saved under. */
  readonly personName: string;
  /**
   * The saved account chosen for a side and card (`source:gmail`), `'new'`, or
   * nothing yet. For somebody else's accounts nothing saved is the default:
   * a saved one may well be the person's own who is starting (`noDefault`).
   */
  readonly choice: (
    key: string,
    saved: ReadonlyArray<ConnectionSummary>,
    noDefault?: boolean,
  ) => string | undefined;
  /** An account saved by its address alone, for its owner to connect by a link: kept as chosen. */
  readonly keep: (key: string, connectionId: string, username: string) => void;
  readonly choose: (key: string, choice: string) => void;
  readonly values: (key: string, initial: Readonly<Record<string, string>>) => Record<string, string>;
  readonly onValues: (
    key: string,
    initial: Readonly<Record<string, string>>,
  ) => React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** The account behind a chosen id, from the list or from this flow. */
  readonly signed: (connectionId: string | undefined) => Signed | undefined;
  /** A form's answer: kept where its check passed, offered again where it did not. */
  readonly onAdded: (key: string, added: TestConnectionResult & { id: string }, values: Record<string, string>) => void;
  /** The account a failed check left, for *Try again*. */
  readonly failedCheck: (key: string) => string | undefined;
  readonly tryAgain: (key: string) => void;
  readonly formKey: (key: string) => number;
}

/** A migration the set-up made, with the server's words where a part of it was refused. */
export interface MadeMigration {
  readonly id?: string;
  /** Why the create was refused: nothing was made for this pair. */
  readonly failed?: string;
  /** Made, but not added to the person: Migrations lists it as nobody's yet. */
  readonly notAdded?: string;
}

/** What the set-up made: the person, and each migration by its pair of accounts. */
export interface Made {
  readonly personId: string | undefined;
  readonly migrations: Readonly<Record<string, MadeMigration>>;
}

/** One pair of accounts: the key a planned migration is made and found under. */
const pairKey = (m: PlannedMigration): string => `${m.sourceConnectionId}→${m.targetConnectionId}`;

/**
 * The tile's name, where the flow says it otherwise than the card: *Another
 * mail provider* is the IMAP card, named for what a person has rather than
 * how it is reached.
 */
function useProviderLabel(): (provider: StartProvider, inSentence?: boolean) => string {
  const { t, locale } = useLocale();
  return (provider, inSentence = false) =>
    provider !== 'imap'
      ? providerName(provider, 'source', locale)
      : inSentence
        ? t('start.from.otherMail.inSentence')
        : t('start.from.otherMail');
}

/**
 * Whether the reader's browser says motion is fine: the step change scrolls
 * smoothly only then, as the wizard's does (0145 T3 (a)).
 */
const motionWelcome = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

const StartMigration: React.FC = () => {
  const { t, locale } = useLocale();
  const { list } = useFormatters();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
    const facts: {
      google?: DiscoveryDomain[];
      microsoft?: DiscoveryDomain[];
      googleClient?: 'deployment' | 'connection';
    } = {};
    if (providerAccounts?.google) facts.google = providerAccounts.google.domains;
    if (providerAccounts?.google?.client) facts.googleClient = providerAccounts.google.client;
    if (providerAccounts?.microsoft) facts.microsoft = providerAccounts.microsoft.domains;
    return facts;
  }, [providerAccounts]);

  const [step, setStep] = React.useState<Step>('who');
  const [who, setWho] = React.useState<Who>({
    personId: searchParams.get('person'),
    name: '',
    someoneElse: false,
  });
  const [providers, setProviders] = React.useState<ReadonlyArray<StartProvider>>([]);
  const [ticked, setTicked] = React.useState<Partial<Record<StartProvider, ReadonlyArray<DiscoveryDomain>>>>({});
  const [nativeFormats, setNativeFormats] = React.useState<NativeFilePolicyByKind>(LEAVE_ALL_BEHIND);
  const [paperFormat, setPaperFormat] = React.useState<DropboxPaperPolicy>(SUGGESTED_PAPER_FORMAT);
  const [destination, setDestination] = React.useState<Partial<Record<DiscoveryDomain, string>>>({});
  // A company's mail through its own app (`PlanChoices`, 0153 open question 5).
  const [microsoftMail, setMicrosoftMail] = React.useState<MicrosoftMailThrough | undefined>(undefined);
  const choices: PlanChoices = React.useMemo(() => (microsoftMail ? { microsoftMail } : {}), [microsoftMail]);
  // The providers whose export was ticked under their tile, and where it is
  // read from (0153 open question 5, item 2).
  const [exportsTicked, setExportsTicked] = React.useState<ReadonlyArray<StartProvider>>([]);
  const [exportTo, setExportTo] = React.useState<string | undefined>(undefined);
  // The folder each migration's copies land in, as typed (0153 open question
  // 5, item 4); a migration not touched follows `prefixOf`.
  const [prefixes, setPrefixes] = React.useState<Readonly<Record<string, string>>>({});
  // Where the files start (0153 open question 5, item 4): the providers whose
  // files move from one folder only, chosen on *What moves?*, and that folder
  // for each card, as typed or picked once its account is connected.
  const [oneFolder, setOneFolder] = React.useState<ReadonlyArray<StartProvider>>([]);
  const [folders, setFolders] = React.useState<Readonly<Record<string, string>>>({});

  const people: ReadonlyArray<Person> = (peopleQuery.data?.people ?? []).filter(
    (p) => !p.implicit && p.displayName !== null,
  );
  // A `?person=` that names nobody on Migrations (gone, or somebody else's)
  // chooses nobody: the screen asks for a name rather than going on with none.
  const peopleRead = peopleQuery.isSuccess;
  React.useEffect(() => {
    if (peopleRead && who.personId !== null && !people.some((p) => p.id === who.personId)) {
      setWho({ personId: null, name: '', someoneElse: who.someoneElse });
    }
  }, [peopleRead, people, who.personId, who.someoneElse]);

  /** What each ticked provider moves: what was ticked, or everything it offers until it is touched. */
  const movesFrom = (provider: StartProvider): ReadonlyArray<DiscoveryDomain> =>
    ticked[provider] ?? offers(provider, served);
  /** The providers whose export moves: ticked, still being left, and read by this build. */
  const exporting = providers.filter((p) => exportsTicked.includes(p) && exportOf(p)?.readable === true);

  const personName =
    who.personId === null ? who.name.trim() : (people.find((p) => p.id === who.personId)?.displayName ?? '');
  const accounts = useAccounts(personName);
  const needs: ReadonlyArray<ConnectionNeed> = providers.flatMap((provider) =>
    connectionsFor(provider, movesFrom(provider), served, choices),
  );
  /** The source accounts chosen, per card; undefined until each is. */
  const sourceOf = (need: ConnectionNeed): Signed | undefined =>
    accounts.signed(
      accounts.choice(`source:${need.card}`, savedSources(accounts.saved, need.card, need.types), who.someoneElse),
    );
  /**
   * The folder a need's files start from, as typed or picked; undefined where
   * all of them move, or it moves no files (0153 open question 5, item 4).
   */
  const folderFor = (need: ConnectionNeed): string | undefined =>
    need.types.includes('file') && oneFolder.includes(need.provider) && folderKeyOf(need.card) !== undefined
      ? (folders[need.card] ?? '')
      : undefined;
  /** Whether the person connects this card themselves, by a grant link (0108). */
  const byLink = (card: string): boolean => who.someoneElse && grantableByLink(card, served);
  /** Every data type that travels, once, in the order a person reads them. */
  const types: ReadonlyArray<DiscoveryDomain> = TYPE_ORDER.filter((d) => needs.some((n) => n.types.includes(d)));
  const destinationOf = (type: DiscoveryDomain): string =>
    destination[type] ?? defaultDestination(type, accounts.saved);

  /** Every data type's journey, once each account is chosen (T4, *Underneath*). */
  const routes: ReadonlyArray<Route> = needs.flatMap((need) => {
    const from = sourceOf(need);
    if (from === undefined) return [];
    return need.types.flatMap((type): Route[] => {
      const to = accounts.signed(destinationOf(type));
      if (to === undefined) return [];
      return [
        {
          type,
          provider: need.provider,
          // A saved Google Calendar or Contacts account is made with its own
          // card, since the create door holds a reused account to its kind.
          sourceCard: RETIRED_GOOGLE_CARDS[from.card] === undefined ? need.card : from.card,
          sourceConnectionId: from.connectionId,
          sourceUsername: from.username,
          targetCard: to.card as WizardTargetType,
          targetConnectionId: to.connectionId,
          ...(to.username ? { targetUsername: to.username } : {}),
        },
      ];
    });
  });
  /**
   * Where an export is read from and written to (0148 D11): what was chosen,
   * else the files' destination where it can serve one, else a saved
   * Nextcloud or WebDAV account, else a new Nextcloud.
   */
  const exportDestinationOf = (): string => {
    if (exportTo !== undefined) return exportTo;
    if (types.includes('file')) {
      const files = destinationOf('file');
      const card = cardOfDestination(files, accounts);
      if (card !== undefined && exportDestinations().includes(card)) return files;
    }
    return defaultExportDestination(accounts.saved);
  };
  const exportTarget = exporting.length === 0 ? undefined : accounts.signed(exportDestinationOf());
  const planned = [
    ...migrationsFor(routes),
    ...(exportTarget === undefined
      ? []
      : exporting.map((provider) =>
          exportMigration(provider, {
            card: exportTarget.card as WizardTargetType,
            connectionId: exportTarget.connectionId,
            ...(exportTarget.username ? { username: exportTarget.username } : {}),
          }),
        )),
  ];

  // THE WORDS FOR A MIGRATION: *"{person} — {provider} to {destination}"*
  // (T4, *Underneath*), and on the check screen its data types, from and to.
  // Another mail provider is named by its address's domain, which says more
  // than "IMAP" does.
  const typeWords = (types: ReadonlyArray<DiscoveryDomain>) =>
    list(types.map((d) => t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale)));
  const fromWord = (m: PlannedMigration) => {
    const archive = m.sourceCard === EXPORT_CARD ? exportOf(m.provider)?.archive : undefined;
    if (archive !== undefined) return ARCHIVE_PROVIDER_NAMES[archive];
    return m.provider === 'imap'
      ? m.sourceUsername.split('@')[1] || t('start.from.otherMail')
      : providerName(m.sourceCard, 'source', locale);
  };
  const toWord = (m: PlannedMigration) => providerName(m.targetCard, 'target', locale);
  const names: Readonly<Record<string, string>> = (() => {
    const base = planned.map((m) =>
      t('start.migrationName', { person: personName, provider: fromWord(m), destination: toWord(m) }),
    );
    // Two migrations of one person between the same two providers (Google's
    // account and its Gmail, say) say which data types each carries.
    return Object.fromEntries(
      planned.map((m, i) => [
        pairKey(m),
        base.filter((b) => b === base[i]).length > 1 ? `${base[i]} (${typeWords(m.types)})` : base[i]!,
      ]),
    );
  })();
  const titles: Readonly<Record<string, string>> = Object.fromEntries(
    planned.map((m) => {
      // An export's files are its photos (owner decision D5), and it says so.
      const types = m.sourceCard === EXPORT_CARD ? t('start.what.photos') : typeWords(m.types);
      return [
        pairKey(m),
        t('start.check.route', {
          types: types.charAt(0).toLocaleUpperCase(locale) + types.slice(1),
          from: fromWord(m),
          to: toWord(m),
        }),
      ];
    }),
  );

  /**
   * WHERE A MIGRATION'S COPIES LAND (0153 open question 5, item 4): what was
   * typed, else a folder named after the account it comes from where another
   * migration sends the same data types to the same destination, else none,
   * so the copies merge into the destination's own folders, as before.
   */
  const prefixOf = (m: PlannedMigration): string =>
    prefixes[pairKey(m)] ?? (sharesItsDestination(m, planned) ? m.sourceUsername || fromWord(m) : '');
  const prefixFor = (m: PlannedMigration) => {
    const folder = prefixOf(m).trim();
    return folder === '' ? {} : { targetFolderPrefix: folder };
  };
  /** Where a migration's files start, where only one folder of them moves: after the account's own. */
  const folderOf = (m: PlannedMigration) => {
    const key = folderKeyOf(m.sourceCard);
    if (key === undefined || !m.types.includes('file') || !oneFolder.includes(m.provider)) return {};
    const folder = folderValue(m.sourceCard, folders[m.sourceCard] ?? '');
    return folder === '' ? {} : { [key]: folder };
  };
  /**
   * WHAT A MIGRATION IS MADE WITH: the two accounts chosen, whose data it is,
   * what a reused account must say again (Box's subject, a root folder), the
   * folder its files start from, the formats chosen on *What moves?*, and
   * where its copies land. No schedule: the automatic cadence (workplan 0157
   * T7; the owner, 2026-10-05: *"sync slow down once a migration is in step:
   * yes"*), every hour for 14 days as the owner's *"paid default: hourly"* of
   * 2026-10-04 asked, then every 6 hours, then once a day from day 30, the 14
   * days starting again when somebody opens the migration or presses *Sync
   * now*. It was daily at 02:00 (0153 T4 *Underneath*), then hourly. A first
   * copy runs pass after pass whatever the schedule says (0156 T5); Free's
   * pace is the tick's to keep (0157 T2).
   */
  const inputFor = (m: PlannedMigration): CreateMappingInput => {
    if (m.sourceCard === EXPORT_CARD) {
      // An export (0153 open question 5, item 2): no account to reuse, so its
      // source is made with it, as a folder of the destination's own files.
      return {
        name: names[pairKey(m)] ?? '',
        sourceType: 'archive',
        targetType: m.targetCard,
        targetConnectionId: m.targetConnectionId,
        sourceConfig: { username: '', provider: exportOf(m.provider)!.archive, path: TAKEOUT_FOLDER, where: 'target' },
        targetConfig: { username: m.targetUsername ?? '', password: '' },
        syncConfig: { domains: [...m.types] },
        ...prefixFor(m),
      };
    }
    const files = m.types.includes('file');
    return {
      name: names[pairKey(m)] ?? '',
      sourceType: m.sourceCard as CreateMappingInput['sourceType'],
      targetType: m.targetCard,
      sourceConnectionId: m.sourceConnectionId,
      targetConnectionId: m.targetConnectionId,
      sourceConfig: {
        username: m.sourceUsername,
        ...(accounts.signed(m.sourceConnectionId)?.perMapping ?? {}),
        ...folderOf(m),
        ...(files && (m.sourceCard === 'google' || m.sourceCard === 'google-drive')
          ? { nativeFilePolicies: { ...nativeFormats } }
          : {}),
        ...(files && m.sourceCard === 'dropbox' ? { nativeFilePolicies: { paper: paperFormat } } : {}),
      },
      targetConfig: { username: m.targetUsername ?? '', password: '' },
      syncConfig: { domains: [...m.types] },
      ...prefixFor(m),
    };
  };

  const [made, setMade] = React.useState<Made>({ personId: undefined, migrations: {} });
  const [settingUp, setSettingUp] = React.useState(false);
  const [personFailed, setPersonFailed] = React.useState<string | null>(null);
  /** Once anything is made, going back would make it twice: the way back closes. */
  const madeAny = Object.values(made.migrations).some((m) => m.id !== undefined);

  /**
   * SET UP, PAUSED (T4, *Review and start*): the person, if new, then one
   * migration per pair of accounts, each added to the person. Nothing copies
   * before *Start*: a migration is made paused. Pressed again after a refusal,
   * only what is not made yet is asked for.
   */
  const setUp = async () => {
    setSettingUp(true);
    setPersonFailed(null);
    const migrations: Record<string, MadeMigration> = { ...made.migrations };
    try {
      let personId = made.personId ?? who.personId ?? undefined;
      if (personId === undefined) {
        try {
          personId = (await createPerson({ displayName: who.name.trim(), email: null })).id;
        } catch (error) {
          setPersonFailed(serverMessage(error));
          return;
        }
        setMade((prev) => ({ ...prev, personId }));
      }
      for (const m of planned) {
        const key = pairKey(m);
        if (migrations[key]?.id !== undefined) continue;
        try {
          const { id } = await mappingApi.create(inputFor(m));
          let notAdded: string | undefined;
          try {
            await addMigrationToPerson(personId, id);
          } catch (error) {
            notAdded = serverMessage(error);
          }
          migrations[key] = notAdded === undefined ? { id } : { id, notAdded };
        } catch (error) {
          migrations[key] = { failed: serverMessage(error) };
        }
      }
      setMade({ personId, migrations });
      void queryClient.invalidateQueries({ queryKey: ['people'] });
      void queryClient.invalidateQueries({ queryKey: ['mappings'] });
      if (planned.every((m) => migrations[pairKey(m)]?.id !== undefined)) setStep('check');
    } finally {
      setSettingUp(false);
    }
  };
  const setUpFailures = planned.flatMap((m) => {
    const failed = made.migrations[pairKey(m)]?.failed;
    return failed === undefined ? [] : [{ key: pairKey(m), title: titles[pairKey(m)] ?? '', failed }];
  });

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
        return providers.every((p) => movesFrom(p).length === 0) && exporting.length === 0
          ? t('start.what.needOne')
          : undefined;
      case 'connect':
        if (needs.some((need) => sourceOf(need) === undefined)) return t('start.connect.needAll');
        return needs.some((need) => {
          const folder = folderFor(need);
          return folder !== undefined && folderValue(need.card, folder) === '';
        })
          ? t('start.connect.needFolder')
          : undefined;
      case 'to': {
        if (
          types.some((type) => accounts.signed(destinationOf(type)) === undefined) ||
          (exporting.length > 0 && exportTarget === undefined)
        ) {
          return t('start.to.needAll');
        }
        // A destination whose last test found it does not take its type: the
        // create door would refuse it, so the screen says so first.
        const refused = types.find((type) => {
          const chosen = accounts.saved.find((c) => c.id === destinationOf(type));
          return chosen !== undefined && measuredCannotTake(chosen, type) !== undefined;
        });
        return refused === undefined
          ? undefined
          : t('start.to.cannotTakeChosen', { type: t(DOMAIN_STRING_KEY[refused]).toLocaleLowerCase(locale) });
      }
      default:
        return undefined;
    }
  })();

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
          {step === 'from' && <FromStep providers={providers} onProviders={setProviders} />}
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
              microsoftMail={microsoftMail}
              onMicrosoftMail={setMicrosoftMail}
              exports={exportsTicked}
              onExports={setExportsTicked}
              oneFolder={oneFolder}
              onOneFolder={setOneFolder}
            />
          )}
          {step === 'connect' && (
            <ConnectStep
              needs={needs}
              accounts={accounts}
              someoneElse={who.someoneElse}
              byLink={byLink}
              exporting={exporting}
              folderFor={folderFor}
              onFolder={(card, folder) => setFolders((prev) => ({ ...prev, [card]: folder }))}
            />
          )}
          {step === 'check' && (
            <CheckStep
              planned={planned}
              made={made}
              titles={titles}
              personName={personName}
              awaitsGrant={(m) => byLink(m.sourceCard) && accounts.signed(m.sourceConnectionId)?.ready !== true}
              onStarted={() => {
                void queryClient.invalidateQueries({ queryKey: ['people'] });
                void navigate(made.personId === undefined ? '/mappings' : `/people/${made.personId}`);
              }}
            />
          )}
          {step === 'to' && (
            <ToStep
              types={types}
              accounts={accounts}
              destinationOf={destinationOf}
              onDestination={(type, choice) => setDestination((prev) => ({ ...prev, [type]: choice }))}
              onAddedFor={(card, connectionId) => {
                if (exporting.length > 0 && exportDestinationOf() === `new:${card}`) setExportTo(connectionId);
                setDestination((prev) => {
                  const next = { ...prev };
                  for (const type of types) {
                    if ((prev[type] ?? defaultDestination(type, accounts.saved)) === `new:${card}`) {
                      next[type] = connectionId;
                    }
                  }
                  return next;
                });
              }}
              exportRow={
                exporting.length === 0 ? undefined : { choice: exportDestinationOf(), onChoice: setExportTo }
              }
              onLeaveOut={
                types.length > 1 || exporting.length > 0
                  ? (type) => {
                      // Out of every provider's ticks, as if unticked on *What moves?*.
                      setTicked((prev) => {
                        const next = { ...prev };
                        for (const provider of providers) {
                          next[provider] = movesFrom(provider).filter((d) => d !== type);
                        }
                        return next;
                      });
                    }
                  : undefined
              }
              lands={{
                planned,
                titles,
                prefixOf,
                shared: (m) => sharesItsDestination(m, planned),
                onPrefix: (m, folder) => setPrefixes((prev) => ({ ...prev, [pairKey(m)]: folder })),
              }}
            />
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-start justify-between gap-3">
        {back !== undefined && !madeAny ? (
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
              // Leaving *Where does it go?* sets the migrations up, paused.
              onClick={() => (step === 'to' ? void setUp() : setStep(next))}
              disabled={notYet !== undefined || settingUp}
              aria-describedby={notYet === undefined ? undefined : reasonId}
              className="min-h-[44px] px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {settingUp ? t('start.to.settingUp') : t('wizard.next')}
            </button>
            {notYet !== undefined && (
              <p id={reasonId} className="mt-2 text-sm text-gray-600">
                {notYet}
              </p>
            )}
            {step === 'to' && personFailed !== null && (
              <p role="alert" className="mt-2 text-sm text-red-800">
                <span className="font-medium">{t('people.new.failed')}</span> {personFailed}
              </p>
            )}
            {step === 'to' &&
              setUpFailures.map((f) => (
                <p key={f.key} role="alert" className="mt-2 text-sm text-red-800">
                  <span className="font-medium">{t('start.to.failed', { migration: f.title })}</span> {f.failed}
                </p>
              ))}
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
        onChange={(e) => onWho({ ...who, personId: null, name: e.target.value })}
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
                  onChange={() => onWho({ ...who, personId: p.id, name: '' })}
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
                onChange={() => onWho({ ...who, personId: null })}
                className="h-4 w-4"
              />
              <span className="text-gray-900">{t('start.who.someoneNew')}</span>
            </label>
          </div>
          {who.personId === null && <div className="mt-2 pl-7">{nameField}</div>}
        </fieldset>
      )}
      {/* WHOSE ACCOUNTS (T4): somebody else connects what a link can reach
          themselves, so the one starting never holds that password (0108). */}
      <fieldset>
        <legend className="sr-only">{t('start.who.whose')}</legend>
        <div className="space-y-1">
          <label className="flex min-h-[44px] items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="start-whose"
              checked={!who.someoneElse}
              onChange={() => onWho({ ...who, someoneElse: false })}
              className="h-4 w-4"
            />
            <span className="text-gray-900">{t('start.who.myself')}</span>
          </label>
          <label className="flex min-h-[44px] items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="start-whose"
              checked={who.someoneElse}
              onChange={() => onWho({ ...who, someoneElse: true })}
              className="h-4 w-4"
            />
            <span className="text-gray-900">{t('start.who.someoneElse')}</span>
          </label>
          <p className="pl-7 text-sm text-gray-600">{t('start.who.someoneElse.line')}</p>
        </div>
      </fieldset>
    </div>
  );
};

/** Screen 2: the accounts being left, as tiles; none ticked, more than one allowed. */
export const FromStep: React.FC<{
  providers: ReadonlyArray<StartProvider>;
  onProviders: (providers: ReadonlyArray<StartProvider>) => void;
}> = ({ providers, onProviders }) => {
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
              // THE WHY FOLDS INSIDE THE TILE, BELOW ITS NAME (the owner,
              // 2026-09-29: "should it go in each ticker box that has that
              // label?"). Inside the tile's border, so it reads as that tile's,
              // and outside its <label>, so opening it does not tick the tile
              // (0145 T2: a fold inside a control is pressed with it).
              <div
                key={provider}
                className={`flex flex-col rounded-lg border-2 focus-within:ring-2 focus-within:ring-blue-500 ${
                  on ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <label className="flex flex-1 min-h-[44px] cursor-pointer items-center justify-between gap-3 p-3">
                  <span className="flex items-center gap-1 font-medium text-gray-900">
                    <ProviderTile type={provider} role="source" size={48} name={label(provider)} />
                    {experimental && <ExperimentalTag />}
                  </span>
                  <input type="checkbox" checked={on} onChange={() => toggle(provider)} className="h-5 w-5 shrink-0" />
                </label>
                {experimental && (
                  <div className="px-3 pb-2">
                    <ExperimentalWhy />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>
      {/* No line for an export archive (0153 open question 5, item 2): every
          export has a provider, so it sits under that provider's tile on the
          next screen. */}
      {/* OTHER WAYS TO CONNECT, without the wizard (0153 open question 5): the
          one source protocol is IMAP, and it is the tile above. The fold named
          CalDAV, CardDAV, WebDAV and JMAP too, which are destinations only. */}
      <details>
        <summary className="cursor-pointer text-sm text-blue-700">{t('start.from.other')}</summary>
        <p className="mt-2 text-sm text-gray-700">{t('start.from.other.line')}</p>
        {!providers.includes('imap') && (
          <button
            type="button"
            onClick={() => toggle('imap')}
            className="mt-2 min-h-[44px] px-4 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50"
          >
            {t('start.from.other.choose')}
          </button>
        )}
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
  /** A company's mail through its own app, where its administrator chose that (0153 open question 5). */
  microsoftMail?: MicrosoftMailThrough | undefined;
  onMicrosoftMail?: (next: MicrosoftMailThrough | undefined) => void;
  /** The providers whose export was ticked under their tile (0153 open question 5, item 2). */
  exports?: ReadonlyArray<StartProvider>;
  onExports?: (next: ReadonlyArray<StartProvider>) => void;
  /** The providers whose files move from one folder only (0153 open question 5, item 4). */
  oneFolder?: ReadonlyArray<StartProvider>;
  onOneFolder?: (next: ReadonlyArray<StartProvider>) => void;
}> = ({
  providers,
  served,
  movesFrom,
  onTicked,
  nativeFormats,
  onNativeFormats,
  paperFormat,
  onPaperFormat,
  microsoftMail,
  onMicrosoftMail = () => undefined,
  exports = [],
  onExports = () => undefined,
  oneFolder = [],
  onOneFolder = () => undefined,
}) => {
  const { t, locale } = useLocale();
  const { list } = useFormatters();
  const label = useProviderLabel();
  const choices: PlanChoices = microsoftMail ? { microsoftMail } : {};
  const typeWords = (types: ReadonlyArray<DiscoveryDomain>) =>
    list(types.map((d) => t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale)));
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">{t('start.what.hint')}</p>
      {providers.map((provider) => {
        const moves = movesFrom(provider);
        const missing = cannotGive(provider, served);
        const exported = exportOf(provider);
        const why: Partial<Record<StartProvider, StringKey>> = {
          apple: 'start.what.notFrom.apple.why',
          imap: 'start.what.notFrom.imap.why',
        };
        const whyKey = why[provider];
        return (
          <fieldset key={provider}>
            <legend className="font-semibold text-gray-900">
              <ProviderTile
                type={provider}
                role="source"
                size={28}
                name={t('start.what.from', { provider: label(provider, true) })}
              />
            </legend>
            <div className="mt-2 space-y-1">
              {offers(provider, served).map((type) => {
                const on = moves.includes(type);
                const experimental = sourceFaceIsExperimental(
                  carrierOf(provider, type, served, microsoftMail ? { microsoftMail } : {}),
                  type,
                );
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
                    {on && type === 'file' && offersOneFolder(provider, served, choices) && (
                      <FilesFrom
                        provider={provider}
                        card={carrierOf(provider, 'file', served, choices)}
                        one={oneFolder.includes(provider)}
                        onOne={(one) =>
                          onOneFolder(one ? [...oneFolder, provider] : oneFolder.filter((p) => p !== provider))
                        }
                      />
                    )}
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
                    {on && type === 'email' && provider === 'microsoft' && (
                      <MicrosoftMailChoice value={microsoftMail} onChange={onMicrosoftMail} />
                    )}
                  </div>
                );
              })}
              {exported?.readable === true && (
                <ExportTick
                  archive={exported.archive}
                  on={exports.includes(provider)}
                  onChange={(on) => onExports(on ? [...exports, provider] : exports.filter((p) => p !== provider))}
                />
              )}
              {exported !== undefined && !exported.readable && <ExportNotRead archive={exported.archive} />}
              {missing.length > 0 && (
                <Hint
                  className="mt-2"
                  text={t('start.what.notFrom', { provider: label(provider, true), types: typeWords(missing) })}
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

/** Where a card's files are, as a person names the whole of them: My Drive, Dropbox, Box. */
function usePlaceName(): (card: string) => string {
  const { t, locale } = useLocale();
  return (card) =>
    card === 'google' || card === 'google-drive' ? t('start.place.myDrive') : providerDisplayName(card, locale);
}

/**
 * WHICH FILES (0153 open question 5, item 4; the owner, 2026-10-04: *"go with
 * the recommendations"*): all of the account, or only one folder, which is
 * asked once the account is connected, when its folders can be listed. A
 * shared drive is a folder here, as it is to a migration.
 */
const FilesFrom: React.FC<{
  provider: StartProvider;
  card: string;
  one: boolean;
  onOne: (one: boolean) => void;
}> = ({ provider, card, one, onOne }) => {
  const { t } = useLocale();
  const place = usePlaceName();
  const lineId = React.useId();
  const name = `start-files-from-${provider}`;
  return (
    <fieldset className="ml-8 mt-1 mb-2">
      <legend className="text-sm text-gray-700">{t('start.what.files.legend')}</legend>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
        <input type="radio" name={name} checked={!one} onChange={() => onOne(false)} className="h-4 w-4" />
        <span className="text-gray-900">{t('start.what.files.all', { place: place(card) })}</span>
      </label>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
        <input
          type="radio"
          name={name}
          checked={one}
          onChange={() => onOne(true)}
          aria-describedby={one ? lineId : undefined}
          className="h-4 w-4"
        />
        <span className="text-gray-900">{t('start.what.files.one')}</span>
      </label>
      {one && (
        <p id={lineId} className="ml-7 text-sm text-gray-600">
          {t('start.what.files.one.line')}
        </p>
      )}
    </fieldset>
  );
};

/** What each export is called under its provider's tile. */
const EXPORT_WORDS: Readonly<Record<ArchiveProvider, StringKey>> = {
  'google-takeout': 'start.what.export.google-takeout',
  'apple-privacy': 'start.what.export.apple-privacy',
};

/** What a readable export's tick box says under it, and why: the company's own words differ. */
const EXPORT_LINES: Readonly<Partial<Record<ArchiveProvider, { readonly line: StringKey; readonly why: StringKey }>>> = {
  'google-takeout': { line: 'start.what.export.google-takeout.line', why: 'start.what.export.google-takeout.why' },
};

/**
 * A PROVIDER'S EXPORT AS A TICK BOX (0153 open question 5, item 2): Google's
 * photos *from a Takeout export*, tagged as its card's verdict says (0148
 * D10). Unticked, because it costs the person a request to Google and a
 * download. Ticked, it says to ask now: an export can take days to prepare,
 * and the migration it makes waits for it.
 */
const ExportTick: React.FC<{ archive: ArchiveProvider; on: boolean; onChange: (on: boolean) => void }> = ({
  archive,
  on,
  onChange,
}) => {
  const { t } = useLocale();
  const experimental = sourceCardIsExperimental(EXPORT_CARD);
  const lines = EXPORT_LINES[archive];
  return (
    <div data-export={archive}>
      <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
        <input type="checkbox" checked={on} onChange={() => onChange(!on)} className="h-5 w-5" />
        <span className="text-gray-900">
          <span className="inline-flex items-center gap-2">
            <DataTypeIcon name="photos" size={20} className="shrink-0" />
            <span>{t(EXPORT_WORDS[archive])}</span>
          </span>
          {experimental && <ExperimentalTag />}
        </span>
      </label>
      {experimental && <ExperimentalWhy />}
      <div className="ml-8">
        {lines !== undefined && <Hint text={t(lines.line)} why={t(lines.why)} />}
        {on && (
          <p className="mt-1 text-sm text-gray-700">
            {t('start.what.export.askNow')}{' '}
            <a
              href={ARCHIVE_PROVIDER_ORIGINS[archive]}
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 underline hover:no-underline"
            >
              {ARCHIVE_PROVIDER_NAMES[archive]}
            </a>
          </p>
        )}
      </div>
    </div>
  );
};

/** The line the archive form says under an export no reader opens yet (0148 D7). */
const NO_READER: Readonly<Partial<Record<ArchiveProvider, StringKey>>> = {
  'apple-privacy': 'wizard.archiveProvider.noReader.apple-privacy',
};

/**
 * AN EXPORT NO READER OPENS YET, AS A LINE (0148 D7; 0153 open question 5,
 * item 2): Apple's, under Apple's tile, *To be tested*, with the archive
 * form's own sentence. Nothing to tick, since a migration from it could only
 * fail; a reader landing turns it into a tick box (`ProviderExport.readable`).
 */
const ExportNotRead: React.FC<{ archive: ArchiveProvider }> = ({ archive }) => {
  const { t } = useLocale();
  const line = NO_READER[archive];
  return (
    <div data-export={archive} className="flex items-start gap-3 py-2">
      <span className="mt-0.5 inline-flex w-5 shrink-0 justify-center text-gray-500">
        <DataTypeIcon name="photos" size={20} />
      </span>
      <p className="text-sm text-gray-700">
        <span className="font-medium text-gray-900">{t(EXPORT_WORDS[archive])}</span>{' '}
        <span className="ml-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 align-middle text-xs font-medium text-gray-700">
          {t('wizard.archiveProvider.untested')}
        </span>
        {line !== undefined && (
          <>
            <br />
            {t(line)}
          </>
        )}
      </p>
    </div>
  );
};

/** The words for each way a company's mail can be read, in the order they are offered. */
const MAIL_THROUGH: ReadonlyArray<{ readonly value: MicrosoftMailThrough | undefined; readonly key: StringKey }> = [
  { value: undefined, key: 'start.what.orgApp.signIn' },
  { value: 'graph', key: 'start.what.orgApp.graph' },
  { value: 'oauth2', key: 'start.what.orgApp.imap' },
];

/**
 * MAIL THROUGH A COMPANY'S OWN APP (0153 open question 5; the owner, 2026-10-04:
 * *"go with the recommendations"*). Behind the company question, as Google's
 * domain-wide key is in the account form: an administrator's own Entra app,
 * with application permissions, reads the mail, through Microsoft Graph or
 * through IMAP. It is the only way to a shared mailbox. The account's sign-in
 * still carries whatever else was ticked, so a No changes nothing.
 */
export const MicrosoftMailChoice: React.FC<{
  value: MicrosoftMailThrough | undefined;
  onChange: (next: MicrosoftMailThrough | undefined) => void;
}> = ({ value, onChange }) => {
  const { t } = useLocale();
  const [company, setCompany] = React.useState(value !== undefined);
  const name = React.useId();
  return (
    <fieldset className="ml-8 mt-1 mb-3">
      <legend className="text-sm text-gray-700">{t('start.company.question')}</legend>
      <div className="mt-1 flex gap-6">
        <label className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name={`${name}-company`}
            checked={!company}
            onChange={() => {
              setCompany(false);
              onChange(undefined);
            }}
          />
          {t('start.company.no')}
        </label>
        <label className="inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-700">
          <input type="radio" name={`${name}-company`} checked={company} onChange={() => setCompany(true)} />
          {t('start.company.yes')}
        </label>
      </div>
      {company && (
        <div className="mt-2">
          <p className="text-sm text-gray-700">{t('start.what.orgApp.lead')}</p>
          <div className="mt-1 space-y-1">
            {MAIL_THROUGH.map((way) => (
              <label key={way.key} className="flex min-h-[44px] cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name={`${name}-through`}
                  checked={value === way.value}
                  onChange={() => onChange(way.value)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-gray-900">
                  {t(way.key)}
                  {way.value !== undefined && sourceCardIsExperimental(way.value) && <ExperimentalTag />}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </fieldset>
  );
};

/**
 * THE TWO RETIRED GOOGLE CARDS, and the one data type each reads (0153 open
 * question 5, item 3). No new migration is made with either, and an account
 * saved with one is offered for the Google tile where it carries exactly what
 * was ticked.
 */
const RETIRED_GOOGLE_CARDS: Readonly<Record<string, DiscoveryDomain>> = {
  'google-calendar': 'calendar',
  'google-contacts': 'contact',
};

/**
 * Saved accounts a card can sign in with: its own kind, never one whose grant
 * was withdrawn. A company's own app is one kind (`o365`) whichever way its
 * mail is read, so either of its cards offers it. Google's account card also
 * offers a saved Google Calendar or Google Contacts account where the ticked
 * types are that one's alone.
 */
export const savedSources = (
  saved: ReadonlyArray<ConnectionSummary>,
  card: string,
  types: ReadonlyArray<DiscoveryDomain> = [],
): ReadonlyArray<ConnectionSummary> =>
  saved.filter((c) => {
    if (c.role !== 'source' || c.status === 'revoked') return false;
    const kindCard = wizardTypeForConnectionKind(c.kind);
    if (kindCard === card || (card === 'oauth2' && kindCard === 'graph')) return true;
    const only = RETIRED_GOOGLE_CARDS[kindCard];
    return card === 'google' && only !== undefined && types.length === 1 && types[0] === only;
  });

/** Saved destinations that can take a data type (`destinationsFor`). */
export const savedTargets = (
  saved: ReadonlyArray<ConnectionSummary>,
  type: DiscoveryDomain,
): ReadonlyArray<ConnectionSummary> =>
  saved.filter(
    (c) =>
      c.role === 'target' &&
      c.status !== 'revoked' &&
      destinationsFor(type).includes(c.kind as WizardTargetType),
  );

/**
 * What a saved destination's last test MEASURED it cannot take (0106 T3a): the
 * account's own evidence, or undefined where it can or was never asked. Only
 * a measured no counts, as at the create door (`measuredNoRefusal`), which
 * stays the safety net: *Where does it go?* says it first (the owner,
 * 2026-10-04, on 0153's *not carried over*: *"4. C, without D"*).
 */
export function measuredCannotTake(
  c: ConnectionSummary,
  type: DiscoveryDomain,
): { readonly detail: string } | undefined {
  const record = qualifiedAnswerFor(c.qualification, type);
  return record?.answer === 'no' ? { detail: record.detail } : undefined;
}

/**
 * Where a data type goes until the person says otherwise (T4, *Where to?*):
 * a saved account that takes it, Soverin for mail, calendars, contacts and
 * tasks and Nextcloud for files first, as drawn; and with none saved, a new
 * account of that kind, with its published servers already in the boxes. An
 * account whose last test found it does not take the type is never suggested.
 */
export function defaultDestination(type: DiscoveryDomain, saved: ReadonlyArray<ConnectionSummary>): string {
  const prefer: WizardTargetType = type === 'file' ? 'nextcloud' : 'soverin';
  const candidates = savedTargets(saved, type).filter(
    (c) => c.status === 'connected' && measuredCannotTake(c, type) === undefined,
  );
  const found = candidates.find((c) => c.kind === prefer) ?? candidates[0];
  return found?.id ?? `new:${prefer}`;
}

/** Saved destinations an export can be read from (`exportDestinations`, 0148 D11). */
export const savedExportTargets = (saved: ReadonlyArray<ConnectionSummary>): ReadonlyArray<ConnectionSummary> =>
  saved.filter(
    (c) =>
      c.role === 'target' && c.status !== 'revoked' && exportDestinations().includes(c.kind as WizardTargetType),
  );

/**
 * Where an export is read from when the files go nowhere that can serve it:
 * a saved Nextcloud first, then any saved WebDAV account, and with none saved,
 * a new Nextcloud, as files default to.
 */
export function defaultExportDestination(saved: ReadonlyArray<ConnectionSummary>): string {
  const candidates = savedExportTargets(saved).filter((c) => c.status === 'connected');
  const found = candidates.find((c) => c.kind === 'nextcloud') ?? candidates[0];
  return found?.id ?? 'new:nextcloud';
}

/** The card behind a destination choice: a saved account's kind, or the card a new one is added with. */
const cardOfDestination = (choice: string, accounts: Accounts): WizardTargetType | undefined =>
  (choice.startsWith('new:') ? choice.slice(4) : accounts.signed(choice)?.card) as WizardTargetType | undefined;

/** The accounts, their forms and what was chosen, for screens 4 and 5. */
function useAccounts(personName: string): Accounts {
  const queryClient = useQueryClient();
  const connections = useQuery({ queryKey: ['connections'], queryFn: connectionsApi.list });
  const [chosen, setChosen] = React.useState<Record<string, string>>({});
  const [typed, setTyped] = React.useState<Record<string, Record<string, string>>>({});
  const [addedHere, setAddedHere] = React.useState<Record<string, Signed>>({});
  const [failedHere, setFailedHere] = React.useState<Record<string, string>>({});
  const [formKeys, setFormKeys] = React.useState<Record<string, number>>({});
  const saved = connections.data ?? [];
  return {
    saved,
    loading: connections.isPending,
    failed: connections.isError,
    personName,
    choice: (key, list, noDefault = false) =>
      chosen[key] ??
      (connections.isPending ? undefined : noDefault ? (list.length === 0 ? 'new' : undefined) : defaultChoice(list)),
    keep: (key, connectionId, username) => {
      setAddedHere((prev) => ({
        ...prev,
        [connectionId]: {
          connectionId,
          card: key.slice(key.indexOf(':') + 1),
          ready: false,
          username,
          perMapping: {},
        },
      }));
      setChosen((prev) => ({ ...prev, [key]: connectionId }));
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
    choose: (key, choice) => setChosen((prev) => ({ ...prev, [key]: choice })),
    values: (key, initial) => typed[key] ?? { ...initial },
    onValues: (key, initial) => (action) =>
      setTyped((prev) => {
        const current = prev[key] ?? { ...initial };
        return { ...prev, [key]: typeof action === 'function' ? action(current) : action };
      }),
    signed: (id) => {
      if (id === undefined || id === 'new' || id.startsWith('new:')) return undefined;
      const row = saved.find((c) => c.id === id);
      return row ? signedFrom(row) : addedHere[id];
    },
    onAdded: (key, added, values) => {
      // Saved either way (the form's rule), and kept only where its check
      // passed: a sign-in that does not work yet is not a way forward here.
      if (!added.ok) {
        setFailedHere((prev) => ({ ...prev, [key]: added.id }));
        return;
      }
      setAddedHere((prev) => ({
        ...prev,
        [added.id]: {
          connectionId: added.id,
          // The key is `source:<card>` or `target:<card>`.
          card: key.slice(key.indexOf(':') + 1),
          ready: true,
          username: values.username?.trim() ?? '',
          perMapping: pickPerMapping(values),
        },
      }));
      setChosen((prev) => ({ ...prev, [key]: added.id }));
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
    },
    failedCheck: (key) => failedHere[key],
    tryAgain: (key) => {
      const id = failedHere[key];
      setFailedHere((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setFormKeys((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
      // The account the failed check left is this flow's own, and nothing
      // uses it yet: it goes, so the Accounts page does not keep a row that
      // never worked. What was typed stays in the form.
      if (id !== undefined) {
        void connectionsApi
          .remove(id)
          .catch(() => undefined)
          .then(() => queryClient.invalidateQueries({ queryKey: ['connections'] }));
      }
    },
    formKey: (key) => formKeys[key] ?? 0,
  };
}

/** A saved account as a choice reads: its name, and the address where the name is not it. */
function useAccountLabel(): (c: ConnectionSummary) => string {
  return (c) => {
    const username = c.knownValues?.username;
    return username && username !== c.displayName ? `${c.displayName} (${username})` : c.displayName;
  };
}

/**
 * Screen 4: one sign-in per card the ticks need, each asking for exactly what
 * was ticked (T1 (c)). Where Google's restricted scopes are not declared, how
 * many Google takes is said before the first (T4). A saved account is offered
 * first (0064), and the one saved account is the default.
 */
export const ConnectStep: React.FC<{
  needs: ReadonlyArray<ConnectionNeed>;
  accounts: Accounts;
  /** The accounts are somebody else's: nothing saved is chosen for them by default. */
  someoneElse?: boolean;
  /** Which cards the person connects themselves, by a grant link. */
  byLink?: (card: string) => boolean;
  /** The providers whose export moves: it needs no sign-in, and the screen says so. */
  exporting?: ReadonlyArray<StartProvider>;
  /** The folder a need's files start from, where only one folder of them moves (0153 open question 5, item 4). */
  folderFor?: (need: ConnectionNeed) => string | undefined;
  onFolder?: (card: string, folder: string) => void;
}> = ({
  needs,
  accounts,
  someoneElse = false,
  byLink = () => false,
  exporting = [],
  folderFor = () => undefined,
  onFolder = () => undefined,
}) => {
  const { t } = useLocale();
  const google = needs.filter((n) => n.provider === 'google');
  if (accounts.loading) return <p className="text-sm text-gray-500">{t('common.loading')}</p>;
  return (
    <div className="space-y-4">
      {accounts.failed && (
        <p role="alert" className="text-sm text-red-800">
          {t('start.accountsFailed')}
        </p>
      )}
      {google.length > 1 && (
        <p className="text-sm text-gray-700">{t('start.connect.googleApart', { n: google.length })}</p>
      )}
      <ul className="space-y-4">
        {needs.map((need) =>
          byLink(need.card) ? (
            <LinkedNeedRow
              key={need.card}
              need={need}
              accounts={accounts}
              folder={folderFor(need)}
              onFolder={(folder) => onFolder(need.card, folder)}
            />
          ) : (
            <NeedRow
              key={need.card}
              need={need}
              accounts={accounts}
              someoneElse={someoneElse}
              folder={folderFor(need)}
              onFolder={(folder) => onFolder(need.card, folder)}
            />
          ),
        )}
      </ul>
      {exporting.length > 0 && <p className="text-sm text-gray-700">{t('start.connect.exportNoSignIn')}</p>}
    </div>
  );
};

/** What a row asks of its files' folder: the folder as typed, where only one folder moves. */
interface FolderAsked {
  readonly folder?: string | undefined;
  readonly onFolder?: (folder: string) => void;
}

const NeedRow: React.FC<{ need: ConnectionNeed; accounts: Accounts; someoneElse?: boolean } & FolderAsked> = ({
  need,
  accounts,
  someoneElse = false,
  folder,
  onFolder = () => undefined,
}) => {
  const { t, locale } = useLocale();
  const { list } = useFormatters();
  const accountLabel = useAccountLabel();
  const key = `source:${need.card}`;
  const saved = savedSources(accounts.saved, need.card, need.types);
  const choice = accounts.choice(key, saved, someoneElse);
  const signed = accounts.signed(choice);
  const name = providerDisplayName(need.card, locale);
  // *Another mail provider* is the IMAP card, named as step 2 named it.
  const title = need.card === 'imap' ? t('start.from.otherMail') : name;
  const initial = formDefaultsFor('source', need.card);
  return (
    <li className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-gray-900">
          <ProviderTile type={need.card} role="source" size={28} name={title} />
        </span>
        {signed && (
          <span className="text-sm text-green-700">
            {t('start.connect.as', { account: signed.username || name })}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {t('start.connect.asks', {
          types: list(need.types.map((d) => t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale))),
        })}
      </p>
      {someoneElse && (
        // No link reaches this provider: said, rather than promised.
        <p className="mt-1 text-sm text-gray-700">
          {t('start.connect.together', { provider: title, person: accounts.personName })}
        </p>
      )}
      {saved.length > 0 && (
        <fieldset className="mt-3">
          <legend className="sr-only">{t('start.connect.which', { provider: title })}</legend>
          <div className="space-y-1">
            {saved.map((c) => (
              <label key={c.id} className="flex min-h-[44px] cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name={`start-${key}`}
                  checked={choice === c.id}
                  onChange={() => accounts.choose(key, c.id)}
                  className="h-4 w-4"
                />
                <span className="text-gray-900">
                  {accountLabel(c)}
                  {c.status === 'error' && (
                    <span className="ml-2 text-sm text-amber-800">{t('start.connect.errored')}</span>
                  )}
                </span>
              </label>
            ))}
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="radio"
                name={`start-${key}`}
                checked={choice === 'new'}
                onChange={() => accounts.choose(key, 'new')}
                className="h-4 w-4"
              />
              <span className="text-gray-900">{t('start.connect.another')}</span>
            </label>
          </div>
        </fieldset>
      )}
      {choice === 'new' && (
        <div className="mt-3">
          <AccountForm
            key={`${key}:${accounts.formKey(key)}:${need.types.join(',')}`}
            role="source"
            type={need.card}
            variant="flow"
            domains={need.types}
            values={accounts.values(key, initial)}
            onValues={accounts.onValues(key, initial)}
            displayName={`${accounts.personName} · ${name}`}
            onDisplayName={() => undefined}
            onAdded={(added) => accounts.onAdded(key, added, accounts.values(key, initial))}
          />
          {accounts.failedCheck(key) !== undefined && (
            <button
              type="button"
              onClick={() => accounts.tryAgain(key)}
              className="mt-3 min-h-[44px] px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
            >
              {t('start.connect.tryAgain')}
            </button>
          )}
        </div>
      )}
      {signed !== undefined && folder !== undefined && (
        // Keyed by the account, so a list read from another one is not shown for it.
        <FolderToStartFrom
          key={signed.connectionId}
          card={need.card}
          signed={signed}
          value={folder}
          onChange={onFolder}
        />
      )}
    </li>
  );
};

/**
 * Screen 4 for an account somebody else connects themselves (T4, 0108): only
 * its address, saved with no credential, so the migration can name whose it
 * is. They grant it from a link on the last screen, and the one starting
 * never holds that password. A saved account is offered, never chosen: one
 * may be the starter's own.
 */
const LinkedNeedRow: React.FC<{ need: ConnectionNeed; accounts: Accounts } & FolderAsked> = ({
  need,
  accounts,
  folder,
  onFolder = () => undefined,
}) => {
  const { t, locale } = useLocale();
  const { list } = useFormatters();
  const accountLabel = useAccountLabel();
  const addressId = React.useId();
  const reasonId = React.useId();
  const key = `source:${need.card}`;
  const saved = savedSources(accounts.saved, need.card, need.types);
  const choice = accounts.choice(key, saved, true);
  const signed = accounts.signed(choice);
  const name = providerDisplayName(need.card, locale);
  const [address, setAddress] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [refused, setRefused] = React.useState<string | null>(null);
  const typed = address.trim();
  const save = async () => {
    setSaving(true);
    setRefused(null);
    try {
      // Saved even though its check cannot pass: there is nothing to check
      // with until they grant it. The migration reuses it, and the grant
      // lands on the migration (0108).
      const added = await connectionsApi.add({
        role: 'source',
        type: need.card,
        displayName: `${accounts.personName} · ${name}`,
        values: { username: typed },
      });
      accounts.keep(key, added.id, typed);
    } catch (error) {
      setRefused(serverMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <li className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-gray-900">
          <ProviderTile type={need.card} role="source" size={28} />
        </span>
        {signed && (
          <span className="text-sm text-gray-700">
            {t('start.connect.byLinkFor', { account: signed.username || name })}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {t('start.connect.asks', {
          types: list(need.types.map((d) => t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale))),
        })}
      </p>
      <p className="mt-1 text-sm text-gray-700">{t('start.connect.byLink', { person: accounts.personName })}</p>
      {saved.length > 0 && (
        <fieldset className="mt-3">
          <legend className="sr-only">{t('start.connect.which', { provider: name })}</legend>
          <div className="space-y-1">
            {saved.map((c) => (
              <label key={c.id} className="flex min-h-[44px] cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name={`start-${key}`}
                  checked={choice === c.id}
                  onChange={() => accounts.choose(key, c.id)}
                  className="h-4 w-4"
                />
                <span className="text-gray-900">{accountLabel(c)}</span>
              </label>
            ))}
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="radio"
                name={`start-${key}`}
                checked={choice === 'new'}
                onChange={() => accounts.choose(key, 'new')}
                className="h-4 w-4"
              />
              <span className="text-gray-900">{t('start.connect.another')}</span>
            </label>
          </div>
        </fieldset>
      )}
      {choice === 'new' && (
        <div className="mt-3">
          <label htmlFor={addressId} className="block text-sm font-medium text-gray-700">
            {t('start.connect.theirAddress', { provider: providerName(need.card, 'source', locale) })}
          </label>
          <div className="mt-1 flex flex-wrap items-start gap-3">
            <input
              id={addressId}
              type="email"
              autoComplete="off"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="input min-h-[44px] w-full max-w-sm"
            />
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !typed.includes('@')}
                aria-describedby={typed.includes('@') ? undefined : reasonId}
                className="min-h-[44px] px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('start.connect.saveAddress')}
              </button>
              {!typed.includes('@') && (
                <p id={reasonId} className="mt-1 text-sm text-gray-600">
                  {t('start.connect.addressNeeded')}
                </p>
              )}
            </div>
          </div>
          {refused !== null && (
            <p role="alert" className="mt-2 text-sm text-red-800">
              {refused}
            </p>
          )}
        </div>
      )}
      {/* Their account is not connected yet, so its folders cannot be listed: typed or pasted.
          Keyed by the account, as on the row above. */}
      {signed !== undefined && folder !== undefined && (
        <FolderToStartFrom
          key={signed.connectionId}
          card={need.card}
          signed={signed}
          value={folder}
          onChange={onFolder}
        />
      )}
    </li>
  );
};

/**
 * THE FOLDER A MIGRATION'S FILES START FROM (0153 open question 5, item 4),
 * once its account is chosen: typed, or its address pasted (`folderValue`
 * reads the id or path out of it), or picked from the drives and folders
 * shared with the account where those can be listed. The wizard's *Browse…*,
 * reading the stored sign-in rather than a typed one; a folder in the
 * account's own Drive is pasted, as it was there. An account whose sign-in
 * does not work yet, or has none, offers no list.
 */
const FolderToStartFrom: React.FC<{
  card: string;
  signed: Signed;
  value: string;
  onChange: (value: string) => void;
}> = ({ card, signed, value, onChange }) => {
  const { t } = useLocale();
  const inputId = React.useId();
  const hintId = React.useId();
  const [listing, setListing] = React.useState<FolderListing | 'loading' | undefined>(undefined);
  const byPath = folderKeyOf(card) === 'rootPath';
  const hint: StringKey =
    card === 'box'
      ? 'start.connect.folder.box.hint'
      : byPath
        ? 'start.connect.folder.dropbox.hint'
        : 'start.connect.folder.google.hint';
  const chosen = folderValue(card, value);
  const browse = () => {
    setListing('loading');
    connectionsApi.folders(signed.connectionId).then(setListing, (error: unknown) =>
      setListing({ ok: false, reason: serverMessage(error) }),
    );
  };
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-900">
        {t(byPath ? 'start.connect.folder.path' : 'start.connect.folder.id')}
      </label>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hintId}
        className="input mt-1 min-h-[44px] w-full max-w-md"
      />
      <p id={hintId} className="mt-1 text-sm text-gray-600">
        {t(hint)}
      </p>
      {signed.ready && foldersListable(card) && (
        <button
          type="button"
          onClick={browse}
          disabled={listing === 'loading'}
          className="mt-2 min-h-[44px] px-4 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          {t(card === 'dropbox' ? 'start.connect.folder.browse.dropbox' : 'start.connect.folder.browse.google')}
        </button>
      )}
      {listing === 'loading' && <p className="mt-2 text-sm text-gray-500">{t('common.loading')}</p>}
      {listing !== undefined && listing !== 'loading' && !listing.ok && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          <span className="font-medium">{t('start.connect.folder.refused')}</span> {listing.reason}
        </p>
      )}
      {listing !== undefined && listing !== 'loading' && listing.ok && (
        <>
          {listing.folders.length === 0 ? (
            <p className="mt-2 text-sm text-gray-700">{t('start.connect.folder.none')}</p>
          ) : (
            <fieldset className="mt-2">
              <legend className="text-sm font-medium text-gray-900">{t('start.connect.folder.found')}</legend>
              <div className="mt-1 space-y-1">
                {listing.folders.map((f) =>
                  f.value === undefined ? (
                    <p key={`unchosen:${f.name}`} className="text-sm text-gray-600">
                      {f.name}: {t('start.connect.folder.notAdded')}
                    </p>
                  ) : (
                    <label key={f.value} className="flex min-h-[44px] cursor-pointer items-center gap-3">
                      <input
                        type="radio"
                        name={`${inputId}-found`}
                        checked={chosen === f.value}
                        onChange={() => onChange(f.value!)}
                        className="h-4 w-4"
                      />
                      <span className="text-gray-900">
                        {f.name}
                        {/* A space, not a margin: a screen reader reads the name and its tag apart. */}
                        {(f.kind === 'shared-drive' || f.owner) && (
                          <>
                            {' '}
                            <span className="text-sm text-gray-600">
                              {f.kind === 'shared-drive'
                                ? t('start.connect.folder.drive')
                                : t('start.connect.folder.from', { owner: f.owner! })}
                            </span>
                          </>
                        )}
                      </span>
                    </label>
                  ),
                )}
              </div>
            </fieldset>
          )}
          {listing.refused !== undefined && (
            <p className="mt-2 text-sm text-amber-800">
              <span className="font-medium">{t('start.connect.folder.refused')}</span> {listing.refused}
            </p>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Screen 5: where each data type goes. A saved account that takes it is
 * suggested; otherwise a new one, whose form shows only what a person must
 * type (T7 (b), (c)). A card chosen for one data type that cannot take
 * another is blamed by name under it (T7 (e)): *Soverin does not take files*.
 */
export const ToStep: React.FC<{
  types: ReadonlyArray<DiscoveryDomain>;
  accounts: Accounts;
  destinationOf: (type: DiscoveryDomain) => string;
  onDestination: (type: DiscoveryDomain, choice: string) => void;
  onAddedFor: (card: WizardTargetType, connectionId: string) => void;
  /** Where an export is read from, on a row of its own (0153 open question 5, item 2). */
  exportRow?: { readonly choice: string; readonly onChoice: (choice: string) => void } | undefined;
  /** Where each migration's copies land, once its accounts are chosen (0153 open question 5, item 4). */
  lands?: LandsProps;
  /**
   * Take a data type out of what moves, where a saved account's last test
   * found it does not take it; absent where nothing else would move.
   */
  onLeaveOut?: ((type: DiscoveryDomain) => void) | undefined;
}> = ({ types, accounts, destinationOf, onDestination, onAddedFor, exportRow, lands, onLeaveOut }) => {
  const { t, locale } = useLocale();
  const accountLabel = useAccountLabel();
  if (accounts.loading) return <p className="text-sm text-gray-500">{t('common.loading')}</p>;
  const word = (d: DiscoveryDomain) => t(DOMAIN_STRING_KEY[d]).toLocaleLowerCase(locale);
  const chosenCards = [
    ...new Set(
      types.flatMap((type) => {
        const card = cardOfDestination(destinationOf(type), accounts);
        return card === undefined ? [] : [card];
      }),
    ),
  ];
  const pending = [
    ...new Set(
      [...types.map(destinationOf), ...(exportRow ? [exportRow.choice] : [])].flatMap((choice) =>
        choice.startsWith('new:') ? [choice.slice(4) as WizardTargetType] : [],
      ),
    ),
  ];
  const photos = t('start.what.photos');
  const savedForExport = savedExportTargets(accounts.saved);
  return (
    <div className="space-y-6">
      {accounts.failed && (
        <p role="alert" className="text-sm text-red-800">
          {t('start.accountsFailed')}
        </p>
      )}
      <ul className="space-y-3">
        {types.map((type) => {
          const saved = savedTargets(accounts.saved, type);
          const blamed = chosenCards.filter((card) => !TARGET_TYPE_DOMAINS[card].includes(type));
          // A saved account whose last test found it does not take this type:
          // marked in the list, never suggested, and said under the row with
          // its own evidence (the owner, 2026-10-04: "4. C, without D").
          const refusing = saved.flatMap((c) => {
            const cannot = measuredCannotTake(c, type);
            return cannot === undefined ? [] : [{ account: c, detail: cannot.detail }];
          });
          return (
            <li key={type}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-32 shrink-0 text-gray-900">
                  <DataTypeLabel domain={type} />
                </span>
                <span aria-hidden="true" className="text-gray-500">
                  →
                </span>
                <select
                  aria-label={t('start.to.row', { type: word(type) })}
                  value={destinationOf(type)}
                  onChange={(e) => onDestination(type, e.target.value)}
                  className="input min-h-[44px] flex-1"
                >
                  {saved.length > 0 && (
                    <optgroup label={t('start.to.yours')}>
                      {saved.map((c) => {
                        const cannot = refusing.some((r) => r.account.id === c.id);
                        return (
                          <option key={c.id} value={c.id} disabled={cannot}>
                            {cannot
                              ? t('start.to.cannotTake.option', { account: accountLabel(c), type: word(type) })
                              : accountLabel(c)}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                  <optgroup label={t('start.to.new')}>
                    {destinationsFor(type).map((card) => (
                      <option key={card} value={`new:${card}`}>
                        {t('start.to.add', { provider: providerDisplayName(card, locale) })}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              {blamed.map((card) => (
                <p key={card} className="mt-1 text-sm text-gray-600 sm:ml-36">
                  {t('start.to.doesNotTake', { provider: providerDisplayName(card, locale), type: word(type) })}
                </p>
              ))}
              {refusing.length > 0 && (
                <div className="mt-1 space-y-1 text-sm sm:ml-36" data-cannot-take={type}>
                  {refusing.map(({ account, detail }) => (
                    <div key={account.id}>
                      <p className={destinationOf(type) === account.id ? 'text-red-800' : 'text-gray-600'}>
                        {t('start.to.cannotTake', { account: accountLabel(account), type: word(type) })}
                      </p>
                      <details>
                        <summary className="cursor-pointer text-blue-700">{t('start.to.cannotTake.why')}</summary>
                        {detail !== '' && <p className="mt-1 text-gray-700">{detail}</p>}
                        <p className="mt-1 text-gray-600">{t('start.to.cannotTake.retest')}</p>
                      </details>
                    </div>
                  ))}
                  {onLeaveOut && (
                    <button
                      type="button"
                      onClick={() => onLeaveOut(type)}
                      className="min-h-[44px] px-3 py-1.5 border border-gray-300 rounded-lg text-gray-800 hover:bg-gray-50"
                    >
                      {t('start.to.leaveOut', { type: word(type) })}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {exportRow && (
          // AN EXPORT'S ROW (0153 open question 5, item 2): read from a folder
          // of these files and written beside it, so only destinations whose
          // files serve byte ranges are offered (0148 D11).
          <li data-export-row="">
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-32 shrink-0 text-gray-900">
                <span className="inline-flex items-center gap-2">
                  <DataTypeIcon name="photos" size={20} className="shrink-0" />
                  <span>{photos}</span>
                </span>
              </span>
              <span aria-hidden="true" className="text-gray-500">
                →
              </span>
              <select
                aria-label={t('start.to.row', { type: photos.toLocaleLowerCase(locale) })}
                value={exportRow.choice}
                onChange={(e) => exportRow.onChoice(e.target.value)}
                className="input min-h-[44px] flex-1"
              >
                {savedForExport.length > 0 && (
                  <optgroup label={t('start.to.yours')}>
                    {savedForExport.map((c) => (
                      <option key={c.id} value={c.id}>
                        {accountLabel(c)}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={t('start.to.new')}>
                  {exportDestinations().map((card) => (
                    <option key={card} value={`new:${card}`}>
                      {t('start.to.add', { provider: providerDisplayName(card, locale) })}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <p className="mt-1 text-sm text-gray-600 sm:ml-36">{t('start.to.exportFolder', { folder: TAKEOUT_FOLDER })}</p>
          </li>
        )}
      </ul>
      {pending.map((card) => (
        <NewDestination key={card} card={card} accounts={accounts} onAdded={(id) => onAddedFor(card, id)} />
      ))}
      {lands && lands.planned.length > 0 && <WhereTheCopiesLand {...lands} />}
    </div>
  );
};

/** What *Where the copies land* reads and writes, from the flow's own state. */
interface LandsProps {
  readonly planned: ReadonlyArray<PlannedMigration>;
  readonly titles: Readonly<Record<string, string>>;
  readonly prefixOf: (m: PlannedMigration) => string;
  readonly shared: (m: PlannedMigration) => boolean;
  readonly onPrefix: (m: PlannedMigration, folder: string) => void;
}

/**
 * WHERE THE COPIES LAND (0153 open question 5, item 4; the owner, 2026-10-04:
 * *"go with the recommendations"*). One fold per migration, *Put it in a
 * folder of its own*: closed and empty, so the copies merge into the
 * destination's own folders as before, except where another migration sends
 * the same data types to the same place. There it is open and filled in with
 * the account each comes from, and says why. It is also the way past the
 * refusal of a second migration between the same two accounts, whose remedy,
 * *a different target folder*, no screen offered.
 */
const WhereTheCopiesLand: React.FC<LandsProps> = ({ planned, titles, prefixOf, shared, onPrefix }) => {
  const { t } = useLocale();
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold text-gray-900">
        {t('start.to.lands')}
      </h3>
      <ul className="mt-2 space-y-3">
        {planned.map((m) => {
          const key = pairKey(m);
          const folder = prefixOf(m);
          const inputId = `lands-${key}`;
          return (
            <li key={key} data-lands={key} className="rounded-lg border border-gray-200 p-3">
              <p className="text-sm text-gray-900">{titles[key] ?? ''}</p>
              {shared(m) && <p className="mt-1 text-sm text-gray-600">{t('start.to.ownFolder.shared')}</p>}
              <details open={shared(m) || folder !== ''} className="mt-1">
                <summary className="cursor-pointer text-sm text-blue-700">{t('start.to.ownFolder')}</summary>
                <div className="mt-2 flex flex-col gap-1">
                  <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
                    {t('start.to.ownFolder.label')}
                  </label>
                  <input
                    id={inputId}
                    className="input min-h-[44px] max-w-md"
                    value={folder}
                    onChange={(e) => onPrefix(m, e.target.value)}
                  />
                  <p className="text-sm text-gray-600">{t('start.to.ownFolder.hint')}</p>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

const NewDestination: React.FC<{
  card: WizardTargetType;
  accounts: Accounts;
  onAdded: (connectionId: string) => void;
}> = ({ card, accounts, onAdded }) => {
  const { t, locale } = useLocale();
  const key = `target:${card}`;
  const initial = formDefaultsFor('target', card);
  const name = providerDisplayName(card, locale);
  return (
    <section className="rounded-lg border border-gray-200 p-4">
      <h3 className="font-medium text-gray-900">
        <ProviderTile type={card} role="target" size={28} name={t('start.to.add', { provider: name })} />
      </h3>
      <AccountForm
        key={`${key}:${accounts.formKey(key)}`}
        role="target"
        type={card}
        variant="flow"
        values={accounts.values(key, initial)}
        onValues={accounts.onValues(key, initial)}
        displayName={`${accounts.personName} · ${name}`}
        onDisplayName={() => undefined}
        onAdded={(added) => {
          accounts.onAdded(key, added, accounts.values(key, initial));
          if (added.ok) onAdded(added.id);
        }}
      />
      {accounts.failedCheck(key) !== undefined && (
        <button
          type="button"
          onClick={() => accounts.tryAgain(key)}
          className="mt-3 min-h-[44px] px-5 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
        >
          {t('start.connect.tryAgain')}
        </button>
      )}
    </section>
  );
};

/**
 * Screen 6: one screen, and it is the green light (T4, 0013, 0037). Each
 * migration's count with the tick for files a format would refuse, the scope
 * manifest's rows true of these sources, and one *Start*, which waits for
 * every count and every tick. Nothing copies before it; after it, the
 * person's page (T5).
 *
 * **Start when granted** (ADR-0035's amendment; the owner, 2026-10-03:
 * *"After preflight the start needs to be given at least once, the grant may
 * arrive later"*, per person). A migration that waits for its person's link
 * is not waited for once another one's count is in: *Start* starts the
 * counted ones, and the waiting one starts by itself when they connect, since
 * their move is then running (`start-when-granted.ts`). With nothing counted
 * yet, *Start* waits, as before.
 */
export const CheckStep: React.FC<{
  planned: ReadonlyArray<PlannedMigration>;
  made: Made;
  titles: Readonly<Record<string, string>>;
  onStarted: () => void;
  /** Whose accounts they are, for the words that wait on them. */
  personName?: string;
  /** A migration whose account its person connects by a link, and has not yet. */
  awaitsGrant?: (m: PlannedMigration) => boolean;
}> = ({ planned, made, titles, onStarted, personName = '', awaitsGrant = () => false }) => {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const waitsId = React.useId();
  const [ready, setReady] = React.useState<Readonly<Record<string, boolean>>>({});
  const onReady = React.useCallback(
    (id: string, now: boolean) => setReady((prev) => (prev[id] === now ? prev : { ...prev, [id]: now })),
    [],
  );
  // What each migration's count measured, for the data ceiling (0109 T6).
  const [measured, setMeasured] = React.useState<Readonly<Record<string, number>>>({});
  const onMeasured = React.useCallback(
    (id: string, bytes: number) => setMeasured((prev) => (prev[id] === bytes ? prev : { ...prev, [id]: bytes })),
    [],
  );
  const [starting, setStarting] = React.useState(false);
  const [started, setStarted] = React.useState<ReadonlySet<string>>(new Set());
  const [startFailed, setStartFailed] = React.useState<Readonly<Record<string, string>>>({});
  // Whether the question at Start stands (0109 T6, the path axis): the plain
  // Start gives way to its two ways on, since the server would refuse it.
  const [askingPaths, setAskingPaths] = React.useState(false);

  const made_ = planned.flatMap((m) => {
    const one = made.migrations[pairKey(m)];
    const archive = m.sourceCard === EXPORT_CARD ? exportOf(m.provider)?.archive : undefined;
    return one?.id === undefined
      ? []
      : [
          {
            key: pairKey(m),
            id: one.id,
            notAdded: one.notAdded,
            byLink: awaitsGrant(m),
            archive,
            destination: providerName(m.targetCard, 'target', locale),
          },
        ];
  });
  const anyByLink = made_.some((m) => m.byLink) && made.personId !== undefined;
  // Whether the person's one link was used: every account on it connected
  // (ADR-0035, amended 2026-09-29). Until then each migration it serves waits.
  const [granted, setGranted] = React.useState(false);
  const waits = (m: (typeof made_)[number]) => m.byLink && anyByLink && !granted;
  // What Start starts: every migration not waiting for the link. It may go once
  // there is one, and each has its count and its tick; the waiting ones start
  // by themselves when the person connects.
  // An export's migration is not counted here and not started by Start: its
  // export is not there yet, and a start follows a count (the owner,
  // 2026-10-03). It is started on its own page once the export is in place.
  const counted = made_.filter((m) => !waits(m) && m.archive === undefined);
  const allReady = counted.length > 0 && counted.every((m) => ready[m.id] === true);
  /** Only exports were set up: nothing to start here, so the screen ends with *Done*. */
  const onlyExports = made_.length > 0 && made_.every((m) => m.archive !== undefined);

  // The manifest's rows true of every source here, and of no other (0153 T1 (a)).
  const manifest = useQuery({ queryKey: ['scope-manifest'], queryFn: () => scopeManifestApi.get() });
  const families = [
    ...new Set(planned.flatMap((m): ScopeFamily[] => {
      const family = scopeFamilyOf(m.sourceCard);
      return family === undefined ? [] : [family];
    })),
  ];
  const scoped = manifest.data && scopeManifestFor(manifest.data, families);

  /**
   * Start each migration not yet started, or only those named (what fits now,
   * at the question about the paths); a refusal is said beside its own count,
   * and the rest go on.
   */
  const start = async (only?: ReadonlyArray<string>) => {
    setStarting(true);
    const now = new Set(started);
    const failed: Record<string, string> = {};
    for (const m of counted) {
      if (now.has(m.id) || (only !== undefined && !only.includes(m.id))) continue;
      try {
        await mappingApi.start(m.id);
        now.add(m.id);
        await forgetMappingLifecycle(queryClient, m.id);
      } catch (error) {
        failed[m.id] = serverMessage(error);
      }
    }
    setStarted(now);
    setStartFailed(failed);
    setStarting(false);
    if (Object.keys(failed).length === 0) onStarted();
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-700">{t('start.check.intro')}</p>
      {anyByLink && made.personId !== undefined && (
        <PersonAwaitingGrant personId={made.personId} personName={personName} onGranted={setGranted} />
      )}
      {made_.map((m) => {
        if (m.archive !== undefined) {
          return (
            <ExportWaits
              key={m.id}
              archive={m.archive}
              title={titles[m.key] ?? ''}
              destination={m.destination}
              {...(m.notAdded === undefined ? {} : { notAdded: m.notAdded })}
            />
          );
        }
        const check = (
          <MigrationCheck
            key={m.id}
            mappingId={m.id}
            title={titles[m.key] ?? ''}
            onReady={onReady}
            onMeasured={onMeasured}
            {...(m.notAdded === undefined ? {} : { notAdded: m.notAdded })}
            {...(startFailed[m.id] === undefined ? {} : { failed: startFailed[m.id] })}
          />
        );
        return waits(m) ? (
          <div key={m.id} className="rounded-lg border border-gray-200 p-4">
            <h3 className="text-sm font-medium text-gray-700">{titles[m.key] ?? ''}</h3>
            <p className="mt-1 text-sm text-gray-600">{t('start.check.waitsForLink', { person: personName })}</p>
            {counted.length > 0 && (
              <p className="mt-1 text-sm text-gray-600">{t('start.check.startsWhenGranted', { person: personName })}</p>
            )}
          </div>
        ) : (
          check
        );
      })}
      {scoped && <ScopeManifestPanel manifest={scoped} />}
      {manifest.isError && (
        <p className="text-sm text-red-600" role="alert">
          {t('confirm.manifestError')} {serverMessage(manifest.error)}
        </p>
      )}
      {/* The data ceiling, before the press (0109 T6): what Start starts, added
          to what has moved. A note, never a block. */}
      {allReady && <CeilingAtStartNote bytes={counted.reduce((sum, m) => sum + (measured[m.id] ?? 0), 0)} />}
      {/* More at the same time than the tier runs (0109 T6, the path axis):
          move up and start everything, or start what fits now, side by side. */}
      {allReady && (
        <PathsAtStartNote
          mappingIds={counted.filter((m) => !started.has(m.id)).map((m) => m.id)}
          disabled={starting}
          onAsking={setAskingPaths}
          onStart={(only) => void start(only)}
        />
      )}
      <div className="flex flex-col items-end">
        {onlyExports ? (
          <button
            type="button"
            onClick={onStarted}
            className="min-h-[44px] px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700"
          >
            {t('start.check.done')}
          </button>
        ) : (
          <>
            {!askingPaths && (
              <button
                type="button"
                onClick={() => void start()}
                disabled={starting || !allReady}
                aria-describedby={allReady ? undefined : waitsId}
                className="min-h-[44px] px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {starting ? t('confirm.starting') : t('start.check.start')}
              </button>
            )}
            {!allReady && (
              <p id={waitsId} className="mt-2 text-sm text-gray-600">
                {t(counted.length === 0 ? 'start.check.waitsForACount' : 'start.check.waits', { person: personName })}
              </p>
            )}
            {!allReady && anyByLink && (
              <p className="mt-1 text-sm text-gray-600">{t('start.check.later', { person: personName })}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/**
 * AN EXPORT'S MIGRATION ON THE CHECK SCREEN (0153 open question 5, item 2):
 * set up, and waiting for its export, with the three things to do: ask for
 * it, put the download in the folder, and start it on its own page, where it
 * is counted first. *Start* leaves it, because there is nothing to count until
 * the export is there.
 */
const ExportWaits: React.FC<{
  archive: ArchiveProvider;
  title: string;
  /** The destination's name, whose files the export goes in. */
  destination: string;
  notAdded?: string;
}> = ({ archive, title, destination, notAdded }) => {
  const { t } = useLocale();
  return (
    <div data-export-waits={archive} className="rounded-lg border border-gray-200 p-4">
      {notAdded !== undefined && (
        <div role="alert" className="mb-3 text-sm text-amber-900">
          <p>
            <span className="font-medium">{t('people.notAdded')}</span> {notAdded}
          </p>
          <p className="mt-1">{t('people.notAdded.where')}</p>
        </div>
      )}
      <h3 className="text-sm font-medium text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-700">{t('start.check.export.waits')}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
        <li>
          {t('start.check.export.ask')}{' '}
          <a
            href={ARCHIVE_PROVIDER_ORIGINS[archive]}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 underline hover:no-underline"
          >
            {ARCHIVE_PROVIDER_NAMES[archive]}
          </a>
        </li>
        <li>{t('start.check.export.put', { folder: TAKEOUT_FOLDER, destination })}</li>
        <li>{t('start.check.export.start')}</li>
      </ol>
      <p className="mt-2 text-sm">
        <Link to="/docs/archive#from-the-flow" className="text-blue-700 hover:underline">
          {t('start.check.export.guide')} →
        </Link>
      </p>
    </div>
  );
};

/**
 * The person's ONE link (ADR-0035, amended 2026-09-29; 0153 T5 (b)): until it
 * is used, which is when every account on it is connected, the link to make
 * and send, and Start waits. Asked for again every ten seconds, so the counts
 * appear once they have connected. It replaces a link per migration: one
 * Google account read by two migrations is signed in to once.
 *
 * Only a link used AFTER this screen first read them counts. A person chosen
 * from the list may have used a link before these migrations were theirs, and
 * that link granted none of them; one used since was spent only once every
 * account of theirs was granted, these migrations' included.
 */
const PersonAwaitingGrant: React.FC<{
  personId: string;
  personName: string;
  onGranted: (granted: boolean) => void;
}> = ({ personId, personName, onGranted }) => {
  const { t } = useLocale();
  const links = useQuery({
    queryKey: ['person-links', personId],
    queryFn: () => personLinkApi.list(personId),
    refetchInterval: 10_000,
    retry: false,
  });
  const usedBefore = React.useRef<ReadonlySet<string> | null>(null);
  if (links.data !== undefined && usedBefore.current === null) {
    usedBefore.current = new Set(links.data.filter((l) => l.state === 'used').map((l) => l.id));
  }
  const granted =
    links.data?.some((l) => l.purpose === 'grant' && l.state === 'used' && !usedBefore.current?.has(l.id)) ?? false;
  React.useEffect(() => onGranted(granted), [granted, onGranted]);
  if (granted) return null;
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-sm text-gray-900">{t('start.check.waitsFor', { person: personName })}</p>
      <PersonGrantLinkSection personId={personId} links={links.data} loadFailed={links.isError} />
    </div>
  );
};

/** One migration's part of the green light: its count, and whether Start may go. */
const MigrationCheck: React.FC<{
  mappingId: string;
  title: string;
  notAdded?: string;
  failed?: string;
  onReady: (mappingId: string, ready: boolean) => void;
  onMeasured?: (mappingId: string, bytes: number) => void;
}> = ({ mappingId, title, notAdded, failed, onReady, onMeasured }) => {
  const { t } = useLocale();
  const count = useMigrationCount(mappingId);
  const [acked, setAcked] = React.useState(false);
  const ready = !count.stillCounting && (!needsAcknowledgement(count.domains) || acked);
  React.useEffect(() => onReady(mappingId, ready), [mappingId, ready, onReady]);
  const bytes = measuredBytes(count.domains);
  React.useEffect(() => onMeasured?.(mappingId, bytes), [mappingId, bytes, onMeasured]);
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      {notAdded !== undefined && (
        <div role="alert" className="mb-3 text-sm text-amber-900">
          <p>
            <span className="font-medium">{t('people.notAdded')}</span> {notAdded}
          </p>
          <p className="mt-1">{t('people.notAdded.where')}</p>
        </div>
      )}
      <MigrationCountSection
        count={count}
        acked={acked}
        onAcked={setAcked}
        heading={title}
        ackId={`start-ack-${mappingId}`}
      />
      {count.countUnfinished && (
        <p className="mt-2 text-sm text-amber-700" role="note">
          {t('confirm.countUnfinished')}
        </p>
      )}
      {failed !== undefined && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {t('confirm.startError')} {failed}
        </p>
      )}
    </div>
  );
};

export default StartMigration;
