// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Connections as things you can SEE and RE-TEST (workplan 0062).
 *
 * `connection` rows have existed since the baseline, but nothing ever showed
 * them: creating a mapping silently inserted two — `"<name> (source)"` and
 * `"<name> (target)"` — and that was the last anyone heard of them. So a
 * credential could expire and the only way to find out was a failing pass, a
 * second mapping against the same tenant meant pasting the same three secrets
 * again, and nothing could answer "is this still good?" without running a
 * migration.
 *
 * `GET /api/connections` — what exists, what it is for, and how many mappings
 * depend on it.
 * `POST /api/connections/:id/test` — probe it NOW, through the same builders a
 * sync pass uses, and record what came back.
 *
 * The list also says what is STANDING against each connection (workplan 0094
 * T5). A sync pass that fails writes a category onto the migration's status
 * row (0110 T3), and until 2026-09-05 nothing carried that back to the page
 * where the credential lives: `status` here is what the last Test said, a
 * pass failing afterwards left it `connected`, and the person who owns the
 * credential had to open each migration to learn that the fix was on the page
 * they had just left. `standingFailures` folds those categories per
 * connection — both sides of every migration that signs in with it — so the
 * card can show the remedy beside the Replace button.
 *
 * SECRETS NEVER COME BACK OUT. The list returns names, kinds and states; the
 * only thing that touches decrypted credentials is the probe, and all it
 * returns is the provider's own verdict.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { eq, and, inArray, or, sql, isNotNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as schema from '@openmig/ledger';
import { PgLedger, readPathPhases } from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { HttpTokenRevoker } from '@openmig/connectors';
import { mergeKeepingTheDriveGrant } from '@openmig/orchestration/cirrux-grant-store';
import { revokeCredentialRow } from '@openmig/orchestration/revoke-stored-credentials';
import { SELF_HEALING_CATEGORIES } from '@openmig/orchestration/failing-backoff';
import type { TokenRevoker } from '@openmig/shared';
import {
  credentialsForProbe,
  listDropboxSharedFolders,
  listGoogleSharedDrives,
  listGoogleSharedFolders,
  probeSourceConnection,
  probeTargetConnection,
} from '@openmig/orchestration/probe-connection';
import { isGoogleGrantKind, type AccountQualification } from '@openmig/orchestration/account-qualification';
import { z } from 'zod';
import {
  ARCHIVE_PROVIDERS,
  DISCOVERY_DOMAINS,
  credentialFieldsFor,
  halfGoogleClientPairProblem,
  halfDropboxClientPairProblem,
  halfMailLogin,
  halfMailLoginRefusal,
  isArchiveProvider,
  isFailureCategory,
  isFailureSide,
  log,
  newReference,
  keepingTheMailLogin,
  recordAppEvent,
  signsInToMailApart,
  targetCredentialRecord,
  wizardTypeForConnectionKind,
} from '@openmig/shared';
import type {
  CredentialField,
  DiscoveryDomain,
  FailureCategory,
  FailureSide,
  TenantId,
} from '@openmig/shared';
import { authenticate, withTenantDb } from '../middleware/auth.ts';
import { refusedAsClosed } from '../closed-organisation.ts';
import { refusedUntilAccepted } from '../conditions-not-accepted.ts';
import type { Answerable, AuthenticatedRequest } from '../types/api.ts';
// The SHAPE builders stay the create route's, deliberately: what a connection
// stores must match what a sync pass reads, and one authority for that is the
// whole point of workplan 0063's descriptor only describing INPUTS.
import {
  CreateMappingBase,
  sourceConnectionConfig,
  sourceCredentialRecord,
  knownConnectionValues,
  sourceKindFor,
  targetConnectionConfig,
} from './migrations/index.ts';
import { pressSyncNow } from './migrations/sync-now.ts';
import { serverFault } from '../server-fault.ts';
import { loggableError } from '@openmig/shared';
import { probeAnswers } from '../probe-answer.ts';
import { refusedOverTestLimit } from '../probe-limit.ts';
import { archiveOnServerRefusal } from './archive-on-the-server.ts';
import {
  PERSON_NOT_FOUND,
  forPersonRefusal,
  missingForPerson,
  personOfThisOrganisation,
  shapedForPerson,
} from './account-for-a-person.ts';
import { DOOR_BUDGET_MS, connectionsPool, qualifyAndRemember } from './qualify-and-remember.ts';

const router = Router();

const pool = connectionsPool;

/** Target kinds `probeTargetConnection` knows how to reach. */
const TARGET_KINDS = ['jmap', 'imap', 'caldav', 'carddav', 'webdav', 'soverin', 'nextcloud', 'cirrux', 'infomaniak'] as const;
type TargetKind = (typeof TARGET_KINDS)[number];

/** The response's qualification field, or its "still measuring" stand-in. */
function qualificationField(
  q: AccountQualification | 'pending' | undefined,
): { qualification: AccountQualification } | { qualificationPending: true } | Record<never, never> {
  if (q === 'pending') return { qualificationPending: true };
  return q ? { qualification: q } : {};
}

/**
 * One standing failure of a migration that signs in with a connection
 * (workplan 0094 T5). The category and nothing else: `last_error` is prose
 * that routinely carries a mailbox address and a folder name, and it has a
 * home on the migration's own page where the prose boundary applies.
 */
export interface StandingFailure {
  readonly mappingId: string;
  readonly mappingName: string | null;
  readonly category: FailureCategory;
  /** The domains this category stands on, in `DISCOVERY_DOMAINS` order. */
  readonly domains: DiscoveryDomain[];
  /** When the newest of those rows last changed — ISO. */
  readonly asOf: string;
  /**
   * Which side the pass named (0094 T5, second slice): set when the entry is
   * on THIS connection because the failure happened here; null when the
   * pass could not tell and the entry is on both cards.
   */
  readonly side: FailureSide | null;
}

/** A `migration_status` row with the two connections its migration signs in with. */
export interface StandingRow {
  readonly mappingId: string;
  readonly mappingName: string | null;
  readonly sourceConnectionId: string | null;
  readonly targetConnectionId: string | null;
  readonly domain: DiscoveryDomain;
  readonly category: string | null;
  readonly failedSide: string | null;
  readonly asOf: Date;
}

/**
 * Fold status rows into one entry per connection, migration and category,
 * latest first.
 *
 * ONE SIDE when the pass named it, BOTH when it could not. The pass tags a
 * failure at the closure that threw (`failed_side`, 0094 T5's second slice),
 * and a row that carries a side lands on that connection only. A row without
 * one — an older build's, or a failure on neither side — still lands on both
 * cards, because a category does not say which of the two connections failed
 * (`target_refused` included: the classifier files a source's 403 there too)
 * and guessing would put the line on the wrong card. The page says which
 * case it is showing.
 *
 * A category this build has no sentence for (a value written by an older or
 * newer one) is skipped — the rule `MigrationStatusStore` reads by. A side it
 * has no word for is read as none.
 */
export function standingFailuresByConnection(
  rows: ReadonlyArray<StandingRow>,
  connectionIds: ReadonlySet<string>,
): Map<string, StandingFailure[]> {
  interface Folded {
    mappingId: string;
    mappingName: string | null;
    category: FailureCategory;
    domains: Set<DiscoveryDomain>;
    asOf: Date;
    side: FailureSide | null;
  }
  const perConnection = new Map<string, Map<string, Folded>>();
  for (const row of rows) {
    if (!isFailureCategory(row.category)) continue;
    const side = isFailureSide(row.failedSide) ? row.failedSide : null;
    // Where this row lands, and what it says about why it landed there.
    const landings: ReadonlyArray<readonly [string | null, FailureSide | null]> =
      side === 'source'
        ? [[row.sourceConnectionId, 'source']]
        : side === 'target'
          ? [[row.targetConnectionId, 'target']]
          : [
              [row.sourceConnectionId, null],
              [row.targetConnectionId, null],
            ];
    for (const [connectionId, placedBy] of landings) {
      if (!connectionId || !connectionIds.has(connectionId)) continue;
      let byKey = perConnection.get(connectionId);
      if (!byKey) perConnection.set(connectionId, (byKey = new Map()));
      const key = `${row.mappingId}\u0000${row.category}`;
      const seen = byKey.get(key);
      if (seen) {
        seen.domains.add(row.domain);
        if (row.asOf > seen.asOf) seen.asOf = row.asOf;
        // A named side is a fact; an unnamed one is an absence. The fact wins.
        seen.side ??= placedBy;
      } else {
        byKey.set(key, {
          mappingId: row.mappingId,
          mappingName: row.mappingName,
          category: row.category,
          domains: new Set([row.domain]),
          asOf: row.asOf,
          side: placedBy,
        });
      }
    }
  }
  const out = new Map<string, StandingFailure[]>();
  for (const [connectionId, byKey] of perConnection) {
    out.set(
      connectionId,
      [...byKey.values()]
        .map((f) => ({
          mappingId: f.mappingId,
          mappingName: f.mappingName,
          category: f.category,
          domains: DISCOVERY_DOMAINS.filter((d) => f.domains.has(d)),
          asOf: f.asOf.toISOString(),
          side: f.side,
        }))
        .sort((a, b) => b.asOf.localeCompare(a.asOf) || a.category.localeCompare(b.category)),
    );
  }
  return out;
}

/**
 * The rows `standingFailuresByConnection` folds: every categorised
 * `migration_status` row of this organisation, with the two connections its
 * migration signs in with (workplan 0094 T5). Read inside the organisation's
 * own transaction.
 *
 * ONE READ FOR TWO QUESTIONS. The list asks it what stands on each card, and
 * a stored rotation asks it which migrations to carry on
 * (`carryOnAfterRotation`), so a reconnect presses Sync now for exactly the
 * migrations the card it was pressed on shows.
 *
 * `done` migrations are over: a rotation would fix nothing for them. Paused
 * ones stay; pausing is what a person does when a pass keeps failing.
 * Read-only: no column, no migration.
 */
export async function readStandingRows(db: PgDatabase, tenantId: string): Promise<StandingRow[]> {
  const sourceBox = alias(schema.mailbox, 'source_box');
  const targetBox = alias(schema.mailbox, 'target_box');
  return db
    .select({
      mappingId: schema.mailboxMapping.id,
      mappingName: schema.mailboxMapping.name,
      sourceConnectionId: sourceBox.connectionId,
      targetConnectionId: targetBox.connectionId,
      domain: schema.migrationStatus.domain,
      category: schema.migrationStatus.lastErrorCategory,
      failedSide: schema.migrationStatus.failedSide,
      asOf: schema.migrationStatus.updatedAt,
    })
    .from(schema.migrationStatus)
    .innerJoin(
      schema.mailboxMapping,
      eq(schema.mailboxMapping.id, schema.migrationStatus.mappingId),
    )
    .innerJoin(sourceBox, eq(sourceBox.id, schema.mailboxMapping.sourceMailboxId))
    .leftJoin(targetBox, eq(targetBox.id, schema.mailboxMapping.targetMailboxId))
    .where(
      and(
        eq(schema.migrationStatus.tenantId, tenantId),
        isNotNull(schema.migrationStatus.lastErrorCategory),
        ne(schema.mailboxMapping.status, 'done'),
      ),
    );
}

/**
 * A MIGRATION USES THIS MAILBOX — on either side.
 *
 * One definition, because the two places that ask were answering differently.
 * The delete guard below has always joined `mailbox_mapping` and says why
 * ("an INNER JOIN asks the question the refusal claims to be answering"); the
 * usage counter in the listing route did not, and counted `mailbox` rows while
 * its comment described this join. A mailbox row outlives every migration that
 * used it, so the card read "1 migration(s) use this" over connections nothing
 * referenced — while the delete guard, asked about the same connection, said
 * it was safe to remove. Two answers to one question, in one file.
 */
const MAPPING_USES_THIS_MAILBOX = or(
  eq(schema.mailboxMapping.sourceMailboxId, schema.mailbox.id),
  eq(schema.mailboxMapping.targetMailboxId, schema.mailbox.id),
);

router.get('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const rows = await withTenantDb(tenantId, pool(), async (db) => {
      const connections = await db
        .select({
          id: schema.connection.id,
          role: schema.connection.role,
          kind: schema.connection.kind,
          displayName: schema.connection.displayName,
          status: schema.connection.status,
          createdAt: schema.connection.createdAt,
          // Non-secret config only — `knownConnectionValues` filters it
          // through the descriptor before any of it leaves this route.
          config: schema.connection.config,
          // What the last test measured this account can carry (0106 T2):
          // the list shows badges without anybody pressing Test again.
          qualification: schema.connection.qualification,
          updatedAt: schema.connection.updatedAt,
        })
        .from(schema.connection)
        .where(eq(schema.connection.tenantId, tenantId));

      if (connections.length === 0) return [];

      // HOW MANY MIGRATIONS DEPEND ON EACH CONNECTION, and it has to reach the
      // mappings to know.
      //
      // This counted `mailbox` rows and stopped there, while its own comment
      // described a join to `mailbox_mapping` that was not in the query. A
      // mailbox row is created when an account is set up and outlives every
      // migration that ever used it, so the card said "1 migration(s) use
      // this" about connections no mapping references. Live 2026-09-12:
      // Soverin Full and a Microsoft account each claimed one with zero, while
      // a demo connection with two mailbox rows and one mapping claimed two.
      // The field was even called `usedByMailboxes` while the label said
      // migrations — the name admitted what the number was.
      //
      // DISTINCT, because a mapping that uses the same connection on both
      // sides (a reorganisation inside one account) is one migration, not two.
      const usage = await db
        .select({
          connectionId: schema.mailbox.connectionId,
          used: sql<number>`count(DISTINCT ${schema.mailboxMapping.id})::int`,
        })
        .from(schema.mailbox)
        .innerJoin(schema.mailboxMapping, MAPPING_USES_THIS_MAILBOX)
        .where(
          inArray(
            schema.mailbox.connectionId,
            connections.map((c) => c.id),
          ),
        )
        .groupBy(schema.mailbox.connectionId);
      const usedByMigrations = new Map(usage.map((u) => [u.connectionId, u.used]));

      // What is STANDING against each connection (workplan 0094 T5): the
      // categorised failure on every domain row of every migration that
      // signs in with it — on the side the pass named, or on both when it
      // could not; `standingFailuresByConnection` says why, and
      // `readStandingRows` which migrations are left out.
      const standing = standingFailuresByConnection(
        await readStandingRows(db, tenantId),
        new Set(connections.map((c) => c.id)),
      );

      return connections.map(({ config, ...c }) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        usedByMigrations: usedByMigrations.get(c.id) ?? 0,
        // Always an array, so a client cannot mistake "nothing stands" for
        // "a server that does not say".
        standingFailures: standing.get(c.id) ?? [],
        /**
         * What this connection already knows, so a rotation only asks for
         * what actually changed (workplan 0078). Built from `config` alone —
         * the encrypted record is never opened — and filtered through the
         * descriptor, so a secret field cannot appear here however the config
         * was written. The raw `config` is destructured away deliberately:
         * only the filtered view leaves.
         */
        knownValues: knownConnectionValues(
          c.role as 'source' | 'target',
          wizardTypeForConnectionKind(c.kind),
          config,
        ),
      }));
    });
    res.json({ connections: rows });
  } catch (error) {
    serverFault(res, 'list_failed', 'listing your connections', error);
  }
});

/**
 * "You still have to fill these in", as DATA rather than a finished sentence
 * (workplan 0071).
 *
 * This used to answer `Still needed: clientId.` — one English string naming
 * the STORAGE key. Both halves were wrong in front of a Dutch operator: the
 * sentence never translated, and `clientId` is not what any screen calls that
 * field (Dropbox's is labelled *App key* / *App-sleutel*). The owner met it
 * as `Still needed: clientId.` beside a form with no such box.
 *
 * `fields` is the fix and `reason` is the fallback. Per the prose boundary
 * (docs/i18n-prose-boundary.md, class 2) a stable machine handle is what the
 * client localizes against — it already holds the label for every key through
 * `credentialFieldsFor`, so it renders the same sentence the wizard shows, in
 * the operator's own language. The English `reason` stays for API consumers
 * that have no dictionary, which is the one audience the old string served.
 */
export function missingFieldsRefusal(missing: string[]): {
  error: string;
  fields: string[];
  reason: string;
} {
  return {
    error: 'missing_fields',
    fields: missing,
    reason: `Still needed: ${missing.join(', ')}.`,
  };
}

/**
 * "These values are not the right shape", also as data (workplan 0072).
 *
 * The sibling of `missingFieldsRefusal`, and it was left behind: a zod failure
 * rendered as `port: Invalid input: expected number, received NaN` — a zod
 * PATH and a zod SENTENCE, in English, in front of an operator reading Dutch,
 * naming the storage key rather than the label above the box. `fields` gives
 * the client the same handle it already uses for the missing-field case, so
 * one localizer covers both; `reason` keeps the zod detail for callers with no
 * dictionary, because "which value and why" is genuinely in there.
 */
function invalidValuesRefusal(error: z.ZodError): {
  error: string;
  fields: string[];
  reason: string;
} {
  return {
    error: 'invalid_values',
    fields: [...new Set(error.issues.map((i) => String(i.path[0] ?? '')).filter(Boolean))],
    reason: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '),
  };
}

const AddSchema = z.object({
  role: z.enum(['source', 'target']),
  type: z.string().min(1),
  displayName: z.string().min(1).max(255),
  /** Field key → what the person typed. Which keys are expected comes from
   *  the shared descriptor, so a form and this route cannot disagree. */
  values: z.record(z.string(), z.string()),
  /**
   * Saved for this person, who types its password on their grant link's page
   * (workplan 0174 §8.2): a password kind only, no secret taken, not probed.
   * See `account-for-a-person.ts`.
   */
  forPerson: z.string().uuid().optional(),
});

/**
 * The config shape a kind's VALUES are checked against.
 *
 * `CreateMappingBase`'s objects are the create door's, and that door demands
 * `username` of every source because every ACCOUNT has one: it names whose
 * mailbox, whose Drive, whose calendar. An export archive is not an account.
 * Its credential is a location (workplan 0116 T1), its descriptor carries
 * `provider` and `path` and nothing else — and the first honest body ever
 * posted here, the managed gate's, was refused with `invalid_values:
 * username` for a field no screen shows for the kind (E2E (managed) #154).
 * The browser's add-form posts only the descriptor's fields, so it was
 * refused the same way: a card that could be offered and not added.
 *
 * So the demand FOLLOWS THE DESCRIPTOR: a kind whose fields include no
 * `username` is not refused for lacking one, and every other kind keeps the
 * create door's shape untouched. Read at both doors, add and rotate, so the
 * two cannot drift apart on this.
 */
function configShapeFor(role: 'source' | 'target', fields: ReadonlyArray<CredentialField>) {
  if (role === 'target') return CreateMappingBase.shape.targetConfig;
  return fields.some((f) => f.key === 'username')
    ? CreateMappingBase.shape.sourceConfig
    : CreateMappingBase.shape.sourceConfig.extend({ username: z.string().optional() });
}

/**
 * Add a connection on its own, without creating a mapping (workplan 0063).
 *
 * PROBED BEFORE IT IS STORED, and stored either way with the outcome on
 * `status`: a credential that does not work yet is worth keeping (somebody is
 * mid-setup and an admin has not authorised the app), but it must not look
 * healthy. The provider's own words come back so the person can act on them.
 */
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const startedAt = Date.now();
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({
        error: 'invalid_body',
        reason: 'Send { role, type, displayName, values }.',
      });
    }
    const { role, type, displayName, values, forPerson } = parsed.data;

    const fields = credentialFieldsFor(role, type);
    if (fields.length === 0) {
      return void res.status(400).json({
        error: 'unknown_type',
        reason: `'${type}' is not a ${role} this product connects to.`,
      });
    }
    // FOR A PERSON (0174 §8.2): a password kind, with no secret, refused
    // without its server; judged before anything is shaped or stored.
    const kindOfType = role === 'source' ? sourceKindFor(type as never) : type;
    if (forPerson !== undefined) {
      const refused = forPersonRefusal(role, kindOfType, fields, values);
      if (refused) return void res.status(refused.status).json(refused.body);
    }
    const missing =
      forPerson === undefined
        ? fields.filter((f) => f.required && !values[f.key]?.trim()).map((f) => f.key)
        : missingForPerson(role, kindOfType, fields, values);
    if (missing.length > 0) {
      return void res.status(400).json(missingFieldsRefusal(missing));
    }
    // WHICH export, checked by name before the shape (0116 T1). The shared
    // parser behind `sourceConnectionConfig` throws on an export it does not
    // read, and a throw there is a 500 wearing the wrong sentence. Refused
    // here the way the create door refuses it — anchored to the field, naming
    // the list — because the wrong reader does not fail, it finds none of its
    // landmarks and reports an archive containing nothing.
    if (role === 'source' && type === 'archive' && !isArchiveProvider(values.provider)) {
      return void res.status(400).json({
        error: 'invalid_values',
        fields: ['provider'],
        reason:
          `provider: '${values.provider}' is not an export this product reads. ` +
          `Choose ${ARCHIVE_PROVIDERS.join(' or ')}.`,
      });
    }

    // Through the SAME zod object the create route validates, so a value this
    // accepts is one create would accept — port coerced because a form sends
    // strings and the schema wants a number.
    const shaped = {
      ...(forPerson === undefined ? values : shapedForPerson(role, kindOfType, fields, values)),
      ...(values.port ? { port: Number(values.port) } : {}),
      ...(values.mailPort ? { mailPort: Number(values.mailPort) } : {}),
    };
    const configShape = configShapeFor(role, fields);
    const checked = configShape.safeParse(shaped);
    if (!checked.success) {
      return void res.status(400).json({
        ...invalidValuesRefusal(checked.error),
      });
    }
    // Half a Google client pair is refused here as at the create door
    // (ADR-0041): with the deployment carrying a client, the run path would
    // complete the half with the WRONG other half, and the probe below would
    // then blame Google for it. Same sentence, same rule, before anything is
    // probed or stored.
    if (role === 'source' && isGoogleGrantKind(sourceKindFor(type as never))) {
      const halfPair = halfGoogleClientPairProblem(values);
      if (halfPair) {
        return void res.status(400).json({ error: 'half_client_pair', reason: halfPair });
      }
    }
    // And half a Dropbox app (2026-09-02: Connect with Dropbox), the same way.
    if (role === 'source' && sourceKindFor(type as never) === 'dropbox') {
      const halfPair = halfDropboxClientPairProblem(values);
      if (halfPair) {
        return void res.status(400).json({ error: 'half_client_pair', reason: halfPair });
      }
    }
    // And half a mail login (workplan 0161 T1): the mailbox's address without
    // its password, or the reverse, can sign in to nothing. Refused naming
    // the missing box, before anything is probed or stored. Not for a
    // person's account: its password is theirs to type (0174 §8.2).
    if (role === 'target' && forPerson === undefined) {
      const halfLogin = halfMailLogin(type, values);
      if (halfLogin) {
        return void res.status(400).json({ ...missingFieldsRefusal([halfLogin]), reason: halfMailLoginRefusal(halfLogin) });
      }
    }

    const half = checked.data as never;
    const config =
      role === 'source'
        ? sourceConnectionConfig({ sourceType: type as never, sourceConfig: half })
        : // WITH ITS TYPE (2026-09-03, the owner's "Unsupported target type:
          // undefined"): this call carried the fields alone, so the kind never
          // reached the shape builder — an imap target stored without
          // `type: 'imap-dav'` or its user, a jmap one without its baseUrl,
          // a soverin one without its mail face — and the first migration to
          // reuse the row handed the writer switch nothing to switch on. The
          // wizard's own door has always passed it; this door builds exactly
          // what that one builds.
          targetConnectionConfig({ targetType: type as TargetKind, targetConfig: half } as never);
    const kind = role === 'source' ? sourceKindFor(type as never) : type;
    // NOT A PATH ON THIS MACHINE (0136 T5). Judged on the config this door
    // would store, before the probe below opens it and the qualifier walks it
    // inside this process. See `archive-on-the-server.ts`.
    const onServer = archiveOnServerRefusal(kind, config);
    if (onServer) return void res.status(400).json(onServer);
    // A target's record through the one builder every door uses (0161 T1).
    const creds =
      role === 'source'
        ? sourceCredentialRecord({ sourceType: type as never, sourceConfig: half })
        : targetCredentialRecord(type, values);

    // A closed organisation takes no new access, and nothing is probed with
    // it (0085 T2).
    if (await refusedAsClosed(res, tenantId, pool())) return;
    // Nor does anybody who has not accepted the current texts, while the
    // deployment asks (0139 T3).
    if (await refusedUntilAccepted(res, tenantId, req.userId, pool())) return;

    // SAVED FOR A PERSON (0174 §8.2): the person must be this organisation's;
    // nothing is probed, nothing qualified, and the row is stored `error`, as
    // an account saved by its address alone for a link always was.
    if (forPerson !== undefined) {
      const saved = await withTenantDb(tenantId, pool(), async (db) => {
        if (!(await personOfThisOrganisation(db, tenantId, forPerson))) return null;
        return db
          .insert(schema.connection)
          .values({
            tenantId,
            role,
            kind: kind as never,
            displayName,
            config,
            secretRef: JSON.stringify(
              SecretStore.encryptCredentials(creds as Record<string, string>).encrypted,
            ),
            status: 'error',
          })
          .returning({ id: schema.connection.id });
      });
      if (saved === null) return void res.status(PERSON_NOT_FOUND.status).json(PERSON_NOT_FOUND.body);
      return void res.status(201).json({ id: saved[0]!.id, forPerson: true });
    }

    // One test against the member's limit, now that it will connect (0136 T3).
    if (refusedOverTestLimit(req, res)) return;
    // What a host the tester typed said is answered from its parts (0136 T3).
    const answers = probeAnswers('adding a connection', tenantId);
    const probe = answers.result(
      role === 'target'
        ? await probeTargetConnection(
            (TARGET_KINDS as ReadonlyArray<string>).includes(type) ? (type as TargetKind) : 'webdav',
            config,
            creds as Record<string, string>,
          )
        : await probeSourceConnection(
            sourceKindFor(type as never),
            config,
            creds as Record<string, string>,
          ),
    );

    const inserted = await withTenantDb(tenantId, pool(), (db) =>
      db
        .insert(schema.connection)
        .values({
          tenantId,
          role,
          kind: kind as never,
          displayName,
          config,
          secretRef: JSON.stringify(
            SecretStore.encryptCredentials(creds as Record<string, string>).encrypted,
          ),
          status: probe.ok ? 'connected' : 'error',
        })
        .returning({ id: schema.connection.id }),
    );

    // Qualify the account behind the fresh row (0106 T0) — what the other
    // protocol faces answered, remembered from day one.
    const qualification = await qualifyAndRemember(
      tenantId,
      inserted[0]!.id,
      kind,
      config,
      creds as Record<string, string>,
      req.userId ?? 'unknown',
      startedAt + DOOR_BUDGET_MS,
      answers,
    );

    res.status(201).json({
      id: inserted[0]!.id,
      ...probe,
      ...qualificationField(qualification),
    });
  } catch (error) {
    serverFault(res, 'add_failed', 'adding this connection', error);
  }
});

router.post('/:id/test', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const startedAt = Date.now();
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return void res.status(400).json({ error: 'invalid_path', reason: 'id is required' });

    const found = await withTenantDb(tenantId, pool(), (db) =>
      db
        .select()
        .from(schema.connection)
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId))),
    );
    const row = found[0];
    if (!row) {
      return void res.status(404).json({ error: 'not_found', reason: 'No such connection.' });
    }
    // A Test uses the stored access, and records what it found (0085 T2):
    // refused for a closed organisation before either.
    if (await refusedAsClosed(res, tenantId, pool())) return;
    // A STORED archive whose path is on this machine (0136 T5): an archive
    // row from before the refusal, or one written by hand. 409, because the
    // request is fine and the row is what this edition cannot serve. Nothing
    // opens the path, but the row's status becomes `error`: the page re-reads
    // the row after every Test, and a row stored `connected` would otherwise
    // stay green beside an answer that says it cannot be read.
    const onServer = archiveOnServerRefusal(row.kind, row.config as Record<string, unknown> | null);
    if (onServer) {
      await withTenantDb(tenantId, pool(), (db) =>
        db
          .update(schema.connection)
          .set({ status: 'error', updatedAt: new Date() })
          .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId))),
      );
      return void res.status(409).json(onServer);
    }

    // A connection with no stored secret cannot be probed — say which it is
    // rather than reporting a credential failure it did not have.
    if (!row.secretRef) {
      return void res.json({
        ok: false,
        reason:
          'This connection has no stored credentials, so there is nothing to test. It was ' +
          'created before credentials were saved, or they were cleared.',
      });
    }

    const creds = SecretStore.decryptCredentials(row.secretRef);
    const config = (row.config ?? {}) as Record<string, unknown>;
    if (refusedOverTestLimit(req, res)) return;
    const answers = probeAnswers('testing a connection', tenantId);
    const result = answers.result(
      row.role === 'target'
        ? await probeTargetConnection(
            (TARGET_KINDS as ReadonlyArray<string>).includes(row.kind)
              ? (row.kind as TargetKind)
              : 'webdav',
            config,
            creds,
          )
        : await probeSourceConnection(row.kind, config, creds),
    );

    // Record what the probe found, so the list says what was last true rather
    // than what was true when the connection was created.
    await withTenantDb(tenantId, pool(), (db) =>
      db
        .update(schema.connection)
        .set({ status: result.ok ? 'connected' : 'error', updatedAt: new Date() })
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId))),
    );

    // And what the account CAN CARRY (0106 T0) — re-measured on every test,
    // whatever the headline probe said: a caldav 401 beside a passing imap
    // face is exactly the per-protocol scoping the record exists to show.
    const qualification = await qualifyAndRemember(
      tenantId,
      id,
      row.kind,
      config,
      creds,
      req.userId ?? 'unknown',
      startedAt + DOOR_BUDGET_MS,
      answers,
    );

    res.json({ ...result, ...qualificationField(qualification) });
  } catch (error) {
    serverFault(res, 'test_failed', 'testing this connection', error);
  }
});

/** Which browse a saved account's folders come from, by its kind. */
const FOLDER_BROWSE_OF_KIND: Readonly<Record<string, 'google' | 'dropbox'>> = {
  google: 'google',
  google_drive: 'google',
  dropbox: 'dropbox',
};

/** One folder a migration may start from, as the browse lists it. */
export interface FolderToStartFrom {
  /**
   * What the migration's root becomes: a folder id on Google, a path on
   * Dropbox. Absent where it cannot be chosen: a Dropbox folder shared with
   * the account and not added to it has no path yet.
   */
  readonly value?: string;
  readonly name: string;
  readonly kind: 'shared-drive' | 'shared-folder';
  /** Who shared it, where the provider says. */
  readonly owner?: string;
}

/**
 * THE FOLDERS A SAVED ACCOUNT CAN START FROM (0153 open question 5, item 4;
 * the owner, 2026-10-04: *"go with the recommendations"*).
 *
 * *Only one folder* on *Start a migration* asks for the folder once the
 * account is connected, and offers the wizard's *Browse…* for it. The
 * wizard's browse takes the credential in the request, typed into its form.
 * The flow saves the account first, so this one reads the stored credential,
 * with the deployment's own application where the account has none, as the
 * Test and a pass read it (`credentialsForProbe`).
 *
 * Google: the shared drives and the folders other accounts shared with this
 * one, from the same two calls the wizard makes. A folder in the account's own
 * Drive is pasted by its link, as in the wizard. Dropbox: its shared folders,
 * where only one added to the account has a path to start from. Box lists
 * nothing here, as the wizard did not: its folder is typed.
 *
 * Read-only, and nothing is stored. It uses the stored access, so a closed
 * organisation is refused before the credential is read (0085 T2). Not under
 * the limit on tests: it connects to the provider's own published service,
 * never to an address somebody typed (0136 T3). A provider's refusal comes
 * back in its own words, as the wizard's browse returns it. Where one of
 * Google's two lists is refused, the other still comes back.
 */
router.get('/:id/folders', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return void res.status(400).json({ error: 'invalid_path', reason: 'id is required' });

    const found = await withTenantDb(tenantId, pool(), (db) =>
      db
        .select()
        .from(schema.connection)
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId))),
    );
    const row = found[0];
    if (!row) {
      return void res.status(404).json({ error: 'not_found', reason: 'No such connection.' });
    }
    const browse =
      row.role === 'source' && Object.prototype.hasOwnProperty.call(FOLDER_BROWSE_OF_KIND, row.kind)
        ? FOLDER_BROWSE_OF_KIND[row.kind]
        : undefined;
    if (browse === undefined) {
      return void res.status(400).json({
        error: 'no_folders',
        reason:
          row.role === 'source' && row.kind === 'box'
            ? "Box's folders are not listed here: type the folder's number, from its address in Box."
            : 'This account has no folders to list here: a migration from it reads the whole account.',
      });
    }
    if (await refusedAsClosed(res, tenantId, pool())) return;
    if (!row.secretRef) {
      return void res.json({
        ok: false,
        reason:
          'This account has no stored sign-in, so its folders cannot be listed. Connect it again first.',
      });
    }

    const creds = credentialsForProbe(row.kind, SecretStore.decryptCredentials(row.secretRef));
    if (browse === 'dropbox') {
      const listed = await listDropboxSharedFolders(creds);
      if (!listed.ok) return void res.json(listed);
      const folders: FolderToStartFrom[] = listed.folders.map((f) => ({
        ...(f.path ? { value: f.path } : {}),
        name: f.name,
        kind: 'shared-folder',
      }));
      return void res.json({ ok: true, key: 'rootPath', folders });
    }

    // Google: both lists, and the half that answered still comes back.
    const [drives, shared] = await Promise.all([listGoogleSharedDrives(creds), listGoogleSharedFolders(creds)]);
    const folders: FolderToStartFrom[] = [
      ...(drives.ok ? drives.drives.map((d) => ({ value: d.id, name: d.name, kind: 'shared-drive' as const })) : []),
      ...(shared.ok
        ? shared.folders.map((f) => ({
            value: f.id,
            name: f.name,
            kind: 'shared-folder' as const,
            ...(f.owner ? { owner: f.owner } : {}),
          }))
        : []),
    ];
    const refusals = [...(drives.ok ? [] : [drives.reason]), ...(shared.ok ? [] : [shared.reason])];
    if (!drives.ok && !shared.ok) return void res.json({ ok: false, reason: refusals.join(' ') });
    res.json({
      ok: true,
      key: 'rootFolderId',
      folders,
      ...(refusals.length > 0 ? { refused: refusals.join(' ') } : {}),
    });
  } catch (error) {
    serverFault(res, 'listing_failed', "listing this account's folders", error);
  }
});

/**
 * The tenant a Microsoft account's stored credential holds, where a rotation
 * that sends none replaces the same registration: the same client id, or none
 * on either side (the deployment's). Undefined otherwise, and wherever the
 * stored credential cannot be read: the rotation then stores what was sent.
 */
export function keptTenant(
  secretRef: unknown,
  values: Readonly<Record<string, string>>,
): string | undefined {
  if ((values.tenantId ?? '').trim() !== '') return undefined;
  let stored: Record<string, string>;
  try {
    stored = SecretStore.decryptCredentials(secretRef as object);
  } catch {
    return undefined;
  }
  const tenant = (stored.tenantId ?? '').trim();
  if (tenant === '') return undefined;
  return (stored.clientId ?? '').trim() === (values.clientId ?? '').trim() ? tenant : undefined;
}

/**
 * The credential record a rotation may keep a mail login from (workplan 0161
 * T1): read only for a kind that signs in to mail apart, so every other kind
 * rotates exactly as before, and `{}` where there is nothing readable to keep.
 *
 * An unreadable record keeps nothing, as `keptTenant` keeps no tenant from
 * one: the rotation stores what was sent, the line below says so in the log
 * by connection id, and the qualification that follows the rotation names
 * the missing mail login by field, so it is not lost without a word.
 */
export function storedMailLogin(row: {
  readonly id: string;
  readonly kind: string;
  readonly secretRef?: unknown;
}): Record<string, string> {
  if (!signsInToMailApart(row.kind) || !row.secretRef) return {};
  try {
    return SecretStore.decryptCredentials(row.secretRef as object);
  } catch (err) {
    log.warn(
      `[rotate] connection ${row.id}: its stored credentials could not be read, so no mail login was ` +
        'kept from them; the replacement is stored as sent:',
      loggableError(err),
    );
    return {};
  }
}

/** The audit action a replacement of a connection's credentials is recorded under (0137 T4). */
export const CREDENTIALS_REPLACED_ACTION = 'connection.credentials_replaced';

/**
 * Who replaced a connection's account, on the transaction it is handed: the
 * connection by id, side and kind, and whether the new account was stored.
 * Never the address, the user name or the password, old or new.
 */
async function recordCredentialsReplaced(
  db: ConstructorParameters<typeof PgLedger>[0],
  tenantId: string,
  actor: string,
  row: { readonly id: string; readonly role: string; readonly kind: string },
  accountStored: boolean,
): Promise<void> {
  await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
    actor,
    action: CREDENTIALS_REPLACED_ACTION,
    entity: 'connection',
    detail: { connectionId: row.id, side: row.role, kind: row.kind, accountStored },
  });
}

/** A migration a stored rotation pressed *Sync now* for, and the run that press started. */
export interface Resumed {
  readonly mappingId: string;
  readonly runId: string;
}

/**
 * A migration a stored rotation pressed *Sync now* for that did not start: the
 * gate's code and sentence as `pressSyncNow` wrote them (`error`, and its
 * `message` as `reason`), or `press_failed` and a reference when the press
 * itself failed.
 */
export interface NotResumed {
  readonly mappingId: string;
  readonly error: string;
  readonly reason: string;
}

/** The code and the sentence of a refusal `pressSyncNow` wrote. */
function refusalOf(body: unknown): { error: string; reason: string } {
  const { error, message } = (typeof body === 'object' && body !== null ? body : {}) as {
    error?: unknown;
    message?: unknown;
  };
  return {
    error: typeof error === 'string' ? error : 'refused',
    reason: typeof message === 'string' ? message : '',
  };
}

/**
 * The migrations a stored rotation presses *Sync now* for, out of what stands
 * against the connection: one per migration, however many of its data types
 * failed, latest failure first, and only for a cause whose remedy is a person.
 * A rate limit, a spent daily allowance and a network blip
 * (`SELF_HEALING_CATEGORIES`) are not waiting for a new credential, and keep
 * their cadence anyway (`failing-backoff.ts`).
 */
export function migrationsToCarryOn(standing: ReadonlyArray<StandingFailure>): string[] {
  const ids = new Set<string>();
  for (const failure of standing) {
    if (!SELF_HEALING_CATEGORIES.has(failure.category)) ids.add(failure.mappingId);
  }
  return [...ids];
}

/**
 * A RECONNECT CARRIES ON THE MIGRATIONS IT WAS FAILING, AT ONCE (2026-11-15).
 *
 * Both pages promise it. The Accounts page's row says that once its button is
 * pressed "the migration then carries on from where it stopped"; a
 * migration's page says that after Reconnect or Replace credentials "this will
 * carry on from where it stopped". Nothing kept the promise. On
 * the OTA stack a Google refresh token expired (a consent screen in Testing
 * gives seven days), every pass of its migration failed `auth_expired` from
 * that evening on, and by the next day the failing ladder
 * (`failing-backoff.ts`) had widened the gap between attempts to four hours,
 * on its way to one a day: it counts the failed passes since the last success,
 * and a credential stored in between is not a success. The owner pressed
 * Reconnect, the row said `connected`, and nothing ran. The ladder's own
 * comment says a repaired credential resumes "at worst a day later, and
 * immediately if anybody presses Sync"; the person who just repaired it was
 * never told that, and should not need to be.
 *
 * So a rotation that STORED its credential presses *Sync now* for each
 * migration standing against this connection, through `pressSyncNow`: the
 * button's own gates and its one enqueue, so every gate applies as it does to
 * the button. The migration read under row security, a closed organisation, a
 * paused migration, a withdrawn grant, Free's pace, and the operator hold
 * right before the enqueue, on the migration's own partition. A refused probe
 * stores nothing and presses nothing.
 *
 * WHICH MIGRATIONS. The ones the card it was pressed on lists: the same rows
 * (`readStandingRows`) and the same fold (`standingFailuresByConnection`), so
 * a failure the pass placed on the other side is not pressed for here, and one
 * it could not place is, as it is on both cards. Of those, the causes
 * `migrationsToCarryOn` keeps. And only a migration the tick would run passes
 * for, asked as the pass itself asks it (`readPathPhases`, its `anyRuns`): one
 * in its cutover's grace period is, one past it with nothing kept copying is
 * not, since a pass started for it would stop at its first step. A paused
 * migration is pressed all the same, and the button's own gate refuses it, so
 * the answer says why it did not carry on. How many passes one reconnect can
 * start is bounded as every pass started by hand is: by the organisation's
 * unfinished migrations, which the cap on migrations per organisation holds
 * (`migration-cap.ts`; 0143 T2a), and not by the tick's caps on passes in
 * flight.
 *
 * WHAT IT ANSWERS. `resumed`, each migration whose pass was enqueued and the
 * run it started; `notResumed`, each one a gate refused, with the refusal's
 * code and sentence as `pressSyncNow` wrote them (an operator hold, Free's
 * pace, a paused migration, a withdrawn grant). Data beside the rotation's
 * answer, never instead of it: the credential is stored either way.
 *
 * A FAULT HERE IS NOT THE ROTATION'S. A press that throws is logged with a
 * reference, recorded on the operator's log page, and listed under
 * `notResumed` as `press_failed` with that reference. A read that throws before
 * any press leaves both fields out: an absence, never an empty list standing
 * for "nothing was failing". Neither turns a stored rotation into a 500, and
 * the tick still carries the migration on by itself, at the ladder's pace.
 *
 * No visit is recorded (`visits.ts`): a visit is somebody opening the
 * migration's page or pressing its button, and it brings an automatic
 * migration back to hourly for 14 days. A reconnect on the Accounts page is
 * neither, and the first pass that succeeds ends the ladder's gap by itself.
 */
async function carryOnAfterRotation(
  tenantId: string,
  connectionId: string,
): Promise<{ resumed: Resumed[]; notResumed: NotResumed[] } | Record<never, never>> {
  let waiting: string[];
  try {
    waiting = await withTenantDb(tenantId, pool(), async (db) => {
      const standing =
        standingFailuresByConnection(await readStandingRows(db, tenantId), new Set([connectionId])).get(
          connectionId,
        ) ?? [];
      const running: string[] = [];
      for (const mappingId of migrationsToCarryOn(standing)) {
        const phases = await readPathPhases(db, tenantId, mappingId);
        if (phases && (phases.anyRuns || phases.status === 'paused')) running.push(mappingId);
      }
      return running;
    });
  } catch (err) {
    const reference = newReference();
    log.error(
      `[rotate] connection ${connectionId}: the credential is stored, but the migrations failing on it ` +
        `could not be read, so none was pressed [ref ${reference}]:`,
      loggableError(err),
    );
    void recordAppEvent({ level: 'error', event: 'connection.carry_on_failed', reference, tenantId });
    return {};
  }

  const resumed: Resumed[] = [];
  const notResumed: NotResumed[] = [];
  for (const mappingId of waiting) {
    // What the gate wrote, kept instead of sent: the rotation answers for itself.
    let refusal: unknown;
    const kept: Answerable = {
      status: () => ({
        json: (body) => {
          refusal = body;
          return undefined;
        },
      }),
    };
    try {
      const pressed = await pressSyncNow(kept, tenantId, mappingId, {}, pool());
      if (pressed) {
        resumed.push({ mappingId, runId: pressed.run.id });
      } else if (refusal === undefined) {
        // A refusal that wrote nothing is no refusal to report as one.
        throw new Error('Sync now refused and answered nothing');
      } else {
        notResumed.push({ mappingId, ...refusalOf(refusal) });
      }
    } catch (err) {
      const reference = newReference();
      log.error(
        `[rotate] connection ${connectionId}: the credential is stored, but Sync now could not be pressed ` +
          `for migration ${mappingId} [ref ${reference}]:`,
        loggableError(err),
      );
      void recordAppEvent({ level: 'error', event: 'connection.carry_on_failed', reference, tenantId, mappingId });
      notResumed.push({
        mappingId,
        error: 'press_failed',
        reason:
          'Something went wrong pressing Sync now for this migration — this is a fault on our side, not ' +
          `something your input caused. Reference ${reference}: mention it when you contact us.`,
      });
    }
  }
  return { resumed, notResumed };
}

/**
 * Replace a connection's credentials in place (workplan 0065).
 *
 * The add route minus the insert. It exists because credentials EXPIRE — a
 * rotated Box secret, a revoked Google refresh token — and without it the only
 * repair was creating a new connection and a new mapping, abandoning the
 * ledger history that made the old one useful.
 *
 * The row keeps its id, so every mapping pointing at it keeps working. What
 * changes is the secret and, if the probe now succeeds, the status. The new
 * credentials are PROBED BEFORE they replace the old ones, and a failure
 * leaves the old ones in place: half-rotating a working connection into a
 * broken one because somebody pasted the wrong value is worse than refusing.
 *
 * WHO REPLACED IT IS RECORDED (workplan 0137 T4). For a target, the account is
 * where every migration on the connection writes, and the probe passes for any
 * real account on the same server, so a replacement can repoint a migration
 * at somebody else's account and still look healthy. `connection.qualified`
 * did not say so: a plain Test press writes the same row. Every probed
 * replacement now writes `connection.credentials_replaced`, with the caller as
 * actor: in the update's own transaction when the new account is stored
 * (`accountStored: true`, and a record that cannot be written keeps the old
 * account), and in one of its own when the probe refuses it and nothing is
 * stored (`accountStored: false`). A request refused before the probe records
 * nothing, and so does one whose connection was deleted while the new account
 * was probed: the update finds no row, nothing is stored, and it answers 404.
 * Guard: `an-account-replaced-is-recorded.integration.test.ts`.
 *
 * AND WHAT WAS FAILING ON IT CARRIES ON (2026-11-15). Once the new account is
 * stored, *Sync now* is pressed for each migration standing against this
 * connection for a cause a person had to fix, and the answer says which
 * started (`resumed`) and which a gate refused (`notResumed`):
 * `carryOnAfterRotation`. Guard: `a-reconnect-that-carries-on.unit.test.ts`.
 */
router.put('/:id/credentials', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  const startedAt = Date.now();
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return void res.status(400).json({ error: 'invalid_path', reason: 'id is required' });

    const parsed = z.object({ values: z.record(z.string(), z.string()) }).safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: 'invalid_body', reason: 'Send { values }.' });
    }

    const found = await withTenantDb(tenantId, pool(), (db) =>
      db
        .select()
        .from(schema.connection)
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId))),
    );
    const row = found[0];
    if (!row) {
      return void res.status(404).json({ error: 'not_found', reason: 'No such connection.' });
    }
    // Rotating probes the STORED config before anything is replaced, so a
    // stored archive on this machine's disk is refused here as at the test
    // door (0136 T5).
    const onServer = archiveOnServerRefusal(row.kind, row.config as Record<string, unknown> | null);
    if (onServer) return void res.status(409).json(onServer);

    // By wizard type, not by kind — the descriptor is keyed the wizard's way.
    const type = wizardTypeForConnectionKind(row.kind);
    const fields = credentialFieldsFor(row.role, type);
    const missing = parsed.data.values
      ? fields.filter((f) => f.required && !parsed.data.values[f.key]?.trim()).map((f) => f.key)
      : [];
    if (missing.length > 0) {
      return void res.status(400).json(missingFieldsRefusal(missing));
    }

    const values = parsed.data.values;
    const shaped = {
      ...values,
      ...(values.port ? { port: Number(values.port) } : {}),
      ...(values.mailPort ? { mailPort: Number(values.mailPort) } : {}),
    };
    const configShape = configShapeFor(row.role, fields);
    const checked = configShape.safeParse(shaped);
    if (!checked.success) {
      return void res.status(400).json({
        ...invalidValuesRefusal(checked.error),
      });
    }
    // Rotation REPLACES the stored credential (see below), so half a pair sent
    // here would be stored as half a pair and completed with the deployment's
    // other half at mint time — the same hole as at the create door, refused
    // the same way (ADR-0041).
    if (row.role === 'source' && isGoogleGrantKind(row.kind)) {
      const halfPair = halfGoogleClientPairProblem(values);
      if (halfPair) {
        return void res.status(400).json({ error: 'half_client_pair', reason: halfPair });
      }
    }
    if (row.role === 'source' && row.kind === 'dropbox') {
      const halfPair = halfDropboxClientPairProblem(values);
      if (halfPair) {
        return void res.status(400).json({ error: 'half_client_pair', reason: halfPair });
      }
    }
    // Half a mail login, refused as at the add door (workplan 0161 T1). Both
    // boxes empty is not half of one: it keeps the login stored (below).
    if (row.role === 'target') {
      const halfLogin = halfMailLogin(row.kind, values);
      if (halfLogin) {
        return void res.status(400).json({ ...missingFieldsRefusal([halfLogin]), reason: halfMailLoginRefusal(halfLogin) });
      }
    }

    // The CONFIG is deliberately left alone: rotation replaces a secret, not
    // where the migration is rooted. Changing both here would let a rotation
    // silently re-point a mapping at a different folder.
    //
    // A closed organisation takes no new access, and nothing is probed with
    // it (0085 T2). Nor does anybody who has not accepted the current texts,
    // while the deployment asks (0139 T3).
    if (await refusedAsClosed(res, tenantId, pool())) return;
    if (await refusedUntilAccepted(res, tenantId, req.userId, pool())) return;
    if (refusedOverTestLimit(req, res)) return;

    // A ROTATION KEEPS THE DIRECTORY ITS REGISTRATION BELONGS TO (0153 open
    // question 5). The panel offers what is required, secret or paired, and a
    // Microsoft account's tenant is none of those, so replacing a revoked
    // token dropped it, and the next pass asked `common` for a single-tenant
    // application it could not find. Kept when the same registration is
    // rotated; a different pair brings its own tenant, or none. Read after the
    // close, as every use of the stored access is.
    const kept = row.role === 'source' && row.kind === 'microsoft' ? keptTenant(row.secretRef, values) : undefined;
    const half = (kept === undefined ? checked.data : { ...checked.data, tenantId: kept }) as never;
    // A ROTATION KEEPS THE MAILBOX'S LOGIN (workplan 0161 T1). For a kind that
    // signs in to mail apart, the panel offers the two mail boxes beside the
    // sync login, and both left empty means "as it is": the record replaces
    // the whole secret, so without this a renewed app password would drop
    // the mail login without a word, and the next pass's mail would refuse.
    // Read before the probe, as the tenant above is, so the probe is handed
    // exactly what is stored. Nothing else writes this login, so there is no
    // refresh to race, unlike Cirrux's Drive grant below.
    const creds =
      row.role === 'source'
        ? sourceCredentialRecord({ sourceType: type as never, sourceConfig: half })
        : keepingTheMailLogin(row.kind, storedMailLogin(row), targetCredentialRecord(row.kind, values));
    const answers = probeAnswers('replacing credentials', tenantId);
    const probe = answers.result(
      row.role === 'target'
        ? await probeTargetConnection(
            (TARGET_KINDS as ReadonlyArray<string>).includes(row.kind)
              ? (row.kind as TargetKind)
              : 'webdav',
            (row.config ?? {}) as Record<string, unknown>,
            creds as Record<string, string>,
          )
        : await probeSourceConnection(
            row.kind,
            (row.config ?? {}) as Record<string, unknown>,
            creds as Record<string, string>,
          ),
    );

    const actor = req.userId ?? 'unknown';
    if (!probe.ok) {
      // The old credentials stay. Every mapping on this connection keeps
      // whatever it had, which may well still be working. Somebody tried to
      // replace the account all the same, and that is recorded (0137 T4).
      await withTenantDb(tenantId, pool(), (db) => recordCredentialsReplaced(db, tenantId, actor, row, false));
      return void res.status(200).json({ ...probe, rotated: false });
    }

    // The probe takes seconds, and the connection may be deleted meanwhile.
    // Then the update changes no row: nothing was stored, so it is a 404 and
    // no `accountStored: true` record (0137 T4).
    //
    // A CIRRUX ACCOUNT KEEPS ITS DRIVE (workplan 0160 T5). The app password is
    // replaced; the Drive sign-in stored beside it is the person's, and is
    // carried across for the same mailbox. It is read under the row's lock, in
    // this transaction, so a refresh in flight cannot store a successor that
    // this would then overwrite with the token it retired (ADR-0052).
    const stored = await withTenantDb(tenantId, pool(), async (db) => {
      const record =
        row.role === 'target' && row.kind === 'cirrux'
          ? await mergeKeepingTheDriveGrant(db, tenantId, id, creds as Record<string, string>)
          : (creds as Record<string, string>);
      const updated = await db
        .update(schema.connection)
        .set({
          secretRef: JSON.stringify(SecretStore.encryptCredentials(record).encrypted),
          status: 'connected',
          updatedAt: new Date(),
        })
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId)))
        .returning({ id: schema.connection.id });
      if (updated.length === 0) return undefined;
      await recordCredentialsReplaced(db, tenantId, actor, row, true);
      return record;
    });
    if (!stored) {
      return void res.status(404).json({ error: 'not_found', reason: 'No such connection.' });
    }

    // The migrations this connection was failing carry on now, rather than at
    // the failing ladder's next rung. Before the qualification, so the presses
    // count against the door's budget and the measuring gets what is left
    // (it answers `qualificationPending` past it); never fails the rotation.
    const carriedOn = await carryOnAfterRotation(tenantId, id);

    // A rotated credential may carry different protocol scopes than the one
    // it replaces (an app-password minted for IMAP only, say) — re-qualify
    // with what is now stored (0106 T0).
    const qualification = await qualifyAndRemember(
      tenantId,
      id,
      row.kind,
      (row.config ?? {}) as Record<string, unknown>,
      stored,
      actor,
      startedAt + DOOR_BUDGET_MS,
      answers,
    );

    res.json({ ...probe, rotated: true, ...carriedOn, ...qualificationField(qualification) });
  } catch (error) {
    serverFault(res, 'rotate_failed', 'replacing these credentials', error);
  }
});

/**
 * Delete a connection — but only one nothing depends on (workplan 0066).
 *
 * THE REFUSAL IS THE FEATURE. `mailbox.connection_id` cascades on delete, and
 * `item` hangs off the mailboxes, so letting this through for a connection in
 * use would not fail loudly — it would take the mailboxes and the entire
 * migration ledger with it, silently, and the next pass would re-copy
 * everything as though it had never run. Hard rule 2 is about not destroying a
 * customer's data on their servers; this is about not destroying the record of
 * what we already did with it, which is the same promise wearing different
 * clothes.
 *
 * So: refuse while anything uses it, and say how many and which migrations, so
 * the answer is actionable rather than a flat no.
 *
 * A delete that goes through is recorded as `connection.deleted` (workplan
 * 0137 T4), with the caller as actor, in the delete's own transaction. The
 * second of two deletes that overlap removes no row, so it records nothing
 * and answers 404. Guard: `connection-delete-revokes.integration.test.ts`.
 */
/**
 * The one revoker both editions use (0085 T4a/T9): Google's endpoint for the
 * kinds that store a refresh token, an honest `unsupported` with the reason
 * for every other kind. Built lazily and once; it reads the global `fetch` at
 * call time, which is the seam the integration test stubs.
 */
let revoker: TokenRevoker | undefined;
const tokenRevoker = (): TokenRevoker => (revoker ??= new HttpTokenRevoker());

/** The audit action a connection's delete is recorded under (0137 T4). */
export const CONNECTION_DELETED_ACTION = 'connection.deleted';

router.delete('/:id', authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.tenantId) {
      return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID not found' });
    }
    const tenantId = req.tenantId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return void res.status(400).json({ error: 'invalid_path', reason: 'id is required' });

    const outcome = await withTenantDb(tenantId, pool(), async (db) => {
      const found = await db
        .select({
          id: schema.connection.id,
          displayName: schema.connection.displayName,
          kind: schema.connection.kind,
          role: schema.connection.role,
          secretRef: schema.connection.secretRef,
          // The legacy column is not modelled by drizzle — nothing has written
          // it for a long time — but the shared revocation still reads it, so
          // this reads it too, the same way, rather than deciding here that a
          // deployment old enough to have used it has nothing to revoke.
          legacyCredentials: sql<string | null>`encrypted_credentials`,
        })
        .from(schema.connection)
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId)));
      if (!found[0]) return { status: 404 as const };

      /**
       * What actually depends on this connection: MIGRATIONS (workplan 0072).
       *
       * This was a LEFT JOIN counting `mailbox` rows, which is not the same
       * question. A mailbox row outlives the migration that created it — the
       * ledger hangs off `item.mapping_id`, never off the mailbox — so a
       * connection whose migrations had all been removed still answered 409,
       * counting a row nothing referenced. The refusal then had no name to
       * give ("still used by 1 mailbox") and named no migration to go and
       * remove, because there was none: an unactionable no, in front of a
       * delete that was in fact safe. The owner met exactly that on the older
       * connections.
       *
       * An INNER JOIN asks the question the refusal claims to be answering.
       * Named, not just counted, for the reason 0068 T4 gives: "3 mailboxes"
       * is a number, "Acme mail" is something a person can act on.
       */
      const users = await db
        .select({ mapping: schema.mailboxMapping.name })
        .from(schema.mailbox)
        .innerJoin(schema.mailboxMapping, MAPPING_USES_THIS_MAILBOX)
        .where(eq(schema.mailbox.connectionId, id));

      if (users.length > 0) {
        const names = [...new Set(users.map((u) => u.mapping).filter(Boolean))];
        return { status: 409 as const, used: users.length, names };
      }

      // The read above takes no lock, so two presses of the same delete can
      // both get this far. The second one's DELETE waits for the first and
      // then removes nothing: it is a 404, not a second delete to record, to
      // answer 200 for or to revoke again (0137 T4).
      const gone = await db
        .delete(schema.connection)
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId)))
        .returning({ id: schema.connection.id });
      if (gone.length === 0) return { status: 404 as const };
      // Who deleted it (0137 T4), in the delete's own transaction: a record
      // that cannot be written keeps the connection, and revokes nothing. Its
      // id, side and kind, never its name, address or user name.
      await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
        actor: req.userId ?? 'unknown',
        action: CONNECTION_DELETED_ACTION,
        entity: 'connection',
        detail: { connectionId: found[0].id, side: found[0].role, kind: found[0].kind },
      });
      return { status: 200 as const, row: found[0] };
    });

    if (outcome.status === 404) {
      return void res.status(404).json({ error: 'not_found', reason: 'No such connection.' });
    }
    if (outcome.status === 409) {
      // The refusal has to answer three questions, because the owner testing
      // this on a phone got only a 409 and asked all three (workplan 0068):
      // WHY it is refused, WHAT to do first, and WHERE to do it. Naming the
      // migrations matters more than counting the mailboxes — "3 mailboxes" is
      // a number, "Acme mail" is something a person can go and act on.
      const named =
        outcome.names.length > 0
          ? outcome.names.map((n) => `“${n}”`).join(', ')
          : `${outcome.used} ${outcome.used === 1 ? 'mailbox' : 'mailboxes'}`;
      // `migrations` is the finding; the FRAME around it is the client's to
      // author and translate (workplan 0071, prose boundary class 2). 0068 T4
      // was right that the refusal must answer why / what first / where, and
      // wrong about where those words live: as one English string on this
      // route it reached a Dutch operator untranslated and five clauses long.
      // The names stay a list rather than a sentence for the same reason the
      // missing-field keys do — a list can be counted, ordered and localized;
      // a sentence can only be printed.
      return void res.status(409).json({
        error: 'in_use',
        migrations: outcome.names,
        used: outcome.used,
        // The English fallback for API consumers with no dictionary — the one
        // audience the old string genuinely served.
        reason:
          `This connection is still used by ${named}. Deleting it would also delete ` +
          `everything those migrations have recorded, so remove ${
            outcome.names.length === 1 ? 'that migration' : 'those migrations'
          } under Migrations first.`,
      });
    }
    /**
     * The grant behind the row (2026-09-20). Until now this route deleted our
     * copy of the credential and stopped, while the privacy text promised, for
     * exactly this press, that it is *destroyed, and the grant revoked where
     * the provider supports it*. A deleted copy of a live refresh token is not
     * a revoked one: the token kept working at Google with nobody holding it.
     *
     * AFTER the delete, not before, for two reasons the erasure path shares. A
     * refused delete (the 409 above) must leave a working credential behind —
     * the connection stays and its next pass must still sign in — so nothing
     * may be revoked until the row is actually gone. And a network call must
     * not hold the tenant transaction open. Best effort, never a refusal: the
     * outcome says `failed` with the reason and the person is told to withdraw
     * it themselves, which is the one thing a false `revoked` would stop them
     * doing.
     */
    const revocation = await revokeCredentialRow(
      {
        kind: outcome.row.kind,
        secret_ref: outcome.row.secretRef,
        legacy_credentials: outcome.row.legacyCredentials,
      },
      tokenRevoker(),
    );
    res.status(200).json({
      deleted: true,
      id: outcome.row.id,
      displayName: outcome.row.displayName,
      revocation,
    });
  } catch (error) {
    serverFault(res, 'delete_failed', 'deleting this connection', error);
  }
});

export default router;
