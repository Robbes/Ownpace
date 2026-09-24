// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Migration Management Routes
 * 
 * CRUD operations for migrations, sync triggers, and run history.
 * Integrates with Trigger.dev for job orchestration.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticate, getDbPool, withTenantDb } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { recordMappingStatusChange } from './mapping-status-audit.ts';
import { activateAddedPath, movePathsWithMapping } from './path-lifecycle-wiring.ts';
import { eq, and, isNull } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgMigrationStatusStore, PgLedger, RunStore, CutoverStore } from '@openmig/ledger';
import {
  ARCHIVE_PROVIDERS,
  ARCHIVE_PROVIDER_ORIGINS,
  archiveProviderName,
  asMappingId,
  asTenantId,
  buildDomainStatusReports,
  DISCOVERY_DOMAINS,
  discoveryForSelection,
  grantWithdrawnRefusal,
  isArchiveProvider,
  isProviderAccountKind,
  log,
  parseArchiveSource,
} from '@openmig/shared';
import { SecretStore } from '@openmig/core/secret-store';
import { prepareTransition } from '@openmig/core/cutover-state';
import { getTriggerClient } from '@openmig/scheduler';
import type {
  GoogleNativeFilePolicy,
  MappingId,
  NativeFilePolicies,
  TenantId,
} from '@openmig/shared';
import {
  resolveSyncJob,
  resolveCutoverJob,
  resolveDiscoveryJob,
  discoveryTriggerOptions,
} from './job-resolution.ts';
import {
  listDropboxSharedFolders,
  listGoogleSharedDrives,
  listGoogleSharedFolders,
  probeSourceConnection,
  probeTargetConnection,
} from '@openmig/orchestration/probe-connection';
// The §11.2 decision queues and the decisions on them (ADR-0026). Mounted on
// this same router so they sit under /api/migrations/:mappingId/... alongside
// discovery and start, which is where the appliance's equivalents live too.
import operatingRoutes from './operating-routes.ts';
// The account kind's scope set, from the same table the consent screen uses
// (workplan 0106 T3b) — so the door demands what the consent asked for.
import { googleAccountScopeSentence } from './google-account-consent.ts';
import googleOauthRoutes from './google-oauth-routes.ts';
import dropboxOauthRoutes from './dropbox-oauth-routes.ts';
import microsoftOauthRoutes from './microsoft-oauth-routes.ts';
// The owner's grant-link surface (workplan 0108 T3): issue, list, revoke, all
// under /api/migrations/:mappingId/links. The link HOLDER's routes are not
// here and never will be — they authenticate a link, not a session, so they
// live behind their own middleware rather than behind `authenticate`.
import linkRoutes from './link-routes.ts';
import { awaitingGrantRefusal } from './grant-link-readiness.ts';
// Its own module since 2026-09-23 (0108 T8a): the grant page names the same
// accounts the detail route does, and importing this router to reach it would
// load every migration route to answer one question.
import { accountOnConnection } from './account-on-connection.ts';
export { accountOnConnection };
import {
  DISTRIBUTION_D_NOT_A_MAPPING,
  targetDomainRefusal,
  parseTargetFolderPrefix,
  parseThrottleConfig,
  sourceDomainRefusal,
  providerAccountDomains,
  googleDeploymentClient,
  halfGoogleClientPairProblem,
  halfDropboxClientPairProblem,
  dropboxDeploymentClient,
  microsoftDeploymentClient,
  halfMicrosoftClientPairProblem,
  providerClientFacts,
  resolveGoogleClient,
  resolveDropboxClient,
  parseGoogleDriveSource,
  carriesGoogleNativeFiles,
  refusalsFor,
  type RevisableField,
  ConfigError,
  describeCronScheduleProblem,
  credentialFieldsFor,
  measuredNoRefusal,
  isAfterCutover,
  kindAdditionRefusal,
  kindChoices,
  updateTransition,
} from '@openmig/shared';
import { serverFault } from '../../server-fault.ts';

/** Take the first row of a RETURNING result or fail loudly (no silent nulls). */
function firstOrThrow<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (!row) {
    throw new Error(`failed to create ${what}`);
  }
  return row;
}

/** Map the web source type to a connection.kind (protocol-based). */
export function sourceKindFor(
  sourceType: 'imap' | 'oauth2' | 'graph' | 'microsoft' | 'apple' | 'google-drive' | 'gmail' | 'google-calendar' | 'google-contacts' | 'google' | 'dropbox' | 'box' | 'archive',
): 'imap' | 'o365' | 'google_drive' | 'gmail' | 'google_calendar' | 'google_contacts' | 'google' | 'microsoft' | 'apple' | 'dropbox' | 'box' | 'archive' {
  // 'google_drive' is the CHECK-constrained connection.kind migration 0008
  // added, and the literal build-deps-from-mapping branches on
  // (GOOGLE_DRIVE_CONNECTION_KIND) — underscore, unlike the wizard's hyphen,
  // because connection.kind predates the wizard vocabulary.
  if (sourceType === 'google-drive') return 'google_drive';
  // 'gmail' joined the CHECK in migration 0012 (workplan 0044). Not 'imap',
  // although the transport is: the credential shape is a Google OAuth client,
  // and the row's kind is what tells the credential validation that.
  if (sourceType === 'gmail') return 'gmail';
  // Same shape for the Google DAV pair (workplan 0045, migration 0015).
  if (sourceType === 'google-calendar') return 'google_calendar';
  // 'dropbox' joined the CHECK in migration 0018 (workplan 0055).
  if (sourceType === 'dropbox') return 'dropbox';
  // 'box' joined the CHECK in migration 0019 (workplan 0056).
  if (sourceType === 'box') return 'box';
  if (sourceType === 'google-contacts') return 'google_contacts';
  // The ACCOUNT kind (workplan 0106 T3b, migration 0034). No underscore to
  // translate: the wizard word and the connection kind are the same word,
  // which is why `wizardTypeForConnectionKind` needs no case for it either.
  if (sourceType === 'google') return 'google';
  // The Microsoft ACCOUNT kind (workplan 0114, migration 0037). Same shape as
  // `google` above and for the same reason: new on both sides at once, so the
  // wizard word and the connection kind are one word. NOT 'o365' — that kind
  // means "the customer's own Entra registration", which is the credential
  // shape `oauth2` and `graph` carry and this row deliberately does not.
  if (sourceType === 'microsoft') return 'microsoft';
  // The Apple ACCOUNT kind (workplan 0115, migration 0038). One word on both
  // sides again — and NOT 'imap', although its mail face is IMAP. The kind is
  // what tells the credential validation that this row carries an
  // app-specific password reaching three protocols, rather than one host and
  // port somebody typed; a `imap` row would ask for the wrong things and
  // reach one face of the four.
  if (sourceType === 'apple') return 'apple';
  // The EXPORT ARCHIVE (workplan 0116 T1, migration 0039). One word on both
  // sides, like the three account kinds above — and unlike them it is not an
  // account at all: the row's credential is a path, and WHICH export it is
  // lives in the config so a third export needs no nineteenth kind here.
  if (sourceType === 'archive') return 'archive';
  return sourceType === 'imap' ? 'imap' : 'o365';
}

/**
 * The source connection's config JSONB, in the ENGINE's own shape —
 * build-deps-from-mapping.ts casts this straight to shared's `SourceConfig`
 * and branches on `type`. Until 2026-08-10 create stored `{host, port,
 * useSsl}` with no `type` and no `user`, so the worker's mail path refused
 * every wizard-created mapping at build time ("got: undefined"); only the dev
 * seed script wrote a config a sync pass could open. host/port/useSsl remain
 * present where they mean something because the GET detail route spreads this
 * object (with the password masked) as its echo.
 */
export function sourceConnectionConfig(
  body: Pick<z.infer<typeof CreateMappingSchema>, 'sourceType' | 'sourceConfig'>,
): Record<string, unknown> {
  const cfg = body.sourceConfig;
  if (body.sourceType === 'google-drive') {
    // Stored in the ENGINE's own shape and validated by the SAME parser the
    // appliance's mapping file goes through (hard rule 5): a nativeFilePolicy
    // one edition refuses must not be one the other stores and ignores.
    // parseGoogleDriveSource throws ConfigError on garbage; the route's
    // superRefine has already refused it with a field-anchored message, so a
    // throw here would be a coding error, not an input error.
    return parseGoogleDriveSource({
      type: 'google-drive',
      ...(cfg.rootFolderId ? { rootFolderId: cfg.rootFolderId } : {}),
      ...exportFormatOf(cfg),
    }) as unknown as Record<string, unknown>;
  }
  if (body.sourceType === 'dropbox') {
    // The config carries only WHERE the migration is rooted; credentials live
    // encrypted on the connection. Engine shape, like every source here.
    return { type: 'dropbox', ...(cfg.rootPath ? { rootPath: cfg.rootPath } : {}) };
  }
  if (body.sourceType === 'archive') {
    // WHICH export and WHERE — and nothing encrypted beside it, because there
    // is nothing on an archive connection to encrypt (0116 T1). Run through
    // the SHARED parser, like `google-drive` above and for the same reason
    // (hard rule 5): an unknown `provider` the appliance's mapping file would
    // refuse must not be one this door stores. The superRefine has already
    // said so with a field-anchored message, so a throw here is a coding
    // error rather than an input one.
    return parseArchiveSource({
      provider: cfg.provider,
      path: cfg.path,
    }) as unknown as Record<string, unknown>;
  }
  if (body.sourceType === 'box') {
    // WHERE it is rooted and WHOSE files (the CCG subject — one subject per
    // mapping, never a secret); the client id + secret live encrypted.
    return {
      type: 'box',
      userId: cfg.userId!,
      ...(cfg.rootFolderId ? { rootFolderId: cfg.rootFolderId } : {}),
    };
  }
  if (body.sourceType === 'gmail') {
    // Everything else is fixed by Google (imap.gmail.com:993, XOAUTH2) or
    // lives in the encrypted credentials — the config carries only WHOSE
    // mailbox this is. Stored in the engine's own shape: the worker casts
    // this to shared's SourceConfig and branches on `type`.
    return { type: 'gmail', user: cfg.username };
  }
  if (body.sourceType === 'google-calendar') {
    // Same one-field shape (workplan 0045): the CalDAV principal URL is
    // derived from the address; credentials live encrypted on the connection.
    return { type: 'google-calendar', user: cfg.username };
  }
  if (body.sourceType === 'google-contacts') {
    return { type: 'google-contacts', user: cfg.username };
  }
  // EVERY PROVIDER ACCOUNT, not one of them (workplan 0115 T9).
  //
  // An account row serves several faces from ONE address, and which faces it
  // serves is the mapping's ticked domains crossed with
  // `PROVIDER_ACCOUNT_DOMAINS` — never something stored here. So the config is
  // the kind and the address and nothing else: no host, because an account
  // kind's endpoints are the provider's (published, or discovered), and no
  // port for the same reason.
  //
  // This read `sourceType === 'google'` alone, and `microsoft` and `apple`
  // fell through to the Azure catch-all at the bottom — which stored them as
  // `{type: 'imap-oauth2', host: undefined, tls, useSsl}`. **An O365
  // IMAP+XOAUTH2 mail source**, for an account whose faces are Graph builders
  // in one case and DAV+IMAP in the other, with no host, no tenant and no
  // client. Nothing failed where anybody would see it, because
  // `sourceFaceBuilder` branches on the connection's KIND and never on this
  // `type` — which is exactly why it lasted. What it did reach: the GET detail
  // route echoes this object, so the row identified itself as a product it is
  // not, and the rotate panel prefills from it.
  //
  // The type is stored for the reason `google`'s own comment gave (0106 T3b)
  // and the two silent kinds proved: a config that cannot identify its row is
  // one nobody can read back, and one that identifies it WRONGLY is worse.
  if (isProviderAccountKind(body.sourceType)) {
    return {
      type: body.sourceType,
      user: cfg.username,
      // AND WHAT BECOMES OF ITS GOOGLE DOCS, where the account has files
      // (owner's live run, 2026-09-17). The account kind's file face is the
      // Drive connector — `parseGoogleDriveSource` reads this blob on the way
      // in, so a policy stored here is the policy that migration exports with.
      // Until the wizard could offer it, every Doc was left behind under the
      // `refuse` default and no screen could say otherwise.
      //
      // Through the SHARED parser like `google-drive` above, for the reason
      // hard rule 5 gives: a value one edition refuses must not be one the
      // other stores and ignores. The superRefine has already refused garbage
      // with a field-anchored message, so a throw here is a coding error.
      ...(carriesGoogleNativeFiles(body.sourceType) ? exportFormatOf(cfg) : {}),
    };
  }
  if (body.sourceType === 'graph') {
    // Graph REST transport: the tenant + mailbox are the address — there is
    // no host. The wizard's source username is the mailbox UPN; an app-only
    // (client-credentials) token reads /users/{mailbox}, never /me.
    return { type: 'graph-mail', tenantId: cfg.tenantId, mailbox: cfg.username };
  }
  if (body.sourceType === 'oauth2') {
    // IMAP + XOAUTH2 against O365 (ADR-0006: IMAP primary, Graph fallback).
    // O365's IMAP endpoint is fixed; asking the operator to type it would
    // only invite typos, so it is a default, not a question.
    return {
      type: 'imap-oauth2',
      host: cfg.host ?? 'outlook.office365.com',
      port: cfg.port ?? 993,
      user: cfg.username,
      tls: true,
      useSsl: true,
    };
  }
  return {
    type: 'imap-oauth2',
    host: cfg.host,
    port: cfg.port,
    user: cfg.username,
    tls: cfg.useSsl,
    useSsl: cfg.useSsl,
  };
}

/**
 * The target connection's config JSONB — same reason as the source: the
 * worker's mail path branches on `type` (jmap → baseUrl+user, imap →
 * imap-dav). The DAV targets keep the plain shape: their domain path builds
 * its URL from host/port/useSsl via `davUrl()` and never reads a `type`.
 */
/**
 * The credential keys a GOOGLE source must carry, given what this deployment
 * already has (ADR-0041, owner decision 2026-09-01 — option B).
 *
 * A deployment that registered its own Google application configures it once
 * (`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`) and the connection
 * stores NEITHER — the client is read at the moment a token is minted, so
 * rotating it is one `.env` edit rather than an edit per connection. So the
 * create door stops demanding what nobody has to type.
 *
 * THE REFRESH TOKEN IS NEVER OPTIONAL. It is the per-account half — the thing
 * that says whose data this is and what they consented to — and no
 * deployment-wide value can stand in for it.
 *
 * A CALLER MAY STILL SEND BOTH, and their values win everywhere downstream:
 * owning a client is a real choice and this must not take it away. What is
 * dropped is only the DEMAND.
 *
 * `google-drive`, `gmail`, `google-calendar`, `google-contacts` and the
 * `google` account share this one list, because four demands that could
 * disagree are four chances to refuse a connection the run path would have
 * accepted. Dropbox and Box are deliberately NOT here: they store their own
 * app key and secret under the same two key names, and a Google application is
 * not a Dropbox app.
 *
 * READ PER REQUEST, not at import: an operator who sets the variables and
 * restarts the API gets the new answer, and nothing caches one from a process
 * that started without them.
 */
function googleCredentialKeysRequired(): ReadonlyArray<'clientId' | 'clientSecret' | 'refreshToken'> {
  return googleDeploymentClient() === null
    ? (['clientId', 'clientSecret', 'refreshToken'] as const)
    : (['refreshToken'] as const);
}

/** Whether this deployment carries the provider's app: the fact the wizard reads too. */
function carriesApp(provider: 'google' | 'dropbox'): boolean {
  return providerClientFacts()[provider] === 'deployment';
}

/**
 * THE REFUSAL WHERE THIS SERVICE CARRIES THE APP (workplan 0148 T2 (d), owner
 * decision D2: "Stop the false hints on managed").
 *
 * With the deployment's Google client or Dropbox app configured, the door asks
 * only for the refresh token — and the refusal still opened "authenticates with
 * your own Google Cloud OAuth client", sending a tester to create what the
 * service already has. So each caller branches on `carriesApp`, the one fact
 * the wizard reads (`providerClientFacts()`), and here names the token and the
 * button that fills it in. Where each connection brings its own app, each row
 * keeps the sentence it had. English, as refusals are
 * (`docs/i18n-prose-boundary.md`).
 *
 * `consented`, when given, is the scope the token must carry — for somebody
 * pasting one rather than pressing the button, which asks for it itself.
 */
function deploymentAppTokenRefusal(
  sourceType: string,
  provider: 'Google' | 'Dropbox',
  missing: ReadonlyArray<string>,
  consented?: string,
): string {
  return (
    `A '${sourceType}' source needs a refresh token` +
    (consented ? ` consented with the ${consented} scope` : '') +
    `, and this service has its own ${provider} app: press Connect with ${provider}, which ` +
    `fills it in. sourceConfig is missing ${missing.join(', ')}.`
  );
}

/**
 * Refuse HALF a client pair on a Google source (ADR-0041, the rule the wizard
 * enforces since the deployment's client became a fact it could read).
 *
 * `googleCredentialKeysRequired` above stops demanding the pair the moment the
 * deployment carries one — and the run path then fills only the MISSING half.
 * So a request carrying a client id and no secret would be accepted here,
 * stored, completed with the deployment's secret at mint time, and refused by
 * Google's token endpoint hours later, from a sync log. The sentence is
 * shared's, the same one the connection routes use; the anchor is the key
 * that is missing, so a form can point at the box to fill or to empty.
 */
function refuseHalfGoogleClientPair(
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
  sourceConfig: { clientId?: string | undefined; clientSecret?: string | undefined },
): void {
  const problem = halfGoogleClientPairProblem(sourceConfig);
  if (!problem) return;
  const missing = sourceConfig.clientId?.trim() ? 'clientSecret' : 'clientId';
  ctx.addIssue({ code: 'custom', path: ['sourceConfig', missing], message: problem });
}

/** The same refusal for a Dropbox app (2026-09-02: Connect with Dropbox). */
function refuseHalfDropboxClientPair(
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
  sourceConfig: { clientId?: string | undefined; clientSecret?: string | undefined },
): void {
  const problem = halfDropboxClientPairProblem(sourceConfig);
  if (!problem) return;
  const missing = sourceConfig.clientId?.trim() ? 'clientSecret' : 'clientId';
  ctx.addIssue({ code: 'custom', path: ['sourceConfig', missing], message: problem });
}

/**
 * The export format as a request sent it, read by the shared parser: the
 * single format and the per-kind ones (workplan 0042 T9), each only where
 * given. Empty is unset, as it has always been at this door for the single
 * format: the wizard posts nothing when its box is empty. The superRefine has
 * already refused an unreadable value with a field-anchored message, so a
 * throw here would be a coding error rather than an input one.
 */
export function exportFormatOf(cfg: ExportFormatAsSent): ExportFormat {
  const single = cfg.nativeFilePolicy === '' ? undefined : cfg.nativeFilePolicy;
  const parsed = parseGoogleDriveSource({
    ...(single === undefined ? {} : { nativeFilePolicy: single }),
    ...(cfg.nativeFilePolicies === undefined ? {} : { nativeFilePolicies: cfg.nativeFilePolicies }),
  });
  return {
    ...(parsed.nativeFilePolicy === undefined ? {} : { nativeFilePolicy: parsed.nativeFilePolicy }),
    ...(parsed.nativeFilePolicies === undefined
      ? {}
      : { nativeFilePolicies: parsed.nativeFilePolicies }),
  };
}

/**
 * THE EXPORT FORMAT AS A MAPPING'S OVERRIDE CARRIES IT: the single format and
 * the per-kind ones as ONE setting (workplan 0042 T9).
 *
 * One setting because a mapping's config is its connection's with this
 * override laid over it KEY BY KEY. Written apart, a migration that chose one
 * format for everything on a reused connection would still carry the per-kind
 * formats the connection's first migration chose, and those win for their
 * kinds: somebody picking PDF for all four would find their decks going out
 * as `.odp`, for a reason no screen of theirs shows. The update route has the
 * same problem one step later: a control offering one format for all four
 * kinds would be contradicted by per-kind formats it cannot show.
 *
 * So whenever the single format is set, the per-kind ones are written too,
 * as `{}` (every kind follows the single one) when none were given. Per-kind
 * formats given without a single one leave the single one as it was, and a
 * kind they do not name still follows it. Neither given writes nothing, which
 * on a reused connection means inherit, as it always has.
 */
export function exportFormatOverride(cfg: ExportFormatAsSent): ExportFormat {
  const format = exportFormatOf(cfg);
  return format.nativeFilePolicy === undefined
    ? format
    : { ...format, nativeFilePolicies: format.nativeFilePolicies ?? {} };
}

interface ExportFormatAsSent {
  readonly nativeFilePolicy?: string | undefined;
  readonly nativeFilePolicies?: Readonly<Record<string, string>> | undefined;
}

interface ExportFormat {
  readonly nativeFilePolicy?: GoogleNativeFilePolicy;
  readonly nativeFilePolicies?: NativeFilePolicies;
}

/**
 * Refuse a Drive setting the CONNECTOR could not read — in the shared parser's
 * own words, for every source type whose files come out of Google Drive.
 *
 * Hard rule 5: a `nativeFilePolicy` the appliance refuses in a mapping file
 * must not be one this door accepts and the connector then ignores. That held
 * for the `google-drive` row from the day the policy existed, and not for the
 * `google` ACCOUNT kind, which gained a chooser on 2026-09-17 — whose file face
 * is the same connector reading the same key.
 *
 * ONE KEY AT A TIME, so the anchor is the box at fault. The block this replaces
 * parsed both settings together and anchored every refusal on
 * `nativeFilePolicy`, so a rejected root folder pointed a form at the wrong
 * field. An empty string still means "unset" at this door, as it always has:
 * the wizard posts neither key when its box is empty, and refusing `''` here
 * would refuse a shape that has been accepted since the field existed.
 */
function refuseUnreadableDriveSettings(
  ctx: IssueSink,
  sourceType: string,
  sourceConfig: DriveSettingsAsSent,
): void {
  if (!carriesGoogleNativeFiles(sourceType)) return;
  if (sourceConfig.rootFolderId) refuseUnreadableKey(ctx, sourceConfig, 'rootFolderId');
  refuseUnreadableExportFormat(ctx, sourceConfig);
}

/**
 * The export format's two keys alone, for the update route (workplan 0042
 * T9), which has no source type in its body to gate on.
 *
 * An unreadable format sent to the update route used to reach
 * `parseGoogleDriveSource` inside the handler, whose throw was answered as a
 * server fault: a 500 saying *we* failed, for a misspelling in the request.
 * Asked here instead, it is a 400 naming the key at fault, in the words the
 * create route and the appliance's mapping file use.
 */
function refuseUnreadableExportFormat(ctx: IssueSink, sourceConfig: DriveSettingsAsSent): void {
  if (sourceConfig.nativeFilePolicy) refuseUnreadableKey(ctx, sourceConfig, 'nativeFilePolicy');
  if (sourceConfig.nativeFilePolicies !== undefined) {
    refuseUnreadableKey(ctx, sourceConfig, 'nativeFilePolicies');
  }
}

type IssueSink = {
  addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void;
};

interface DriveSettingsAsSent {
  readonly rootFolderId?: string | undefined;
  readonly nativeFilePolicy?: string | undefined;
  readonly nativeFilePolicies?: Readonly<Record<string, string>> | undefined;
}

/** One key through the shared parser, its refusal anchored on that key. */
function refuseUnreadableKey(
  ctx: IssueSink,
  sourceConfig: DriveSettingsAsSent,
  key: keyof DriveSettingsAsSent,
): void {
  try {
    parseGoogleDriveSource({ type: 'google-drive', [key]: sourceConfig[key] });
  } catch (err) {
    ctx.addIssue({
      code: 'custom',
      path: ['sourceConfig', key],
      message: err instanceof ConfigError ? err.message : String(err),
    });
  }
}

/**
 * What a stored connection ALREADY KNOWS, keyed the way the FORM keys it
 * (workplan 0078, owner decision 2026-08-18).
 *
 * Rotating a credential presented every field empty, so somebody fixing an
 * expired secret had to retype the server address and the account name that
 * had not changed. The owner asked why, and chose the boundary this function
 * exists inside: prefill from `connection.config` ONLY.
 *
 * That boundary is the whole design. `config` is plain JSONB, written by the
 * builders above, and it holds which server a migration talks to and where it
 * is rooted — never a credential. The encrypted record is not read here at
 * all, so *SECRETS NEVER COME BACK OUT* needs no exception carved into it:
 * everything returned was never secret to begin with.
 *
 * The key names differ, and this is the one place they meet. The builders
 * above write the ENGINE's vocabulary (`user`, `mailbox`); the descriptor and
 * every form speak their own (`username`). Translating in the client would
 * put a second copy of that mapping a long way from the first.
 *
 * The consequence worth stating: providers whose identity lives ENTIRELY in
 * the encrypted record get nothing back. Dropbox stores only `rootPath` in
 * config, so its App key — the field that prompted this — still has to be
 * retyped. That is the cost of the chosen boundary, not an oversight.
 */
export function knownConnectionValues(
  role: 'source' | 'target',
  type: string,
  config: unknown,
): Record<string, string> {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => {
    if (typeof v === 'string' && v !== '') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return undefined;
  };

  // Engine vocabulary → form vocabulary, per what the builders actually write.
  const candidates: Record<string, string | undefined> = {
    host: str(cfg.host),
    port: str(cfg.port),
    username: str(cfg.user) ?? str(cfg.mailbox),
    tenantId: str(cfg.tenantId),
    rootFolderId: str(cfg.rootFolderId),
    rootPath: str(cfg.rootPath),
    userId: str(cfg.userId),
  };

  // Only what this provider asks for, and never a secret one. The descriptor
  // decides both, so a field that becomes secret later stops being returned
  // without anybody having to remember this function exists.
  const out: Record<string, string> = {};
  for (const field of credentialFieldsFor(role, type)) {
    if (field.secret) continue;
    const value = candidates[field.key];
    if (value !== undefined) out[field.key] = value;
  }
  return out;
}

export function targetConnectionConfig(
  body: Pick<z.infer<typeof CreateMappingSchema>, 'targetType' | 'targetConfig'>,
): Record<string, unknown> {
  const cfg = body.targetConfig;
  const base = { host: cfg.host, port: cfg.port, useSsl: cfg.useSsl };
  if (body.targetType === 'jmap') {
    // JmapTarget.baseUrl is the server ROOT — scheme+host+port, NO path: the
    // JMAP clients append /.well-known/jmap themselves (see JmapTarget's doc).
    const scheme = cfg.useSsl ? 'https' : 'http';
    return { ...base, type: 'jmap', baseUrl: `${scheme}://${cfg.host}:${cfg.port}`, user: cfg.username };
  }
  if (body.targetType === 'imap') {
    return { ...base, type: 'imap-dav', user: cfg.username, tls: cfg.useSsl };
  }
  // The DAV-shaped types — the protocol trio and the `soverin` account kind
  // (0106 T4a). `url`, when given, is the full DAV base the endpoint
  // resolver prefers over host+port (0105 T1) — the door for a provider
  // whose DAV root lives behind a path. The account kind alone may also
  // store its MAIL face (T4b): the IMAP host the person typed, which the
  // mail seam resolves into the imap-dav writer — scoped to `soverin` so a
  // protocol row can never grow a face its kind does not carry.
  return {
    ...base,
    ...(cfg.url ? { url: cfg.url } : {}),
    ...(body.targetType === 'soverin' && cfg.mailHost
      ? { mailHost: cfg.mailHost, ...(cfg.mailPort ? { mailPort: cfg.mailPort } : {}) }
      : {}),
  };
}

/**
 * What a mapping overrides on a SHARED connection — only the keys that are
 * this mapping's to answer (workplan 0067, closing 0066 T4d).
 *
 * The split is the one migration 0021 encodes: a connection answers *as whom
 * do we sign in*, a mapping answers *whose data, and where*. `rootFolderId`,
 * `rootPath`, the Box subject and the per-mapping user/mailbox belong to the
 * mapping; the host, port, TLS, tenant and every credential belong to the
 * connection.
 *
 * This started as `sourceConnectionConfig(body)` reused wholesale, recorded as
 * "harmless, a narrower projection would be tidier". It stopped being harmless
 * the moment the wizard stopped ASKING for the connection-level fields when
 * reusing: the full shape would then write `host: undefined` into the override
 * and the key-by-key merge in `loadDomainConnections` would apply it OVER the
 * connection's real host. Storing more than you need is only free while
 * everything keeps filling it in.
 *
 * Undefined values are dropped, so a field the operator left blank means
 * "inherit", never "blank it".
 */
export function sourceConfigOverride(
  body: Pick<z.infer<typeof CreateMappingSchema>, 'sourceType' | 'sourceConfig'>,
): Record<string, unknown> {
  const cfg = body.sourceConfig;
  const keep = (o: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );

  switch (body.sourceType) {
    case 'google-drive':
      return keep({ rootFolderId: cfg.rootFolderId, ...exportFormatOverride(cfg) });
    case 'dropbox':
      return keep({ rootPath: cfg.rootPath });
    case 'box':
      // The CCG subject is per-mapping by ADR-0033, and the superRefine above
      // demands it on the reuse path too — without it this override would be
      // empty and the merge would silently fall back to whoever the shared
      // connection was created for.
      return keep({ userId: cfg.userId, rootFolderId: cfg.rootFolderId });
    case 'archive':
      // WHERE, not which export (0116 T1). A reused archive connection is one
      // person's export series, and the second migration from it points at
      // the NEXT archive — the two-month Takeout the owner will have — so the
      // path is the mapping's to answer. `provider` is not: an archive that
      // changed provider is a different connection, and letting a mapping
      // override it would let one row's export be opened by the other's
      // reader, which reports emptiness rather than failing (0116 §5).
      return keep({ path: cfg.path });
    case 'gmail':
    case 'google-calendar':
    case 'google-contacts':
      return keep({ user: cfg.username });
    case 'google':
      // The ACCOUNT kind splits off from the three single-purpose rows: its
      // file face is Drive, so "what becomes of the Docs" is this mapping's to
      // answer on a shared connection, exactly as `rootFolderId` is for the
      // `google-drive` row above. Without it here, a second migration from a
      // reused account connection would silently inherit the first one's
      // export choice — and a person who picked PDF for their files would have
      // no way to leave them behind next time.
      return keep({ user: cfg.username, ...exportFormatOverride(cfg) });
    case 'graph':
      // The tenant is the app registration's, which the connection holds.
      return keep({ mailbox: cfg.username });
    default:
      // imap and oauth2: the server is the connection's, the mailbox is ours.
      return keep({ user: cfg.username });
  }
}

/**
 * WHICH REVISABLE FIELDS A PATCH BODY PROPOSES (workplan 0125 T3).
 *
 * Exported and pure so the mapping from this route's vocabulary onto the
 * shared rule's can be read and tested without a server — which is the half
 * that goes wrong. The rule itself decides nothing here; it decides in
 * `shared`, where both editions call it.
 *
 * ONLY the fields this route can act on. `name` and `schedule` are permitted
 * by the table and are not collected, because this route does not write them
 * yet: collecting them would put them through a refusal check they pass and
 * change nothing, which reads like support they do not have.
 *
 * A field is proposed when it is PRESENT, not when it differs from what is
 * stored. "May this change at all" is a property of the field, so a body
 * restating the stored value is still asking for a write this route will not
 * make — and comparing first would mean reading the row to decide whether to
 * refuse, which is a second answer to a question the table already answers.
 */
export function proposedRevisions(
  body: Pick<z.infer<typeof UpdateMappingSchema>, 'sourceType' | 'targetType' | 'sourceConfig' | 'targetConfig'>,
): readonly RevisableField[] {
  const proposed: RevisableField[] = [];
  if (body.sourceType !== undefined) proposed.push('source.type');
  if (body.targetType !== undefined) proposed.push('target.type');
  if (body.sourceConfig?.rootFolderId !== undefined) proposed.push('source.rootFolderId');
  if (body.targetConfig?.username !== undefined) proposed.push('target.account');
  return proposed;
}

/** The target half of the same split: the account, never the server. */
export function targetConfigOverride(
  body: Pick<z.infer<typeof CreateMappingSchema>, 'targetType' | 'targetConfig'>,
): Record<string, unknown> {
  const user = body.targetConfig.username;
  return user ? { user } : {};
}

/**
 * The credential record create ENCRYPTS — factored so the connection-test
 * probe (workplan 0046) can run on EXACTLY what would be stored: "test
 * passed, create, first pass fails" must never be caused by the probe testing
 * a different shape than the one saved.
 *
 * What goes in follows the source type (0037 T6): an 'imap' source signs in
 * directly (username + password); 'oauth2'/'graph' carry the per-customer
 * Entra app registration (tenantId doubling as the Graph-fallback signal);
 * the four Google sources carry EXACTLY the keys the STORED_*_NAMES read —
 * the build refuses at build time naming any that are missing.
 */
export function sourceCredentialRecord(
  body: Pick<z.infer<typeof CreateMappingSchema>, 'sourceType' | 'sourceConfig'>,
): Record<string, string> {
  if (body.sourceType === 'imap') {
    return {
      username: body.sourceConfig.username,
      ...(body.sourceConfig.password ? { password: body.sourceConfig.password } : {}),
    };
  }
  if (body.sourceType === 'archive') {
    // EMPTY, and that is this kind's truth rather than a gap (0116 T1). An
    // archive's credential is a LOCATION, and a path is not a password: there
    // is nothing here to encrypt, nothing to mask on the detail route and
    // nothing for a rotation panel to offer. Returned explicitly rather than
    // by falling through, because the catch-all below reads `username` and
    // `password` off the config and an archive has neither — a `{username:
    // undefined}` record would be a credential-shaped nothing that later
    // reads as a broken row instead of an honest one.
    return {};
  }
  if (body.sourceType === 'microsoft') {
    // THE GRANT, and the registration only where the person carries one
    // (0114 T3; the branch itself 2026-09-06). Until today a `microsoft` body
    // fell through to the Azure catch-all at the bottom, whose shape is the
    // customer's OWN registration — tenant, client id, client secret — and
    // which has no `refreshToken` at all. So the token the consent had just
    // handed over was never written: the row stored `{username}`, the
    // deployment's fill later added a client PAIR and no token, and the token
    // provider took the application flow against `common`, which MSAL refuses
    // as `missing_tenant_id_error`. The first live Test read exactly that.
    //
    // The pair and the tenant are copied only when SENT: a row that took the
    // grant button carries the token alone, and the deployment's registration
    // is filled in at build time by `withDeploymentMicrosoftClient` (T1's
    // rule). An empty string stored here would read later as "configured,
    // and wrong" rather than "not set", the same reason the Gmail app-password
    // shape stores alone.
    return {
      refreshToken: body.sourceConfig.refreshToken!,
      ...(body.sourceConfig.clientId ? { clientId: body.sourceConfig.clientId } : {}),
      ...(body.sourceConfig.clientSecret ? { clientSecret: body.sourceConfig.clientSecret } : {}),
      ...(body.sourceConfig.tenantId ? { tenantId: body.sourceConfig.tenantId } : {}),
    };
  }
  if (body.sourceType === 'apple') {
    // An app-specific password over IMAP and DAV (0115), the same two fields
    // an `imap` source signs in with — and the same fall-through as
    // `microsoft` above until 2026-09-06: the catch-all kept the username and
    // dropped the password, so every Apple face was built with nothing to
    // sign in with.
    return {
      username: body.sourceConfig.username,
      ...(body.sourceConfig.password ? { password: body.sourceConfig.password } : {}),
    };
  }
  if (body.sourceType === 'box') {
    // Client id + secret ONLY — no refresh token by DESIGN: Box rotates
    // refresh tokens on every use, and stored credentials are never written
    // back (see the box factory). The subject user id rides the config.
    return {
      clientId: body.sourceConfig.clientId!,
      clientSecret: body.sourceConfig.clientSecret!,
    };
  }
  if (
    body.sourceType === 'google-drive' ||
    body.sourceType === 'gmail' ||
    body.sourceType === 'google-calendar' ||
    body.sourceType === 'google-contacts' ||
    body.sourceType === 'google' ||
    // Dropbox rides the same trio keys; the factory's naming maps them to
    // Dropbox's own words (App key / App secret).
    body.sourceType === 'dropbox'
  ) {
    // Either flow's values (ADR-0033): a service-account key selects
    // domain-wide delegation, and the SUBJECT rides along so the factories
    // impersonate exactly this mapping's account — the drive factory has no
    // user parameter to learn it from otherwise.
    if (body.sourceConfig.serviceAccountKey) {
      return {
        serviceAccountKey: body.sourceConfig.serviceAccountKey,
        subject: body.sourceConfig.username ?? '',
        // The trio may ride along when ALSO provided; harmless, and it keeps
        // a later switch back to per-user tokens from losing them.
        ...(body.sourceConfig.clientId ? { clientId: body.sourceConfig.clientId } : {}),
        ...(body.sourceConfig.clientSecret ? { clientSecret: body.sourceConfig.clientSecret } : {}),
        ...(body.sourceConfig.refreshToken ? { refreshToken: body.sourceConfig.refreshToken } : {}),
      };
    }
    // Gmail's third shape (workplan 0089 T7): a personal account's app password
    // in place of the trio. Stored ALONE — copying absent OAuth fields in as
    // `undefined` would put empty strings on the connection, and a blank
    // clientId reads later as "configured, and wrong" rather than "not set".
    if (body.sourceType === 'gmail' && body.sourceConfig.appPassword?.trim()) {
      return {
        appPassword: body.sourceConfig.appPassword.trim(),
        // The trio rides along when ALSO given, for the reason the DWD branch
        // keeps it: switching back to OAuth later must not lose what was typed.
        ...(body.sourceConfig.clientId ? { clientId: body.sourceConfig.clientId } : {}),
        ...(body.sourceConfig.clientSecret ? { clientSecret: body.sourceConfig.clientSecret } : {}),
        ...(body.sourceConfig.refreshToken ? { refreshToken: body.sourceConfig.refreshToken } : {}),
      };
    }
    return {
      clientId: body.sourceConfig.clientId!,
      clientSecret: body.sourceConfig.clientSecret!,
      refreshToken: body.sourceConfig.refreshToken!,
    };
  }
  return {
    username: body.sourceConfig.username,
    tenantId: body.sourceConfig.tenantId!,
    clientId: body.sourceConfig.clientId!,
    clientSecret: body.sourceConfig.clientSecret!,
  };
}

// The run wire shape and its mapper live in @openmig/ledger (`toRunReport`)
// so the appliance cannot grow a second, slightly different one — see
// RunStore.listRunsWithEvents.

const router = Router();

/**
 * "You already have this migration" — a REFUSAL, not a fault (workplan 0071).
 *
 * Thrown from inside the create transaction so the whole chain rolls back, and
 * caught by the route as a 409 rather than falling into the 500 branch. It
 * carries the existing mapping's id and name as DATA: the client renders the
 * sentence in its own language, and a name is something a person can go and
 * open, where "a mapping already exists" is something they can only stare at.
 */
export class DuplicateMappingError extends Error {
  readonly existingId: string;
  readonly existingName: string | null;
  constructor(
    existingId: string,
    existingName: string | null,
  ) {
    super(
      `A migration between these two accounts already exists${
        existingName ? ` (“${existingName}”)` : ''
      }. Two migrations that copy the same items into the same place would ` +
        `double everything on the target. Give this one a different target ` +
        `folder, or open the existing migration instead.`,
    );
    this.existingId = existingId;
    this.existingName = existingName;
    this.name = 'DuplicateMappingError';
  }
}

router.use('/', operatingRoutes);
router.use('/', googleOauthRoutes);
router.use('/', dropboxOauthRoutes);
// Connect with Microsoft (workplan 0114 T2b), mounted beside the other two.
router.use('/', microsoftOauthRoutes);
router.use('/', linkRoutes);

// Global pool - created once and reused
let _dbPool: ReturnType<typeof getDbPool> | null = null;
function getSharedPool() {
  if (!_dbPool) {
    _dbPool = getDbPool();
  }
  return _dbPool;
}

// Schema validation
/**
 * Exported for the retraction guard (`sync-mode.unit.test.ts`).
 *
 * The mode enum below is the whole of what rows 7 and 8's retraction amounts
 * to in code. Nothing else refuses a withdrawn mode, so nothing else can be
 * asserted against — and a schema nothing tests is one careless widening away
 * from accepting `bidirectional` again in silence.
 */
/** Exported for the credential-descriptor coverage lock (workplan 0063):
 *  a form that collects a field this schema has never heard of stores
 *  nothing, and neither side errors at runtime. */
export const CreateMappingBase = z.object({
  name: z.string().min(1).max(255),
  sourceType: z.enum(['imap', 'oauth2', 'graph', 'microsoft', 'apple', 'google-drive', 'gmail', 'google-calendar', 'google-contacts', 'google', 'dropbox', 'box', 'archive']),
  /**
   * Reuse a connection that already exists instead of creating another
   * (workplan 0064). When set, the credentials and provider config come from
   * that row and the matching `sourceConfig`/`targetConfig` credential fields
   * are no longer demanded — `username` still is, because it names WHICH
   * mailbox this mapping moves, which a shared connection cannot know.
   */
  sourceConnectionId: z.string().uuid().optional(),
  targetConnectionId: z.string().uuid().optional(),
  targetType: z.enum(['jmap', 'imap', 'caldav', 'carddav', 'webdav', 'soverin', 'nextcloud']),
  sourceConfig: z.object({
    // host/port belong to an 'imap' source; tenantId/clientId/clientSecret to
    // 'oauth2'/'graph' (the per-customer Entra app registration — ADR-0006,
    // owner decision 0026 T3 row 14). Which set is REQUIRED depends on
    // sourceType, so the demands live in CreateMappingSchema's superRefine
    // where both fields are visible, not here.
    host: z.string().optional(),
    port: z.number().optional(),
    username: z.string(),
    password: z.string().optional(),
    useSsl: z.boolean().default(true),
    tenantId: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    /** Google Drive only (workplan 0042): the delegated OAuth refresh token. */
    refreshToken: z.string().optional(),
    /** The four Google sources (ADR-0033): a service-account key FILE selects
     *  domain-wide delegation instead of a per-user refresh token. */
    serviceAccountKey: z.string().optional(),
    /** Gmail only (workplan 0089 T7): a personal account's app password, used
     *  in place of the OAuth trio. Optional and never preferred — the factory
     *  reaches it only when no better credential is configured. */
    appPassword: z.string().optional(),
    /** Google Drive or Box: root the migration somewhere other than the account root. */
    rootFolderId: z.string().optional(),
    /** Dropbox only (workplan 0055): root the migration at a folder path. */
    rootPath: z.string().optional(),
    /** Box only (workplan 0056): the NUMERIC user id whose files the CCG token reads. */
    userId: z.string().optional(),
    /**
     * Archive only (workplan 0116 T1): WHICH export this is. Validated
     * against `ARCHIVE_PROVIDERS` in the superRefine rather than as a
     * `z.enum` here, so the refusal can name the list and say where each
     * export is requested — the part of an archive import that actually
     * takes somebody twenty minutes.
     */
    provider: z.string().optional(),
    /** Archive only: WHERE the archive is. Not a secret — a path is not a password. */
    path: z.string().optional(),
    /** Google Drive only: what happens to Docs/Sheets/Slides. The VALUES are
     *  validated by the shared parser in the superRefine, not re-enumerated
     *  here — one authority, both editions. */
    nativeFilePolicy: z.string().optional(),
    /** A format per kind, laid over `nativeFilePolicy` (workplan 0042 T9).
     *  Kinds and formats alike are validated by the shared parser, which
     *  refuses an unknown kind by name rather than ignoring it. */
    nativeFilePolicies: z.record(z.string(), z.string()).optional(),
  }),
  targetConfig: z.object({
    /**
     * WHERE the target is — and which pair of fields says so depends on the
     * TARGET TYPE, the way `sourceConfig`'s does above (2026-09-07). Every
     * target but one is reached at host+port, with `url` as an escape hatch;
     * a Nextcloud is reached at its base URL and nothing else, because its
     * DAV root is always behind `/remote.php/dav`. Demanded here, host+port
     * made a Nextcloud mapping impossible to create at all — so the demand
     * moved to the superRefine, where the type is visible.
     */
    host: z.string().optional(),
    port: z.number().optional(),
    username: z.string(),
    password: z.string(),
    useSsl: z.boolean().default(true),
    /**
     * DAV targets (0105 T1): the full base URL, for a provider whose DAV
     * root is not at the host root. When present it wins over host+port
     * (`davUrl`'s precedence). On a `nextcloud` target it is not an escape
     * hatch but the address, and the superRefine demands it.
     */
    url: z.string().optional(),
    /**
     * The soverin account kind's MAIL face (0106 T4b): the account's IMAP
     * host, typed by the person — never pre-filled from our memory of a
     * provider. Demanded by the superRefine, by name, exactly when the email
     * domain is ticked on a soverin target.
     */
    mailHost: z.string().optional(),
    mailPort: z.number().optional(),
  }),
  syncConfig: z.object({
    domains: z.array(z.enum(DISCOVERY_DOMAINS)).default(['email']),
    schedule: z.string().optional(), // Cron expression
  }).default({ domains: ['email'] }),
  /**
   * Put everything this mapping writes under one folder on the target (owner
   * decision 2026-08-16): absent/empty = MERGE, the default and the product's
   * philosophy; a per-source subfolder (`Gmail`, `O365/mail`) is the opt-in
   * for owners consolidating several sources who want them kept apart.
   * Validated by the shared parser, so the appliance's mapping file and this
   * API refuse the same shapes in the same words.
   */
  targetFolderPrefix: z.string().optional(),
  // The mapping's throttle choice — the appliance's `throttleConfig` shape,
  // refused by the SHARED parser in its words (hard rule 5).
  throttleConfig: z.record(z.string(), z.unknown()).optional(),
  // Mapping-specific fields (for mailbox_mapping table)
  //
  // FOUR of the CHECK constraint's five, and the omission is deliberate.
  // `continuous` (workplan 0117 T1) IS admitted here, since 2026-09-10, and it
  // was the last of the five to be.
  //
  // ADR-0014's amendment made entering the lane an act with a price attached: a
  // continuous path holds a capacity slot for as long as it runs (D6), so the
  // tier does NOT fall the way finishing makes it fall. The condition on
  // opening this door was never a technical one — it was that *somebody
  // entering the lane is told their bill does not stop at cutover*, which is
  // T5's sentence and was the owner's to write. It now exists in two places
  // and both are guarded: `pricing.md`, in the same breath as "finishing lowers
  // your bill", and `lane.why` on the screen that offers the switch.
  //
  // The route does not enforce that telling — a screen does, and a guard
  // asserts the screen still says it. What the route enforces is that the value
  // is reachable at all, which is what makes the lane usable rather than a
  // state nothing can enter.
  status: z.enum(['active', 'paused', 'cutover', 'done', 'continuous']).optional(),
  /**
   * The sync mode. **One value, because one is all the engine implements.**
   *
   * `bidirectional` and `asymmetric` were RETRACTED 2026-08-03 (owner decision,
   * 0026 T3 row 7; SAD §11 carries the note): writing changes back to the
   * source would mean modifying the system being migrated away from.
   *
   * `one_time` went the same way on 2026-08-05, for a different and simpler
   * reason. Tracing consumers for that retraction turned up the fact that
   * **nothing anywhere branches on `mode` at all** — it is written on create,
   * echoed back on read, and never acted upon. So `one_time` was as
   * unimplemented as the two withdrawn modes, minus their hard-rule-2
   * argument: "run once and stop" writes nothing to the source, it simply does
   * not exist. Accepting it told an operator their migration would stop after
   * one pass, and it would have gone on mirroring indefinitely.
   *
   * It is refused rather than silently ignored, and refused as NOT BUILT
   * rather than as withdrawn, because the two are different promises: this one
   * could be built, and the message says so instead of closing the door.
   *
   * All three stay in the DATABASE enum. Existing rows may carry them and hard
   * rule 2 does not delete a customer's data to tidy a type; what changes is
   * that the API no longer pretends to honour a mode it does not implement.
   */
  mode: z
    .enum(['mirror'], {
      message:
        "sync mode must be 'mirror', which is the only mode this engine " +
        'implements. `bidirectional` and `asymmetric` were withdrawn on ' +
        '2026-08-03: writing changes back to the source would mean modifying ' +
        'the system being migrated away from, which this tool does not do — ' +
        'changes made on the target during shadow are surfaced as decisions ' +
        'instead. `one_time` is NOT WITHDRAWN but NOT BUILT: nothing stops a ' +
        'mapping after one pass today, so accepting it would promise a ' +
        'migration that ends when it would in fact keep mirroring.',
    })
    .optional(),
  // §14.1's two patterns are both legal in the LEDGER — `group_def` records
  // that an address IS a distribution list — but only one of them can be a
  // MAPPING (workplan 0027 T3). The appliance refuses the other at startup;
  // refusing it here too is ADR-0026's one contract, and without it a managed
  // tenant could create a mapping that copies nothing and reports success.
  pattern: z
    .enum(['shared_s', 'distribution_d'])
    .refine((p) => p !== 'distribution_d', { message: DISTRIBUTION_D_NOT_A_MAPPING })
    .optional(),
});

/**
 * The cross-field refusals (0037 T4) ride on the base object so
 * UpdateMappingSchema can stay `base.partial()`:
 *
 *  - **target/domain coherence.** The matrix lives in shared
 *    (`TARGET_TYPE_DOMAINS`) because the wizard constrains the same choice
 *    client-side; without this check a `carddav` target + `email` domain
 *    sailed into scope_selection rows the target protocol can never receive,
 *    failing later as sync errors the admin cannot connect to a wizard
 *    choice. The refusal names both sides and renders verbatim.
 *  - **cron schedule.** The schedule was stored verbatim; the tick worker
 *    deliberately logs-and-falls-back to the default 15-minute cadence on an
 *    invalid cron (hard rule 9 — never dead-stop a mapping), which keeps the
 *    mapping syncing but silently ignores the admin's stated cadence. Refuse
 *    garbage here, in front of whoever typed it, and say what the fallback
 *    would have done.
 */
export const CreateMappingSchema = CreateMappingBase.superRefine((body, ctx) => {
  // Reusing a stored connection means the credentials are already on it and
  // already proved: demanding them again would make "pick the Box connection
  // you added last week" impossible without re-pasting its secret, which is
  // the whole point of reuse (workplan 0064). The DOMAIN coherence checks
  // below still run — those are about this mapping, not the credential.
  const reusingSource = Boolean(body.sourceConnectionId);
  // Source-type / credential coherence (0037 T6, owner decision 2026-08-10):
  // an 'imap' source signs in directly and needs a server to sign in TO;
  // 'oauth2' and 'graph' authenticate with the customer's own Entra app
  // registration (client-credentials — ADR-0006's row-14 model), so accepting
  // them without tenantId/clientId/clientSecret would store a connection no
  // sync pass can ever open.
  if (reusingSource) {
    // No CREDENTIAL to demand — the connection carries those. But the fields
    // that say WHOSE data this mapping moves are still ours to demand, and a
    // Box subject is the one with no safe default: with no `userId` the
    // override is empty, the merge falls back to the connection's stored
    // subject, and the migration silently reads whoever that connection was
    // first created for. ADR-0033's one-subject-per-mapping rule is only true
    // if every mapping states its subject (workplan 0067).
    if (body.sourceType === 'box' && !body.sourceConfig.userId) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', 'userId'],
        message:
          'Reusing a Box connection still needs the NUMERIC Box user id of the account ' +
          'this migration moves (userId): the connection says which Box app signs in, ' +
          'not whose files to read. See docs/box-setup.md.',
      });
    }
    // And WHICH archive (0116 T5/T6). A reused archive connection is one
    // person's export series, and each migration points at the next archive
    // in it: the provider is the row's, the path is this mapping's own. With
    // no path the merge falls back to the connection's stored one — the FIRST
    // export, imported again under a new name, and nothing would say so.
    if (body.sourceType === 'archive' && !body.sourceConfig.path) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', 'path'],
        message:
          "Reusing an export archive connection still needs WHERE this migration's archive " +
          'is (path): the connection says which export it reads, and each migration points ' +
          'at one archive — the next one in the series. See docs/archive-setup.md.',
      });
    }
  } else if (body.sourceType === 'google-drive') {
    // A service-account key selects domain-wide delegation (ADR-0033): the
    // refresh-token trio is not required, but a SUBJECT is — the username
    // names the one account this mapping impersonates.
    const dwd = Boolean(body.sourceConfig.serviceAccountKey);
    if (dwd && !body.sourceConfig.username) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', 'username'],
        message:
          'Domain-wide delegation impersonates a NAMED user: sourceConfig.username must be ' +
          "the migrated account's address (ADR-0033 — one subject per mapping, however wide " +
          'the credential).',
      });
    }
    const missing = dwd ? [] : googleCredentialKeysRequired().filter((k) => !body.sourceConfig[k]);
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message: carriesApp('google')
          ? deploymentAppTokenRefusal('google-drive', 'Google', missing)
          : "A 'google-drive' source authenticates with your own Google Cloud OAuth client and a " +
            `delegated refresh token: sourceConfig is missing ${missing.join(', ')}. ` +
            'Where each comes from is docs/google-workspace-setup.md, which ends with one ' +
            'read-only command that proves all three before anything migrates.',
      });
    }
    refuseHalfGoogleClientPair(ctx, body.sourceConfig);
    const sourceRefusal = sourceDomainRefusal('google-drive', body.syncConfig.domains);
    if (sourceRefusal) {
      ctx.addIssue({ code: 'custom', path: ['syncConfig', 'domains'], message: sourceRefusal });
    }
    refuseUnreadableDriveSettings(ctx, 'google-drive', body.sourceConfig);
  } else if (
    body.sourceType === 'google-calendar' ||
    body.sourceType === 'google-contacts' ||
    body.sourceType === 'google'
  ) {
    // The Drive/Gmail credential shape again (workplan 0045): a Google OAuth
    // client and a refresh token — consented per product. The scope each
    // token must carry is in the refusal, because "which consent is this"
    // is the mistake waiting to happen with four Google sources sharing one
    // OAuth client.
    // The ACCOUNT asks for the scopes of the faces it was TICKED for, so its
    // refusal names them all rather than one — the same string
    // `POST /google/authorize` builds, from the same table, because "which
    // consent is this" is the mistake waiting to happen with several Google
    // sources sharing one OAuth client.
    const scope =
      body.sourceType === 'google'
        ? googleAccountScopeSentence(body.syncConfig.domains)
        : body.sourceType === 'google-calendar'
          ? 'https://www.googleapis.com/auth/calendar'
          : 'https://www.googleapis.com/auth/carddav';
    // A service-account key selects domain-wide delegation (ADR-0033); the
    // subject is the username these sources already require.
    const missing = body.sourceConfig.serviceAccountKey
      ? []
      : googleCredentialKeysRequired().filter((k) => !body.sourceConfig[k]);
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message: carriesApp('google')
          ? deploymentAppTokenRefusal(body.sourceType, 'Google', missing, scope)
          : `A '${body.sourceType}' source authenticates with your own Google Cloud OAuth client ` +
            `and a refresh token consented with the ${scope} scope: sourceConfig is missing ` +
            `${missing.join(', ')}. Where each comes from is docs/google-workspace-setup.md.`,
      });
    }
    // The ACCOUNT's ceiling is THIS DEPLOYMENT'S, not the product's (ADR-0041,
    // owner decision 2026-09-01): an installation whose own Google application
    // carries the restricted scopes may tick mail and files. Passed rather
    // than read inside, because the same function runs in a browser where
    // `process.env` does not exist — the wizard gets the same list from
    // `GET /api/provider-accounts`. The single-purpose kinds take no argument
    // and are unaffected: a Gmail credential reads mail whoever deployed it.
    refuseHalfGoogleClientPair(ctx, body.sourceConfig);
    const sourceRefusal = sourceDomainRefusal(
      body.sourceType,
      body.syncConfig.domains,
      providerAccountDomains('google'),
    );
    if (sourceRefusal) {
      ctx.addIssue({ code: 'custom', path: ['syncConfig', 'domains'], message: sourceRefusal });
    }
    // An export policy is refused in the SAME words here as on the
    // `google-drive` row (hard rule 5), because from 2026-09-17 the account
    // kind can carry one: its file face is the Drive connector, and a value
    // this door accepted and the connector then ignored would leave somebody's
    // Docs behind for a reason nobody could find.
    refuseUnreadableDriveSettings(ctx, body.sourceType, body.sourceConfig);
  } else if (body.sourceType === 'microsoft') {
    // The Microsoft ACCOUNT (workplan 0114). Named here rather than left to
    // the Azure catch-all below, and that distinction is the whole point of
    // the kind: `oauth2` and `graph` demand tenantId + clientId + clientSecret
    // because they ARE the customer's own app registration. This row is a
    // delegated grant — the deployment may carry the application, the tenant
    // is optional, and a client secret is not required at all when the
    // deployment's pair answers.
    //
    // `scripts/a-source-type-the-validator-never-names.unit.test.ts` is what
    // makes the omission impossible: everything the API accepts must be named
    // here or written down as a deliberate member of the Azure set.
    const missing = (
      microsoftDeploymentClient() === null
        ? (['clientId', 'clientSecret', 'refreshToken'] as const)
        : (['refreshToken'] as const)
    ).filter((k) => !body.sourceConfig[k]);
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message:
          "A 'microsoft' source authenticates with a delegated refresh token from a Microsoft " +
          `consent: sourceConfig is missing ${missing.join(', ')}. ` +
          (microsoftDeploymentClient() === null
            ? 'This deployment carries no Microsoft app registration of its own, so the ' +
              'Application (client) ID and client secret travel with the request. Where each ' +
              'comes from is docs/microsoft-setup.md.'
            : "This deployment carries its own app registration, so only the token is needed — " +
              'press Connect with Microsoft, or paste one you already have.'),
      });
    }
    // Half a pair is refused rather than completed with the deployment's other
    // half, at this door as at every other (ADR-0041). The client id somebody
    // typed does not belong to the deployment's secret, and Entra would refuse
    // the pair at its token endpoint — hours later, from a sync pass.
    const halfPair = halfMicrosoftClientPairProblem(body.sourceConfig);
    if (halfPair) {
      ctx.addIssue({ code: 'custom', path: ['sourceConfig', 'clientSecret'], message: halfPair });
    }
    const microsoftRefusal = sourceDomainRefusal(
      body.sourceType,
      body.syncConfig.domains,
      providerAccountDomains('microsoft'),
    );
    if (microsoftRefusal) {
      ctx.addIssue({ code: 'custom', path: ['syncConfig', 'domains'], message: microsoftRefusal });
    }
  } else if (body.sourceType === 'apple') {
    // The Apple ACCOUNT (workplan 0115). Named here for the same reason
    // `microsoft` is, and with more at stake: left to the Azure catch-all
    // below, an Apple row would be refused for a MISSING TENANT ID AND CLIENT
    // SECRET — three values that do not exist for this provider, demanded of
    // somebody whose whole credential is an address and an app-specific
    // password. `a-source-type-the-validator-never-names` is what turned that
    // into a failing test instead of a support ticket.
    //
    // There is no client pair to half-refuse and no deployment application to
    // fall back on, because Apple publishes no OAuth scope for its own Mail,
    // Calendar, Contacts, Reminders or Drive to anybody outside Apple. Two
    // fields, both required, and the refusal says which page makes the second
    // one — a person who types their Apple Account password here is told by
    // Apple only that the password is wrong, which it is not.
    const missing = (['username', 'password'] as const).filter((k) => !body.sourceConfig[k]);
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message:
          "An 'apple' source authenticates with an app-specific password over IMAP, CalDAV " +
          `and CardDAV: sourceConfig is missing ${missing.join(', ')}. Apple refuses an Apple ` +
          'Account password on these protocols by design, because every Apple Account has ' +
          'two-factor authentication. Make an app-specific password at account.apple.com ' +
          '(Sign-In and Security → App-Specific Passwords) — docs/apple-setup.md walks it.',
      });
    }
    const appleRefusal = sourceDomainRefusal(
      body.sourceType,
      body.syncConfig.domains,
      providerAccountDomains('apple'),
    );
    if (appleRefusal) {
      ctx.addIssue({ code: 'custom', path: ['syncConfig', 'domains'], message: appleRefusal });
    }
  } else if (body.sourceType === 'dropbox') {
    // Dropbox's App Console calls these "App key" and "App secret"; they ride
    // the shared trio fields so the probe and create post one shape. The pair
    // is demanded only where this deployment carries no Dropbox app of its own
    // (2026-09-02: Connect with Dropbox) — the same rule as Google's trio.
    const missing = (
      dropboxDeploymentClient() === null
        ? (['clientId', 'clientSecret', 'refreshToken'] as const)
        : (['refreshToken'] as const)
    ).filter((k) => !body.sourceConfig[k]);
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message: carriesApp('dropbox')
          ? deploymentAppTokenRefusal('dropbox', 'Dropbox', missing)
          : "A 'dropbox' source authenticates with your own Dropbox app (App key as clientId, " +
            `App secret as clientSecret) and a refresh token: sourceConfig is missing ` +
            `${missing.join(', ')}. Where each comes from is docs/dropbox-setup.md.`,
      });
    }
    refuseHalfDropboxClientPair(ctx, body.sourceConfig);
    const sourceRefusal = sourceDomainRefusal('dropbox', body.syncConfig.domains);
    if (sourceRefusal) {
      ctx.addIssue({ code: 'custom', path: ['syncConfig', 'domains'], message: sourceRefusal });
    }
  } else if (body.sourceType === 'archive') {
    // THE EXPORT ARCHIVE (workplan 0116 T1), named here rather than left to
    // the Azure catch-all — which would refuse it for a missing tenant id,
    // client id and client secret, three values that have no meaning for a
    // folder on a disk. `a-source-type-the-validator-never-names` is what
    // turns that into a failing test rather than a support ticket.
    //
    // Two required fields and no credential at all. That is the kind's whole
    // shape: a gatekeeper's answer to a portability request is a file, so
    // there is nothing to sign in as and nothing to encrypt.
    const missing = (['provider', 'path'] as const).filter((k) => !body.sourceConfig[k]);
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message:
          "An 'archive' source is an EXPORT you already downloaded, not an account: " +
          `sourceConfig is missing ${missing.join(', ')}. \`provider\` says which export ` +
          `(${ARCHIVE_PROVIDERS.join(' or ')}) and \`path\` says where it is. ` +
          'docs/archive-setup.md walks requesting each one.',
      });
    }
    // The provider is validated against the list BY NAME, because getting it
    // wrong does not fail: the wrong reader finds none of its own landmarks
    // and reports an archive containing nothing. "Your export is empty" is
    // the most alarming thing this product could say to somebody who waited a
    // week for a 25 GB download, and the least actionable.
    if (body.sourceConfig.provider && !isArchiveProvider(body.sourceConfig.provider)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', 'provider'],
        message:
          `'${body.sourceConfig.provider}' is not an export this product can read. ` +
          `Expected ${ARCHIVE_PROVIDERS.join(' or ')} — the provider is what SELECTS the ` +
          'reader, so the wrong one does not fail, it reports an archive containing nothing. ' +
          Object.entries(ARCHIVE_PROVIDER_ORIGINS)
            .map(([id, url]) => `${archiveProviderName(id)} exports are requested at ${url}`)
            .join('; ') + '.',
      });
    }
    const archiveRefusal = sourceDomainRefusal('archive', body.syncConfig.domains);
    if (archiveRefusal) {
      ctx.addIssue({ code: 'custom', path: ['syncConfig', 'domains'], message: archiveRefusal });
    }
  } else if (body.sourceType === 'box') {
    // No refreshToken demanded, by DESIGN: Box rotates refresh tokens on
    // every use, so the Client Credentials Grant is used and the subject
    // user id names whose files the token reads (one subject per mapping).
    const missing = (['clientId', 'clientSecret', 'userId'] as const).filter(
      (k) => !body.sourceConfig[k],
    );
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message:
          "A 'box' source authenticates with your own Box platform app via the Client " +
          `Credentials Grant (client id + client secret) and needs the NUMERIC Box user id ` +
          `of the account being migrated as userId: sourceConfig is missing ` +
          `${missing.join(', ')}. Where each comes from is docs/box-setup.md.`,
      });
    }
    const sourceRefusal = sourceDomainRefusal('box', body.syncConfig.domains);
    if (sourceRefusal) {
      ctx.addIssue({ code: 'custom', path: ['syncConfig', 'domains'], message: sourceRefusal });
    }
  } else if (body.sourceType === 'gmail') {
    // The same three fields as Drive — a Google OAuth client and a delegated
    // refresh token — but the CONSENT differs: the token must be minted with
    // the https://mail.google.com/ scope (the only one Google's IMAP endpoint
    // accepts), and a Drive-consented token answers invalid_scope. Refused
    // here so the mistake surfaces in front of whoever pasted the token, not
    // as a mid-pass auth failure.
    // A third accepted shape since workplan 0089 T7: a PERSONAL account's app
    // password, in place of the trio. Listed here as an alternative rather than
    // preferred anywhere — the factory reaches it only when nothing better is
    // configured, so accepting it costs no precedence.
    const missing =
      body.sourceConfig.serviceAccountKey || body.sourceConfig.appPassword?.trim()
        ? []
        : googleCredentialKeysRequired().filter((k) => !body.sourceConfig[k]);
    if (missing.length > 0) {
      const googleApp = carriesApp('google');
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message:
          (googleApp
            ? deploymentAppTokenRefusal('gmail', 'Google', missing, 'https://mail.google.com/') +
              ' '
            : "A 'gmail' source authenticates with your own Google Cloud OAuth client and a " +
              `refresh token consented with the https://mail.google.com/ scope: sourceConfig is ` +
              `missing ${missing.join(', ')}. Where each comes from is ` +
              'docs/google-workspace-setup.md. ') +
          `A PERSONAL Google account may send appPassword instead${
            googleApp ? '' : ' of all three'
          } — Google recommends against it, it needs 2-step verification on the account, and ` +
          'it does not exist on a Workspace account.',
      });
    }
    refuseHalfGoogleClientPair(ctx, body.sourceConfig);
    const sourceRefusal = sourceDomainRefusal('gmail', body.syncConfig.domains);
    if (sourceRefusal) {
      ctx.addIssue({ code: 'custom', path: ['syncConfig', 'domains'], message: sourceRefusal });
    }
  } else if (body.sourceType === 'imap') {
    const missing = (['host', 'port'] as const).filter((k) => body.sourceConfig[k] === undefined);
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message: `An 'imap' source connects to a server: sourceConfig is missing ${missing.join(' and ')}.`,
      });
    }
  } else {
    const missing = (['tenantId', 'clientId', 'clientSecret'] as const).filter(
      (k) => !body.sourceConfig[k],
    );
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig', missing[0]!],
        message:
          `A '${body.sourceType}' source authenticates with your own Entra app registration ` +
          `(the client-credentials flow): sourceConfig is missing ${missing.join(', ')}. ` +
          'Register the app in your own tenant and grant admin consent — see docs/o365-setup.md.',
      });
    }
  }
  if (body.targetFolderPrefix !== undefined) {
    try {
      parseTargetFolderPrefix(body.targetFolderPrefix);
    } catch (err) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetFolderPrefix'],
        message: err instanceof ConfigError ? err.message : String(err),
      });
    }
  }
  if (body.throttleConfig !== undefined) {
    // The appliance's parser, verbatim (hard rule 5): a garbage field is
    // refused here in the same words a mapping file gets.
    try {
      parseThrottleConfig(body.throttleConfig);
    } catch (err) {
      ctx.addIssue({
        code: 'custom',
        path: ['throttleConfig'],
        message: err instanceof ConfigError ? err.message : String(err),
      });
    }
  }
  // WHERE the target is, demanded per type (2026-09-07). `nextcloud` is the
  // one target whose address is a URL: host and port cannot be right for it,
  // so its door does not ask for them and this must not either. Every other
  // type is still refused without a server to reach — the check moved, it
  // did not weaken. A reused connection carries its own address, as ever.
  if (!body.targetConnectionId) {
    if (body.targetType === 'nextcloud') {
      if (!body.targetConfig.url?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['targetConfig', 'url'],
          message:
            'A Nextcloud target is reached at its DAV base URL, which is missing ' +
            '(targetConfig.url). It is the address in your browser with /remote.php/dav ' +
            'on the end, such as https://cloud.example.com/remote.php/dav — a host and ' +
            'port cannot express it, which is why this target does not ask for them.',
        });
      }
    } else {
      if (!body.targetConfig.host?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['targetConfig', 'host'],
          message:
            `A ${body.targetType} target needs the server to sign in to: ` +
            'targetConfig.host is missing.',
        });
      }
      if (body.targetConfig.port === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['targetConfig', 'port'],
          message:
            `A ${body.targetType} target needs the port to reach that server on: ` +
            'targetConfig.port is missing.',
        });
      }
    }
  }
  const domainRefusal = targetDomainRefusal(body.targetType, body.syncConfig.domains);
  if (domainRefusal) {
    ctx.addIssue({ code: 'custom', path: ['syncConfig', 'domains'], message: domainRefusal });
  }
  // The soverin account kind carries mail only through a mail server the
  // person NAMED (0106 T4b — never guessed from the provider's name). A
  // reused connection is exempt here because its stored config may already
  // carry the host; the mail seam refuses at build time with the same field
  // name if it does not.
  if (
    body.targetType === 'soverin' &&
    body.syncConfig.domains.includes('email') &&
    !body.targetConnectionId &&
    !body.targetConfig.mailHost?.trim()
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['targetConfig', 'mailHost'],
      message:
        "A soverin target carries email only when the account's mail server is stored: " +
        'targetConfig.mailHost is missing. Enter the IMAP host your provider names (the ' +
        'account settings page lists it) — or drop the email data type; calendars and ' +
        'contacts need no mail server.',
    });
  }
  if (body.syncConfig.schedule !== undefined) {
    const cronProblem = describeCronScheduleProblem(body.syncConfig.schedule);
    if (cronProblem) {
      ctx.addIssue({
        code: 'custom',
        path: ['syncConfig', 'schedule'],
        message:
          `The sync schedule is not a valid cron expression: ${cronProblem}. ` +
          'The scheduler could not evaluate it and would fall back to syncing every ' +
          '15 minutes, silently ignoring the cadence you stated — so it is refused here instead.',
      });
    }
  }
});

/** Exported for the retraction guard too: the update path must refuse the
 *  withdrawn modes with the same words as create (sync-mode.unit.test.ts).
 *  Built from the BASE object because zod refuses .partial() on a schema
 *  carrying cross-field refinements — and the coherence checks read fields a
 *  partial body may legitimately omit. */
/**
 * AND PARTIAL ALL THE WAY DOWN, which `.partial()` alone is not (0125 T3).
 *
 * `.partial()` is SHALLOW: it made `sourceConfig` optional and left the object
 * inside it exactly as strict as create's, where `username` is required. So
 * the only `sourceConfig` this route would accept was one carrying the account
 * name — a field a revision never means to send, and one this route would
 * refuse to act on if it did.
 *
 * That shut the door in front of everything #1004 built. A body proposing only
 * an export policy was answered `400 Validation error: sourceConfig.username`,
 * and a body proposing a new root folder got the same — so the refusal written
 * to say *"items already copied would sit outside the new folder"* could not be
 * reached through the route it guards. Hard rule 9 twice over: the caller is
 * told the wrong reason, and a refusal that never fires cannot be trusted to
 * fire.
 *
 * Widening what PARSES is not widening what is WRITTEN. The handler writes
 * status, mode, pattern and the export policy; every other field goes through
 * `mayRevise` first, which is the point of the table. The comment above says
 * "a partial body may legitimately omit" fields — this makes that true of the
 * nested objects too, which is what it always meant.
 *
 * `syncConfig` is deliberately left alone: this route does not write a schedule
 * yet, and loosening a shape nothing reads would be a change with no caller.
 */
export const UpdateMappingSchema = CreateMappingBase.partial()
  .extend({
    sourceConfig: CreateMappingBase.shape.sourceConfig.partial().optional(),
    targetConfig: CreateMappingBase.shape.targetConfig.partial().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.sourceConfig) refuseUnreadableExportFormat(ctx, body.sourceConfig);
  });

/**
 * Prove a connection before creating anything (workplan 0046).
 *
 * One side per call — the wizard collects the source and target on different
 * steps and tests them as they are completed. The probe runs on EXACTLY the
 * shapes create would store (`sourceConnectionConfig` + the credential record
 * that would be encrypted), interpreted by the same builders a sync pass
 * uses, so a passed test cannot diverge from what was saved.
 */
const TestConnectionSchema = z.object({
  side: z.enum(['source', 'target']),
  sourceType: CreateMappingBase.shape.sourceType.optional(),
  sourceConfig: CreateMappingBase.shape.sourceConfig.optional(),
  targetType: CreateMappingBase.shape.targetType.optional(),
  targetConfig: CreateMappingBase.shape.targetConfig.optional(),
});

/**
 * The shared drives a Google credential can see (workplan 0049): the wizard's
 * "browse" behind the rootFolderId field, so a shared-drive migration does not
 * require pasting an id out of the admin console. Read-only (`drives.list`),
 * and the credentials travel in the request exactly as test-connection's do —
 * nothing is stored.
 */
/**
 * The Google browse's shape (ADR-0041): the pair is optional as a WHOLE,
 * because the deployment may carry it — `resolveGoogleClient` decides, in
 * the order the consent route uses. `.min(1)` on the optional halves so an
 * empty string is refused rather than read as "the deployment's".
 */
const GoogleBrowseSchema = z.object({
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  refreshToken: z.string().min(1),
});

/**
 * Dropbox's browse, the same rule against its own application (2026-09-02:
 * Connect with Dropbox): the same three names, the pair optional as a whole,
 * and `resolveDropboxClient` — never Google's resolver — supplying the
 * deployment's App key and secret where none were sent. Until then the
 * wizard's folder browse stayed dead behind two fields the fold had taken.
 */
const DropboxBrowseSchema = GoogleBrowseSchema;

/** The refusal for a body the Dropbox browse cannot read. */
const DROPBOX_BROWSE_BODY_REFUSAL = {
  error: 'invalid_body',
  reason:
    'Send { refreshToken } and, unless this deployment carries its own Dropbox app, ' +
    '{ clientId, clientSecret } — the App key and App secret, under the same keys the ' +
    'Dropbox source stores.',
} as const;

/** The refusal for a body the Google browse cannot read. */
const GOOGLE_BROWSE_BODY_REFUSAL = {
  error: 'invalid_body',
  reason:
    'Send { refreshToken } and, unless this deployment carries its own Google client, ' +
    '{ clientId, clientSecret } — the values the Drive source stores.',
} as const;

router.post(
  '/google-drive/shared-drives',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = GoogleBrowseSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json(GOOGLE_BROWSE_BODY_REFUSAL);
      }
      const client = resolveGoogleClient(parsed.data);
      if (!client.ok) {
        return void res.status(400).json({ error: client.error, reason: client.reason });
      }
      res.json(
        await listGoogleSharedDrives({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          refreshToken: parsed.data.refreshToken,
        }),
      );
    } catch (error) {
      serverFault(res, 'listing_failed', 'listing the shared drives', error);
    }
  },
);

// The other half of the browse (workplan 0051): folders other accounts
// shared with this credential — each migratable by rooting a mapping at its
// id. Same credentials, same read-only posture as shared-drives above.
router.post(
  '/google-drive/shared-folders',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = GoogleBrowseSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json(GOOGLE_BROWSE_BODY_REFUSAL);
      }
      const client = resolveGoogleClient(parsed.data);
      if (!client.ok) {
        return void res.status(400).json({ error: client.error, reason: client.reason });
      }
      res.json(
        await listGoogleSharedFolders({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          refreshToken: parsed.data.refreshToken,
        }),
      );
    } catch (error) {
      serverFault(res, 'listing_failed', 'listing the shared folders', error);
    }
  },
);

// Dropbox's turn at the same browse (workplan 0055 follow-up): the shared
// folders this credential can see. A MOUNTED folder's path is what goes in
// rootPath; an unmounted one is shown so the owner knows it exists —
// mounting happens in Dropbox itself, never here. The trio keys are the
// shared OAuth shape; Dropbox's App Console words for the first two are
// "App key" and "App secret". Needs the `sharing.read` scope beside the
// files scopes — an app created without it gets Dropbox's refusal verbatim.
router.post(
  '/dropbox/shared-folders',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = DropboxBrowseSchema.safeParse(req.body);
      if (!parsed.success) {
        return void res.status(400).json(DROPBOX_BROWSE_BODY_REFUSAL);
      }
      const client = resolveDropboxClient(parsed.data);
      if (!client.ok) {
        return void res.status(400).json({ error: client.error, reason: client.reason });
      }
      res.json(
        await listDropboxSharedFolders({
          clientId: client.clientId,
          clientSecret: client.clientSecret,
          refreshToken: parsed.data.refreshToken,
        }),
      );
    } catch (error) {
      serverFault(res, 'listing_failed', 'listing the Dropbox shared folders', error);
    }
  },
);

router.post('/test-connection', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = TestConnectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({
        error: 'invalid_body',
        reason: parsed.error.issues.map((i) => i.message).join(' '),
      });
    }
    const body = parsed.data;
    if (body.side === 'source') {
      if (!body.sourceType || !body.sourceConfig) {
        return void res.status(400).json({
          error: 'invalid_body',
          reason: 'Testing the source needs sourceType and sourceConfig.',
        });
      }
      const half = { sourceType: body.sourceType, sourceConfig: body.sourceConfig };
      const result = await probeSourceConnection(
        sourceKindFor(body.sourceType),
        sourceConnectionConfig(half),
        sourceCredentialRecord(half),
      );
      return void res.json(result);
    }
    if (!body.targetType || !body.targetConfig) {
      return void res.status(400).json({
        error: 'invalid_body',
        reason: 'Testing the target needs targetType and targetConfig.',
      });
    }
    const result = await probeTargetConnection(
      body.targetType,
      targetConnectionConfig({ targetType: body.targetType, targetConfig: body.targetConfig }),
      { username: body.targetConfig.username, password: body.targetConfig.password },
    );
    return void res.json(result);
  } catch (error) {
    // Provider-side failures are ANSWERS ({ok:false, reason}) from the probe;
    // only a genuine coding error lands here.
    serverFault(res, 'probe_failed', 'testing this connection', error);
  }
});

const TriggerSyncSchema = z.object({
  type: z.enum(['full', 'delta']).optional(),
  mode: z.string().optional(), // Accept legacy 'mode' field for tests
  // `true` for every domain the pass runs, or a list to pick which — "the
  // tasks came out wrong, do those again" without re-reading the mailbox.
  forceFullScan: z
    .union([z.boolean(), z.array(z.enum(['file', 'email', 'calendar', 'contact', 'task']))])
    .default(false),
}).passthrough(); // Allow additional fields

// No gracePeriodHours: the cutover task prepares and verifies, then stops at
// READY_FOR_CUTOVER for operator approval. It does not execute the cutover and
// does not start a grace period, so accepting a grace-period setting here would
// be accepting a knob that turns nothing.
const TriggerCutoverSchema = z.object({
  skipFinalSync: z.boolean().default(false),
  skipVerification: z.boolean().default(false),
  pattern: z.string().optional(), // Accept legacy 'pattern' field for tests
}).passthrough(); // Allow additional fields

/**
 * GET /api/mappings
 * 
 * List all mappings for the current tenant
 */
router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;

    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }

    const pool = getSharedPool();

    // One tenant-scoped read for everything the list needs. The old mapper
    // hardcoded sourceType 'imap' / targetType 'jmap' (misreporting the
    // wizard's choices), sent tenant_id in snake case, and omitted the domains
    // and lastSyncAt entirely — the client schema could never parse a single
    // row (0033 T1). The real kinds live on the connection rows, reached via
    // each mapping's mailboxes; domains live in scope_selection; lastSyncAt is
    // the newest domain completion, same definition as GET /:mappingId.
    const { mappings, mailboxes, connections, scopeRows, statusRows } = await withTenantDb(
      tenantId,
      pool,
      async (db) => {
        const mappings = await db
          .select()
          .from(schema.mailboxMapping)
          .where(eq(schema.mailboxMapping.tenantId, tenantId));
        if (mappings.length === 0) {
          return { mappings, mailboxes: [], connections: [], scopeRows: [], statusRows: [] };
        }
        const [mailboxes, connections, scopeRows, statusRows] = await Promise.all([
          db
            .select({ id: schema.mailbox.id, connectionId: schema.mailbox.connectionId })
            .from(schema.mailbox)
            .where(eq(schema.mailbox.tenantId, tenantId)),
          db
            .select({ id: schema.connection.id, kind: schema.connection.kind })
            .from(schema.connection)
            .where(eq(schema.connection.tenantId, tenantId)),
          db
            .select({
              mappingId: schema.scopeSelection.mappingId,
              domain: schema.scopeSelection.domain,
            })
            .from(schema.scopeSelection)
            .where(
              and(
                eq(schema.scopeSelection.tenantId, tenantId),
                eq(schema.scopeSelection.included, true),
              ),
            )
            .orderBy(schema.scopeSelection.domain),
          db
            .select({
              mappingId: schema.migrationStatus.mappingId,
              completedAt: schema.migrationStatus.completedAt,
            })
            .from(schema.migrationStatus)
            .where(eq(schema.migrationStatus.tenantId, tenantId)),
        ]);
        return { mappings, mailboxes, connections, scopeRows, statusRows };
      },
    );

    const kindByConnection = new Map(connections.map((c) => [c.id, c.kind]));
    const kindByMailbox = new Map(
      mailboxes.map((mb) => [mb.id, kindByConnection.get(mb.connectionId)]),
    );
    const domainsByMapping = new Map<string, string[]>();
    for (const row of scopeRows) {
      const list = domainsByMapping.get(row.mappingId) ?? [];
      list.push(row.domain);
      domainsByMapping.set(row.mappingId, list);
    }
    const lastSyncByMapping = new Map<string, string>();
    for (const row of statusRows) {
      if (!row.completedAt) continue;
      const iso = row.completedAt.toISOString();
      const prev = lastSyncByMapping.get(row.mappingId);
      if (!prev || iso > prev) lastSyncByMapping.set(row.mappingId, iso);
    }

    res.json({
      mappings: mappings.map((m) => ({
        id: m.id,
        tenantId,
        name: m.name ?? m.mode, // real name (falls back to mode for legacy rows)
        sourceType: kindByMailbox.get(m.sourceMailboxId) ?? 'unknown',
        // targetMailboxId is nullable in the schema (a mapping can exist
        // before its target mailbox does) — that is one honest 'unknown'.
        targetType:
          (m.targetMailboxId ? kindByMailbox.get(m.targetMailboxId) : undefined) ?? 'unknown',
        status: m.status,
        mode: m.mode,
        pattern: m.pattern,
        domains: domainsByMapping.get(m.id) ?? [],
        lastSyncAt: lastSyncByMapping.get(m.id),
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
    });
  } catch (error) {
    serverFault(res, 'list_failed', 'listing your migrations', error);
  }
});

/**
 * POST /api/mappings
 * 
 * Create a new migration mapping
 */
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tenantId } = req;
    const body = CreateMappingSchema.parse(req.body);

    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }

    // Persist the full chain in one tenant-scoped transaction (RLS-enforced):
    // source + target connection (with ENCRYPTED credentials), a mailbox per
    // connection, the mailbox_mapping, and one scope_selection row per domain.
    const created = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      // Never store plaintext secrets — encrypt via SecretStore. secret_ref is a
      // text column read back by decryptCredentials(string) → parseEncryptedSecret,
      // which expects the inner EncryptedSecret ({v,n,t,c}) JSON, so store `.encrypted`.
      // What gets encrypted follows the source type (0037 T6): an 'imap'
      // source signs in directly (username + password); 'oauth2'/'graph'
      // carry the per-customer Entra app registration — tenantId/clientId/
      // clientSecret are exactly the keys build-deps-from-mapping.ts reads
      // (tenantId doubling as the Graph-fallback signal for the IMAP path).
      // The superRefine above guarantees the registration fields are present.
      const sourceSecret = JSON.stringify(
        SecretStore.encryptCredentials(sourceCredentialRecord(body)).encrypted,
      );
      const targetSecret = JSON.stringify(
        SecretStore.encryptCredentials({
          username: body.targetConfig.username,
          password: body.targetConfig.password,
        }).encrypted,
      );

      /**
       * Reuse a stored connection, or make one (workplan 0064).
       *
       * Reuse is checked against THIS tenant and the right role before it is
       * trusted: an id is a client-supplied value, and a mapping pointed at
       * another tenant's connection would read their mail. A mismatch is a
       * refusal naming what was wrong, not a silent fall back to creating a
       * new row — that would quietly store the credentials the caller was
       * trying not to re-send.
       */
      const reuseConnection = async (
        id: string,
        role: 'source' | 'target',
        wantKind: string,
      ): Promise<{ id: string; qualification: unknown }> => {
        const rows = await db
          .select({
            id: schema.connection.id,
            role: schema.connection.role,
            kind: schema.connection.kind,
            qualification: schema.connection.qualification,
          })
          .from(schema.connection)
          .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId)));
        const found = rows[0];
        if (!found) {
          throw new ConfigError(`No connection ${id} belongs to this tenant.`);
        }
        if (found.role !== role) {
          throw new ConfigError(
            `Connection ${id} is a ${found.role}, so it cannot be used as the ${role}.`,
          );
        }
        // The KIND has to match too (workplan 0068). The wizard's picker only
        // offers connections of the selected type, so this looked unreachable —
        // but the selected type can CHANGE after a connection is picked, and
        // the id rode along. A Box connection accepted for a Dropbox mapping
        // would then be handed to the Dropbox factory, which would fail at the
        // first request with a credential-shaped error rather than a refusal
        // anybody could act on. The client now clears the id on a provider
        // switch; this is the half that does not depend on the client.
        if (found.kind !== wantKind) {
          throw new ConfigError(
            `Connection ${id} is a '${found.kind}' connection, so it cannot be used for a ` +
              `'${wantKind}' ${role}. Pick a ${wantKind} connection, or enter new credentials.`,
          );
        }
        return { id: found.id, qualification: found.qualification };
      };

      const sourceConn = body.sourceConnectionId
        ? await reuseConnection(body.sourceConnectionId, 'source', sourceKindFor(body.sourceType))
        : firstOrThrow(
            await db
              .insert(schema.connection)
              .values({
                tenantId,
                role: 'source',
                kind: sourceKindFor(body.sourceType),
                displayName: `${body.name} (source)`,
                config: sourceConnectionConfig(body),
                secretRef: sourceSecret,
              })
              .returning({ id: schema.connection.id }),
            'source connection',
          );

      const targetConn = body.targetConnectionId
        ? await (async () => {
            const reused = await reuseConnection(body.targetConnectionId!, 'target', body.targetType);
            // What the account itself MEASURED constrains what a mapping may
            // ask of it (0106 T3a) — the shared gate, so the wizard's marking
            // and this refusal are one sentence. Only a well-formed measured
            // 'no' refuses; unknown and absent records never do (the
            // three-state rule): the static matrix above stays the ceiling,
            // this reads the account's own record beneath it.
            const refusal = measuredNoRefusal(reused.qualification, body.syncConfig.domains);
            if (refusal) throw new ConfigError(refusal);
            return reused;
          })()
        : firstOrThrow(
            await db
              .insert(schema.connection)
              .values({
                tenantId,
                role: 'target',
                // targetType values (jmap/imap/caldav/carddav/webdav/soverin) are all valid connection kinds.
                kind: body.targetType,
                displayName: `${body.name} (target)`,
                config: targetConnectionConfig(body),
                secretRef: targetSecret,
              })
              .returning({ id: schema.connection.id }),
            'target connection',
          );

      /**
       * ONE mailbox per connection, found or created (workplan 0071 T6).
       *
       * This used to be a bare INSERT of `external_id: 'primary'` per side.
       * `mailbox` declares `UNIQUE (connection_id, external_id)`, so the first
       * migration on a stored connection succeeded and every later one died on
       * a 23505 the route turned into a 500 — the connection-reuse feature
       * (0064) failing at the one thing it exists for, and 0069 made it
       * near-certain to be hit, because testing now saves a connection and the
       * wizard holds its id from then on. The owner met it as reference
       * `e133a809`.
       *
       * The constraint was right and the INSERT was wrong: a connection is one
       * account, so it has one mailbox row, and reusing the connection means
       * reusing that row. `primaryAddress` is only overwritten when the body
       * actually carries one — a reused connection hides the username input,
       * so trusting the body blindly renamed a real mailbox to ''.
       */
      const mailboxFor = async (
        connectionId: string,
        username: string,
        label: string,
      ): Promise<{ id: string }> => {
        const existing = await db
          .select({ id: schema.mailbox.id })
          .from(schema.mailbox)
          .where(
            and(
              eq(schema.mailbox.connectionId, connectionId),
              eq(schema.mailbox.externalId, 'primary'),
            ),
          );
        const found = existing[0];
        if (found) {
          if (username) {
            await db
              .update(schema.mailbox)
              .set({ primaryAddress: username })
              .where(eq(schema.mailbox.id, found.id));
          }
          return found;
        }
        return firstOrThrow(
          await db
            .insert(schema.mailbox)
            .values({
              tenantId,
              connectionId,
              kind: 'user',
              externalId: 'primary',
              primaryAddress: username,
            })
            .returning({ id: schema.mailbox.id }),
          label,
        );
      };

      const sourceMailbox = await mailboxFor(
        sourceConn.id,
        body.sourceConfig.username,
        'source mailbox',
      );
      const targetMailbox = await mailboxFor(
        targetConn.id,
        body.targetConfig.username,
        'target mailbox',
      );

      /**
       * The same two accounts, twice, into the same place (owner decision
       * 2026-08-18): refused, because both mappings would copy the same items
       * to the same destination and double everything in the target. A
       * different target folder prefix makes them not overlap, and is the
       * answer this refusal points at — migration 0022 enforces exactly that
       * triple, so this check and the index cannot disagree about what counts
       * as "the same migration twice".
       */
      const prefix = parseTargetFolderPrefix(body.targetFolderPrefix) ?? null;
      const clash = await db
        .select({ id: schema.mailboxMapping.id, name: schema.mailboxMapping.name })
        .from(schema.mailboxMapping)
        .where(
          and(
            eq(schema.mailboxMapping.sourceMailboxId, sourceMailbox.id),
            eq(schema.mailboxMapping.targetMailboxId, targetMailbox.id),
            prefix === null
              ? isNull(schema.mailboxMapping.targetFolderPrefix)
              : eq(schema.mailboxMapping.targetFolderPrefix, prefix),
          ),
        );
      if (clash[0]) {
        throw new DuplicateMappingError(clash[0].id, clash[0].name ?? null);
      }

      const mapping = firstOrThrow(
        await db
          .insert(schema.mailboxMapping)
          .values({
            tenantId,
            sourceMailboxId: sourceMailbox.id,
            targetMailboxId: targetMailbox.id,
            mode: body.mode ?? 'mirror',
            // 0013 T5: new mappings land PAUSED (draft) — the owner reviews the discovery
            // counts + scope manifest and clicks "Start migration" (POST …/start) to activate.
            status: body.status ?? 'paused',
            pattern: body.pattern,
            name: body.name,
            schedule: body.syncConfig.schedule,
            // Parsed, not raw: '/Gmail/' stores as 'Gmail', and '' as NULL —
            // the same normalisation the appliance's config loader applies.
            targetFolderPrefix: parseTargetFolderPrefix(body.targetFolderPrefix) ?? null,
            // Stored as the PARSED shape, so what a pass reads back is exactly
            // what the shared parser accepted (migration 0017).
            throttleConfig: body.throttleConfig
              ? parseThrottleConfig(body.throttleConfig)
              : null,
            /**
             * When a connection is SHARED, this mapping's own answers to
             * "whose data, and where" (migration 0021). Only recorded when
             * reusing: a mapping with its own connection already has these on
             * it, and writing them twice would create two places to disagree.
             */
            sourceConfigOverride: body.sourceConnectionId ? sourceConfigOverride(body) : null,
            targetConfigOverride: body.targetConnectionId ? targetConfigOverride(body) : null,
          })
          .returning(),
        'mapping',
      );

      if (body.syncConfig.domains.length > 0) {
        await db.insert(schema.scopeSelection).values(
          body.syncConfig.domains.map((domain) => ({ tenantId, mappingId: mapping.id, domain, included: true })),
        );
      }

      // A mapping created directly as 'active' never passes the start route,
      // so its paths take their slots here — same transaction as the mapping
      // and its scope (workplan 0109 T1b). The default draft ('paused') gets
      // no rows: absent means `ready`, and a draft has not moved anything.
      if (mapping.status === 'active') {
        await movePathsWithMapping(db, tenantId, mapping.id, 'active');
      }

      return mapping;
    });

    res.status(201).json({
      id: created.id,
      tenantId,
      name: created.name,
      sourceType: body.sourceType,
      targetType: body.targetType,
      status: created.status,
      mode: created.mode,
      pattern: created.pattern ?? undefined,
      syncConfig: { domains: body.syncConfig.domains, schedule: created.schedule ?? undefined },
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation error',
        // The sentences the schema wrote for exactly this refusal, where
        // serverMessage() finds them — `details` alone left the wizard
        // rendering the two words 'Validation error' while the refusal that
        // names both sides of an incoherent choice sat unread in the issue
        // list (0037 T4).
        message: error.issues.map((i) => i.message).join(' '),
        details: error.issues,
      });
    } else if (error instanceof DuplicateMappingError) {
      // A refusal the person can act on, so it must not look like a fault:
      // this used to reach them as a 500 about a unique index (0071 T6).
      res.status(409).json({
        error: 'duplicate_mapping',
        existingMappingId: error.existingId,
        existingMappingName: error.existingName,
        message: error.message,
      });
    } else {
      // A 500 is a BUG, not a refusal, so its internals must not reach a
      // browser — a driver error can carry a connection string. But "Failed to
      // create mapping" alone left the owner with no way to get from a red box
      // on a phone to the cause, which is sitting in the log two metres away
      // (workplan 0068). So the log line and the response now share a short
      // reference: the message stays safe, and quoting it finds the stack.
      serverFault(res, 'create_failed', 'creating this migration', error);
    }
  }
});

/**
 * GET /api/mappings/:mappingId
 * 
 * Get mapping details
 */
router.get('/:mappingId', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const mappingId = req.params.mappingId;
    if (!mappingId || Array.isArray(mappingId)) {
      res.status(400).json({ error: "mappingId is required" });
      return;
    }
    const tenantId = req.tenantId;

    if (!tenantId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Tenant ID not found in authentication context',
      });
      return;
    }


    const pool = getSharedPool();

    // Query the mapping + its real source/target connections + scope selection +
    // ledger-derived per-domain status, all RLS-enforced under one tenant context.
    // Previously this handler returned hardcoded placeholder data (imap.example.com,
    // a fixed lastSyncAt, domains: ['email']) regardless of the mapping's actual
    // config or sync state — this is the real fix, not a Docker/environment issue.
    const { mapping, sourceConn, targetConn, scopeRows, domainStatus, failures, adopted } =
      await withTenantDb(
      tenantId,
      pool,
      async (db) => {
        const mappings = await db
          .select()
          .from(schema.mailboxMapping)
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          );
        const mapping = mappings[0];
        if (!mapping) {
          return { mapping: null, sourceConn: null, targetConn: null, scopeRows: [], domainStatus: [], failures: [] };
        }

        // THE MAPPING'S OWN CONNECTIONS, through its mailboxes — not the
        // tenant's first source and first target. That is what this used to
        // read (`sourceRows[0]`/`targetRows[0]`), which was correct for a
        // tenant with exactly one of each and wrong for every other: the
        // detail page for "G to Sov" reported the kind and account of
        // whichever target connection happened to sort first, while the
        // passes wrote to the one the mapping actually holds. Found live
        // 2026-09-11, on a tenant with two targets, when the page and the
        // Connections page disagreed about where the files had gone.
        const connectionOf = async (mailboxId: string | null) => {
          if (!mailboxId) return null;
          const rows = await db
            .select({ connection: schema.connection })
            .from(schema.mailbox)
            .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
            .where(and(eq(schema.mailbox.id, mailboxId), eq(schema.mailbox.tenantId, tenantId)));
          return rows[0]?.connection ?? null;
        };
        const [sourceConn, targetConn, scopeRows, domainStatus, failures, adopted] =
          await Promise.all([
          connectionOf(mapping.sourceMailboxId),
          connectionOf(mapping.targetMailboxId),
          db
            .select()
            .from(schema.scopeSelection)
            .where(
              and(
                eq(schema.scopeSelection.tenantId, tenantId),
                eq(schema.scopeSelection.mappingId, mappingId),
                eq(schema.scopeSelection.included, true),
              ),
            )
            .orderBy(schema.scopeSelection.domain),
          new PgMigrationStatusStore(db).getStatus(tenantId as TenantId, mappingId as MappingId),
          // The failure queue feeds the attention counts — same derivation as
          // the appliance's /status (see buildDomainStatusReports).
          new PgLedger(db).listFailures(tenantId as TenantId, mappingId as MappingId),
          // What each domain LEFT AS IT WAS (0124 T2) — the one thing that
          // happened to an item that this page had no counter for, so its
          // totals never added up and there was nothing to read instead.
          new PgLedger(db).countAdoptedByDomain(tenantId as TenantId, mappingId as MappingId),
        ]);

        return {
          mapping,
          sourceConn,
          targetConn,
          scopeRows,
          domainStatus,
          failures,
          adopted,
        };
      },
    );

    if (!mapping) {
      res.status(404).json({
        error: 'Not found',
        message: 'Mapping not found',
      });
      return;
    }

    // lastSyncAt: the most recent domain completion, if any have completed yet.
    const completedTimestamps = domainStatus
      .map((s) => s.completedAt)
      .filter((v): v is string => typeof v === 'string');
    const lastSyncAt = completedTimestamps.length > 0
      ? completedTimestamps.sort().at(-1)
      : undefined;

    // Config is real: host/port/useSsl come straight from the connection's
    // non-secret config JSON. The ACCOUNT is not always in there — where it
    // lives depends on the kind, which is `accountOnConnection`'s whole
    // subject. The password stays masked whatever that finds: never return the
    // real secret, even though it is available server-side for a sync pass.
    const usernameFor = (conn: typeof sourceConn): string | undefined =>
      accountOnConnection(conn);

    res.json({
      id: mapping.id,
      tenantId,
      name: mapping.name ?? mapping.mode,
      sourceType: sourceConn?.kind ?? 'unknown',
      targetType: targetConn?.kind ?? 'unknown',
      // Named, so the page can say WHICH account this migration signs in
      // with on each side. A migration called "G to Sov" whose target is in
      // fact the Nextcloud connection is a fact the operator has to be able
      // to read off the migration itself, not reconstruct from a failure
      // line on the Connections page.
      sourceConnection: sourceConn
        ? { id: sourceConn.id, name: sourceConn.displayName, kind: sourceConn.kind }
        : null,
      targetConnection: targetConn
        ? { id: targetConn.id, name: targetConn.displayName, kind: targetConn.kind }
        : null,
      /**
       * THE CONFIG THIS MIGRATION ACTUALLY RUNS UNDER, which until 2026-09-18
       * was not what this said.
       *
       * It spread the CONNECTION's config alone. A connection is shared, and
       * the fields that say whose data a mapping moves — a Box subject, a
       * Drive root folder, a Dropbox root path, the Google export policy —
       * are the MAPPING's, in `source_config_override`. So a page reading this
       * was shown the connection's answer for every one of them, which for a
       * mapping that overrides any of them is somebody else's setting.
       *
       * It matters more now than it did: 0125 T3 made the export policy
       * changeable, and a chooser showing the wrong current value is worse
       * than no chooser — it would read as "this migration exports to PDF"
       * about one that refuses, and a press to "change" it would be a change
       * away from something it never had.
       *
       * Merged exactly as a sync pass merges it (`build-deps-from-mapping`):
       * override over connection, KEY BY KEY, so an absent key keeps the
       * connection's value and a mapping with no override reads exactly as it
       * did before. One merge rule, so what a screen shows and what a pass
       * runs cannot disagree.
       *
       * `username` and `password` are stamped after, deliberately: the account
       * comes from `accountOnConnection`, which knows where each provider kind
       * keeps it, and the password is masked whatever either object held.
       */
      sourceConfig: {
        ...(sourceConn?.config as Record<string, unknown> ?? {}),
        ...((mapping.sourceConfigOverride as Record<string, unknown> | null) ?? {}),
        username: usernameFor(sourceConn),
        password: '***',
      },
      targetConfig: {
        ...(targetConn?.config as Record<string, unknown> ?? {}),
        ...((mapping.targetConfigOverride as Record<string, unknown> | null) ?? {}),
        username: usernameFor(targetConn),
        password: '***',
      },
      syncConfig: {
        domains: scopeRows.map((r) => r.domain),
        schedule: mapping.schedule ?? undefined,
      },
      // Each kind this migration has, or could gain, and why not where it
      // cannot (workplan 0125 T6). The page offers exactly what this lists as
      // addable, and `POST …/domains` accepts exactly that, because both ask
      // `kindChoices`.
      kindChoices: kindChoices(
        {
          status: mapping.status,
          current: scopeRows.map((r) => r.domain),
          sourceKind: sourceConn?.kind ?? '',
          targetKind: targetConn?.kind ?? '',
          sourceQualification: sourceConn?.qualification,
          targetQualification: targetConn?.qualification,
        },
        process.env,
      ),
      status: mapping.status,
      mode: mapping.mode,
      pattern: mapping.pattern,
      // DomainStatusReport rows — the SAME shape the appliance's /status
      // serves (ADR-0026: shared shapes), with itemsRetrying and
      // itemsNeedingDecision derived from the failure queue and completedAt
      // renamed lastSyncedAt. Raw MigrationStatus rows lacked both counts,
      // so the hub's progress strip would have silently never shown a
      // retrying count on this edition (0033 T5).
      domainStatus: buildDomainStatusReports(domainStatus, failures, adopted),
      lastSyncAt,
      // When the person who granted through a link took it back (0108 T8 (c)),
      // or null. The page says so above everything else: nothing reads the
      // account until they grant it again, whatever the status says.
      grantWithdrawnAt: mapping.grantWithdrawnAt?.toISOString() ?? null,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
    });
  } catch (error) {
    serverFault(res, 'read_failed', 'reading this migration', error);
  }
});

/**
 * PUT /api/mappings/:mappingId
 * 
 * Update mapping configuration
 */
router.put(
  '/:mappingId',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const mappingId = req.params.mappingId;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const body = UpdateMappingSchema.parse(req.body);
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }


      const pool = getSharedPool();

      // Update mapping in database with RLS enforcement via withTenantDb
      // Note: mailbox_mapping has limited fields - we only update what's available
      const updateData: Partial<typeof schema.mailboxMapping.$inferInsert> = {};
      
      // Only update fields that exist in mailbox_mapping table
      // Note: body comes from UpdateMappingSchema which is partial of CreateMappingSchema
      // The actual mailbox_mapping fields are: id, tenant_id, source_mailbox_id, target_mailbox_id, 
      // status, mode, pattern, created_at, updated_at
      // So we need to check for these specific fields
      if ('status' in body && body.status) {
        // The four the schema above admits, NOT all five of `MappingLifecycle`
        // — see the note on `status` in UpdateMappingSchema for why the fifth
        // has no door here yet.
        updateData.status = body.status as 'active' | 'paused' | 'cutover' | 'done';
      }
      if ('mode' in body && body.mode) {
        // Narrowed to what the engine implements; the schema above refuses the
        // retracted modes with the reason, so nothing unsupported reaches here.
        updateData.mode = body.mode as 'mirror';
      }
      if ('pattern' in body && body.pattern) {
        updateData.pattern = body.pattern as 'shared_s' | 'distribution_d' | undefined;
      }

      /**
       * WHAT A LIVE MIGRATION MAY CHANGE ABOUT ITSELF (workplan 0125 T1/T3).
       *
       * The note that stood here said name, sourceType, targetType,
       * sourceConfig, targetConfig and syncConfig "are not direct fields of
       * mailbox_mapping — they would require updating related tables". That is
       * true of a connection's SERVER and CREDENTIALS, and it was read as
       * covering everything: a `sourceConfig` arriving here was parsed and
       * then dropped, in silence.
       *
       * It is not true of the fields that say "whose data, and where". Those
       * are per-mapping and live in `source_config_override` on THIS row —
       * `sourceConfigOverride()` builds it at create, and the schema says why
       * the column exists: *"a shared connection cannot answer something that
       * is true of one mapping only."* So the export policy is a merge into
       * one jsonb column, in the transaction below, and it does not reach any
       * other migration sharing the same Google connection.
       *
       * The owner found the gap the hard way: twenty-one of his files were
       * refused with a sentence telling him to set an export policy on the
       * mapping, and the product had nowhere to do it.
       *
       * WHAT MAY CHANGE IS NOT DECIDED HERE. `mayRevise` is in `shared` and is
       * called by both editions, for the reason `parseGoogleDriveSource` is:
       * hard rule 5 says they do not differ in behaviour, and a revision the
       * appliance refuses must not be one this route quietly performs.
       *
       * AND A REFUSED FIELD IS REFUSED OUT LOUD. Dropping it silently is what
       * this route did, and it is the failure hard rule 9 is about: a caller
       * who changed the root folder and got 200 back has been told the change
       * landed. Every refused field at once, never the first — somebody who
       * changed three and is told about one fixes it and is refused again.
       */
      const refused = refusalsFor(proposedRevisions(body));
      if (refused.length > 0) {
        res.status(409).json({
          error: 'revision_refused',
          message:
            'Some of what was asked for cannot change on a migration that already exists.',
          refused: refused.map((r) => ({ field: r.field, reason: r.reason })),
        });
        return;
      }

      /**
       * The export policy, merged over whatever the row already holds.
       *
       * MERGED, not replaced: `source_config_override` also carries the fields
       * that say whose data this mapping moves (a Box subject, a Drive root,
       * an archive path), and writing a fresh object here would blank them and
       * silently fall the next pass back to the connection's own — which is
       * precisely the defect ADR-0033's one-subject-per-mapping rule exists to
       * prevent.
       *
       * Validated through the SAME parser a mapping file goes through, so a
       * value the appliance refuses is not one this route stores; the schema
       * has already answered an unreadable one with a 400.
       *
       * The single format and the per-kind ones are ONE setting here, as in a
       * reused connection's override at create (`exportFormatOverride`,
       * workplan 0042 T9): setting the single format clears any per-kind
       * ones, so a control offering one format for all four kinds is never
       * contradicted by a per-kind format it cannot show.
       */
      const revisedFormat = exportFormatOverride(body.sourceConfig ?? {});
      const revisesFormat = Object.keys(revisedFormat).length > 0;

      const outcome = await withTenantDb(tenantId, pool, async (db) => {
        // The status this mapping holds BEFORE the write, read inside the same
        // transaction so nothing can move it in between. Only needed when the
        // body actually carries a status — otherwise this is not a lifecycle
        // transition and there is nothing to record.
        const previousStatus = updateData.status
          ? (
              await db
                .select({ status: schema.mailboxMapping.status })
                .from(schema.mailboxMapping)
                .where(
                  and(
                    eq(schema.mailboxMapping.id, mappingId),
                    eq(schema.mailboxMapping.tenantId, tenantId),
                  ),
                )
            )[0]?.status
          : undefined;
        // THE LIFECYCLE IS ASKED BEFORE THE ROW IS WRITTEN (ADR-0049). Until
        // 2026-09-20 this route wrote whatever status its schema admitted:
        // `cutover` -> `active` went through here while `/start` refused it,
        // `done` -> `paused` went through while nothing else leaves `done`,
        // and `active` -> `done` skipped the unresolved-failures rule that
        // `/finish` exists to apply. Two doors to one state, one guarded. The
        // decision is `shared`'s, like every other door's, and it runs on the
        // status read inside THIS transaction so nothing can move in between.
        if (updateData.status && previousStatus) {
          const transition = updateTransition(previousStatus, updateData.status);
          if ('refuse' in transition) {
            // A literal discriminant, not `'refused' in outcome`: TS normalises the
            // two return shapes into one union with the other's keys optional,
            // and `in` cannot tell an absent key from an optional one.
            return { kind: 'refused', refused: transition, from: previousStatus, to: updateData.status } as const;
          }
        }
        // Read inside the same transaction, for the same reason the status is:
        // a merge built from a value read outside it can be written over a row
        // that moved in between.
        const currentOverride = !revisesFormat
          ? undefined
          : ((
              await db
                .select({ o: schema.mailboxMapping.sourceConfigOverride })
                .from(schema.mailboxMapping)
                .where(
                  and(
                    eq(schema.mailboxMapping.id, mappingId),
                    eq(schema.mailboxMapping.tenantId, tenantId),
                  ),
                )
            )[0]?.o as Record<string, unknown> | null | undefined);
        const [row] = await db
          .update(schema.mailboxMapping)
          // Stamped LAST so it cannot be spread away by a field above, and
          // unconditionally: this route is how a mapping reaches `paused`,
          // `cutover` and `done`, so three of the four lifecycle transitions
          // ran through here leaving no timestamp at all (workplan 0109 T1).
          .set({
            ...updateData,
            ...(revisesFormat
              ? { sourceConfigOverride: { ...(currentOverride ?? {}), ...revisedFormat } }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          )
          .returning();
        // Only when the row existed AND the status actually moved — the helper
        // drops a from === to change, because a PATCH restating the status a
        // mapping already has is a request, not a transition.
        if (row && updateData.status && previousStatus) {
          await recordMappingStatusChange(db, tenantId, {
            mappingId,
            from: previousStatus,
            to: updateData.status,
            actor: req.userId ?? 'unknown',
            via: 'update',
          });
          // The paths move with the mapping, in the same transaction
          // (workplan 0109 T1b). Gated like the audit row: a PATCH restating
          // the status a mapping already has is a request, not a transition.
          if (previousStatus !== updateData.status) {
            await movePathsWithMapping(db, tenantId, mappingId, updateData.status);
          }
        }
        return { kind: 'updated', row } as const;
      });

      if (outcome.kind === 'refused') {
        // 409, not 400: the body is well-formed and understood. What refuses
        // it is the lifecycle of the migration it names — and `code` is the
        // stable part, so a screen can offer the right door without matching
        // sentence text (the `finishTransition` precedent, 0038 T1).
        res.status(409).json({
          error: 'lifecycle_refused',
          message: outcome.refused.refuse,
          hint: outcome.refused.hint,
          code: outcome.refused.code,
          from: outcome.from,
          to: outcome.to,
        });
        return;
      }
      const updated = outcome.row;

      if (!updated) {
        res.status(404).json({
          error: 'Not found',
          message: 'Mapping not found',
        });
        return;
      }

      res.json({
        id: updated.id,
        ...body,
        updatedAt: updated.updatedAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        serverFault(res, 'update_failed', 'updating this migration', error);
      }
    }
  }
);

/**
 * DELETE /api/mappings/:mappingId
 * 
 * Delete a mapping
 */
router.delete(
  '/:mappingId',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const mappingId = req.params.mappingId;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }


      const pool = getSharedPool();

      // Delete mapping from database with RLS enforcement via withTenantDb
      const [deleted] = await withTenantDb(tenantId, pool, async (db) => {
        return await db
          .delete(schema.mailboxMapping)
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          )
          .returning();
      });

      if (!deleted) {
        res.status(404).json({
          error: 'Not found',
          message: 'Mapping not found',
        });
        return;
      }

      res.json({
        success: true,
        message: 'Mapping deleted successfully',
      });
    } catch (error) {
      serverFault(res, 'delete_failed', 'deleting this migration', error);
    }
  }
);

/**
 * POST /api/mappings/:mappingId/sync
 * 
 * Trigger a sync for a mapping
 */
router.post(
  '/:mappingId/sync',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mappingId } = req.params;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const body = TriggerSyncSchema.parse(req.body);
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }

      // Verify mapping exists and belongs to tenant (RLS enforced via withTenantDb)
      const pool = getSharedPool();
      const mappings = await withTenantDb(tenantId, pool, async (db) => {
        return await db
          .select()
          .from(schema.mailboxMapping)
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          );
      });

      if (mappings.length === 0) {
        res.status(404).json({
          error: 'Not found',
          message: 'Mapping not found',
        });
        return;
      }

      // 0013 T5: a paused (draft) mapping must not sync until the owner green-lights it
      // via POST …/start. Refuse rather than silently kicking off a pass.
      if (mappings[0]?.status === 'paused') {
        res.status(409).json({
          error: 'Conflict',
          message: 'Mapping is paused — review the discovery counts and start it first (POST /start).',
        });
        return;
      }
      // A grant the person took back (0108 T8 (c)): nothing reads their account
      // until they grant it again, so a pass enqueued now would only be refused
      // by the builder. Said here, where the owner pressed the button.
      const withdrawnAt = mappings[0]?.grantWithdrawnAt;
      if (withdrawnAt) {
        const withdrawn = grantWithdrawnRefusal(withdrawnAt).en;
        res.status(409).json({ error: 'grant_withdrawn', message: withdrawn, reason: withdrawn });
        return;
      }

      // Enqueue the real Trigger.dev task with an id-only, tenant-scoped payload
      // (the mapping was just verified to belong to this tenant above).
      const { taskId, payload } = resolveSyncJob(tenantId, mappingId, body);
      const run = await getTriggerClient().tasks.trigger(taskId, payload, {
        // One running pass per mapping: the partition run-delta-sync's queue
        // relies on, and the one the sync tick and /start set. Without it this
        // run lands on the base `delta-sync` queue (limit 1, shared by every
        // tenant) and does not wait for the mapping's scheduled pass.
        concurrencyKey: mappingId,
        tags: [`tenant:${tenantId}`, `mapping:${mappingId}`],
      });

      res.status(202).json({
        success: true,
        runId: run.id,
        jobType: taskId,
        triggeredAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        serverFault(res, 'sync_failed', 'starting this sync', error);
      }
    }
  }
);

/**
 * POST /api/mappings/:mappingId/cutover
 *
 * Enqueue the cutover PREPARATION (final delta sync + the §20 gate, stopping
 * at READY_FOR_CUTOVER) — after asking the ledger.
 *
 * This door used to enqueue without looking. A press on a cutover under way
 * or on a finished ledger got a 202 promising "on a passing verification the
 * mapping becomes READY_FOR_CUTOVER", and the refusal happened minutes later
 * inside a Trigger.dev run nobody was watching; a press on an APPROVED cutover
 * quietly revoked the approval. Now the door asks `prepareTransition` — the
 * same rule the job follows (ADR-0049's rule, one level up: every door asks
 * before it acts) — and answers 409 with the reason, or 202 that says what
 * will happen. The read is advisory: the job re-reads the ledger and remains
 * the authority on a ledger that moved in between.
 */
router.post(
  '/:mappingId/cutover',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { mappingId } = req.params;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const body = TriggerCutoverSchema.parse(req.body);
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }

      // Verify mapping exists and belongs to tenant (RLS enforced via withTenantDb)
      const pool = getSharedPool();
      const mappings = await withTenantDb(tenantId, pool, async (db) => {
        return await db
          .select()
          .from(schema.mailboxMapping)
          .where(
            and(
              eq(schema.mailboxMapping.id, mappingId),
              eq(schema.mailboxMapping.tenantId, tenantId)
            )
          );
      });

      if (mappings.length === 0) {
        res.status(404).json({
          error: 'Not found',
          message: 'Mapping not found',
        });
        return;
      }

      // Ask the ledger BEFORE anything is enqueued: the same decision the job
      // follows, so the door never refuses what the job would accept, and
      // never accepts what the job would refuse.
      const ledger = await withTenantDb(tenantId, pool, async (db) => {
        const cutoverStore = new CutoverStore(db);
        return cutoverStore.loadCutoverState(asTenantId(tenantId), asMappingId(mappingId));
      });
      const decision = prepareTransition(ledger ? (ledger.currentState ?? ledger.state) : undefined);

      if ('refuse' in decision) {
        res.status(409).json({
          error: 'cutover_refused',
          message: decision.refuse,
          hint: decision.hint,
          code: decision.code,
          state: decision.from,
        });
        return;
      }

      // What the job will do with this press — said here, because a 202 that
      // reads the same for a first preparation and for a re-preparation that
      // revokes an approval is not an honest 202.
      const preparation =
        'initialize' in decision
          ? { from: null, resetsToPreparing: false, revokesApproval: false }
          : {
              from: decision.from,
              resetsToPreparing: decision.resetFirst,
              revokesApproval: decision.from === 'APPROVED',
            };

      // Enqueue the real Trigger.dev cutover task (id-only, tenant-scoped payload).
      const { taskId, payload } = resolveCutoverJob(tenantId, mappingId, body);
      const run = await getTriggerClient().tasks.trigger(taskId, payload, {
        tags: [`tenant:${tenantId}`, `mapping:${mappingId}`, 'type:cutover'],
      });

      res.status(202).json({
        success: true,
        runId: run.id,
        triggeredAt: new Date().toISOString(),
        // What was actually enqueued. This used to return a gracePeriodEnd
        // computed from the request, which reads as "the cutover is running and
        // its grace period ends at T" — nothing had run yet, and the task never
        // executes the cutover or starts a grace period.
        enqueued: 'cutover-preparation',
        preparation,
        nextStep: preparation.revokesApproval
          ? 'The earlier approval is revoked by this re-preparation: on a PASSing verification the mapping is READY_FOR_CUTOVER again and waits for a new approval.'
          : 'On a PASSing verification the mapping becomes READY_FOR_CUTOVER and waits for operator approval.',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation error',
          details: error.issues,
        });
      } else {
        serverFault(res, 'cutover_failed', 'starting this cutover', error);
      }
    }
  }
);

/**
 * GET /api/migrations/:mappingId/runs
 *
 * Run history for a mapping, newest first, events inline — the shared
 * `RunReport` contract from @openmig/shared, produced by the ledger's own
 * reader so both editions serve one shape (see RunStore.listRunsWithEvents).
 *
 * The per-run detail route (`/runs/:runId`) that used to sit beside this was
 * DELETED with the 2026-08-09 row-23 decision: events arrive with the list,
 * and a second route with no reader is surface waiting to drift.
 */
router.get(
  '/:mappingId/runs',
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const mappingId = req.params.mappingId;
      if (!mappingId || Array.isArray(mappingId)) {
        res.status(400).json({ error: "mappingId is required" });
        return;
      }
      const tenantId = req.tenantId;

      if (!tenantId) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Tenant ID not found in authentication context',
        });
        return;
      }

      const pool = getSharedPool();
      const { runs, truncated } = await withTenantDb(tenantId, pool, async (db) =>
        new RunStore(db).listRunsWithEvents(tenantId as TenantId, mappingId as MappingId),
      );

      res.json({ runs, truncated });
    } catch (error) {
      serverFault(res, 'runs_failed', 'listing the runs for this migration', error);
    }
  }
);

/** Load a mapping and confirm it belongs to the tenant (RLS-enforced). Returns null if not found. */
async function loadMapping(
  tenantId: string,
  mappingId: string,
): Promise<typeof schema.mailboxMapping.$inferSelect | null> {
  const rows = await withTenantDb(tenantId, getSharedPool(), (db) =>
    db
      .select()
      .from(schema.mailboxMapping)
      .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId))),
  );
  return rows[0] ?? null;
}

/**
 * Is this mapping still waiting for somebody to connect its Google account?
 *
 * Composes the credentials the way a sync pass will (migration 0032: the
 * mapping's own over the connection's, key by key) and asks the decision in
 * `grant-link-readiness.ts` — deliberately the SAME composition, because a
 * guard that reasons about different credentials from the ones the run will
 * use is a guard that eventually disagrees with reality.
 *
 * A source whose credentials cannot be decrypted reads as "nothing there",
 * which lands the owner on the refusal rather than on a run that dies at the
 * first request. That is the honest direction: an unreadable secret and an
 * absent one both mean the pass has no way in.
 */
async function awaitingGrant(
  tenantId: string,
  mappingId: string,
  mappingSecretRef: string | null,
): Promise<string | null> {
  const rows = await withTenantDb(tenantId, getSharedPool(), (db) =>
    db
      .select({ kind: schema.connection.kind, secretRef: schema.connection.secretRef })
      .from(schema.mailboxMapping)
      .innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMapping.sourceMailboxId))
      .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
      .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId))),
  );
  const source = rows[0];
  if (!source) return null;

  const read = (ref: string | null): Record<string, unknown> => {
    if (!ref) return {};
    try {
      return SecretStore.decryptCredentials(ref);
    } catch {
      return {};
    }
  };
  const creds = { ...read(source.secretRef), ...read(mappingSecretRef) };
  const has = (key: string) => typeof creds[key] === 'string' && creds[key].trim().length > 0;
  return awaitingGrantRefusal({
    sourceKind: source.kind,
    hasRefreshToken: has('refreshToken'),
    hasServiceAccountKey: has('serviceAccountKey'),
  });
}

/**
 * The sync domains, from the one list (workplan 0113 T5).
 *
 * Written out by hand until T2 landed: widening a validator ahead of the
 * ledger would have accepted a domain the database then refuses, which is a
 * pass that dies half-copied rather than a request that is refused. The
 * migration is in, and `scripts/a-fifth-domain-the-database-would-refuse.unit.test.ts`
 * fails the build if the shared list ever outruns the CHECKs again — so
 * deriving is now the safer of the two, not just the shorter.
 */
const DiscoverSchema = z.object({
  domains: z.array(z.enum(DISCOVERY_DOMAINS)).optional(),
});

/**
 * POST /api/migrations/:mappingId/discover (0013 T4)
 * Enqueue the read-only discovery job. Counts are written to migration_discovery; poll GET …/discovery.
 */
router.post('/:mappingId/discover', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mappingId } = req.params;
    const tenantId = req.tenantId;
    if (!mappingId || Array.isArray(mappingId)) return void res.status(400).json({ error: 'mappingId is required' });
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });

    const body = DiscoverSchema.parse(req.body ?? {});
    const mapping = await loadMapping(tenantId, mappingId);
    if (!mapping) return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });

    // No `domains`: `run-discovery` resolves the mapping's own scope_selection
    // when the payload omits them, exactly as the start route leaves it to
    // `run-delta-sync`. See `resolveDiscoveryJob` for the Email row that
    // naming all five here put on a migration whose owner had switched mail
    // off, and what it said.
    const { taskId, payload } = resolveDiscoveryJob(tenantId, mappingId, body);
    // One count per migration, and a reload joins it: see the function.
    const run = await getTriggerClient().tasks.trigger(
      taskId,
      payload,
      discoveryTriggerOptions(tenantId, mappingId, {
        updatedAt: mapping.updatedAt,
        ...(body.domains ? { domains: body.domains } : {}),
      }),
    );
    res.status(202).json({ success: true, runId: run.id, jobType: 'run-discovery', triggeredAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: error.issues });
    } else {
      serverFault(res, 'discovery_failed', 'starting discovery', error);
    }
  }
});

/**
 * GET /api/migrations/:mappingId/discovery (0013 T4)
 * Return the stored per-domain discovery counts. `discovered` is false until the first pass lands.
 *
 * THE MIGRATION'S OWN DOMAINS, on the way out as well as on the way in. The
 * enqueue side learned this in #854 (`resolveDiscoveryJob`, and
 * `domainsToCount` behind it); the read side had not, so every row any pass
 * had ever written came back — including the ones written BY the defect #854
 * removed. See `discoveryForSelection` for the Tasks row holding the Drive
 * numbers that survived the fix and kept showing up on the owner's screen.
 *
 * Both reads in ONE tenant transaction: a selection read outside it could
 * describe a different moment from the counts it filters, and the whole point
 * of this route is that the two agree.
 */
router.get('/:mappingId/discovery', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mappingId } = req.params;
    const tenantId = req.tenantId;
    if (!mappingId || Array.isArray(mappingId)) return void res.status(400).json({ error: 'mappingId is required' });
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });

    const mapping = await loadMapping(tenantId, mappingId);
    if (!mapping) return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });

    const domains = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      const [stored, scopeRows] = await Promise.all([
        new schema.PgDiscoveryStore(db).getDiscovery(tenantId as TenantId, mappingId as MappingId),
        db
          .select({ domain: schema.scopeSelection.domain })
          .from(schema.scopeSelection)
          .where(
            and(
              eq(schema.scopeSelection.tenantId, tenantId),
              eq(schema.scopeSelection.mappingId, mappingId),
              eq(schema.scopeSelection.included, true),
            ),
          ),
      ]);
      return discoveryForSelection(stored, scopeRows.map((r) => r.domain));
    });
    res.json({ mappingId, discovered: domains.length > 0, domains });
  } catch (error) {
    serverFault(res, 'discovery_read_failed', 'reading the discovery result', error);
  }
});

/**
 * POST /api/migrations/:mappingId/start (0013 T5)
 * The green light: flip a paused (draft) mapping to active so the scheduler picks it up.
 * Idempotent for an already-active mapping; 409 once it has moved on to cutover/done.
 *
 * **Activating also runs the first pass**, rather than leaving it to the tick.
 * The mapping's cron is how often the sync REPEATS; it was never meant to be
 * how long the first one is postponed, and an owner who chose a quarter-hourly
 * cadence on a mapping that had already run once got exactly that — a button
 * that reported success followed by fifteen quiet minutes. `isSyncDue` already
 * calls a never-run mapping due immediately; this extends the same intent to
 * the moment somebody presses start.
 *
 * Only on the TRANSITION into 'active'. A second click is idempotent (that is
 * this route's contract) and must not queue a second pass; and the enqueue is
 * safe against the tick either way, because both go through the same
 * `concurrencyKey: mappingId`.
 */
router.post('/:mappingId/start', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mappingId } = req.params;
    const tenantId = req.tenantId;
    if (!mappingId || Array.isArray(mappingId)) return void res.status(400).json({ error: 'mappingId is required' });
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });

    const mapping = await loadMapping(tenantId, mappingId);
    if (!mapping) return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });

    // The same refusal `startTransition` makes for the appliance, through the
    // same predicate rather than a second copy of the comparison — this line
    // was a hand-copied duplicate of `lifecycle.ts`, message string included,
    // which is the drift this repository normally polices (hard rule 5). The
    // answer and the wording are unchanged; only the authority moved.
    //
    // What makes it worth moving now is 0117 D4: after cutover the source is
    // no longer the authority on what exists, and the states this asks about
    // are exactly the ones where that becomes true. `isAfterCutover` carries
    // that reasoning; two inline comparisons carried none of it.
    if (isAfterCutover(mapping.status)) {
      return void res.status(409).json({ error: 'Conflict', message: `Cannot start a mapping in '${mapping.status}' state` });
    }

    // Waiting on somebody's grant is not runnable (workplan 0108 T4). Starting
    // it would enqueue a pass that fails at the first request, and the failure
    // would arrive as a provider authentication error in a run report — read
    // as Google's fault, days after the owner forgot they were waiting on a
    // colleague. Derived from the rows rather than stored as a fifth status:
    // see `awaitingGrantRefusal` for why that is the cheaper honest answer.
    // A grant the person took back (0108 T8 (c)) is its own answer, and comes
    // first: "nobody has connected its Google account" would be untrue, and
    // where the connection holds a credential of its own the question below
    // would say "go ahead" and start reading the account the person has just
    // said no to. The builder refuses it too; this is where the owner hears it.
    if (mapping.grantWithdrawnAt) {
      const withdrawn = grantWithdrawnRefusal(mapping.grantWithdrawnAt).en;
      return void res.status(409).json({ error: 'grant_withdrawn', message: withdrawn, reason: withdrawn });
    }
    const waiting = await awaitingGrant(tenantId, mappingId, mapping.sourceSecretRef);
    if (waiting) {
      return void res.status(409).json({ error: 'awaiting_grant', message: waiting, reason: waiting });
    }

    const activated = mapping.status !== 'active';
    if (activated) {
      await withTenantDb(tenantId, getSharedPool(), async (db) => {
        await db
          .update(schema.mailboxMapping)
          .set({ status: 'active', updatedAt: new Date() })
          .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
        // Recorded in the SAME transaction (workplan 0109 T1): the change and
        // the record of it commit together. `mapping.status` was read above,
        // and `activated` already guarantees it differs from 'active'.
        await recordMappingStatusChange(db, tenantId, {
          mappingId,
          from: mapping.status,
          to: 'active',
          actor: req.userId ?? 'unknown',
          via: 'start',
        });
        // Every included path takes its slot in the same transaction
        // (workplan 0109 T1b): `activate` stamps `first_activated_at` once,
        // so a resume through this route keeps the original date.
        await movePathsWithMapping(db, tenantId, mappingId, 'active');
      });
    }

    // The mapping IS active whatever happens next, so a failure to enqueue
    // must not fail this request — the tick still picks it up on its own
    // cadence. It is NOT swallowed either (hard rule 9): it is logged and it
    // rides back on the answer to the request that caused it, which is the
    // same shape every other enqueue call site here uses.
    let firstRun: { queued: true; runId: string } | { queued: false; reason: string } | undefined;
    if (activated) {
      // No `domains`: `run-delta-sync` resolves the mapping's own
      // scope_selection when the payload omits them, which is the one place
      // that decision belongs. Naming them here would let a stale copy of the
      // scope sync a domain the owner had switched off.
      const { taskId, payload } = resolveSyncJob(tenantId, mappingId, {});
      try {
        const run = await getTriggerClient().tasks.trigger(taskId, payload, {
          tags: [`tenant:${tenantId}`, `mapping:${mappingId}`],
          concurrencyKey: mappingId,
        });
        firstRun = { queued: true, runId: run.id };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log.error(`[start] mapping ${mappingId}: could not enqueue the first pass:`, reason);
        firstRun = { queued: false, reason };
      }
    }

    res.json({ id: mappingId, status: 'active', activated, ...(firstRun ? { firstRun } : {}) });
  } catch (error) {
    serverFault(res, 'start_failed', 'starting this migration', error);
  }
});

/**
 * POST /api/migrations/:mappingId/domains — ADD ONE KIND to a migration that
 * already exists (workplan 0125 T6, the owner's decision of 2026-09-23).
 *
 * The day Google Tasks became a face of a Google account, the owner's running
 * migration had no way to take them: its kinds were written once, at
 * creation, and a second migration between the same two accounts is refused
 * (migration 0022). This is that way.
 *
 * Accepted exactly when `kindChoices` calls the kind addable, which is the
 * list the migration page offers, and refused otherwise in
 * `kindAdditionRefusal`'s words, so the page and this door cannot disagree.
 * Adding only: nothing here takes a kind off.
 *
 * One transaction: the kind is included, the migration's `updated_at` moves,
 * so the next preflight counts afresh instead of joining one asked before the
 * kind existed (`discoveryTriggerOptions` keys on it), and a RUNNING
 * migration's new path takes its slot. A paused one takes it at its next
 * start, with the rest.
 *
 * Nothing is enqueued. Every pass reads the included kinds afresh
 * (`enabledDomains`), so a running migration's next pass copies the new kind.
 */
const AddKindSchema = z.object({ domain: z.enum(DISCOVERY_DOMAINS) });

router.post('/:mappingId/domains', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mappingId } = req.params;
    const tenantId = req.tenantId;
    if (!mappingId || Array.isArray(mappingId)) return void res.status(400).json({ error: 'mappingId is required' });
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });

    const parsed = AddKindSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const reason = `Send { domain } naming one kind: ${DISCOVERY_DOMAINS.join(', ')}.`;
      return void res.status(400).json({ error: 'invalid_body', message: reason, reason });
    }
    const { domain } = parsed.data;

    const outcome = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      const [mapping] = await db
        .select()
        .from(schema.mailboxMapping)
        .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
      if (!mapping) return { kind: 'not-found' } as const;

      // The mapping's OWN connections, through its mailboxes, as the detail
      // route reads them: the choice must be made on the rows it showed.
      const connectionOf = async (mailboxId: string | null) => {
        if (!mailboxId) return null;
        const rows = await db
          .select({ connection: schema.connection })
          .from(schema.mailbox)
          .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
          .where(and(eq(schema.mailbox.id, mailboxId), eq(schema.mailbox.tenantId, tenantId)));
        return rows[0]?.connection ?? null;
      };
      // One after another, not `Promise.all`: these share the transaction's
      // one client, and overlapping queries on a client is what pg 9 removes.
      const sourceConn = await connectionOf(mapping.sourceMailboxId);
      const targetConn = await connectionOf(mapping.targetMailboxId);
      const scopeRows = await db
        .select({ domain: schema.scopeSelection.domain })
        .from(schema.scopeSelection)
        .where(
          and(
            eq(schema.scopeSelection.tenantId, tenantId),
            eq(schema.scopeSelection.mappingId, mappingId),
            eq(schema.scopeSelection.included, true),
          ),
        );
      const current = scopeRows.map((r) => r.domain);
      const refusal = kindAdditionRefusal(
        domain,
        {
          status: mapping.status,
          current,
          sourceKind: sourceConn?.kind ?? '',
          targetKind: targetConn?.kind ?? '',
          sourceQualification: sourceConn?.qualification,
          targetQualification: targetConn?.qualification,
        },
        process.env,
      );
      if (refusal) return { kind: 'refused', reason: refusal } as const;

      // An EXCLUDED row for this kind is included again rather than doubled:
      // the pair is unique (`uk_scope_mapping_domain`).
      await db
        .insert(schema.scopeSelection)
        .values({ tenantId, mappingId, domain, included: true })
        .onConflictDoUpdate({
          target: [schema.scopeSelection.mappingId, schema.scopeSelection.domain],
          set: { included: true },
        });
      await db
        .update(schema.mailboxMapping)
        .set({ updatedAt: new Date() })
        .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
      if (mapping.status === 'active') await activateAddedPath(db, tenantId, mappingId, domain);

      const now = new Set<string>([...current, domain]);
      return { kind: 'added', domains: DISCOVERY_DOMAINS.filter((d) => now.has(d)) } as const;
    });

    if (outcome.kind === 'not-found') {
      return void res.status(404).json({ error: 'Not found', message: 'Mapping not found' });
    }
    if (outcome.kind === 'refused') {
      return void res
        .status(409)
        .json({ error: 'kind_refused', message: outcome.reason, reason: outcome.reason });
    }
    res.json({ id: mappingId, added: domain, domains: outcome.domains });
  } catch (error) {
    serverFault(res, 'add_kind_failed', 'adding a kind to this migration', error);
  }
});

export default router;
