// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What a person must do IN THE PROVIDER before Ownpace can read anything
 * (workplan 0061) — the platform-side prerequisites, as a checklist.
 *
 * WHY THIS EXISTS. Until now the wizard said all of this in one amber
 * paragraph per source type, and the wizard keeps its state in memory: a
 * person who reached the credentials step, discovered that a Box admin has to
 * authorise the app, and came back the next day started from an empty form.
 * The prerequisites are the part of a migration that is NOT in this product's
 * hands — they involve other consoles and often other people — so they are
 * exactly the part that gets interrupted, and the part worth tracking.
 *
 * DEFINITIONS LIVE HERE, STATE LIVES IN THE LEDGER, and that split is
 * deliberate: a step's `key` is its identity in `setup_step` rows, so steps
 * can be added, reworded or reordered in code without a data migration. A key
 * that disappears from this file leaves its rows behind, and the reader simply
 * stops showing them — harmless, and better than a migration every time a
 * provider changes a console label.
 *
 * `ownAppOnly` names the provider whose OWN application a step is about
 * (workplan 0148 T2 (b), owner decision D2). A deployment that carries that
 * provider's application has no such step for its customers — the wizard's
 * button signs in through the service's app — so `setupStepsFor` leaves it out
 * when the facts it is handed say `deployment`. The managed route hands it
 * `providerClientFacts()`, the same fact the wizard reads over
 * `/api/provider-clients`; the appliance's route hands it nothing and keeps
 * every step, because an appliance carries whatever its operator configured
 * and its operator reads this list too. Nothing here reads the edition's name.
 *
 * `needsAnotherPerson` is not decoration. An administrator authorising a Box
 * app or granting Entra admin consent is the single most common reason a
 * setup stops halfway, and saying so UP FRONT — before someone starts pasting
 * values — is most of the guidance this checklist exists to give.
 */

import type { GrantProvider, ProviderClientFacts } from './provider-clients.ts';

export type SetupSide = 'source' | 'target';

export interface SetupStep {
  /**
   * Stable identity, stored in the ledger. Rename it and you orphan every
   * tick a customer has already made, so don't — add a new key instead.
   */
  readonly key: string;
  /** One line: what this step IS. */
  readonly titleKey: string;
  /** What to actually do, in the provider's own console vocabulary. */
  readonly detailKey: string;
  /** The value this step produces, when it produces one you later paste in. */
  readonly yieldsKey?: string;
  /** Needs an administrator (or the account owner) who may not be you. */
  readonly needsAnotherPerson?: boolean;
  /**
   * Only for somebody using their OWN app with this provider: left out where
   * the deployment carries the provider's application (see the header).
   */
  readonly ownAppOnly?: GrantProvider;
}

/**
 * One profile per distinct SETUP FLOW, not per wizard type: the four Google
 * source types share one OAuth client and differ only in which scope the
 * token is consented with, so they share a profile whose scope step says so.
 */
const BOX: ReadonlyArray<SetupStep> = [
  {
    key: 'create_app',
    titleKey: 'setup.box.create_app.title',
    detailKey: 'setup.box.create_app.detail',
    yieldsKey: 'setup.box.create_app.yields',
  },
  {
    key: 'configure_access',
    titleKey: 'setup.box.configure_access.title',
    detailKey: 'setup.box.configure_access.detail',
  },
  {
    key: 'admin_authorize',
    titleKey: 'setup.box.admin_authorize.title',
    detailKey: 'setup.box.admin_authorize.detail',
    needsAnotherPerson: true,
  },
  {
    key: 'subject_user_id',
    titleKey: 'setup.box.subject_user_id.title',
    detailKey: 'setup.box.subject_user_id.detail',
    yieldsKey: 'setup.box.subject_user_id.yields',
    needsAnotherPerson: true,
  },
];

/**
 * Dropbox with one's own app. *Connect with Dropbox* (2026-09-02) does the
 * owner's consent and the code exchange where the deployment serves it, and
 * needs the address shown under the button registered on the app; that is
 * `redirect_uri` (0148 T2 (b)). The appliance serves no such button and gets
 * the same list (its route passes no facts), so `consent` and `exchange_code`
 * stay: they are how its operator gets the refresh token, and the consent is
 * somebody else's. Each step's words are true with or without the button.
 * Where the deployment carries Dropbox's app, all five are left out.
 */
const DROPBOX: ReadonlyArray<SetupStep> = [
  {
    key: 'create_app',
    titleKey: 'setup.dropbox.create_app.title',
    detailKey: 'setup.dropbox.create_app.detail',
    yieldsKey: 'setup.dropbox.create_app.yields',
    ownAppOnly: 'dropbox',
  },
  {
    key: 'scopes',
    titleKey: 'setup.dropbox.scopes.title',
    detailKey: 'setup.dropbox.scopes.detail',
    ownAppOnly: 'dropbox',
  },
  {
    key: 'redirect_uri',
    titleKey: 'setup.dropbox.redirect_uri.title',
    detailKey: 'setup.dropbox.redirect_uri.detail',
    ownAppOnly: 'dropbox',
  },
  {
    key: 'consent',
    titleKey: 'setup.dropbox.consent.title',
    detailKey: 'setup.dropbox.consent.detail',
    needsAnotherPerson: true,
    ownAppOnly: 'dropbox',
  },
  {
    key: 'exchange_code',
    titleKey: 'setup.dropbox.exchange_code.title',
    detailKey: 'setup.dropbox.exchange_code.detail',
    yieldsKey: 'setup.dropbox.exchange_code.yields',
    ownAppOnly: 'dropbox',
  },
];

const GOOGLE: ReadonlyArray<SetupStep> = [
  {
    key: 'create_oauth_client',
    titleKey: 'setup.google.create_oauth_client.title',
    detailKey: 'setup.google.create_oauth_client.detail',
    yieldsKey: 'setup.google.create_oauth_client.yields',
    ownAppOnly: 'google',
  },
  {
    key: 'enable_api',
    titleKey: 'setup.google.enable_api.title',
    detailKey: 'setup.google.enable_api.detail',
    ownAppOnly: 'google',
  },
  {
    key: 'consent_scope',
    titleKey: 'setup.google.consent_scope.title',
    detailKey: 'setup.google.consent_scope.detail',
    yieldsKey: 'setup.google.consent_scope.yields',
    needsAnotherPerson: true,
    ownAppOnly: 'google',
  },
];

/**
 * The two Microsoft cards that take an administrator's registration, *Via the
 * Graph API* (`graph`) and *Via IMAP* (`oauth2`). They shared one profile until
 * 0148 T5 (a), whose permission step said to add Microsoft Graph permissions
 * "for mail, calendar, contacts or files". Both cards read one mailbox's mail,
 * and the IMAP card's token carries only what is given on Office 365 Exchange
 * Online, so the Graph permission did nothing for it. Each card now has the
 * recipe of its own section of the Microsoft guide (`{#application-graph}`,
 * `{#application-imap}`), after the registration and its secret, which the
 * two share and the guide writes once (`{#application}`).
 *
 * No step here is `ownAppOnly`: these cards always take a registration of the
 * customer's own, whatever the deployment carries (the guide's words).
 */
const ENTRA_REGISTRATION: SetupStep = {
  key: 'app_registration',
  titleKey: 'setup.graph.app_registration.title',
  detailKey: 'setup.graph.app_registration.detail',
  yieldsKey: 'setup.graph.app_registration.yields',
};

const ENTRA_SECRET: SetupStep = {
  key: 'client_secret',
  titleKey: 'setup.graph.client_secret.title',
  detailKey: 'setup.graph.client_secret.detail',
  yieldsKey: 'setup.graph.client_secret.yields',
};

const GRAPH: ReadonlyArray<SetupStep> = [
  ENTRA_REGISTRATION,
  ENTRA_SECRET,
  {
    // The key stays: it was this card's permission step, and it still is.
    key: 'api_permissions',
    titleKey: 'setup.graph.api_permissions.title',
    detailKey: 'setup.graph.api_permissions.detail',
    needsAnotherPerson: true,
  },
];

/**
 * *Via IMAP*: the Exchange Online permission, the application registered in
 * Exchange Online, and the mailbox given to it. New keys rather than the old
 * `api_permissions`: a tick given against the Graph text is not a tick for the
 * Exchange permission, so the old rows are left behind (see the header).
 */
const IMAP_APPLICATION: ReadonlyArray<SetupStep> = [
  ENTRA_REGISTRATION,
  ENTRA_SECRET,
  {
    key: 'exchange_permission',
    titleKey: 'setup.exchange.permission.title',
    detailKey: 'setup.exchange.permission.detail',
    needsAnotherPerson: true,
  },
  {
    key: 'service_principal',
    titleKey: 'setup.exchange.service_principal.title',
    detailKey: 'setup.exchange.service_principal.detail',
    needsAnotherPerson: true,
  },
  {
    key: 'mailbox_permission',
    titleKey: 'setup.exchange.mailbox_permission.title',
    detailKey: 'setup.exchange.mailbox_permission.detail',
    needsAnotherPerson: true,
  },
];

/**
 * The Apple account (0148 T5 (a)). One thing comes first, and it is at Apple:
 * the app-specific password, because Apple refuses the account's own password
 * over IMAP, CalDAV and CardDAV. The words are `wizard.appleAppPassword.why`'s
 * and the Apple guide's `{#app-password}`.
 */
const APPLE: ReadonlyArray<SetupStep> = [
  {
    key: 'app_password',
    titleKey: 'setup.apple.app_password.title',
    detailKey: 'setup.apple.app_password.detail',
    yieldsKey: 'setup.apple.app_password.yields',
  },
];

const IMAP_BASIC: ReadonlyArray<SetupStep> = [
  {
    key: 'server_address',
    titleKey: 'setup.imap.server_address.title',
    detailKey: 'setup.imap.server_address.detail',
    yieldsKey: 'setup.imap.server_address.yields',
  },
  {
    key: 'app_password',
    titleKey: 'setup.imap.app_password.title',
    detailKey: 'setup.imap.app_password.detail',
    yieldsKey: 'setup.imap.app_password.yields',
  },
];

const WEBDAV_TARGET: ReadonlyArray<SetupStep> = [
  {
    key: 'account_exists',
    titleKey: 'setup.webdav.account_exists.title',
    detailKey: 'setup.webdav.account_exists.detail',
    needsAnotherPerson: true,
  },
  {
    key: 'app_password',
    titleKey: 'setup.webdav.app_password.title',
    detailKey: 'setup.webdav.app_password.detail',
    yieldsKey: 'setup.webdav.app_password.yields',
  },
  {
    key: 'base_url',
    titleKey: 'setup.webdav.base_url.title',
    detailKey: 'setup.webdav.base_url.detail',
    yieldsKey: 'setup.webdav.base_url.yields',
  },
];

/**
 * The Nextcloud card (0148 T5 (a)): the account, an app password, and the
 * address with `/remote.php/dav`, which is the card's one address box. Not
 * `WEBDAV_TARGET`, whose last step asks for a host, a port and a path that
 * this card has no boxes for. The words are the Nextcloud guide's.
 */
const NEXTCLOUD_TARGET: ReadonlyArray<SetupStep> = [
  {
    key: 'account_exists',
    titleKey: 'setup.nextcloud.account_exists.title',
    detailKey: 'setup.nextcloud.account_exists.detail',
    needsAnotherPerson: true,
  },
  {
    key: 'app_password',
    titleKey: 'setup.nextcloud.app_password.title',
    detailKey: 'setup.nextcloud.app_password.detail',
    yieldsKey: 'setup.nextcloud.app_password.yields',
  },
  {
    key: 'dav_url',
    titleKey: 'setup.nextcloud.dav_url.title',
    detailKey: 'setup.nextcloud.dav_url.detail',
    yieldsKey: 'setup.nextcloud.dav_url.yields',
  },
];

/**
 * The Soverin card (0148 T5 (a)): the account, its password (or an app
 * password, if Soverin offers one), and, only where mail moves, the mail
 * server the wizard pre-fills from the provider directory. A connection saved
 * without it carries no mail (the Soverin guide). Its first step is not marked
 * as somebody else's: a Soverin account is one its holder signs up for.
 */
const SOVERIN_TARGET: ReadonlyArray<SetupStep> = [
  {
    key: 'account_exists',
    titleKey: 'setup.soverin.account_exists.title',
    detailKey: 'setup.soverin.account_exists.detail',
  },
  {
    key: 'password',
    titleKey: 'setup.soverin.password.title',
    detailKey: 'setup.soverin.password.detail',
    yieldsKey: 'setup.soverin.password.yields',
  },
  {
    key: 'mail_server',
    titleKey: 'setup.soverin.mail_server.title',
    detailKey: 'setup.soverin.mail_server.detail',
  },
];

const JMAP_TARGET: ReadonlyArray<SetupStep> = [
  {
    key: 'account_exists',
    titleKey: 'setup.jmap.account_exists.title',
    detailKey: 'setup.jmap.account_exists.detail',
    needsAnotherPerson: true,
  },
  {
    key: 'api_token',
    titleKey: 'setup.jmap.api_token.title',
    detailKey: 'setup.jmap.api_token.detail',
    yieldsKey: 'setup.jmap.api_token.yields',
  },
];

const DAV_BASIC_TARGET: ReadonlyArray<SetupStep> = [
  {
    key: 'account_exists',
    titleKey: 'setup.davbasic.account_exists.title',
    detailKey: 'setup.davbasic.account_exists.detail',
    needsAnotherPerson: true,
  },
  {
    key: 'app_password',
    titleKey: 'setup.davbasic.app_password.title',
    detailKey: 'setup.davbasic.app_password.detail',
    yieldsKey: 'setup.davbasic.app_password.yields',
  },
];

/** Wizard type → setup profile. Several types legitimately share one flow. */
const SOURCE_PROFILE: Readonly<Record<string, ReadonlyArray<SetupStep>>> = {
  box: BOX,
  dropbox: DROPBOX,
  // The Google ACCOUNT card signs in with the same client as the four
  // products (0148 T2 (b)); it had no profile, so its checklist said there
  // was nothing to prepare on a deployment without Google's app.
  google: GOOGLE,
  'google-drive': GOOGLE,
  gmail: GOOGLE,
  'google-calendar': GOOGLE,
  'google-contacts': GOOGLE,
  // Each Microsoft registration card its own recipe (0148 T5 (a)).
  oauth2: IMAP_APPLICATION,
  graph: GRAPH,
  apple: APPLE,
  imap: IMAP_BASIC,
};

const TARGET_PROFILE: Readonly<Record<string, ReadonlyArray<SetupStep>>> = {
  webdav: WEBDAV_TARGET,
  jmap: JMAP_TARGET,
  imap: DAV_BASIC_TARGET,
  caldav: DAV_BASIC_TARGET,
  carddav: DAV_BASIC_TARGET,
  nextcloud: NEXTCLOUD_TARGET,
  soverin: SOVERIN_TARGET,
};

/**
 * The steps for one side of one provider, or `[]` when that combination has
 * no platform-side prerequisites worth tracking.
 *
 * An empty list is a real answer — "nothing to do in the provider" — and the
 * caller shows it as such rather than as a missing checklist.
 *
 * `facts`, when given, are `providerClientFacts()`: a step whose provider the
 * deployment carries is left out (0148 T2 (b)). Without them every step is
 * returned — the appliance's answer, and the list as it has always been.
 */
export function setupStepsFor(
  side: SetupSide,
  provider: string,
  facts?: ProviderClientFacts,
): ReadonlyArray<SetupStep> {
  const table = side === 'source' ? SOURCE_PROFILE : TARGET_PROFILE;
  const steps = table[provider] ?? [];
  if (!facts) return steps;
  return steps.filter((s) => s.ownAppOnly === undefined || facts[s.ownAppOnly] !== 'deployment');
}

/** Every provider with a checklist, for the side given — what the UI can offer. */
export function providersWithSetup(side: SetupSide): ReadonlyArray<string> {
  return Object.keys(side === 'source' ? SOURCE_PROFILE : TARGET_PROFILE).sort();
}

export type SetupStepState = 'open' | 'done' | 'skipped';

/** One step plus what the owner has said about it. */
export interface SetupStepStatus {
  readonly step: SetupStep;
  readonly state: SetupStepState;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
}

/**
 * Where a setup has got to. `blockedOnOthers` counts the OPEN steps that need
 * somebody else — the number that answers "why is this stuck?", which a bare
 * "3 of 7 done" never does.
 */
export interface SetupProgress {
  readonly total: number;
  readonly done: number;
  readonly skipped: number;
  readonly open: number;
  readonly blockedOnOthers: number;
  readonly complete: boolean;
}

export function summariseSetup(statuses: ReadonlyArray<SetupStepStatus>): SetupProgress {
  const done = statuses.filter((s) => s.state === 'done').length;
  const skipped = statuses.filter((s) => s.state === 'skipped').length;
  const open = statuses.filter((s) => s.state === 'open');
  return {
    total: statuses.length,
    done,
    skipped,
    open: open.length,
    blockedOnOthers: open.filter((s) => s.step.needsAnotherPerson).length,
    // A skipped step counts as settled: the owner decided it does not apply.
    // Deliberately NOT "done === total", which would leave a checklist whose
    // every row is answered reading as unfinished forever.
    complete: open.length === 0 && statuses.length > 0,
  };
}
