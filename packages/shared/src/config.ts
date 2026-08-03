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

/** O365 source over IMAP+OAuth2 (slice 0001). */
export interface ImapOAuth2Source {
  readonly type: 'imap-oauth2';
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly auth: SourceAuth;
}

export type JmapAuth =
  | { readonly kind: 'basic'; readonly passwordFromEnv: string }
  | { readonly kind: 'bearer'; readonly tokenFromEnv: string };

/** JMAP target (primary family). */
export interface JmapTarget {
  readonly type: 'jmap';
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
   * `maxConcurrent`/`requestsPerSecond` across domains — and that limiter is
   * currently wired to the MAIL source only; the DAV/files connectors run
   * without one. The most-restrictive merge errs in the safe direction
   * (rule 4: no domain's cap is ever exceeded), but a lower cap on one
   * domain slows all of them. True per-domain limiters are future work;
   * until then, configure this as "the mapping's limiter", not a per-domain
   * one.
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

export type SourceConfig = ImapOAuth2Source | CalDAVSource | CardDAVSource | WebDAVSource | GraphCalendarSource | GraphContactsSource | GraphMailSource;
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
  if (type === 'graph-mail') {
    return {
      type: 'graph-mail',
      baseUrl: obj['baseUrl'] as string | undefined,
      tenantId: reqString(obj, 'tenantId', 'source.tenantId'),
      // Optional: unset means the signed-in user (/me). See the type's comment.
      ...(obj['mailbox'] === undefined ? {} : { mailbox: String(obj['mailbox']) }),
    };
  }
  throw new ConfigError(`source.type: unsupported "${type}" (expected "imap-oauth2", "caldav", "carddav", "webdav", "graph-calendar", "graph-contacts", or "graph-mail")`);
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
  const excludeSpecialUse = parseExcludeSpecialUse(root.excludeSpecialUse);
  const domains = root.domains === undefined ? undefined : parseDomainsConfig(asRecord(root.domains, 'domains'));
  const allowApplyDeletions =
    root.allowApplyDeletions === undefined
      ? undefined
      : reqBoolean(root, 'allowApplyDeletions', 'allowApplyDeletions');

  return {
    tenantId,
    mappingId,
    source,
    target,
    ...(schedule ? { schedule } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(onCollision !== undefined ? { onCollision } : {}),
    ...(excludeSpecialUse !== undefined ? { excludeSpecialUse } : {}),
    ...(domains !== undefined ? { domains } : {}),
    ...(allowApplyDeletions !== undefined ? { allowApplyDeletions } : {}),
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
function parseThrottleConfig(obj: Record<string, unknown>): Partial<ThrottleConfig> {
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
