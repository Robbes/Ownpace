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
 * `needsAnotherPerson` is not decoration. An administrator authorising a Box
 * app or granting Entra admin consent is the single most common reason a
 * setup stops halfway, and saying so UP FRONT — before someone starts pasting
 * values — is most of the guidance this checklist exists to give.
 */

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

const DROPBOX: ReadonlyArray<SetupStep> = [
  {
    key: 'create_app',
    titleKey: 'setup.dropbox.create_app.title',
    detailKey: 'setup.dropbox.create_app.detail',
    yieldsKey: 'setup.dropbox.create_app.yields',
  },
  {
    key: 'scopes',
    titleKey: 'setup.dropbox.scopes.title',
    detailKey: 'setup.dropbox.scopes.detail',
  },
  {
    key: 'consent',
    titleKey: 'setup.dropbox.consent.title',
    detailKey: 'setup.dropbox.consent.detail',
    needsAnotherPerson: true,
  },
  {
    key: 'exchange_code',
    titleKey: 'setup.dropbox.exchange_code.title',
    detailKey: 'setup.dropbox.exchange_code.detail',
    yieldsKey: 'setup.dropbox.exchange_code.yields',
  },
];

const GOOGLE: ReadonlyArray<SetupStep> = [
  {
    key: 'create_oauth_client',
    titleKey: 'setup.google.create_oauth_client.title',
    detailKey: 'setup.google.create_oauth_client.detail',
    yieldsKey: 'setup.google.create_oauth_client.yields',
  },
  {
    key: 'enable_api',
    titleKey: 'setup.google.enable_api.title',
    detailKey: 'setup.google.enable_api.detail',
  },
  {
    key: 'consent_scope',
    titleKey: 'setup.google.consent_scope.title',
    detailKey: 'setup.google.consent_scope.detail',
    yieldsKey: 'setup.google.consent_scope.yields',
    needsAnotherPerson: true,
  },
];

const GRAPH: ReadonlyArray<SetupStep> = [
  {
    key: 'app_registration',
    titleKey: 'setup.graph.app_registration.title',
    detailKey: 'setup.graph.app_registration.detail',
    yieldsKey: 'setup.graph.app_registration.yields',
  },
  {
    key: 'api_permissions',
    titleKey: 'setup.graph.api_permissions.title',
    detailKey: 'setup.graph.api_permissions.detail',
    needsAnotherPerson: true,
  },
  {
    key: 'client_secret',
    titleKey: 'setup.graph.client_secret.title',
    detailKey: 'setup.graph.client_secret.detail',
    yieldsKey: 'setup.graph.client_secret.yields',
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
  'google-drive': GOOGLE,
  gmail: GOOGLE,
  'google-calendar': GOOGLE,
  'google-contacts': GOOGLE,
  oauth2: GRAPH,
  graph: GRAPH,
  imap: IMAP_BASIC,
};

const TARGET_PROFILE: Readonly<Record<string, ReadonlyArray<SetupStep>>> = {
  webdav: WEBDAV_TARGET,
  jmap: JMAP_TARGET,
  imap: DAV_BASIC_TARGET,
  caldav: DAV_BASIC_TARGET,
  carddav: DAV_BASIC_TARGET,
};

/**
 * The steps for one side of one provider, or `[]` when that combination has
 * no platform-side prerequisites worth tracking.
 *
 * An empty list is a real answer — "nothing to do in the provider" — and the
 * caller shows it as such rather than as a missing checklist.
 */
export function setupStepsFor(side: SetupSide, provider: string): ReadonlyArray<SetupStep> {
  const table = side === 'source' ? SOURCE_PROFILE : TARGET_PROFILE;
  return table[provider] ?? [];
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
