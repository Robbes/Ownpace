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
 * SECRETS NEVER COME BACK OUT. The list returns names, kinds and states; the
 * only thing that touches decrypted credentials is the probe, and all it
 * returns is the provider's own verdict.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { eq, and, inArray, or, sql } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import { PgLedger } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import {
  probeSourceConnection,
  probeTargetConnection,
} from '@openmig/orchestration/probe-connection';
import {
  isDropboxKind,
  isGoogleGrantKind,
  isQualifiableKind,
  qualifyAccount,
  isArchiveKind,
  qualifyArchive,
  qualifyDropbox,
  qualifyGoogleGrant,
  type AccountQualification,
} from '@openmig/orchestration/account-qualification';
import { z } from 'zod';
import {
  ARCHIVE_PROVIDERS,
  credentialFieldsFor,
  halfGoogleClientPairProblem,
  halfDropboxClientPairProblem,
  isArchiveProvider,
  log,
  wizardTypeForConnectionKind,
} from '@openmig/shared';
import type { CredentialField, TenantId } from '@openmig/shared';
import { authenticate, getDbPool, withTenantDb } from '../middleware/auth.ts';
import type { AuthenticatedRequest } from '../types/api.ts';
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
import { serverFault } from '../server-fault.ts';
import { withinBudget } from './within-budget.ts';

const router = Router();

let _pool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_pool) _pool = getDbPool();
  return _pool;
}

/** Target kinds `probeTargetConnection` knows how to reach. */
const TARGET_KINDS = ['jmap', 'imap', 'caldav', 'carddav', 'webdav', 'soverin'] as const;
type TargetKind = (typeof TARGET_KINDS)[number];

/**
 * Qualify the account behind a connection and REMEMBER the answer
 * (workplan 0106 T0): what the last test measured, per domain, stored on the
 * row and recorded to the audit log. Runs beside the headline probe, never
 * instead of it, and NEVER fails a test — a qualification that could not be
 * taken is reported to the log and the test result stands (the probe's own
 * verdict is the thing the person asked for).
 */
/**
 * THE DOOR ANSWERS BEFORE THE BROWSER GIVES UP (2026-09-02, the owner's
 * whole-Dropbox test). The web client waits 30 s; a door probes (its own
 * deadline, `PROBE_DEADLINE_MS`), writes the row, then qualifies the account,
 * and the qualification gets what is left of this budget — never less than
 * the floor. Past it the door answers `qualificationPending` and the
 * measuring finishes on its own, into the row.
 */
const DOOR_BUDGET_MS = 26_000;
const QUALIFICATION_FLOOR_MS = 3_000;

/** The response's qualification field, or its "still measuring" stand-in. */
function qualificationField(
  q: AccountQualification | 'pending' | undefined,
): { qualification: AccountQualification } | { qualificationPending: true } | Record<never, never> {
  if (q === 'pending') return { qualificationPending: true };
  return q ? { qualification: q } : {};
}

async function qualifyAndRemember(
  tenantId: string,
  connectionId: string,
  kind: string,
  config: Record<string, unknown>,
  creds: Record<string, string>,
  actor: string,
  deadlineAt: number,
): Promise<AccountQualification | 'pending' | undefined> {
  // EVERY KIND THAT HAS A QUALIFIER, and this list is the whole reason the
  // dispatch below can be trusted. It is also where 0116 T7 was briefly
  // broken: `qualifyArchive` was wired into `qualifyAndRememberNow` and an
  // `archive` row still never reached it, because this guard did not name the
  // kind and returned `undefined` one function earlier. Nothing failed — the
  // connection stored fine, the probe answered fine, and the Measured line
  // simply never appeared. The unit tests called `qualifyArchive` directly and
  // were green throughout.
  //
  // That is the family this repository keeps meeting: a new kind must reach
  // every table, and the tables that GATE are the ones whose absence is
  // invisible. `smoke-managed.sh` is what turned it into a failure.
  if (
    !isQualifiableKind(kind) &&
    !isGoogleGrantKind(kind) &&
    !isDropboxKind(kind) &&
    !isArchiveKind(kind)
  ) {
    return undefined;
  }
  return withinBudget(
    qualifyAndRememberNow(tenantId, connectionId, kind, config, creds, actor),
    Math.max(QUALIFICATION_FLOOR_MS, deadlineAt - Date.now()),
  );
}

async function qualifyAndRememberNow(
  tenantId: string,
  connectionId: string,
  kind: string,
  config: Record<string, unknown>,
  creds: Record<string, string>,
  actor: string,
): Promise<AccountQualification | undefined> {
  try {
    // Probe-qualified for the Basic-auth families; grant-qualified for the
    // Google kinds (0106 T1a) — the token response's scope field says what
    // the grant ACTUALLY carries, never the wizard kind it was typed under.
    // AND REACHED (2026-09-02): each face the grant carries is asked as a
    // pass would ask it, from the row's own address and blob, so a switch
    // left off in the client's project shows here and not at the first
    // migration. The owner's "5 calendars and nothing about the other three".
    // AND THE DROPBOX ACCOUNT (2026-09-02): one face, its top-level count
    // and the bytes in use — the Measured line the owner asked for on Drive,
    // on the connection he tested next.
    // AND THE EXPORT ARCHIVE (workplan 0116 T7): items, bytes, folders, the
    // span the export covers and the count broken down — the whole point of
    // the archive's first slice, which is that somebody sees what their
    // export holds BEFORE anyone commits to importing 25 GB of it. It takes
    // no credentials, which is why it is the one qualifier here that is
    // passed the config alone.
    const qualification =
      (await qualifyAccount(kind, config, creds)) ??
      (await qualifyGoogleGrant(kind, creds, {
        reach: { user: String(config.user ?? ''), config },
      })) ??
      (await qualifyDropbox(kind, config, creds)) ??
      (await qualifyArchive(kind, config));
    if (!qualification) return undefined;
    await withTenantDb(tenantId, pool(), async (db) => {
      await db
        .update(schema.connection)
        .set({ qualification, updatedAt: new Date() })
        .where(
          and(eq(schema.connection.id, connectionId), eq(schema.connection.tenantId, tenantId)),
        );
      try {
        await new PgLedger(db).recordAuditEvent(tenantId as TenantId, {
          actor,
          action: 'connection.qualified',
          entity: 'connection',
          detail: {
            connectionId,
            mail: qualification.domains.mail.answer,
            calendar: qualification.domains.calendar.answer,
            contact: qualification.domains.contact.answer,
            file: qualification.domains.file.answer,
            ...(qualification.scheduling
              ? { scheduling: qualification.scheduling.capability }
              : {}),
          },
        });
      } catch (err) {
        log.error('recording the qualification failed (the row itself is updated)', err);
      }
    });
    return qualification;
  } catch (err) {
    log.error('[qualify] the account could not be qualified; the test result stands', err);
    return undefined;
  }
}

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

      // How many mappings depend on each connection. The link is
      // mailbox_mapping → mailbox → connection, so this counts through the
      // mailboxes — the number that says whether re-testing this matters.
      const usage = await db
        .select({
          connectionId: schema.mailbox.connectionId,
          used: sql<number>`count(*)::int`,
        })
        .from(schema.mailbox)
        .where(
          inArray(
            schema.mailbox.connectionId,
            connections.map((c) => c.id),
          ),
        )
        .groupBy(schema.mailbox.connectionId);
      const usedBy = new Map(usage.map((u) => [u.connectionId, u.used]));

      return connections.map(({ config, ...c }) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        usedByMailboxes: usedBy.get(c.id) ?? 0,
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
    const { role, type, displayName, values } = parsed.data;

    const fields = credentialFieldsFor(role, type);
    if (fields.length === 0) {
      return void res.status(400).json({
        error: 'unknown_type',
        reason: `'${type}' is not a ${role} this product connects to.`,
      });
    }
    const missing = fields.filter((f) => f.required && !values[f.key]?.trim()).map((f) => f.key);
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
      ...values,
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
    const creds =
      role === 'source'
        ? sourceCredentialRecord({ sourceType: type as never, sourceConfig: half })
        : { username: values.username ?? '', password: values.password ?? '' };

    const probe =
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
          );

    const kind = role === 'source' ? sourceKindFor(type as never) : type;
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
    const result =
      row.role === 'target'
        ? await probeTargetConnection(
            (TARGET_KINDS as ReadonlyArray<string>).includes(row.kind)
              ? (row.kind as TargetKind)
              : 'webdav',
            config,
            creds,
          )
        : await probeSourceConnection(row.kind, config, creds);

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
    );

    res.json({ ...result, ...qualificationField(qualification) });
  } catch (error) {
    serverFault(res, 'test_failed', 'testing this connection', error);
  }
});

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

    const half = checked.data as never;
    const creds =
      row.role === 'source'
        ? sourceCredentialRecord({ sourceType: type as never, sourceConfig: half })
        : { username: values.username ?? '', password: values.password ?? '' };

    // The CONFIG is deliberately left alone: rotation replaces a secret, not
    // where the migration is rooted. Changing both here would let a rotation
    // silently re-point a mapping at a different folder.
    const probe =
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
          );

    if (!probe.ok) {
      // The old credentials stay. Every mapping on this connection keeps
      // whatever it had, which may well still be working.
      return void res.status(200).json({ ...probe, rotated: false });
    }

    await withTenantDb(tenantId, pool(), (db) =>
      db
        .update(schema.connection)
        .set({
          secretRef: JSON.stringify(
            SecretStore.encryptCredentials(creds as Record<string, string>).encrypted,
          ),
          status: 'connected',
          updatedAt: new Date(),
        })
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId))),
    );

    // A rotated credential may carry different protocol scopes than the one
    // it replaces (an app-password minted for IMAP only, say) — re-qualify
    // with what is now stored (0106 T0).
    const qualification = await qualifyAndRemember(
      tenantId,
      id,
      row.kind,
      (row.config ?? {}) as Record<string, unknown>,
      creds as Record<string, string>,
      req.userId ?? 'unknown',
      startedAt + DOOR_BUDGET_MS,
    );

    res.json({ ...probe, rotated: true, ...qualificationField(qualification) });
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
 */
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
        .select({ id: schema.connection.id, displayName: schema.connection.displayName })
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
        .innerJoin(
          schema.mailboxMapping,
          or(
            eq(schema.mailboxMapping.sourceMailboxId, schema.mailbox.id),
            eq(schema.mailboxMapping.targetMailboxId, schema.mailbox.id),
          ),
        )
        .where(eq(schema.mailbox.connectionId, id));

      if (users.length > 0) {
        const names = [...new Set(users.map((u) => u.mapping).filter(Boolean))];
        return { status: 409 as const, used: users.length, names };
      }

      await db
        .delete(schema.connection)
        .where(and(eq(schema.connection.id, id), eq(schema.connection.tenantId, tenantId)));
      return { status: 204 as const };
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
    res.status(204).end();
  } catch (error) {
    serverFault(res, 'delete_failed', 'deleting this connection', error);
  }
});

export default router;
