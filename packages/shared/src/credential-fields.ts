// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * WHAT A PERSON TYPES to connect one provider (workplan 0063).
 *
 * Until now this knowledge lived only as hand-written JSX inside
 * `CreateMapping.tsx`: which fields a Box source needs, that Dropbox calls its
 * client id an "App key", which values are secret. That was fine while the
 * wizard was the only door — and it stopped being fine the moment a second
 * one was wanted (add a connection from the Connections page, rotate an
 * expired credential, reuse a connection instead of re-typing it). Three
 * features, each needing the same list, and copying it into each would put
 * Box's "App key" in four places that must agree.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is describe the STORED shapes. The
 * config JSONB and the encrypted credential record are built by
 * `sourceConnectionConfig` / `sourceCredentialRecord` in the create route, and
 * they stay the single authority for that — this file only says what to ask a
 * person for, and the caller feeds the answers through those same builders. A
 * descriptor that produced stored shapes itself would be a second source of
 * truth for the thing that actually has to match what the connectors read.
 *
 * LABELS ARE THE WIZARD'S OWN i18n KEYS, reused rather than restated, so a
 * field renamed for one door is renamed for all of them — and so this file
 * adds no new translations to drift.
 */

export interface CredentialField {
  /**
   * The name this value has in the create route's `sourceConfig` /
   * `targetConfig` body — which is what the shape builders read.
   */
  readonly key: string;
  /** i18n key for the label, in the PROVIDER's vocabulary, not ours. */
  readonly labelKey: string;
  /** Rendered masked, and never echoed back by any API. */
  readonly secret?: boolean;
  readonly required?: boolean;
  /** A pasted key file rather than a one-line value. */
  readonly multiline?: boolean;
  /**
   * The value is a NUMBER (workplan 0072). The create schema coerces and then
   * refuses a non-number, and the Connections form rendered every field as a
   * bare text box — so a port typed as anything else came back as
   * `port: Invalid input: expected number, received NaN`, a zod path and a zod
   * sentence, in English, naming a storage key. The wizard's own port input
   * has always been `type="number"`; this is how the other doors learn it
   * without restating which field it is.
   */
  readonly numeric?: boolean;
  readonly placeholderKey?: string;
}

/** Fields for one wizard source type, in the order a person meets them. */
const SOURCE_FIELDS: Readonly<Record<string, ReadonlyArray<CredentialField>>> = {
  box: [
    { key: 'username', labelKey: 'wizard.sourceUsername', required: true },
    { key: 'clientId', labelKey: 'wizard.clientId', required: true },
    { key: 'clientSecret', labelKey: 'wizard.sourceClientSecret', required: true, secret: true },
    { key: 'userId', labelKey: 'wizard.boxUserId', required: true },
    { key: 'rootFolderId', labelKey: 'wizard.boxRootFolderId' },
  ],
  dropbox: [
    { key: 'username', labelKey: 'wizard.sourceUsername', required: true },
    { key: 'clientId', labelKey: 'wizard.dropboxAppKey', required: true },
    { key: 'clientSecret', labelKey: 'wizard.sourceClientSecret', required: true, secret: true },
    { key: 'refreshToken', labelKey: 'wizard.refreshToken', required: true, secret: true },
    { key: 'rootPath', labelKey: 'wizard.dropboxRootPath' },
  ],
  'google-drive': [
    { key: 'username', labelKey: 'wizard.sourceUsername', required: true },
    { key: 'clientId', labelKey: 'wizard.clientId' },
    { key: 'clientSecret', labelKey: 'wizard.sourceClientSecret', secret: true },
    { key: 'refreshToken', labelKey: 'wizard.refreshToken', secret: true },
    {
      key: 'serviceAccountKey',
      labelKey: 'wizard.serviceAccountKey',
      secret: true,
      multiline: true,
      placeholderKey: 'wizard.serviceAccountKey.placeholder',
    },
    { key: 'rootFolderId', labelKey: 'wizard.rootFolderId' },
  ],
  gmail: googleFields(),
  'google-calendar': googleFields(),
  'google-contacts': googleFields(),
  graph: [
    { key: 'username', labelKey: 'wizard.sourceUsername', required: true },
    { key: 'tenantId', labelKey: 'wizard.tenantId', required: true },
    { key: 'clientId', labelKey: 'wizard.clientId', required: true },
    { key: 'clientSecret', labelKey: 'wizard.sourceClientSecret', required: true, secret: true },
  ],
  oauth2: [
    { key: 'username', labelKey: 'wizard.sourceUsername', required: true },
    { key: 'tenantId', labelKey: 'wizard.tenantId', required: true },
    { key: 'clientId', labelKey: 'wizard.clientId', required: true },
    { key: 'clientSecret', labelKey: 'wizard.sourceClientSecret', required: true, secret: true },
  ],
  imap: [
    { key: 'host', labelKey: 'wizard.host', required: true },
    { key: 'port', labelKey: 'wizard.port', required: true, numeric: true },
    { key: 'username', labelKey: 'wizard.sourceUsername', required: true },
    { key: 'password', labelKey: 'wizard.sourcePassword', required: true, secret: true },
  ],
};

/**
 * The four Google source types share one OAuth client and differ only in the
 * scope the token was consented with — the same reason they share a setup
 * profile in `provider-setup.ts`. Drive alone adds a root folder.
 */
function googleFields(): ReadonlyArray<CredentialField> {
  return [
    { key: 'username', labelKey: 'wizard.sourceUsername', required: true },
    { key: 'clientId', labelKey: 'wizard.clientId' },
    { key: 'clientSecret', labelKey: 'wizard.sourceClientSecret', secret: true },
    { key: 'refreshToken', labelKey: 'wizard.refreshToken', secret: true },
    {
      key: 'serviceAccountKey',
      labelKey: 'wizard.serviceAccountKey',
      secret: true,
      multiline: true,
      placeholderKey: 'wizard.serviceAccountKey.placeholder',
    },
  ];
}

/** Every target speaks host/port/user/password; only the protocol differs. */
const TARGET_FIELDS: ReadonlyArray<CredentialField> = [
  { key: 'host', labelKey: 'wizard.host', required: true },
  { key: 'port', labelKey: 'wizard.port', required: true, numeric: true },
  { key: 'username', labelKey: 'wizard.targetUsername', required: true },
  { key: 'password', labelKey: 'wizard.targetPassword', required: true, secret: true },
];

const TARGET_TYPES = ['jmap', 'imap', 'caldav', 'carddav', 'webdav'] as const;

/**
 * What to ask for, or `[]` when the type is not one this product connects to.
 * An empty list is a refusal to guess, not a form with no fields — callers
 * check it and say so.
 */
export function credentialFieldsFor(
  role: 'source' | 'target',
  type: string,
): ReadonlyArray<CredentialField> {
  if (role === 'target') {
    return (TARGET_TYPES as ReadonlyArray<string>).includes(type) ? TARGET_FIELDS : [];
  }
  return SOURCE_FIELDS[type] ?? [];
}

/** The wizard types each side offers — what an "add a connection" form can list. */
export function connectableTypes(role: 'source' | 'target'): ReadonlyArray<string> {
  return role === 'target' ? [...TARGET_TYPES] : Object.keys(SOURCE_FIELDS).sort();
}

/** Just the secret ones — what must never be rendered in the clear or echoed back. */
export function secretFieldKeys(role: 'source' | 'target', type: string): ReadonlyArray<string> {
  return credentialFieldsFor(role, type)
    .filter((f) => f.secret)
    .map((f) => f.key);
}

/**
 * `connection.kind` → the wizard type the rest of this file is keyed by
 * (workplan 0065).
 *
 * The two vocabularies differ by an underscore for historical reasons —
 * `connection.kind` predates the wizard, so Drive is `google_drive` there and
 * `google-drive` here — and the gap is silent when you get it wrong: looking a
 * setup profile up by KIND answers `[]`, which renders as "this provider needs
 * nothing set up in advance". That is what the Connections page did for every
 * Google connection until this existed.
 *
 * The server's `sourceKindFor` is the forward direction; this is its inverse,
 * and a test pins them as a round trip.
 */
export function wizardTypeForConnectionKind(kind: string): string {
  switch (kind) {
    case 'google_drive':
      return 'google-drive';
    case 'google_calendar':
      return 'google-calendar';
    case 'google_contacts':
      return 'google-contacts';
    case 'o365':
      // Both `oauth2` and `graph` store as o365; they share a setup profile
      // and a field list, so either answer is correct for those uses.
      return 'graph';
    default:
      return kind;
  }
}

/**
 * What to CALL a provider on screen (workplan 0074).
 *
 * The setup checklist rendered the wizard type itself — `oauth2` — as its
 * heading and in its provider chooser, and the owner asked the right question:
 * *how should a user guess that is for Entra ID?* They should not have to. A
 * type is a key the code agrees on; a name is what the person came in knowing.
 *
 * It lives beside the field descriptor rather than in the web dictionary for
 * the reason the descriptor lives here at all: these are the vocabulary of the
 * PROVIDER, not our copy, so they are identical in every language and must not
 * drift between the doors that show them. `providerDisplayNamesCoverEveryType`
 * pins that a type without a name fails loudly rather than rendering a key.
 *
 * The Microsoft pair is deliberately named for the product an admin buys, with
 * the protocol kept in parentheses: `oauth2` and `graph` differ by transport,
 * and nobody arrives thinking "I need the OAuth2 one".
 */
const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  imap: 'IMAP',
  oauth2: 'Microsoft 365 (OAuth2)',
  graph: 'Microsoft 365 (Microsoft Graph)',
  'google-drive': 'Google Drive',
  gmail: 'Gmail',
  'google-calendar': 'Google Calendar',
  'google-contacts': 'Google Contacts',
  dropbox: 'Dropbox',
  box: 'Box',
  jmap: 'JMAP',
  caldav: 'CalDAV',
  carddav: 'CardDAV',
  webdav: 'WebDAV',
};

/**
 * The provider's name, or the type itself when nothing names it — shown as
 * itself rather than blanked, on the same principle as an unlabelled field
 * key: a gap you can see is a bug report, a gap you cannot is a mystery.
 */
export function providerDisplayName(type: string): string {
  return PROVIDER_DISPLAY_NAMES[type] ?? type;
}

/** Every type this product connects to, for the coverage lock. */
export function typesNeedingDisplayNames(): ReadonlyArray<string> {
  return [...new Set([...connectableTypes('source'), ...connectableTypes('target')])];
}

/** Whether every connectable type has a real name. Used by the lock test. */
export function providerDisplayNamesCoverEveryType(): ReadonlyArray<string> {
  return typesNeedingDisplayNames().filter((t) => !(t in PROVIDER_DISPLAY_NAMES));
}
