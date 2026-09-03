// Copyright 2026 The Ownpace authors (Apache-2.0)

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
  /**
   * The other half of a pair this value belongs to, by key (ADR-0041).
   *
   * A client id is neither secret nor, since the deployment may carry its own
   * client, required — so the rotation panel, which offers "required or
   * secret", dropped it and offered the secret alone. Rotation REPLACES the
   * stored credential, so a new secret typed there travelled without its id,
   * and the doors now refuse exactly that: half a pair. This flag says the id
   * is presented wherever its secret is, so a rotated pair is a pair.
   */
  readonly pairedWith?: string;
  /**
   * WHOSE consent mints this value (2026-09-02: Connect with Dropbox). On a
   * refresh-token field, the provider whose consent screen fills it — and
   * so which deployment-owned application may stand in for the pair beside
   * it. A screen reads it to know which button to offer; a list of kinds
   * kept in the page would be a second copy of this table.
   */
  readonly consent?: 'google' | 'dropbox' | 'microsoft';
  /** A pasted key file rather than a one-line value. */
  readonly multiline?: boolean;
  /**
   * The example value shown in the empty box, VERBATIM (workplan 0075).
   *
   * Not translated, and that is the point: `…apps.googleusercontent.com` and
   * `contoso.onmicrosoft.com` are shapes the provider itself uses, and a
   * Dutch rendering of them would be a Dutch rendering of somebody else's
   * identifier. Where the example is really a sentence — "paste the whole key
   * file" — it is a `placeholderKey` instead, below.
   */
  readonly placeholder?: string;
  /** A sentence under the field. Ours, so it is a key. */
  readonly hintKey?: string;
  /** What the browser should offer to autofill here. */
  readonly autoComplete?: 'username' | 'new-password' | 'off';
  /**
   * Offers a show/hide toggle. Deliberately NOT every secret: a masked
   * password is worth being able to check after a paste, while a refresh
   * token or a pasted key file is too long to proofread by eye and putting an
   * eye icon beside it only widens the shoulder-surfing window.
   */
  readonly revealable?: boolean;
  /**
   * Survives a REUSED connection (workplan 0075). A connection answers "as
   * whom do we sign in"; it cannot answer "whose files, and from which
   * folder" — that is this mapping's question, and `source_config_override`
   * exists to hold the answer (0066 T4a). Everything without this flag
   * disappears when a stored connection supplies it.
   */
  readonly perMapping?: boolean;
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
const USER = {
  key: 'username',
  labelKey: 'wizard.sourceUsername',
  required: true,
  placeholder: 'user@example.com',
  autoComplete: 'username',
} as const;

const SECRET = {
  key: 'clientSecret',
  labelKey: 'wizard.sourceClientSecret',
  required: true,
  secret: true,
  placeholder: '••••••••',
  autoComplete: 'new-password',
  revealable: true,
} as const;

const REFRESH = {
  key: 'refreshToken',
  labelKey: 'wizard.refreshToken',
  secret: true,
  placeholder: '1//…',
  hintKey: 'wizard.refreshToken.hint',
  autoComplete: 'off',
} as const;

const SERVICE_ACCOUNT_KEY = {
  key: 'serviceAccountKey',
  labelKey: 'wizard.serviceAccountKey',
  secret: true,
  multiline: true,
  placeholderKey: 'wizard.serviceAccountKey.placeholder',
  hintKey: 'wizard.serviceAccountKey.width',
  autoComplete: 'off',
} as const;

/**
 * The four Google source types share one OAuth client and differ only in the
 * scope the token was consented with — the same reason they share a setup
 * profile in `provider-setup.ts`. Drive alone adds a root folder.
 */
function googleFields(): ReadonlyArray<CredentialField> {
  return [
    USER,
    {
      key: 'clientId',
      labelKey: 'wizard.clientId',
      placeholder: '…apps.googleusercontent.com',
      pairedWith: 'clientSecret',
    },
    { ...SECRET, required: false },
    { ...REFRESH, consent: 'google' },
    SERVICE_ACCOUNT_KEY,
  ];
}

/**
 * The `microsoft` ACCOUNT type (workplan 0114) — one Entra grant, four faces.
 *
 * `googleFields()`'s sibling, and deliberately NOT `o365Fields()` below. Those
 * two ask a customer for their own app registration and require every part of
 * it; this one is the grant-button shape, where the deployment may carry the
 * application and the person carries only the consent (ADR-0041).
 *
 * Three differences from Google's, each with a reason:
 *
 *  - **The refresh token is `required`.** Google's four types can also be fed a
 *    service-account key, so its token is optional; there is no service-account
 *    equivalent here. Without the token there is no credential at all.
 *  - **No `serviceAccountKey`.** Graph's application flow is a client secret
 *    with `.default`, which `graph`/`oauth2` already offer. Putting a field
 *    here that this row's builders never read would be offering something that
 *    cannot work — the same rule that keeps the app-password field on `gmail`
 *    alone.
 *  - **`tenantId` is present and OPTIONAL**, which is the whole asymmetry with
 *    `o365Fields()`. A row that took the grant button has no directory of its
 *    own and the deployment's authority answers for it (`common` unless an
 *    operator declared otherwise). A customer using their own single-tenant
 *    registration types theirs here and it wins — sending them to `common`
 *    fails at Entra with a message about the application not being found,
 *    which reads like a typo and is not one (0114 T1).
 */
function microsoftAccountFields(): ReadonlyArray<CredentialField> {
  return [
    USER,
    {
      key: 'clientId',
      labelKey: 'wizard.clientId',
      placeholder: '00000000-0000-0000-0000-000000000000',
      pairedWith: 'clientSecret',
    },
    { ...SECRET, required: false },
    { ...REFRESH, required: true, consent: 'microsoft', placeholder: '0.AXoA…' },
    {
      key: 'tenantId',
      labelKey: 'wizard.tenantId',
      placeholder: 'contoso.onmicrosoft.com',
      hintKey: 'wizard.microsoft.tenantId.hint',
    },
  ];
}

/**
 * oauth2 and graph authenticate with the customer's OWN Entra app
 * registration (0037 T6, ADR-0006's row-14 model), so what they ask for is a
 * registration and a mailbox — never a server address.
 */
function o365Fields(): ReadonlyArray<CredentialField> {
  return [
    USER,
    {
      key: 'tenantId',
      labelKey: 'wizard.tenantId',
      required: true,
      placeholder: 'contoso.onmicrosoft.com',
    },
    {
      key: 'clientId',
      labelKey: 'wizard.clientId',
      required: true,
      placeholder: '00000000-0000-0000-0000-000000000000',
    },
    SECRET,
  ];
}

const SOURCE_FIELDS: Readonly<Record<string, ReadonlyArray<CredentialField>>> = {
  box: [
    USER,
    { key: 'clientId', labelKey: 'wizard.clientId', required: true },
    SECRET,
    // The CCG subject — WHOSE files the token reads. One subject per mapping
    // (ADR-0033), so it outlives a reused connection.
    {
      key: 'userId',
      labelKey: 'wizard.boxUserId',
      required: true,
      placeholderKey: 'wizard.boxUserId.placeholder',
      perMapping: true,
    },
    {
      key: 'rootFolderId',
      labelKey: 'wizard.boxRootFolderId',
      placeholderKey: 'wizard.boxRootFolderId.placeholder',
      perMapping: true,
    },
  ],
  dropbox: [
    USER,
    // Dropbox's App Console calls it an App key, so the field does too. Paired
    // with its secret and no longer required on its own (2026-09-02: Connect
    // with Dropbox): the deployment may carry the app, as it may Google's
    // client, and a screen folds the pair away where it does.
    { key: 'clientId', labelKey: 'wizard.dropboxAppKey', pairedWith: 'clientSecret' },
    { ...SECRET, required: false },
    { ...REFRESH, required: true, consent: 'dropbox' },
    {
      key: 'rootPath',
      labelKey: 'wizard.dropboxRootPath',
      placeholderKey: 'wizard.dropboxRootPath.placeholder',
      perMapping: true,
    },
  ],
  'google-drive': [
    ...googleFields(),
    {
      key: 'rootFolderId',
      labelKey: 'wizard.rootFolderId',
      placeholderKey: 'wizard.rootFolderId.placeholder',
      perMapping: true,
    },
  ],
  /**
   * Gmail alone gains the app-password field (workplan 0089 T7).
   *
   * NOT on the other three, and that is a fact rather than a preference: an app
   * password is an IMAP credential, and Calendar, Contacts and Drive are not
   * reached over IMAP. Offering it there would be offering something that
   * cannot work.
   *
   * **Last in the list, and optional**, so the OAuth fields are what a reader
   * meets first — the ordering carries "never the default" the same way the
   * factory's branch ordering does. Everything a person needs in order to
   * decide against it travels in the hint: Google's own recommendation, the
   * 2-step-verification prerequisite, that it is personal accounts only, and
   * where it is withdrawn.
   */
  gmail: [
    ...googleFields(),
    {
      key: 'appPassword',
      labelKey: 'wizard.gmailAppPassword',
      hintKey: 'wizard.gmailAppPassword.hint',
      secret: true,
      autoComplete: 'off',
      placeholder: 'xxxx xxxx xxxx xxxx',
    },
  ],
  'google-calendar': googleFields(),
  'google-contacts': googleFields(),
  // The ACCOUNT kind (workplan 0106 T3b) — the SAME three fields, because it
  // is the same credential: one OAuth client and one refresh token, consented
  // for however many faces were ticked. What differs is the consent's scope
  // set, which is the authorize route's business and not a field anybody
  // types.
  google: googleFields(),
  // The Microsoft ACCOUNT kind (workplan 0114), cohabiting with `graph` and
  // `oauth2` exactly as `google` cohabits with its four single-purpose types:
  // a customer who registered their own Entra application keeps using it, and
  // a person who just wants their mail presses a button.
  microsoft: microsoftAccountFields(),
  graph: o365Fields(),
  oauth2: o365Fields(),
  imap: [
    { key: 'host', labelKey: 'wizard.host', required: true, placeholder: 'imap.example.com' },
    { key: 'port', labelKey: 'wizard.port', required: true, numeric: true, placeholder: '993' },
    USER,
    {
      key: 'password',
      labelKey: 'wizard.sourcePassword',
      required: true,
      secret: true,
      placeholder: '••••••••',
      autoComplete: 'new-password',
      revealable: true,
    },
  ],
};

/** Every target speaks host/port/user/password; only the protocol differs. */
const TARGET_FIELDS: ReadonlyArray<CredentialField> = [
  { key: 'host', labelKey: 'wizard.host', required: true, placeholder: 'jmap.example.com' },
  { key: 'port', labelKey: 'wizard.port', required: true, numeric: true, placeholder: '443' },
  {
    key: 'username',
    labelKey: 'wizard.targetUsername',
    required: true,
    placeholder: 'user@example.com',
    autoComplete: 'username',
  },
  {
    key: 'password',
    labelKey: 'wizard.targetPassword',
    required: true,
    secret: true,
    placeholder: '••••••••',
    autoComplete: 'new-password',
    revealable: true,
  },
];

const TARGET_TYPES = ['jmap', 'imap', 'caldav', 'carddav', 'webdav', 'soverin'] as const;

/**
 * The DAV targets' escape hatch (0105 T1): a full base URL, for a provider
 * whose DAV root is NOT at the host root and whose `/.well-known` does not
 * lead there. host+port alone can only say `https://host:port/`; a customer
 * target like `https://mail.example.com/dav/` was inexpressible through this
 * door until the field existed. Optional — when present it wins over
 * host+port (`davUrl`'s existing precedence), when absent nothing changes.
 * DAV types only: an IMAP target has no URL, and a JMAP target's baseUrl is
 * derived (the clients append `/.well-known/jmap` themselves).
 */
const TARGET_DAV_URL: CredentialField = {
  key: 'url',
  labelKey: 'wizard.targetDavUrl',
  placeholder: 'https://cloud.example.com/remote.php/dav',
  hintKey: 'wizard.targetDavUrl.hint',
};

// `soverin` is DAV-shaped at the door (0106 T4a): one account, the DAV base
// URL as its escape hatch, exactly like the protocol trio.
const DAV_TARGET_TYPES = ['caldav', 'carddav', 'webdav', 'soverin'] as const;

/**
 * The account kind's MAIL face (0106 T4b): the IMAP host the person's provider
 * names, typed here rather than guessed anywhere — a provider directory may
 * one day PRE-FILL it (T5, parked), but the record stays what was typed and
 * what Test measured. Optional, because an account used only for calendars
 * and contacts needs no mail server; the create door demands it the moment
 * the email domain is ticked, by name.
 */
const SOVERIN_MAIL_FIELDS: ReadonlyArray<CredentialField> = [
  {
    key: 'mailHost',
    labelKey: 'wizard.soverinMailHost',
    placeholder: 'imap.example.com',
    hintKey: 'wizard.soverinMailHost.hint',
  },
  { key: 'mailPort', labelKey: 'wizard.soverinMailPort', numeric: true, placeholder: '993' },
];

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
    if (type === 'soverin') {
      return [...TARGET_FIELDS, TARGET_DAV_URL, ...SOVERIN_MAIL_FIELDS];
    }
    if ((DAV_TARGET_TYPES as ReadonlyArray<string>).includes(type)) {
      return [...TARGET_FIELDS, TARGET_DAV_URL];
    }
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
  // The method in the brackets, not the mechanism (0107 T1): "(OAuth2)" said
  // how it authenticates, not how it connects — the distinction a person
  // picking between the two actually needs.
  oauth2: 'Microsoft 365 (IMAP)',
  microsoft: 'Microsoft 365 account',
  graph: 'Microsoft 365 (Graph API)',
  'google-drive': 'Google Drive',
  gmail: 'Gmail',
  'google-calendar': 'Google Calendar',
  'google-contacts': 'Google Contacts',
  // Just the company: this door is the ACCOUNT, and naming it for one of its
  // products is what the three above already do.
  google: 'Google account',
  dropbox: 'Dropbox',
  box: 'Box',
  jmap: 'JMAP',
  caldav: 'CalDAV',
  carddav: 'CardDAV',
  webdav: 'WebDAV',
  soverin: 'Soverin',
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
