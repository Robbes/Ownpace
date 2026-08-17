// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/** Thrown when a mapping config fails validation; the message carries the offending path. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Import ThrottleConfig from throttling module for type reference
import type { ThrottleConfig } from './throttling';
import type { SpecialUse } from './mail';

export type SourceAuth =
  | { readonly kind: 'xoauth2'; readonly tokenFromEnv: string }
  | { readonly kind: 'login'; readonly passwordFromEnv: string };

/**
 * Implicit TLS on connect, for the IMAP source and the IMAP/DAV target.
 *
 * **Defaults to `true`, and the port is not consulted.** Until 2026-08-09 there
 * was no such field and the decision was `port === 993` — a literal comparison,
 * in four places. Anyone whose IMAPS server listens anywhere else got a
 * CLEARTEXT socket opened against a TLS listener, which is wrong twice over: it
 * fails, and it fails in a way that reads like a network fault rather than a
 * configuration one. Found on a dev Stalwart published on 1993.
 *
 * The default is `true` rather than "guess from the port" because the two
 * mistakes are not symmetric. Defaulting to TLS and being wrong costs a
 * connection error on the first attempt, in front of whoever just wrote the
 * mapping. Defaulting to cleartext and being wrong puts a mailbox password on
 * the wire in the clear. Only one of those is recoverable by reading an error
 * message.
 *
 * So port 143 — cleartext, or STARTTLS negotiated after connect — is now an
 * explicit `"tls": false`, which is the right shape anyway: choosing not to
 * encrypt from the first byte should be something a mapping SAYS, not something
 * a port number implies.
 */
export type ImapTlsSetting = boolean;

/**
 * Verify the IMAP server's TLS certificate. Unset means TRUE.
 *
 * `false` exists for one situation: a dev or lab server with a self-signed
 * certificate. It is a per-mapping, written-down decision — until 2026-08-09
 * the source connector hardcoded verification OFF for everyone, a leftover
 * from a parity harness that had itself been deleted, which meant every
 * production connection would hand its password or OAuth token to whatever
 * answered the socket first. The asymmetry argument is the same as
 * {@link ImapTlsSetting}'s: verification failing wrongly costs a readable
 * error naming this field; verification skipped wrongly costs the mailbox
 * credentials.
 */
export type ImapTlsVerifySetting = boolean;

/** O365 source over IMAP+OAuth2 (slice 0001). */
export interface ImapOAuth2Source {
  readonly type: 'imap-oauth2';
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly auth: SourceAuth;
  /** See {@link ImapTlsSetting}. Unset means `true`. */
  readonly tls?: ImapTlsSetting;
  /** See {@link ImapTlsVerifySetting}. Unset means `true`. */
  readonly tlsVerify?: ImapTlsVerifySetting;
}

export type JmapAuth =
  | { readonly kind: 'basic'; readonly passwordFromEnv: string }
  | { readonly kind: 'bearer'; readonly tokenFromEnv: string };

/** JMAP target (primary family). */
export interface JmapTarget {
  readonly type: 'jmap';
  /**
   * The server ROOT — scheme, host, port. No path.
   *
   * Every JMAP client here builds its session URL as
   * `${baseUrl}/.well-known/jmap` (RFC 8620 §2.2), so a `baseUrl` carrying a
   * path produces `https://host/jmap/.well-known/jmap` and a 404 that reads
   * like the server is wrong rather than the config. `mapping.json.example`
   * shipped exactly that mistake until 2026-08-08.
   *
   *   correct    https://mail.example.net
   *   WRONG      https://mail.example.net/jmap
   */
  readonly baseUrl: string;
  readonly user: string;
  readonly auth: JmapAuth;
}

/** IMAP/DAV target (second family, slice 0002). */
export interface ImapDavTarget {
  readonly type: 'imap-dav';
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly auth: SourceAuth;
  /** See {@link ImapTlsSetting}. Unset means `true`. */
  readonly tls?: ImapTlsSetting;
  /** See {@link ImapTlsVerifySetting}. Unset means `true`. */
  readonly tlsVerify?: ImapTlsVerifySetting;
}

/** CalDAV source for calendar data */
export interface CalDAVSource {
  readonly type: 'caldav';
  readonly url: string;
  readonly user: string;
  readonly auth: SourceAuth;
}

/** CardDAV source for contact data */
export interface CardDAVSource {
  readonly type: 'carddav';
  readonly url: string;
  readonly user: string;
  readonly auth: SourceAuth;
}

/** WebDAV source for file data */
export interface WebDAVSource {
  readonly type: 'webdav';
  readonly url: string;
  readonly user: string;
  readonly auth: SourceAuth;
}

/**
 * What to do with a Google Doc, Sheet or Slide (workplan 0042 T3).
 *
 * Native editor files are not files: they have no bytes, and reaching them means
 * asking Drive to EXPORT a rendering in a format somebody chose. That is lossy —
 * the original is not recoverable from a `.docx` — and, critically, it may not be
 * byte-stable across calls. If it is not, `contentHash` sees a change on every
 * pass and the migration rewrites every document forever.
 *
 * **The owner chooses per migration (0042 T0 Q3), and the default is `refuse`
 * until byte-stability has been measured against a real tenant.** Of the two
 * failure modes available here — "your Docs did not migrate, and here is why"
 * and "your Docs are silently re-copied nightly, and their formatting changed" —
 * only the first is one an owner can act on. Setting an export policy today is
 * choosing an UNMEASURED behaviour; 0042 T6 is where that measurement goes.
 *
 * Defined here rather than beside the connector because it is a product
 * decision that now appears in a mapping file, not part of Google's wire format.
 * `@openmig/connectors` re-exports it as `NativeFilePolicy` so there is exactly
 * one definition of the three values.
 */
export type GoogleNativeFilePolicy = 'refuse' | 'export-office' | 'export-pdf';

/**
 * Google Drive as a file source (workplan 0042).
 *
 * No `auth` block, and that is deliberate rather than an omission: the OAuth2
 * client id, client secret and refresh token are credentials, so they arrive the
 * way every other OAuth source's do — environment variables on the appliance, the
 * encrypted `SecretStore` under the managed edition — and never through a file
 * that lands in a support ticket.
 */
export interface GoogleDriveSource {
  readonly type: 'google-drive';
  /** Drive API base. Overridable for a proxy or a test; unset means Google's. */
  readonly baseUrl?: string;
  /**
   * The folder id the migration is rooted at. Unset means `root` — My Drive.
   *
   * A SHARED DRIVE is named here by its own id, which is how a store owned by no
   * single user becomes an ordinary mapping. What that does NOT do is enumerate
   * shared drives for you (`drives.list`), which stays 0042 T0 scoping work.
   */
  readonly rootFolderId?: string;
  /** See {@link GoogleNativeFilePolicy}. Unset means `refuse`. */
  readonly nativeFilePolicy?: GoogleNativeFilePolicy;
  /**
   * The account whose Drive this is — required only under domain-wide
   * delegation (ADR-0033), where it is the impersonated SUBJECT. The
   * refresh-token flow carries the identity inside the token and ignores it.
   */
  readonly user?: string;
}

/**
 * Gmail as a MAIL source (workplan 0044).
 *
 * One field, because everything else is fixed by Google: the transport is IMAP
 * over XOAUTH2 at `imap.gmail.com:993` (so no host/port to mistype — the same
 * argument the O365 IMAP path records for its fixed endpoint), and the OAuth2
 * client id, secret and refresh token are credentials, so — exactly as
 * {@link GoogleDriveSource} explains — they arrive via environment variables on
 * the appliance or the encrypted `SecretStore` under the managed edition, never
 * through a file. The refresh token must be consented with the
 * `https://mail.google.com/` scope: it is the only scope Google's IMAP endpoint
 * accepts, and a Drive-consented token answers `invalid_scope` at mint time.
 */
export interface GmailSource {
  readonly type: 'gmail';
  /** The Gmail address the migration reads — XOAUTH2 authenticates a token FOR an address. */
  readonly user: string;
}

/**
 * Google Calendar as a calendar source (workplan 0045).
 *
 * One field, like {@link GmailSource} and for the same reasons: the endpoint
 * is fixed by Google (its CalDAV v2 principal for this address), the OAuth
 * client + refresh token are credentials and never appear in a file, and the
 * refresh token must be consented with the
 * `https://www.googleapis.com/auth/calendar` scope — Google's CalDAV endpoint
 * takes OAuth only.
 */
export interface GoogleCalendarSource {
  readonly type: 'google-calendar';
  /** The Google account whose calendars are read. */
  readonly user: string;
}

/**
 * Google Contacts as a contact source (workplan 0045).
 *
 * The CardDAV sibling of {@link GoogleCalendarSource}: fixed endpoint
 * (Google's CardDAV v1 principal), credentials via env/SecretStore, and a
 * refresh token consented with `https://www.googleapis.com/auth/carddav`.
 */
export interface GoogleContactsSource {
  readonly type: 'google-contacts';
  /** The Google account whose contacts are read. */
  readonly user: string;
}

/**
 * Microsoft OneDrive/SharePoint file source (workplan 0054) — the Graph drive
 * connector, wired at last. Same Entra registration and flow rules as the
 * other Graph sources; `mailbox` unset reads the signed-in user's drive
 * (/me, delegated), an address reads /users/{address}/drive under
 * application permissions (see docs/o365-application-access.md — reading
 * another user's OneDrive needs Files.Read.All, the scope workplan 0029
 * deliberately did NOT consent on the reference tenant; a customer grants it
 * to their own registration knowingly or reads /me per user).
 */
export interface GraphDriveFileSource {
  readonly type: 'graph-drive';
  readonly baseUrl?: string;
  readonly tenantId: string;
  /** Whose drive, when not the signed-in user's. See GraphCalendarSource.mailbox. */
  readonly mailbox?: string;
}

/**
 * Dropbox file source (workplan 0055). The credential trio lives beside the
 * config, per edition (env vars on the appliance, stored encrypted on
 * managed) — like every OAuth source here.
 */
export interface DropboxSource {
  readonly type: 'dropbox';
  /** Unset = the whole Dropbox; a path ('/Team') scopes the migration to it. */
  readonly rootPath?: string;
}

/**
 * Box file source (workplan 0056). Client id + secret live beside the config
 * per edition, like every OAuth source here — but there is NO refresh token:
 * Box rotates refresh tokens on every use, so the Client Credentials Grant
 * is used, and the SUBJECT (whose files) is named here on the config.
 */
export interface BoxSource {
  readonly type: 'box';
  /** The NUMERIC Box user id being migrated — one subject per mapping. */
  readonly userId: string;
  /** Unset = '0' (the account root, "All Files"); a folder id scopes to it. */
  readonly rootFolderId?: string;
}

/** Microsoft Graph Calendar source */
export interface GraphCalendarSource {
  readonly type: 'graph-calendar';
  readonly baseUrl?: string;
  readonly tenantId: string;
  /**
   * WHOSE mailbox to read, when it is not the signed-in user's own.
   *
   * Unset (the default, and what every existing mapping does) means `/me`
   * under delegated permissions. An address makes this a `/users/{address}`
   * read, which needs APPLICATION permissions and admin consent on the source
   * tenant — see `docs/o365-application-access.md`. That is how a SHARED
   * mailbox becomes an ordinary mapping (SAD §14.1 Pattern S): a shared store
   * has no interactive user to sign in as.
   *
   * Validated by `graph-scope.ts` before any request is built; a value that is
   * not a usable user principal name is refused with the reason.
   */
  readonly mailbox?: string;
}

/** Microsoft Graph Contacts source */
export interface GraphContactsSource {
  readonly type: 'graph-contacts';
  readonly baseUrl?: string;
  readonly tenantId: string;
  /**
   * WHOSE mailbox to read, when it is not the signed-in user's own.
   *
   * Unset (the default, and what every existing mapping does) means `/me`
   * under delegated permissions. An address makes this a `/users/{address}`
   * read, which needs APPLICATION permissions and admin consent on the source
   * tenant — see `docs/o365-application-access.md`. That is how a SHARED
   * mailbox becomes an ordinary mapping (SAD §14.1 Pattern S): a shared store
   * has no interactive user to sign in as.
   *
   * Validated by `graph-scope.ts` before any request is built; a value that is
   * not a usable user principal name is refused with the reason.
   */
  readonly mailbox?: string;
}

/** Microsoft Graph mail source (workplan 0023 — ADR-0006's IMAP-disabled fallback). */
export interface GraphMailSource {
  readonly type: 'graph-mail';
  readonly baseUrl?: string;
  readonly tenantId: string;
  /**
   * WHOSE mailbox to read, when it is not the signed-in user's own.
   *
   * Unset (the default, and what every existing mapping does) means `/me`
   * under delegated permissions. An address makes this a `/users/{address}`
   * read, which needs APPLICATION permissions and admin consent on the source
   * tenant — see `docs/o365-application-access.md`. That is how a SHARED
   * mailbox becomes an ordinary mapping (SAD §14.1 Pattern S): a shared store
   * has no interactive user to sign in as.
   *
   * Validated by `graph-scope.ts` before any request is built; a value that is
   * not a usable user principal name is refused with the reason.
   */
  readonly mailbox?: string;
}

/** CalDAV target for calendar data */
export interface CalDAVTarget {
  readonly type: 'caldav';
  readonly url: string;
  readonly user: string;
  readonly auth: SourceAuth;
}

/** CardDAV target for contact data */
export interface CardDAVTarget {
  readonly type: 'carddav';
  readonly url: string;
  readonly user: string;
  readonly auth: SourceAuth;
}

/** WebDAV target for file data */
export interface WebDAVTarget {
  readonly type: 'webdav';
  readonly url: string;
  readonly user: string;
  readonly auth: SourceAuth;
}

/** Per-domain sync configuration for multi-domain sync */
export interface DomainConfig {
  /** Whether this domain is enabled */
  readonly enabled: boolean;
  /** Source connector for this domain */
  readonly source: SourceConfig;
  /** Target writer for this domain */
  readonly target: TargetConfig;
  /** Optional per-domain concurrency override */
  readonly concurrency?: number;
  /**
   * Optional throttle configuration.
   *
   * NOT per-domain in effect, despite where it sits (0026 T1 item 4): every
   * domain's block is merged into ONE shared limiter —
   * `createThrottleLimiterFromMapping` takes the most restrictive
   * `maxConcurrent`/`requestsPerSecond` across domains. Since workplan 0050
   * that limiter is enforced on the DAV/file SOURCE connectors as well as the
   * mail source (every request takes a slot, keyed by host); the DAV target
   * writers keep their own reactive protection (`dav-retry`). The
   * most-restrictive merge errs in the safe direction (rule 4: no domain's
   * cap is ever exceeded), but a lower cap on one domain slows all of them.
   * True per-domain limiters are future work; until then, configure this as
   * "the mapping's limiter", not a per-domain one.
   */
  readonly throttleConfig?: Partial<ThrottleConfig>;
}

/** Per-domain configuration block for multi-domain sync */
export interface DomainsConfig {
  mail?: DomainConfig;
  calendar?: DomainConfig;
  contacts?: DomainConfig;
  files?: DomainConfig;
}

export type SourceConfig = ImapOAuth2Source | CalDAVSource | CardDAVSource | WebDAVSource | GraphCalendarSource | GraphContactsSource | GraphMailSource | GraphDriveFileSource | GoogleDriveSource | GmailSource | GoogleCalendarSource | GoogleContactsSource | DropboxSource | BoxSource;
export type TargetConfig = JmapTarget | ImapDavTarget | CalDAVTarget | CardDAVTarget | WebDAVTarget;

export interface ScheduleConfig {
  readonly cron: string;
}

export interface MappingConfig {
  readonly tenantId: string;
  readonly mappingId: string;
  readonly source: SourceConfig;
  readonly target: TargetConfig;
  readonly schedule?: ScheduleConfig;
  /** Max messages processed in parallel per folder (bounds throughput and peak memory). */
  readonly concurrency?: number;
  /** Optional per-domain configuration for multi-domain sync */
  readonly domains?: DomainsConfig;
  /**
   * What to do when the DESTINATION already holds an item under our natural key.
   *
   *  - `skip` (default) — adopt it: record it as migrated and leave the
   *    destination's copy exactly as it is. Non-destructive, and what the
   *    product has always done.
   *  - `fail` — stop this domain's pass and surface it, for an operator who
   *    would rather look before anything is recorded as migrated.
   *
   * There is deliberately no `overwrite`. `TargetWriter` is specified "NEVER
   * deletes or overwrites (non-destructive)" — hard rule 2 — so source-wins
   * would break a documented invariant of every writer, and that needs an ADR
   * and an owner decision, not a config flag.
   *
   * Discovery reports the collision count before the run either way, so `skip`
   * is an informed default rather than a silent one.
   */
  readonly onCollision?: 'skip' | 'fail';
  /**
   * Which §14.1 shared-address pattern this mapping is (workplan 0027 T3).
   *
   * Almost always omitted: an ordinary personal mailbox is neither pattern.
   *
   *  - `shared_s` — a SHARED MAILBOX. The full folder tree is copied
   *    idempotently, which is the existing mail path unchanged; what makes it
   *    Pattern S is that `source.mailbox` names the shared address, so the
   *    source reads `/users/{address}` rather than `/me`. Setting it is a
   *    declaration checked against the source, not a switch that changes how
   *    the copy runs.
   *  - `distribution_d` — REFUSED here. A distribution list usually has no
   *    message store, so a mapping for one would copy nothing and report a
   *    successful, empty migration. What migrates is the definition and the
   *    member list, by hand (0027 T2's runbook).
   */
  readonly pattern?: 'shared_s';
  /**
   * Mail folders to leave behind, by their RFC 6154 special-use role.
   *
   * Defaults to `['trash', 'junk']`, and that default is the fix for something
   * nobody had decided: nothing filtered on special-use at all, so a migration
   * copied the owner's Deleted Items and Junk into their new mailbox alongside
   * everything else. Almost nobody wants that — they threw those away — and it
   * had never been asked.
   *
   * Set it to `[]` to migrate everything, which is a legitimate answer for
   * anyone who treats Deleted Items as an archive. Discovery reports what would
   * be skipped and how many items are in it either way, so the default is
   * informed rather than silent.
   *
   * There is a second reason to leave the trash behind, and it is the more
   * interesting one. An item sitting in Deleted Items is EXPLICIT evidence that
   * the owner deleted it — far better evidence than the absence-counting the
   * deletions queue has to fall back on. Once the trash is out of scope as
   * content, it becomes available as a signal.
   *
   * Mail only for now. Calendar and contacts have no trash in the collection
   * listing, and a Nextcloud file trashbin lives at its own endpoint we do not
   * read.
   */
  readonly excludeSpecialUse?: ReadonlyArray<SpecialUse>;
  /**
   * Allow this mapping to REMOVE an item's copy on the target, once an operator
   * has confirmed the source deleted it.
   *
   * Defaults to `false`. This is the one destructive capability in the product —
   * see `applyDeletion` in `@openmig/core` for the seven gates in front of every
   * individual removal — and a capability that destroys data must be opted into
   * per mapping rather than on by default. Turning it on does not remove
   * anything by itself: it only allows the `apply` action on an individual,
   * already-confirmed deletion queue entry to go through instead of being
   * refused outright.
   */
  readonly allowApplyDeletions?: boolean;
  /**
   * Apply open RELOCATIONS unattended, at the end of each file pass
   * (ADR-0031, accepted 2026-08-16).
   *
   * Defaults to `false`, like every destructive capability. Requires
   * `allowApplyDeletions` too — this is the same capability (removing our
   * copy from the target), run without a human pressing the button, which is
   * why four EXTRA gates stand in front of it: the pairing must be unique,
   * the relocation must have survived a pass, the mass breaker decides for
   * the whole pass, and at most `AUTO_APPLY_RELOCATIONS_CAP` items go per
   * pass. Deletions are never auto-applied.
   */
  readonly autoApplyRelocations?: boolean;
  /**
   * Put everything this mapping writes under one folder on the TARGET.
   *
   * THE CHOICE THIS ENCODES (owner decision 2026-08-16): when several sources
   * migrate into one target account, some owners want them MERGED — one inbox,
   * one file tree, the new platform as the single place — and some want a
   * subfolder per source (`Gmail/…`, `O365/…`). Merging is the default,
   * because working in the new platform as one thing is this product's
   * philosophy; the prefix is the opt-in for the other camp.
   *
   * Applies to the domains whose targets are PATH-SHAPED: mail folders and
   * file directories. Calendars and contacts merge regardless — their items
   * are UID-keyed and their collections are not trees, so a prefix would
   * rename collections rather than organise them.
   *
   * The ledger keeps recording SOURCE collections (move detection depends on
   * that), and the destructive path learns the prefix separately so an IMAP
   * removal opens the mailbox the copy actually lives in. Root-relative, no
   * leading or trailing slash, no `.`/`..` segments; absent or empty = merge.
   *
   * Set it when the mapping is created. Changing it later strands nothing —
   * every existing copy stays tracked at its recorded target id — but NEW
   * items land under the new prefix, so the target ends up with both layouts.
   */
  readonly targetFolderPrefix?: string;
}

/**
 * Validate a mapping's `targetFolderPrefix`, or refuse with the reason.
 *
 * ONE definition for both editions (hard rule 5): the appliance's mapping file
 * and the managed create API refuse the same shapes in the same words. The
 * rules exist because every rejected shape is a real bug somewhere downstream:
 * a leading slash makes a WebDAV path absolute and escapes the account root, a
 * `..` climbs out of it, an empty segment writes `a//b`, and a backslash is a
 * different separator on exactly the servers where that matters.
 */
export function parseTargetFolderPrefix(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ConfigError('targetFolderPrefix: must be a string when present');
  }
  const trimmed = value.replace(/^\/+|\/+$/g, '');
  if (trimmed === '') return undefined; // '' and '/' both mean "merge"
  if (trimmed.includes('\\')) {
    throw new ConfigError(
      "targetFolderPrefix: use '/' as the separator — a backslash is a literal character " +
        'on the servers this writes to, not a path boundary.',
    );
  }
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new ConfigError(
        `targetFolderPrefix: "${value}" contains an empty, '.' or '..' segment. The prefix is ` +
          'a folder path under the target account root, and those segments would escape or ' +
          'mangle it.',
      );
    }
  }
  return trimmed;
}

/**
 * Compose a target collection path under the mapping's prefix.
 *
 * The one composition, used by the sync engines (creating folders) and the
 * destructive path (naming the mailbox a removal must open). Two definitions
 * that "should" agree is how an IMAP removal ends up opening `INBOX` while the
 * copy lives in `Gmail/INBOX`.
 */
export function applyTargetFolderPrefix(prefix: string | undefined, path: string): string {
  if (!prefix) return path;
  return path ? `${prefix}/${path}` : prefix;
}

/**
 * What `excludeSpecialUse` means when the config does not say.
 *
 * Trash and Junk. Inbox, Sent, Drafts and Archive are all things the owner
 * chose to keep; these two are the ones they chose to discard, and copying them
 * into a fresh mailbox is a surprise rather than a service.
 */
export const DEFAULT_EXCLUDE_SPECIAL_USE: ReadonlyArray<SpecialUse> = ['trash', 'junk'];

/** Every value `excludeSpecialUse` accepts. */
const SPECIAL_USE_VALUES: ReadonlyArray<SpecialUse> = [
  'inbox',
  'sent',
  'drafts',
  'archive',
  'junk',
  'trash',
  'normal',
];

/**
 * Validate `excludeSpecialUse`, rejecting roles that do not exist.
 *
 * Loudly, because a typo here silently migrates the thing the owner asked to
 * leave behind — the failure mode is "we copied your deleted mail after you
 * told us not to", which is exactly the kind of quiet wrong answer a config
 * parser exists to prevent.
 */
export function parseExcludeSpecialUse(v: unknown): ReadonlyArray<SpecialUse> | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    throw new ConfigError('excludeSpecialUse must be an array of special-use role names');
  }
  const out: SpecialUse[] = [];
  for (const entry of v) {
    if (typeof entry !== 'string' || !SPECIAL_USE_VALUES.includes(entry as SpecialUse)) {
      throw new ConfigError(
        `excludeSpecialUse: '${String(entry)}' is not a special-use role. ` +
          `Expected one of: ${SPECIAL_USE_VALUES.join(', ')}.`,
      );
    }
    out.push(entry as SpecialUse);
  }
  return out;
}

/**
 * Why a distribution list cannot be a mailbox mapping (workplan 0027 T3).
 *
 * Exported and shared because THREE doors have to refuse it in the same
 * words: an appliance config file (`parsePattern`, below), a mapping built in
 * code (`assertMappingPattern` in `@openmig/core`), and the managed create /
 * update API. Three hand-written variants of one refusal is three chances for
 * one of them to drift into being wrong, or to quietly stop refusing at all.
 *
 * It lives in `shared` rather than `core` because the config parser is here
 * and `shared` is the base package — nothing above it can lend it a string.
 */
export const DISTRIBUTION_D_NOT_A_MAPPING =
  "'distribution_d' cannot be a mapping. A distribution list has no message store to copy — " +
  'what migrates is the group definition and its member list, which is a manual step (see the ' +
  'shared-addresses runbook). A mapping for one would connect, find nothing, and report a ' +
  'successful, empty migration.';

/**
 * Validate `pattern`, refusing the one that cannot work (workplan 0027 T3).
 *
 * `distribution_d` is a legal value of the LEDGER column and an illegal value
 * here, and the asymmetry is deliberate: `group_def` records that an address
 * IS a distribution list, while a `mailbox_mapping` for one would connect,
 * find no store, and report a clean empty migration. The refusal names the
 * runbook so the reader learns what to do instead of only what not to.
 */
function parsePattern(v: unknown): 'shared_s' | undefined {
  if (v === undefined) return undefined;
  if (v === 'shared_s') return v;
  if (v === 'distribution_d') throw new ConfigError(`pattern: ${DISTRIBUTION_D_NOT_A_MAPPING}`);
  throw new ConfigError("pattern: expected 'shared_s' (a shared mailbox) or nothing");
}

/** Validate `onCollision`, rejecting anything we do not actually implement. */
function parseOnCollision(v: unknown): 'skip' | 'fail' | undefined {
  if (v === undefined) return undefined;
  if (v === 'skip' || v === 'fail') return v;
  // Named explicitly, because it is the value an operator is most likely to
  // reach for and its absence is a deliberate architectural position, not an
  // oversight.
  if (v === 'overwrite') {
    throw new ConfigError(
      "onCollision: 'overwrite' is not supported — target writers are non-destructive by " +
        "specification (hard rule 2). Use 'skip' to keep the destination's copy, or 'fail' to " +
        'stop and look.',
    );
  }
  throw new ConfigError("onCollision: expected 'skip' or 'fail'");
}

function asRecord(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new ConfigError(`${path}: expected an object`);
  }
  return v as Record<string, unknown>;
}

function reqString(obj: Record<string, unknown>, key: string, path: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ConfigError(`${path}: expected a non-empty string`);
  }
  return v;
}

function reqInt(obj: Record<string, unknown>, key: string, path: string): number {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new ConfigError(`${path}: expected an integer`);
  }
  return v;
}

function parseSourceAuth(obj: Record<string, unknown>): SourceAuth {
  const kind = reqString(obj, 'kind', 'source.auth.kind');
  if (kind === 'xoauth2') return { kind: 'xoauth2', tokenFromEnv: reqString(obj, 'tokenFromEnv', 'source.auth.tokenFromEnv') };
  if (kind === 'login') return { kind: 'login', passwordFromEnv: reqString(obj, 'passwordFromEnv', 'source.auth.passwordFromEnv') };
  throw new ConfigError(`source.auth.kind: unsupported "${kind}" (expected "xoauth2" or "login")`);
}

function parseSource(obj: Record<string, unknown>): SourceConfig {
  const type = reqString(obj, 'type', 'source.type');
  if (type === 'imap-oauth2') {
    return {
      type: 'imap-oauth2',
      host: reqString(obj, 'host', 'source.host'),
      port: reqInt(obj, 'port', 'source.port'),
      user: reqString(obj, 'user', 'source.user'),
      auth: parseSourceAuth(asRecord(obj.auth, 'source.auth')),
      // Omitted rather than defaulted here: the default belongs at the one
      // place that builds the client, so there is a single answer to "what
      // happens when tls is unset" instead of one per parser. See ImapTlsSetting.
      ...(obj.tls === undefined ? {} : { tls: reqBoolean(obj, 'tls', 'source.tls') }),
      ...(obj.tlsVerify === undefined
        ? {}
        : { tlsVerify: reqBoolean(obj, 'tlsVerify', 'source.tlsVerify') }),
    };
  }
  if (type === 'caldav') {
    return {
      type: 'caldav',
      url: reqString(obj, 'url', 'source.url'),
      user: reqString(obj, 'user', 'source.user'),
      auth: parseSourceAuth(asRecord(obj.auth, 'source.auth')),
    };
  }
  if (type === 'carddav') {
    return {
      type: 'carddav',
      url: reqString(obj, 'url', 'source.url'),
      user: reqString(obj, 'user', 'source.user'),
      auth: parseSourceAuth(asRecord(obj.auth, 'source.auth')),
    };
  }
  if (type === 'webdav') {
    return {
      type: 'webdav',
      url: reqString(obj, 'url', 'source.url'),
      user: reqString(obj, 'user', 'source.user'),
      auth: parseSourceAuth(asRecord(obj.auth, 'source.auth')),
    };
  }
  if (type === 'graph-calendar') {
    return {
      type: 'graph-calendar',
      baseUrl: obj['baseUrl'] as string | undefined,
      tenantId: reqString(obj, 'tenantId', 'source.tenantId'),
      // Optional: unset means the signed-in user (/me). See the type's comment.
      ...(obj['mailbox'] === undefined ? {} : { mailbox: String(obj['mailbox']) }),
    };
  }
  if (type === 'graph-contacts') {
    return {
      type: 'graph-contacts',
      baseUrl: obj['baseUrl'] as string | undefined,
      tenantId: reqString(obj, 'tenantId', 'source.tenantId'),
      // Optional: unset means the signed-in user (/me). See the type's comment.
      ...(obj['mailbox'] === undefined ? {} : { mailbox: String(obj['mailbox']) }),
    };
  }
  if (type === 'dropbox') {
    return {
      type: 'dropbox',
      ...(obj['rootPath'] === undefined
        ? {}
        : { rootPath: reqString(obj, 'rootPath', 'source.rootPath') }),
    };
  }
  if (type === 'box') {
    return {
      type: 'box',
      // Required: the Client Credentials Grant reads nobody without a subject.
      userId: reqString(obj, 'userId', 'source.userId'),
      ...(obj['rootFolderId'] === undefined
        ? {}
        : { rootFolderId: reqString(obj, 'rootFolderId', 'source.rootFolderId') }),
    };
  }
  if (type === 'graph-drive') {
    return {
      type: 'graph-drive',
      baseUrl: obj['baseUrl'] as string | undefined,
      tenantId: reqString(obj, 'tenantId', 'source.tenantId'),
      // Optional: unset means the signed-in user (/me). See the type's comment.
      ...(obj['mailbox'] === undefined ? {} : { mailbox: String(obj['mailbox']) }),
    };
  }
  if (type === 'graph-mail') {
    return {
      type: 'graph-mail',
      baseUrl: obj['baseUrl'] as string | undefined,
      tenantId: reqString(obj, 'tenantId', 'source.tenantId'),
      // Optional: unset means the signed-in user (/me). See the type's comment.
      ...(obj['mailbox'] === undefined ? {} : { mailbox: String(obj['mailbox']) }),
    };
  }
  if (type === 'google-drive') {
    return parseGoogleDriveSource(obj);
  }
  if (type === 'gmail') {
    return {
      type: 'gmail',
      user: reqString(obj, 'user', 'source.user'),
    };
  }
  if (type === 'google-calendar') {
    return {
      type: 'google-calendar',
      user: reqString(obj, 'user', 'source.user'),
    };
  }
  if (type === 'google-contacts') {
    return {
      type: 'google-contacts',
      user: reqString(obj, 'user', 'source.user'),
    };
  }
  throw new ConfigError(`source.type: unsupported "${type}" (expected "imap-oauth2", "caldav", "carddav", "webdav", "graph-calendar", "graph-contacts", "graph-mail", "google-drive", "gmail", "google-calendar", or "google-contacts")`);
}

/**
 * Validate a Google Drive source's settings — from a mapping FILE or from a
 * managed connection's stored `config` blob.
 *
 * Exported, and called by both editions, because hard rule 5 says they do not
 * differ in behaviour: a `nativeFilePolicy` the appliance refuses must not be a
 * `nativeFilePolicy` the managed edition silently accepts and then ignores. The
 * managed `config` column is untyped JSON, so without this it would be read with
 * casts and no validation at all.
 *
 * `type` is not required in the input — a stored connection carries its provider
 * in its own `kind` column, not in the blob — and is always set on the way out.
 */
export function parseGoogleDriveSource(obj: Record<string, unknown>): GoogleDriveSource {
  return {
    type: 'google-drive',
    ...(obj['baseUrl'] === undefined
      ? {}
      : { baseUrl: reqString(obj, 'baseUrl', 'source.baseUrl') }),
    // Unset means `root` (My Drive). Present-but-empty is refused rather than
    // silently treated as unset: an empty string here would migrate the whole
    // of My Drive when the operator meant one shared drive.
    ...(obj['rootFolderId'] === undefined
      ? {}
      : { rootFolderId: reqString(obj, 'rootFolderId', 'source.rootFolderId') }),
    ...(obj['user'] === undefined ? {} : { user: reqString(obj, 'user', 'source.user') }),
    ...(obj['nativeFilePolicy'] === undefined
      ? {}
      : { nativeFilePolicy: parseNativeFilePolicy(obj['nativeFilePolicy']) }),
  };
}

/**
 * Validate the Google native-file policy, refusing anything else BY NAME.
 *
 * A typo here is not a typo: an unrecognised value silently falling back to a
 * default would mean an operator who wrote `"export_office"` gets `refuse` and
 * is told their Docs are un-migratable, with the config in front of them saying
 * otherwise. See {@link GoogleNativeFilePolicy} for why the default is `refuse`
 * and what choosing an export still leaves unproven.
 */
function parseNativeFilePolicy(value: unknown): GoogleNativeFilePolicy {
  if (value === 'refuse' || value === 'export-office' || value === 'export-pdf') return value;
  throw new ConfigError(
    `source.nativeFilePolicy: unsupported ${JSON.stringify(value)} (expected "refuse", ` +
      '"export-office", or "export-pdf"). "refuse" is the default and reports each Google Doc, ' +
      'Sheet and Slide as un-migratable with a reason; the export policies ask Drive to render ' +
      'one, which is lossy and whose byte-stability across passes is NOT yet measured ' +
      '(workplan 0042 T6).',
  );
}

function parseJmapAuth(obj: Record<string, unknown>): JmapAuth {
  const kind = reqString(obj, 'kind', 'target.auth.kind');
  if (kind === 'basic') return { kind: 'basic', passwordFromEnv: reqString(obj, 'passwordFromEnv', 'target.auth.passwordFromEnv') };
  if (kind === 'bearer') return { kind: 'bearer', tokenFromEnv: reqString(obj, 'tokenFromEnv', 'target.auth.tokenFromEnv') };
  throw new ConfigError(`target.auth.kind: unsupported "${kind}" (expected "basic" or "bearer")`);
}

function parseTarget(obj: Record<string, unknown>): TargetConfig {
  const type = reqString(obj, 'type', 'target.type');
  if (type === 'jmap') {
    return {
      type: 'jmap',
      baseUrl: reqString(obj, 'baseUrl', 'target.baseUrl'),
      user: reqString(obj, 'user', 'target.user'),
      auth: parseJmapAuth(asRecord(obj.auth, 'target.auth')),
    };
  }
  if (type === 'imap-dav') {
    return {
      type: 'imap-dav',
      host: reqString(obj, 'host', 'target.host'),
      port: reqInt(obj, 'port', 'target.port'),
      user: reqString(obj, 'user', 'target.user'),
      auth: parseSourceAuth(asRecord(obj.auth, 'target.auth')),
      ...(obj.tls === undefined ? {} : { tls: reqBoolean(obj, 'tls', 'target.tls') }),
      ...(obj.tlsVerify === undefined
        ? {}
        : { tlsVerify: reqBoolean(obj, 'tlsVerify', 'target.tlsVerify') }),
    };
  }
  if (type === 'caldav') {
    return {
      type: 'caldav',
      url: reqString(obj, 'url', 'target.url'),
      user: reqString(obj, 'user', 'target.user'),
      auth: parseSourceAuth(asRecord(obj.auth, 'target.auth')),
    };
  }
  if (type === 'carddav') {
    return {
      type: 'carddav',
      url: reqString(obj, 'url', 'target.url'),
      user: reqString(obj, 'user', 'target.user'),
      auth: parseSourceAuth(asRecord(obj.auth, 'target.auth')),
    };
  }
  if (type === 'webdav') {
    return {
      type: 'webdav',
      url: reqString(obj, 'url', 'target.url'),
      user: reqString(obj, 'user', 'target.user'),
      auth: parseSourceAuth(asRecord(obj.auth, 'target.auth')),
    };
  }
  throw new ConfigError(`target.type: unsupported "${type}" (expected "jmap", "imap-dav", "caldav", "carddav", or "webdav")`);
}

/** Validate a parsed config object into a typed MappingConfig (throws ConfigError on the first issue). */
export function parseMappingConfig(input: unknown): MappingConfig {
  const root = asRecord(input, '(root)');
  const tenantId = reqString(root, 'tenantId', 'tenantId');
  const mappingId = reqString(root, 'mappingId', 'mappingId');
  const source = parseSource(asRecord(root.source, 'source'));
  const target = parseTarget(asRecord(root.target, 'target'));
  const schedule =
    root.schedule === undefined
      ? undefined
      : { cron: reqString(asRecord(root.schedule, 'schedule'), 'cron', 'schedule.cron') };
  const concurrency = root.concurrency === undefined ? undefined : reqInt(root, 'concurrency', 'concurrency');
  const onCollision = parseOnCollision(root.onCollision);
  const pattern = parsePattern(root.pattern);
  const excludeSpecialUse = parseExcludeSpecialUse(root.excludeSpecialUse);
  const domains = root.domains === undefined ? undefined : parseDomainsConfig(asRecord(root.domains, 'domains'));
  const targetFolderPrefix = parseTargetFolderPrefix(root.targetFolderPrefix);
  const allowApplyDeletions =
    root.allowApplyDeletions === undefined
      ? undefined
      : reqBoolean(root, 'allowApplyDeletions', 'allowApplyDeletions');
  const autoApplyRelocations =
    root.autoApplyRelocations === undefined
      ? undefined
      : reqBoolean(root, 'autoApplyRelocations', 'autoApplyRelocations');

  return {
    tenantId,
    mappingId,
    source,
    target,
    ...(schedule ? { schedule } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(onCollision !== undefined ? { onCollision } : {}),
    ...(pattern !== undefined ? { pattern } : {}),
    ...(excludeSpecialUse !== undefined ? { excludeSpecialUse } : {}),
    ...(domains !== undefined ? { domains } : {}),
    ...(allowApplyDeletions !== undefined ? { allowApplyDeletions } : {}),
    ...(autoApplyRelocations !== undefined ? { autoApplyRelocations } : {}),
    ...(targetFolderPrefix !== undefined ? { targetFolderPrefix } : {}),
  };
}

/** Parse and validate the domains configuration block */
function parseDomainsConfig(obj: Record<string, unknown>): DomainsConfig {
  const domains: DomainsConfig = {};

  // Parse mail domain
  if (obj.mail !== undefined) {
    const mail = asRecord(obj.mail, 'domains.mail');
    domains.mail = {
      enabled: reqBoolean(mail, 'enabled', 'domains.mail.enabled'),
      source: parseSource(asRecord(mail.source, 'domains.mail.source')),
      target: parseTarget(asRecord(mail.target, 'domains.mail.target')),
      ...(mail.concurrency !== undefined ? { concurrency: reqInt(mail, 'concurrency', 'domains.mail.concurrency') } : {}),
      ...(mail.throttleConfig !== undefined ? { throttleConfig: parseThrottleConfig(asRecord(mail.throttleConfig, 'domains.mail.throttleConfig')) } : {}),
    };
  }

  // Parse calendar domain
  if (obj.calendar !== undefined) {
    const calendar = asRecord(obj.calendar, 'domains.calendar');
    domains.calendar = {
      enabled: reqBoolean(calendar, 'enabled', 'domains.calendar.enabled'),
      source: parseSource(asRecord(calendar.source, 'domains.calendar.source')),
      target: parseTarget(asRecord(calendar.target, 'domains.calendar.target')),
      ...(calendar.concurrency !== undefined ? { concurrency: reqInt(calendar, 'concurrency', 'domains.calendar.concurrency') } : {}),
      ...(calendar.throttleConfig !== undefined ? { throttleConfig: parseThrottleConfig(asRecord(calendar.throttleConfig, 'domains.calendar.throttleConfig')) } : {}),
    };
  }

  // Parse contacts domain
  if (obj.contacts !== undefined) {
    const contacts = asRecord(obj.contacts, 'domains.contacts');
    domains.contacts = {
      enabled: reqBoolean(contacts, 'enabled', 'domains.contacts.enabled'),
      source: parseSource(asRecord(contacts.source, 'domains.contacts.source')),
      target: parseTarget(asRecord(contacts.target, 'domains.contacts.target')),
      ...(contacts.concurrency !== undefined ? { concurrency: reqInt(contacts, 'concurrency', 'domains.contacts.concurrency') } : {}),
      ...(contacts.throttleConfig !== undefined ? { throttleConfig: parseThrottleConfig(asRecord(contacts.throttleConfig, 'domains.contacts.throttleConfig')) } : {}),
    };
  }

  // Parse files domain
  if (obj.files !== undefined) {
    const files = asRecord(obj.files, 'domains.files');
    domains.files = {
      enabled: reqBoolean(files, 'enabled', 'domains.files.enabled'),
      source: parseSource(asRecord(files.source, 'domains.files.source')),
      target: parseTarget(asRecord(files.target, 'domains.files.target')),
      ...(files.concurrency !== undefined ? { concurrency: reqInt(files, 'concurrency', 'domains.files.concurrency') } : {}),
      ...(files.throttleConfig !== undefined ? { throttleConfig: parseThrottleConfig(asRecord(files.throttleConfig, 'domains.files.throttleConfig')) } : {}),
    };
  }

  return domains;
}

/** Parse and validate throttle configuration */
export function parseThrottleConfig(obj: Record<string, unknown>): Partial<ThrottleConfig> {
  const config: Partial<ThrottleConfig> = {};
  
  if (obj.maxConcurrent !== undefined) {
    config.maxConcurrent = reqInt(obj, 'maxConcurrent', 'throttleConfig.maxConcurrent');
  }
  if (obj.requestsPerSecond !== undefined) {
    config.requestsPerSecond = reqInt(obj, 'requestsPerSecond', 'throttleConfig.requestsPerSecond');
  }
  if (obj.maxRetries !== undefined) {
    config.maxRetries = reqInt(obj, 'maxRetries', 'throttleConfig.maxRetries');
  }
  if (obj.baseBackoffMs !== undefined) {
    config.baseBackoffMs = reqInt(obj, 'baseBackoffMs', 'throttleConfig.baseBackoffMs');
  }
  if (obj.maxBackoffMs !== undefined) {
    config.maxBackoffMs = reqInt(obj, 'maxBackoffMs', 'throttleConfig.maxBackoffMs');
  }
  if (obj.jitterMs !== undefined) {
    config.jitterMs = reqInt(obj, 'jitterMs', 'throttleConfig.jitterMs');
  }
  
  return config;
}

function reqBoolean(obj: Record<string, unknown>, key: string, path: string): boolean {
  const v = obj[key];
  if (typeof v !== 'boolean') {
    throw new ConfigError(`${path}: expected a boolean`);
  }
  return v;
}

/** Parse + validate a mapping config from JSON text. Unknown extra keys (e.g. "_note") are ignored. */
export function parseMappingConfigJson(text: string): MappingConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`invalid JSON: ${(e as Error).message}`);
  }
  return parseMappingConfig(data);
}
