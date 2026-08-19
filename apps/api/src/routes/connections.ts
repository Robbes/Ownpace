// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
import { SecretStore } from '@openmig/core/secret-store';
import {
  probeSourceConnection,
  probeTargetConnection,
} from '@openmig/orchestration/probe-connection';
import { z } from 'zod';
import { credentialFieldsFor, wizardTypeForConnectionKind } from '@openmig/shared';
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

const router = Router();

let _pool: ReturnType<typeof getDbPool> | null = null;
function pool() {
  if (!_pool) _pool = getDbPool();
  return _pool;
}

/** Target kinds `probeTargetConnection` knows how to reach. */
const TARGET_KINDS = ['jmap', 'imap', 'caldav', 'carddav', 'webdav'] as const;
type TargetKind = (typeof TARGET_KINDS)[number];

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
 * Add a connection on its own, without creating a mapping (workplan 0063).
 *
 * PROBED BEFORE IT IS STORED, and stored either way with the outcome on
 * `status`: a credential that does not work yet is worth keeping (somebody is
 * mid-setup and an admin has not authorised the app), but it must not look
 * healthy. The provider's own words come back so the person can act on them.
 */
router.post('/', authenticate, async (req: AuthenticatedRequest, res: Response) => {
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

    // Through the SAME zod object the create route validates, so a value this
    // accepts is one create would accept — port coerced because a form sends
    // strings and the schema wants a number.
    const shaped = { ...values, ...(values.port ? { port: Number(values.port) } : {}) };
    const configShape =
      role === 'source' ? CreateMappingBase.shape.sourceConfig : CreateMappingBase.shape.targetConfig;
    const checked = configShape.safeParse(shaped);
    if (!checked.success) {
      return void res.status(400).json({
        ...invalidValuesRefusal(checked.error),
      });
    }

    const half = checked.data as never;
    const config =
      role === 'source'
        ? sourceConnectionConfig({ sourceType: type as never, sourceConfig: half })
        : targetConnectionConfig({ targetConfig: half } as never);
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

    res.status(201).json({ id: inserted[0]!.id, ...probe });
  } catch (error) {
    serverFault(res, 'add_failed', 'adding this connection', error);
  }
});

router.post('/:id/test', authenticate, async (req: AuthenticatedRequest, res: Response) => {
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

    res.json(result);
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
    const shaped = { ...values, ...(values.port ? { port: Number(values.port) } : {}) };
    const configShape =
      row.role === 'source' ? CreateMappingBase.shape.sourceConfig : CreateMappingBase.shape.targetConfig;
    const checked = configShape.safeParse(shaped);
    if (!checked.success) {
      return void res.status(400).json({
        ...invalidValuesRefusal(checked.error),
      });
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

    res.json({ ...probe, rotated: true });
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
