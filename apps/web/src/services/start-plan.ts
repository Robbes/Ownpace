// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT *START A MIGRATION* DECIDES, AS RULES (workplan 0153 T4; drawn in
 * `docs/design/0152-0154/wf-start-a-migration.svg`).
 *
 * The flow asks a person four things before it creates anything: who it is
 * for, which accounts they are leaving, what moves, and where each thing goes.
 * This module turns the answers into what the server is asked for:
 *
 * - **what a provider can give on this deployment** (`offers`), so *What
 *   moves?* never offers a type the provider cannot give, and says which ones
 *   it cannot in a line of their own (T7 (e));
 * - **which card carries each type** (`carrierOf`), which is also whose
 *   verdict its *Experimental* tag reads (0131 D6): Google's mail through its
 *   `gmail` card is proven, and through the account it is not yet;
 * - **where a provider's photos come from** (`photosThrough`): an export
 *   archive, never a sign-in, so *What moves?* says how and ticks nothing;
 * - **which accounts to connect for what was ticked** (`connectionsFor`): one
 *   sign-in per provider for exactly the ticked types (T1 (c) by
 *   construction). Where this deployment has not declared Google's restricted
 *   scopes, Google's one consent covers calendar, contacts and tasks, and mail
 *   and files each take a consent of their own, through the `gmail` and
 *   `google-drive` cards (0106 T3b, ADR-0041);
 * - **which destinations can take a type** (`destinationsFor`);
 * - **the migrations that follow** (`migrationsFor`): one per pair of old and
 *   new account, holding the types that travel between them. Each is named
 *   *"{person} — {provider} to {destination}"* in the reader's language
 *   (`start.migrationName`), which is why the name is the screen's to write.
 *
 * Pure, so a test holds every rule, and the screens draw what this returns.
 * Nothing here reads the environment: what a deployment serves arrives from
 * `GET /api/provider-accounts`, as the wizard reads it.
 */
import {
  DISCOVERY_DOMAINS,
  PROVIDER_ACCOUNT_DOMAINS,
  TARGET_TYPE_DOMAINS,
  hasArchiveReader,
  type ArchiveProvider,
  type DiscoveryDomain,
  type WizardTargetType,
} from '@openmig/shared';

/**
 * The accounts a person may be leaving, in the drawing's order (step 2).
 * Each is a card the wizard and the Accounts page already know: an account
 * where the provider has one, and `imap` for *Another mail provider*.
 */
export const START_PROVIDERS = ['google', 'microsoft', 'apple', 'dropbox', 'box', 'imap'] as const;
export type StartProvider = (typeof START_PROVIDERS)[number];

/** The data types in the order a person reads them, the way every screen lists them. */
export const TYPE_ORDER: ReadonlyArray<DiscoveryDomain> = DISCOVERY_DOMAINS;

/**
 * What this deployment says it serves, from `GET /api/provider-accounts`.
 * Absent where the read has not answered: the static tables then speak, which
 * is what an appliance always gets (ADR-0041).
 */
export interface ServedFacts {
  readonly google?: ReadonlyArray<DiscoveryDomain>;
  readonly microsoft?: ReadonlyArray<DiscoveryDomain>;
  /**
   * Whose Google client a consent runs on here (ADR-0041): the deployment's,
   * or each connection's. A grant link through a connection with no client
   * of its own needs the deployment's (`grantableByLink`).
   */
  readonly googleClient?: 'deployment' | 'connection';
}

const inOrder = (types: Iterable<DiscoveryDomain>): DiscoveryDomain[] => {
  const set = new Set(types);
  return TYPE_ORDER.filter((d) => set.has(d));
};

/**
 * The types a provider can give here, and nothing else.
 *
 * Google gives all five whichever way it is asked: its account where the
 * deployment declared the restricted scopes, or the account beside the
 * `gmail` and `google-drive` cards where it has not. How many sign-ins that
 * takes is `connectionsFor`'s business, not the person's choice of what moves.
 */
export function offers(provider: StartProvider, served: ServedFacts = {}): DiscoveryDomain[] {
  switch (provider) {
    case 'google':
      return [...TYPE_ORDER];
    case 'microsoft':
      return inOrder(served.microsoft ?? PROVIDER_ACCOUNT_DOMAINS.microsoft);
    case 'apple':
      // No file: Apple offers no way into iCloud Drive (0115).
      return inOrder(PROVIDER_ACCOUNT_DOMAINS.apple);
    case 'dropbox':
    case 'box':
      return ['file'];
    case 'imap':
      return ['email'];
  }
}

/** The types a provider cannot give, for *What moves?*'s fold (T7 (e)). */
export function cannotGive(provider: StartProvider, served: ServedFacts = {}): DiscoveryDomain[] {
  const given = new Set(offers(provider, served));
  return TYPE_ORDER.filter((d) => !given.has(d));
}

/**
 * The card that carries a type from a provider: its account, except Google's
 * mail and files where this deployment has not declared the restricted
 * scopes, which the `gmail` and `google-drive` cards carry (0106 T3b).
 */
export function carrierOf(provider: StartProvider, type: DiscoveryDomain, served: ServedFacts = {}): string {
  if (provider !== 'google') return provider;
  if ((served.google ?? PROVIDER_ACCOUNT_DOMAINS.google).includes(type)) return 'google';
  return type === 'email' ? 'gmail' : 'google-drive';
}

/**
 * The export a provider's photos come through, where this build can read it
 * (`hasArchiveReader`): Google's Takeout today. Apple's export waits on its
 * reader (0148 T3), so Apple has none yet, and a provider with no photos of
 * its own has none at all.
 */
export function photosThrough(provider: StartProvider): ArchiveProvider | undefined {
  const archive: Partial<Record<StartProvider, ArchiveProvider>> = {
    google: 'google-takeout',
    apple: 'apple-privacy',
  };
  const through = archive[provider];
  return through !== undefined && hasArchiveReader(through) ? through : undefined;
}

/**
 * Whether the person a migration is for can connect this card themselves, by
 * a grant link (0108), so the one who starts it never holds their password.
 *
 * Only Google's cards have links, and only through the deployment's own
 * client, since an account saved for somebody else holds none. Through it,
 * mail and files are asked for only where the deployment declared Google's
 * restricted scopes (`GOOGLE_ACCOUNT_SCOPE_CLASS=restricted`); the link's own
 * readiness check refuses them otherwise, so they are not offered.
 */
export function grantableByLink(card: string, served: ServedFacts = {}): boolean {
  if (served.googleClient !== 'deployment') return false;
  const account = served.google ?? PROVIDER_ACCOUNT_DOMAINS.google;
  switch (card) {
    case 'google':
    case 'google-calendar':
    case 'google-contacts':
      return true;
    case 'gmail':
      return account.includes('email');
    case 'google-drive':
      return account.includes('file');
    default:
      return false;
  }
}

/** One account to connect: the card it is added with, and the types it is asked for. */
export interface ConnectionNeed {
  readonly provider: StartProvider;
  /** The card's id, as `credentialFieldsFor` and the create route know it. */
  readonly card: string;
  readonly types: ReadonlyArray<DiscoveryDomain>;
}

/**
 * The sign-ins a provider's ticked types need, in the order they are asked:
 * one per card that carries them (`carrierOf`), so one per provider except
 * Google's mail and files where the restricted scopes are not declared. The
 * provider's own account comes first, and a card of its own after it. A
 * provider with nothing ticked needs nothing.
 */
export function connectionsFor(
  provider: StartProvider,
  ticked: ReadonlyArray<DiscoveryDomain>,
  served: ServedFacts = {},
): ConnectionNeed[] {
  const needs = new Map<string, DiscoveryDomain[]>([[provider, []]]);
  for (const type of inOrder(ticked.filter((d) => offers(provider, served).includes(d)))) {
    const card = carrierOf(provider, type, served);
    needs.set(card, [...(needs.get(card) ?? []), type]);
  }
  return [...needs].filter(([, types]) => types.length > 0).map(([card, types]) => ({ provider, card, types }));
}

/** The destination cards that can take a type, in the cards' own order. */
export function destinationsFor(type: DiscoveryDomain): WizardTargetType[] {
  return (Object.keys(TARGET_TYPE_DOMAINS) as WizardTargetType[]).filter((t) =>
    TARGET_TYPE_DOMAINS[t].includes(type),
  );
}

/** One type's journey: the account it leaves and the account it goes to. */
export interface Route {
  readonly type: DiscoveryDomain;
  readonly provider: StartProvider;
  readonly sourceCard: string;
  readonly sourceConnectionId: string;
  /** Whose data this is at the source: the address a shared connection cannot know. */
  readonly sourceUsername: string;
  readonly targetCard: WizardTargetType;
  readonly targetConnectionId: string;
  readonly targetUsername?: string;
}

/** A migration to create: one pair of accounts and the types between them. */
export interface PlannedMigration {
  readonly provider: StartProvider;
  readonly sourceCard: string;
  readonly sourceConnectionId: string;
  readonly sourceUsername: string;
  readonly targetCard: WizardTargetType;
  readonly targetConnectionId: string;
  readonly targetUsername?: string;
  readonly types: ReadonlyArray<DiscoveryDomain>;
}

/**
 * One migration per pair of old and new account, holding every type that
 * travels between them (0153 T4, *Underneath*). Mail and calendar leaving one
 * Google account for one Soverin account are one migration; files leaving
 * the same account for a Nextcloud are another. They are listed in the order
 * a person reads data types, by the first each carries, so the check screen
 * shows mail before files whichever provider was ticked first.
 */
export function migrationsFor(routes: ReadonlyArray<Route>): PlannedMigration[] {
  const pairs = new Map<string, PlannedMigration & { types: DiscoveryDomain[] }>();
  for (const r of routes) {
    const key = `${r.sourceConnectionId}→${r.targetConnectionId}`;
    const found = pairs.get(key);
    if (found) {
      if (!found.types.includes(r.type)) found.types.push(r.type);
      continue;
    }
    pairs.set(key, {
      provider: r.provider,
      sourceCard: r.sourceCard,
      sourceConnectionId: r.sourceConnectionId,
      sourceUsername: r.sourceUsername,
      targetCard: r.targetCard,
      targetConnectionId: r.targetConnectionId,
      ...(r.targetUsername ? { targetUsername: r.targetUsername } : {}),
      types: [r.type],
    });
  }
  const first = (m: { types: ReadonlyArray<DiscoveryDomain> }) => TYPE_ORDER.indexOf(m.types[0]!);
  return [...pairs.values()].map((m) => ({ ...m, types: inOrder(m.types) })).sort((a, b) => first(a) - first(b));
}

/**
 * A Nextcloud's DAV root, from the address a person opens it at (T7 (c)):
 * `cloud.example.eu` is `https://cloud.example.eu/remote.php/dav`. A scheme
 * typed stays as typed, a path it is installed under stays (`/nextcloud`),
 * and what a browser's address bar adds after it (`/apps/files`,
 * `/index.php/…`, the DAV root itself) goes. Checked by the same probe as
 * anything typed, so a server whose root is elsewhere fails with its field
 * named, never silently.
 */
export function nextcloudDavUrl(address: string): string {
  let url = address.trim();
  if (url === '') return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\/remote\.php\/dav(\/.*)?$/i, '')
    .replace(/\/(index\.php|apps)(\/.*)?$/i, '')
    .replace(/\/+$/, '');
  return `${url}/remote.php/dav`;
}

/** The address a DAV root was derived from, for a box drawn again: the inverse of `nextcloudDavUrl`. */
export function nextcloudAddress(davUrl: string): string {
  return davUrl
    .trim()
    .replace(/\/remote\.php\/dav\/?$/i, '')
    .replace(/^https:\/\//i, '');
}
