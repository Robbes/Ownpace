// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * One account, several faces (workplan 0106 T3b — the owner's decision of
 * 2026-08-27).
 *
 * ## Provider-shaped, not Google-shaped, on purpose
 *
 * The obvious version of this task is "let a Google connection serve more than
 * one domain". The owner asked for the general one, and gave the reason:
 *
 *   *"one can tick 'google' and pick the object types to ask a grant for…
 *   since we will have this more often — Soverin will add Nextcloud for files
 *   later this year."*
 *
 * So this is a TABLE. A provider gaining a face is a row edit here, reviewed in
 * a diff, with no new branch anywhere. `soverin` gaining `file` when its
 * Nextcloud arrives is one word in one array; a `switch (kind)` fork would
 * have been a second implementation and the #597 defect all over again.
 *
 * ## What a row means, and what it does NOT mean
 *
 * A row says: **this provider serves these faces from ONE account row.** It is
 * a ceiling, not a promise. What a particular account can actually carry is
 * read off its measured qualification record (0106 T0/T1a) — the static table
 * says what is possible for the provider, the record says what is true for the
 * account, and only a measured `no` constrains anything (0106 T3a). Unmeasured
 * is never a wall.
 *
 * ## Why `google` starts with three faces
 *
 * Not a technical limit — Google's own pricing of its scopes. Calendar and
 * carddav are *sensitive* (brand verification, free), and so is Tasks'
 * `tasks.readonly` (workplan 0126); Gmail's
 * `https://mail.google.com/` and `drive.readonly` are *restricted*, needing an
 * annual third-party security assessment (`docs/google-oauth-verification.md`).
 * One consent inviting all four would push the MANAGED client into the
 * restricted tier for every customer, including one who only wanted contacts.
 *
 * That constraint is the managed client's alone: an appliance registers its own
 * OAuth client and does its own verification (ADR-0041). Which is why this is a
 * table of what the PRODUCT offers rather than of what the protocol allows —
 * and why the single-domain kinds cohabit rather than being replaced.
 */

import { soverinRecordOf } from './soverin-record.ts';
import type { DiscoveryDomain } from './discovery.ts';
import { googleDeploymentClient, type GoogleClientEnv } from './google-deployment-client.ts';
import {
  microsoftDeploymentClient,
  type MicrosoftClientEnv,
} from './microsoft-deployment-client.ts';
import { cirruxDeploymentClient, type CirruxClientEnv } from './cirrux-drive.ts';

/**
 * Connection kinds that hold ONE account and can serve several of its faces.
 *
 * Deliberately not "every kind": `imap` is a protocol, not an account, and a
 * person who typed an IMAP host has not told us anything about what else that
 * server does. These are the kinds where one credential provably reaches more
 * than one domain.
 */
export const PROVIDER_ACCOUNT_KINDS = ['google', 'soverin', 'microsoft', 'apple', 'cirrux', 'infomaniak'] as const;
export type ProviderAccountKind = (typeof PROVIDER_ACCOUNT_KINDS)[number];

/**
 * The account kinds whose MAIL face is a second server the account STORES
 * (`mailHost`, `mailPort`), beside the DAV host its other faces share
 * (workplan 0106 T4b for Soverin, 0160 T1 for Cirrux, 0161 T1 for Infomaniak).
 *
 * One table rather than a `kind === 'soverin'` at each seam, because three
 * seams ask the same question and must give the same answer: the create door
 * (which demands the field when email is ticked), the mail seam that builds
 * the writer, and the qualification that measures the face. Written out for
 * one provider, the second provider is the one a seam forgets, and a
 * forgotten seam does not fail at its own door: it fails at the first pass,
 * as a missing writer.
 *
 * Not `apple`: its mail server is the same for every account and is
 * PUBLISHED (`PROVIDER_ENDPOINTS`), so its door asks for no host at all.
 */
export const MAIL_SERVER_ACCOUNT_KINDS = ['soverin', 'cirrux', 'infomaniak'] as const;

/** Does this kind keep its mail server in `mailHost`, apart from its DAV host? */
export function storesItsMailServer(kind: string): boolean {
  return (MAIL_SERVER_ACCOUNT_KINDS as ReadonlyArray<string>).includes(kind);
}

/**
 * The account kinds whose MAIL face signs in with a LOGIN OF ITS OWN, beside
 * the one their DAV faces sign in with (workplan 0161 T1).
 *
 * Soverin and Cirrux sign in to mail and to DAV with one username and one
 * password. Infomaniak cannot be reached that way. Its calendars and contacts
 * belong to the Infomaniak ACCOUNT and sign in with a short sync username
 * (`AB12345`) and an app password, or the account's own password without
 * two-step validation (https://www.infomaniak.com/fr/support/faq/1544). An
 * app password "ne permettra pas de synchroniser une adresse mail"
 * (https://www.infomaniak.com/fr/support/faq/2855). Mail signs in with the
 * full address and a password made for that address on its Devices tab
 * (https://www.infomaniak.com/fr/support/faq/1321), which has "pas de rapport
 * avec votre mot de passe de connexion à Infomaniak"
 * (https://www.infomaniak.com/fr/support/faq/2427). All four read 2026-11-19.
 *
 * So the one encrypted secret of such a kind holds two logins:
 * `username`/`password`, the sync login its calendar, contact and task faces
 * use; and `mailUsername`/`mailPassword`, the mailbox's own, which its mail
 * face uses and nothing else does. A table, for `MAIL_SERVER_ACCOUNT_KINDS`'s
 * reason: the doors that store a secret, the mail seam that builds the
 * writer, the qualification that measures the face and the probe all ask
 * this question, and a seam that reads `username`/`password` for mail by hand
 * does not fail at its own door. It signs in to mail with the sync login,
 * which the mail server refuses, at the first pass.
 */
export const MAIL_LOGIN_APART_KINDS = ['infomaniak'] as const;

/** Does this kind's mail face sign in with a login of its own (`mailUsername`, `mailPassword`)? */
export function signsInToMailApart(kind: string): boolean {
  return (MAIL_LOGIN_APART_KINDS as ReadonlyArray<string>).includes(kind);
}

/** One username and its password, as a mail face signs in with them. */
export interface MailLogin {
  readonly username: string;
  readonly password: string;
}

/** The two keys of a mailbox's own login, as a kind apart stores them in its secret. */
export const MAIL_LOGIN_KEYS = ['mailUsername', 'mailPassword'] as const;
export type MailLoginKey = (typeof MAIL_LOGIN_KEYS)[number];

/**
 * A credential record, a door's typed values or a create body's config: read
 * key by key, and only a string counts as a value (a port is a number there).
 */
export type CredentialValues = Readonly<Record<string, unknown>>;

/** A stored or typed value, or `''` for an absent one. Never trimmed: a password is what was typed. */
function valueOf(record: CredentialValues, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

/** Was this value given at all? A value of only spaces was not: no server takes it. */
function given(record: CredentialValues, key: string): boolean {
  return valueOf(record, key).trim() !== '';
}

/**
 * THE LOGIN A KIND'S MAIL FACE SIGNS IN WITH, from its credential record.
 *
 * For a kind that signs in to mail apart, the mailbox's own pair,
 * `mailUsername`/`mailPassword`: never the sync login, which its mail server
 * refuses. An absent half is `''`, and the seams refuse it by name
 * (`missingMailLogin`) before they connect.
 *
 * For every other kind, the record's own `username`/`password`, exactly as
 * every seam read them before 0161. A seam that falls back to a token where no
 * password is stored (`access_token` for an IMAP writer; `token` and `api_key`
 * for JMAP) still does, because it lays this pair over the record rather than
 * replacing it, so the fallback reads what it always read.
 */
export function mailLoginOf(kind: string, credentials: CredentialValues): MailLogin {
  if (signsInToMailApart(kind)) {
    return { username: valueOf(credentials, 'mailUsername'), password: valueOf(credentials, 'mailPassword') };
  }
  return { username: valueOf(credentials, 'username'), password: valueOf(credentials, 'password') };
}

/**
 * The halves of a kind apart's mail login its record lacks, by field name, or
 * `[]` when it has both or the kind signs in to mail with its one login. A
 * value of only spaces is lacking: no mail server takes it.
 */
export function missingMailLogin(
  kind: string,
  credentials: CredentialValues,
): ReadonlyArray<MailLoginKey> {
  if (!signsInToMailApart(kind)) return [];
  return MAIL_LOGIN_KEYS.filter((key) => !given(credentials, key));
}

/**
 * The account kinds whose DAV faces may sign in with a LOGIN OF THEIR OWN,
 * beside the one their mail signs in with (workplan 0175 §5.3).
 *
 * A Soverin mailbox with a Suite licence signs in twice: IMAP with the
 * mailbox password, which stays the same, and Suite's Nextcloud with a Suite
 * app password and a username that "may be different from your email
 * address" (Soverin's help desk, article 116). That is Infomaniak's shape
 * inverted, so its secret keeps `username`/`password` for the mailbox and
 * adds `suiteUsername`/`suitePassword` for Nextcloud.
 *
 * Unlike `MAIL_LOGIN_APART_KINDS`, the second login is PER ACCOUNT, not per
 * kind: a personal Soverin mailbox never holds one. So the question is
 * `davLoginOf(kind, qualification, creds)`, which reads the record the Test
 * kept, and answers the Suite login only when that record says `suite`.
 * Nothing writes `suite` before the maintainer's live test (0175 T0).
 */
export const DAV_LOGIN_APART_KINDS = ['soverin'] as const;

/** May this kind's DAV faces sign in with a login of their own (`suiteUsername`, `suitePassword`)? */
export function signsInToDavApart(kind: string): boolean {
  return (DAV_LOGIN_APART_KINDS as ReadonlyArray<string>).includes(kind);
}

/** The two keys of a Suite login, as a Soverin secret stores them beside the mailbox's. */
export const SUITE_LOGIN_KEYS = ['suiteUsername', 'suitePassword'] as const;
export type SuiteLoginKey = (typeof SUITE_LOGIN_KEYS)[number];

/**
 * THE LOGIN A KIND'S DAV FACES SIGN IN WITH, from its record and its secret.
 *
 * The Suite login for a kind apart whose measured record says `suite`; an
 * absent half is `''`, which a seam refuses by name before it connects. The
 * record's own `username`/`password` for everything else: a personal or
 * unknown Soverin mailbox, a row with no record, and every other kind.
 */
export function davLoginOf(kind: string, qualification: unknown, credentials: CredentialValues): MailLogin {
  if (signsInToDavApart(kind) && soverinRecordOf(qualification)?.kind === 'suite') {
    return { username: valueOf(credentials, 'suiteUsername'), password: valueOf(credentials, 'suitePassword') };
  }
  return { username: valueOf(credentials, 'username'), password: valueOf(credentials, 'password') };
}

/**
 * HALF A MAIL LOGIN, REFUSED AT EVERY DOOR (workplan 0161 T1): the field that
 * was not given when its other half was, or `undefined` when both or neither
 * were. Both are optional, because an account used only for calendars,
 * contacts and tasks needs no mail login; half of one can sign in to nothing,
 * and stored, it would read later as a mail face set up wrong rather than as
 * one never set up.
 */
export function halfMailLogin(
  kind: string,
  values: CredentialValues,
): MailLoginKey | undefined {
  if (!signsInToMailApart(kind)) return undefined;
  const missing = missingMailLogin(kind, values);
  return missing.length === 1 ? missing[0] : undefined;
}

/** The sentence a door refuses half a mail login with, naming the half that is missing. */
export function halfMailLoginRefusal(missing: MailLoginKey): string {
  const sent: MailLoginKey = missing === 'mailUsername' ? 'mailPassword' : 'mailUsername';
  return (
    `A mail login is given whole or not at all: ${sent} was sent without ${missing}. Enter the ` +
    'mailbox address and the password made for that address together, or leave both empty — ' +
    'calendars, contacts and tasks need no mail login.'
  );
}

/**
 * WHAT A DOOR ENCRYPTS FOR A TARGET (workplan 0161 T1): `{ username, password }`
 * as every target has stored since the doors existed, and for a kind that
 * signs in to mail apart, the mailbox's `mailUsername`/`mailPassword` beside
 * them, where they were given. Every door that stores or tests a target secret
 * builds it here; `scripts/a-target-secret-a-door-built-by-hand.unit.test.ts`
 * fails the day one builds the pair by hand again, because a hand-built pair
 * is a mail login dropped on its way to the store.
 *
 * Never trimmed, as a typed password never is. The mail login is never part
 * of a connection's `config`, which is plain JSON a form may read back
 * (`knownConnectionValues`): it lives only in this record, which is encrypted.
 */
export function targetCredentialRecord(
  kind: string,
  values: CredentialValues,
): Record<string, string> {
  const record: Record<string, string> = {
    username: valueOf(values, 'username'),
    password: valueOf(values, 'password'),
  };
  if (signsInToMailApart(kind)) {
    for (const key of MAIL_LOGIN_KEYS) {
      if (given(values, key)) record[key] = valueOf(values, key);
    }
  }
  return record;
}

/**
 * A replacement record for a target, keeping the mail login it already stores
 * when the replacement carries none (workplan 0161 T1).
 *
 * *Replace credentials* replaces the whole secret, so a person renewing the
 * sync login and leaving the two mail boxes empty would otherwise lose the
 * mailbox's login without being told, and the next pass's mail would refuse.
 * Empty means "as it is"; both boxes filled means a new mail login. The
 * mailbox's login is the mailbox's, not the sync account's, so it is kept
 * whichever sync login replaces the old one. Cirrux's Drive grant is carried
 * across a rotation the same way (`keepingTheDriveGrant`).
 */
export function keepingTheMailLogin(
  kind: string,
  stored: CredentialValues,
  replacement: Readonly<Record<string, string>>,
): Record<string, string> {
  if (!signsInToMailApart(kind)) return { ...replacement };
  if (MAIL_LOGIN_KEYS.some((key) => given(replacement, key))) return { ...replacement };
  const kept: Record<string, string> = {};
  for (const key of MAIL_LOGIN_KEYS) {
    if (given(stored, key)) kept[key] = valueOf(stored, key);
  }
  return { ...replacement, ...kept };
}

/**
 * The faces each provider account can serve, TODAY.
 *
 * Ordered as a person would tick them rather than alphabetically, so the
 * wizard and any consent screen list them the same way twice running.
 */
export const PROVIDER_ACCOUNT_DOMAINS: Readonly<
  Record<ProviderAccountKind, ReadonlyArray<DiscoveryDomain>>
> = {
  // Mail and files are absent because of Google's restricted-scope assessment,
  // not because they do not work. This is the DEFAULT — the answer for a
  // deployment that has not declared otherwise, and the only answer the
  // appliance can have, since it has no application of its own at all
  // (ADR-0041). A deployment whose own Google application carries the
  // restricted scopes says so, and `providerAccountDomains` below is what
  // reads that. `gmail`/`google_drive` remain their own kinds either way.
  //
  // 'task' joined on 2026-09-23 (workplan 0126 T2), last so the consent's
  // order and this one agree. Not over CalDAV, which carries no VTODO at
  // Google: over the Tasks API, which `google-tasks-source` reads.
  google: ['calendar', 'contact', 'task'],
  // Soverin's Nextcloud for files is expected later in 2026 (the owner,
  // 2026-08-27). When it lands and has been MEASURED against the live
  // provider, 'file' joins this array — one word, no new branch. Never added
  // on an announcement: 0105's never-guess rule.
  //
  // 'task' joined on 2026-09-03 under that same rule, not around it: the owner
  // has a Tasks list in his own Soverin account, over the CalDAV face this row
  // already claims. A task list IS a calendar collection — one that declares
  // VTODO in its `supported-calendar-component-set` (RFC 4791 §5.2.3) — so
  // this is a face already measured, now named (workplan 0113 T5).
  soverin: ['email', 'calendar', 'contact', 'task'],
  // FOUR, and the asymmetry with Google runs the OTHER way (workplan 0114).
  // Google offers two by default because `https://mail.google.com/` and
  // `drive.readonly` are restricted scopes needing an annual third-party
  // security assessment. Microsoft's delegated equivalents — Mail.Read,
  // Calendars.Read, Contacts.Read, Files.Read over the signed-in user's own
  // data — carry no such tier, so one consent can honestly offer all four
  // without pushing anybody into a review they did not ask for.
  //
  // 'task' joined with 0114 T9, and the asymmetry with Google runs the other
  // way here too: Microsoft HAS a tasks face at `/me/todo/lists` under
  // Tasks.Read, where Google's CalDAV carries no VTODO at any scope tier. A
  // To Do list is not a CalDAV collection, so it took a connector of its own
  // (`graph-todo-source`) rather than the DAV builder the other task faces
  // share; the consent asks for Tasks.Read only when the face is ticked.
  // Google's tasks took the same road later (0126): `google-tasks-source`.
  microsoft: ['email', 'calendar', 'contact', 'file', 'task'],
  // FOUR AGAIN, and a different four (workplan 0115). Apple is the first
  // provider account with NO consent screen behind it: Apple publishes no
  // OAuth scope for Mail, Calendar, Contacts, Reminders or iCloud Drive to
  // anybody outside Apple, so this row is reached with an app-specific
  // password over IMAP, CalDAV and CardDAV. Soverin's shape, not Google's.
  //
  // 'task' is here on the day the kind arrives, which no other provider
  // account managed: Apple Reminders are VTODO components in the same CalDAV
  // account, which is exactly what 0113 taught this product to read. Google
  // Tasks needed its own API (0126) and Microsoft To Do `graph-todo-source`
  // (0114 T9); Apple needs nothing new.
  //
  // 'file' is absent and it is APPLE'S absence, not ours: there is no
  // third-party API — public, partner or paid — that reads a person's iCloud
  // Drive. CloudKit Web Services reaches an application's own container,
  // never the user's Drive. So this is a measured no with a reason rather
  // than a face waiting on work, and no amount of connector would change it.
  apple: ['email', 'calendar', 'contact', 'task'],
  // Soverin's shape again (workplan 0160): one app password per mailbox,
  // over IMAP for mail and over CalDAV and CardDAV for the rest, which
  // https://cirrux.co/help/setup lists under Calendar, Contacts and Reminders
  // with one server, api.cirrux.co (read 2026-11-19). 'task' is here on the
  // day the kind arrives, as Apple's was: every Cirrux mailbox has a task
  // list called Reminders, and Apple Reminders reads it over CalDAV
  // (https://cirrux.co/help/api/tasks), so it is a calendar collection that
  // declares VTODO (0113 T5).
  //
  // 'file' is absent, and the reason is the shape of Cirrux Drive rather
  // than work left undone here: Drive speaks no WebDAV, only its own HTTP
  // API, and that API takes a person's OAuth sign-in through a client Cirrux
  // registers by hand (https://cirrux.co/help/api/drive). A files face is a
  // connector of its own, not a row edit; 0160 T5 plans it.
  cirrux: ['email', 'calendar', 'contact', 'task'],
  // Soverin's four faces with TWO logins (workplan 0161; read 2026-11-19):
  // mail over IMAP at mail.infomaniak.com, signed in with the full address
  // and the password made for it (https://www.infomaniak.com/fr/support/faq/2427),
  // and calendars, contacts and tasks over CalDAV and CardDAV at
  // sync.infomaniak.com, signed in with the account's sync login
  // (https://www.infomaniak.com/fr/support/faq/1544). `MAIL_LOGIN_APART_KINDS`
  // says why the two cannot be one. 'task' is here on the day the kind
  // arrives, with Cirrux's evidence: a task in Infomaniak's Calendar is linked
  // to a calendar (https://www.infomaniak.com/fr/support/faq/984), an imported
  // .ics puts its VTODO there (https://www.infomaniak.com/fr/support/faq/1974),
  // and kSync syncs "contacts, calendriers/agendas et tâches" over CardDAV and
  // CalDAV (https://www.infomaniak.com/fr/support/faq/2302). So a task list is
  // a calendar collection that declares VTODO (0113 T5).
  //
  // 'file' is absent, and it is a measured "later" rather than a no: kDrive
  // has WebDAV, at an address of its own per drive,
  // `https://<kDrive ID>.connect.kdrive.infomaniak.com`, and Infomaniak does
  // not offer it on kSuite Free, kSuite Standard, my kSuite or my kSuite+
  // (https://www.infomaniak.com/fr/support/faq/2409, updated 12/11/2026). A
  // face some plans have and others refuse needs its own address field and its
  // own measurement before this row can claim it; 0161 T3 plans it.
  infomaniak: ['email', 'calendar', 'contact', 'task'],
};

/**
 * The faces a `google` account serves when the deployment's own application
 * carries Google's RESTRICTED scopes as well as its sensitive ones.
 *
 * Not a wish list: `https://mail.google.com/` and `drive.readonly` are
 * restricted, and Google grants them only to an application that registered
 * them and passed the review its publishing status demands.
 *
 * `task` is in BOTH Google lists since 2026-09-23 (workplan 0126 T2). Google's
 * CalDAV still carries no VTODO (0113 T5); the face is the Tasks API, under
 * the sensitive `tasks.readonly`, so a deployment that declares the restricted
 * tier keeps it rather than losing it for having asked for more.
 */
export const GOOGLE_RESTRICTED_ACCOUNT_DOMAINS: ReadonlyArray<DiscoveryDomain> = [
  'email',
  'calendar',
  'contact',
  'file',
  'task',
];

/** What a deployment may declare about the scope class its application holds. */
export const GOOGLE_ACCOUNT_SCOPE_CLASSES = ['sensitive', 'restricted'] as const;
export type GoogleAccountScopeClass = (typeof GOOGLE_ACCOUNT_SCOPE_CLASSES)[number];

export interface ProviderAccountEnv {
  readonly GOOGLE_ACCOUNT_SCOPE_CLASS?: string | undefined;
}

/** Is this kind an account that can wear several faces? */
export function isProviderAccountKind(kind: string): kind is ProviderAccountKind {
  return (PROVIDER_ACCOUNT_KINDS as ReadonlyArray<string>).includes(kind);
}

/**
 * The faces this provider account can serve ON THIS DEPLOYMENT, or an empty
 * list for a kind that is not one. Empty rather than a throw: callers ask
 * about arbitrary kinds, and "this is not a provider account" is an answer,
 * not an error.
 *
 * WHAT AN APPLICATION CARRIES IS A FACT ABOUT A DEPLOYMENT, NOT ABOUT THE
 * PRODUCT (ADR-0041, owner decision 2026-09-01). `PROVIDER_ACCOUNT_DOMAINS`
 * was written when there was one Google client and it reads as a law; it was
 * a law about that client, and it still governs the one Ownpace publishes to
 * strangers. A deployment running its OWN application — registered by its own
 * owner, who accepts the restricted tier's consequences — answers for itself
 * in `GOOGLE_ACCOUNT_SCOPE_CLASS`.
 *
 * DEFAULTS TO THE NARROW ANSWER, and every unrecognised value defaults with
 * it. Unset, mistyped, or never heard of all mean "sensitive only" — the
 * answer that cannot over-ask. The appliance has no application at all, so
 * this never widens it (hard rule 5).
 *
 * A DECLARATION IS NOT A CAPABILITY. Setting it does not make Google grant
 * anything. It changes which consent this product is willing to BUILD, so a
 * deployment that declares `restricted` without having registered the scopes
 * gets a refusal at Google's own screen with the scope string in hand —
 * never a consent silently narrowed to the sensitive faces and a migration
 * that turns out weeks later to have never included mail.
 *
 * AND IN "EXTERNAL + TESTING" IT COSTS ONE MORE THING, which the operator
 * documentation says beside the setting: Google expires refresh tokens after
 * seven days in that publishing status. `google-token-provider.ts`'s
 * `invalid_grant` hint names that cause first, and it is the same fact.
 */
export function providerAccountDomains(
  kind: string,
  env: ProviderAccountEnv = process.env,
): ReadonlyArray<DiscoveryDomain> {
  if (!isProviderAccountKind(kind)) return [];
  if (kind === 'google' && env.GOOGLE_ACCOUNT_SCOPE_CLASS?.trim() === 'restricted') {
    return GOOGLE_RESTRICTED_ACCOUNT_DOMAINS;
  }
  return PROVIDER_ACCOUNT_DOMAINS[kind];
}

/** Where a Google connection's OAuth client comes from on this deployment. */
export type ProviderClientSource = 'deployment' | 'connection';

/**
 * Every deployment-level fact about one provider account kind, in ONE answer.
 *
 * `domains` is the ceiling above. `client` is the second fact the screen could
 * not see (ADR-0041, owner decision 2026-09-01): whether this deployment
 * carries its own Google OAuth client, so a wizard can stop demanding a client
 * id and secret the deployment already has. The server had accepted a consent
 * and a create without the pair since it became configurable; the screen kept
 * refusing to press the button, because nothing had told it.
 *
 * Present for the kinds that HAVE one. Soverin has no OAuth client to speak
 * of, and a `'connection'` there would be a claim about a thing that does not
 * exist. `microsoft` joined `google` in 0114, which is why the answer is a
 * table below rather than a second `if`: two providers is a condition, three
 * is a fan-out, and a fan-out that grows one branch at a time is how a
 * provider ends up silently missing from a screen.
 *
 * `'deployment'` is answered only for a COMPLETE pair — the rule
 * `googleDeploymentClient` already follows. Half a pair is no client, and
 * telling a screen otherwise would have it drop two required fields on the
 * strength of a typo. The values themselves are never part of the answer.
 */
export interface ProviderAccountFacts {
  readonly domains: ReadonlyArray<DiscoveryDomain>;
  readonly client?: ProviderClientSource;
}

/**
 * Which kinds carry a deployment-level OAuth application, and how to ask.
 *
 * A kind absent from this table has no application to speak of — that is the
 * answer, not an omission — so `client` stays undefined for it rather than
 * claiming `'connection'` about a thing that does not exist.
 */
const DEPLOYMENT_CLIENT_PROBES: Readonly<
  Partial<Record<ProviderAccountKind, (env: ProviderAccountEnv & GoogleClientEnv & MicrosoftClientEnv) => boolean>>
> = {
  google: (env) => googleDeploymentClient(env) !== null,
  microsoft: (env) => microsoftDeploymentClient(env) !== null,
};

export function providerAccountFacts(
  kind: string,
  env: ProviderAccountEnv & GoogleClientEnv & MicrosoftClientEnv & CirruxClientEnv = process.env,
): ProviderAccountFacts {
  const domains = providerAccountDomains(kind, env);
  if (!isProviderAccountKind(kind)) return { domains };
  // CIRRUX'S CLIENT IS THE DEPLOYMENT'S OR THERE IS NONE (workplan 0160 T5,
  // ADR-0052). A public client with no secret, registered by Cirrux per
  // redirect URL: no connection can carry one of its own, so `'connection'`
  // would claim a thing that does not exist. `'deployment'` is what lets a
  // screen offer *Connect Cirrux Drive*; absent, it offers no button.
  if (kind === 'cirrux') {
    return cirruxDeploymentClient(env) ? { domains, client: 'deployment' } : { domains };
  }
  const probe = DEPLOYMENT_CLIENT_PROBES[kind];
  if (!probe) return { domains };
  return { domains, client: probe(env) ? 'deployment' : 'connection' };
}

/**
 * Does this provider account serve that face?
 *
 * The question a domain tick asks. It is the CEILING — an account's own
 * measured record still decides what is true for it.
 */
export function providerAccountServes(
  kind: string,
  domain: DiscoveryDomain,
  env: ProviderAccountEnv = process.env,
): boolean {
  return providerAccountDomains(kind, env).includes(domain);
}
