// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What both halves of a grant link read about one migration (workplan 0108
 * T6–T8a, 2026-09-23).
 *
 * The owner's route reads it when a link is issued and the grant route when one
 * is used, and both hand the result to `grantLinkAsk`. ONE reading, because the
 * defect this reopening found was two: the issue check and the use check each
 * decrypted the source's credentials their own way, neither knew the
 * deployment's client, and so a migration the product could run was one its
 * link refused.
 *
 * The rows come back as they are stored. `grantReadiness` reduces them to the
 * booleans the decision takes. The client VALUES are decrypted only by the
 * grant route, at the moment it builds a consent URL, and only when the
 * decision says the connection's own pair is the one to use.
 */

import { and, eq } from 'drizzle-orm';
import * as schema from '@openmig/ledger';
import type { PgDatabase } from '@openmig/ledger';
import { SecretStore } from '@openmig/core/secret-store';
import { googleDeploymentClient, type GoogleClientEnv } from '@openmig/shared';
import type { GrantLinkReadiness } from './grant-link-readiness.ts';
import { accountOfMapping } from './account-on-connection.ts';

interface StoredConnection {
  readonly kind: string;
  readonly config: unknown;
  readonly secretRef: string | null;
}

export interface GrantRows {
  readonly organisation: string;
  readonly source: StoredConnection;
  /** `mailbox_mapping.source_config_override`: this migration's own account. */
  readonly sourceOverride: unknown;
  /** Null when the migration has no destination (never set, or deleted). */
  readonly target: StoredConnection | null;
  readonly targetOverride: unknown;
  /** Its included `scope_selection` rows — the scheduler's reading. */
  readonly includedDomains: ReadonlyArray<string>;
}

/** One mapping's rows, inside the caller's tenant transaction. Null when it has no source. */
export async function readGrantRows(
  db: PgDatabase,
  tenantId: string,
  mappingId: string,
): Promise<GrantRows | null> {
  const found = await db
    .select({
      organisation: schema.tenant.name,
      kind: schema.connection.kind,
      config: schema.connection.config,
      secretRef: schema.connection.secretRef,
      sourceOverride: schema.mailboxMapping.sourceConfigOverride,
      targetOverride: schema.mailboxMapping.targetConfigOverride,
      targetMailboxId: schema.mailboxMapping.targetMailboxId,
    })
    .from(schema.mailboxMapping)
    .innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMapping.sourceMailboxId))
    .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
    .innerJoin(schema.tenant, eq(schema.tenant.id, schema.mailboxMapping.tenantId))
    .where(and(eq(schema.mailboxMapping.id, mappingId), eq(schema.mailboxMapping.tenantId, tenantId)));
  const row = found[0];
  if (!row) return null;

  let target: StoredConnection | null = null;
  if (row.targetMailboxId) {
    const targets = await db
      .select({
        kind: schema.connection.kind,
        config: schema.connection.config,
        secretRef: schema.connection.secretRef,
      })
      .from(schema.mailbox)
      .innerJoin(schema.connection, eq(schema.connection.id, schema.mailbox.connectionId))
      .where(and(eq(schema.mailbox.id, row.targetMailboxId), eq(schema.mailbox.tenantId, tenantId)));
    target = targets[0] ?? null;
  }

  const scope = await db
    .select({ domain: schema.scopeSelection.domain })
    .from(schema.scopeSelection)
    .where(
      and(
        eq(schema.scopeSelection.tenantId, tenantId),
        eq(schema.scopeSelection.mappingId, mappingId),
        eq(schema.scopeSelection.included, true),
      ),
    );

  return {
    organisation: row.organisation,
    source: { kind: row.kind, config: row.config, secretRef: row.secretRef },
    sourceOverride: row.sourceOverride,
    target,
    targetOverride: row.targetOverride,
    includedDomains: scope.map((s) => s.domain),
  };
}

/**
 * The stored credentials, or nothing. A secret this process cannot decrypt
 * reads as absent: from the owner's side an unreadable secret and a missing one
 * are the same fact (the consent has no client to run against), and the remedy
 * is the same. What must never happen is issuing a link anyway.
 */
export function storedCredentials(secretRef: string | null): Record<string, unknown> {
  if (!secretRef) return {};
  try {
    return SecretStore.decryptCredentials(secretRef);
  } catch {
    return {};
  }
}

/** A non-empty string under this key, or ''. */
export function credential(creds: Record<string, unknown>, key: string): string {
  const value = creds[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : '';
}

/** The three variables this reads, and nothing else from the environment. */
export type GrantEnv = GoogleClientEnv & { readonly GOOGLE_ACCOUNT_SCOPE_CLASS?: string | undefined };

/**
 * The rows, reduced to what `grantLinkAsk` takes. The credentials are decrypted
 * and immediately become two booleans: the secret's lifetime is this function.
 */
export function grantReadiness(
  rows: GrantRows | null,
  env: GrantEnv = process.env,
): Omit<GrantLinkReadiness, 'hasWebUrl'> {
  const deployment = {
    hasDeploymentClient: googleDeploymentClient(env) !== null,
    scopeClass: env.GOOGLE_ACCOUNT_SCOPE_CLASS,
  };
  if (!rows) {
    return {
      sourceKind: null,
      includedDomains: [],
      hasTarget: false,
      hasClientId: false,
      hasClientSecret: false,
      ...deployment,
    };
  }
  const creds = storedCredentials(rows.source.secretRef);
  return {
    sourceKind: rows.source.kind,
    includedDomains: rows.includedDomains,
    hasTarget: rows.target !== null,
    hasClientId: credential(creds, 'clientId') !== '',
    hasClientSecret: credential(creds, 'clientSecret') !== '',
    ...deployment,
  };
}

/** Where the destination lives: its host, or the host of the address it was given. */
function hostOf(config: unknown): string | null {
  const c = (config ?? {}) as Record<string, unknown>;
  if (typeof c.host === 'string' && c.host.trim() !== '') return c.host.trim();
  for (const key of ['url', 'baseUrl']) {
    const value = c[key];
    if (typeof value !== 'string') continue;
    try {
      return new URL(value).host;
    } catch {
      // Not an address. The next key, or no host at all.
    }
  }
  return null;
}

/** What the page says about where the data comes from and goes to (T8a). */
export interface WhereFromAndTo {
  /** The account the migration reads, or null when it names none. */
  readonly from: string | null;
  /** The destination: which kind of server, where, and the account on it. */
  readonly to: {
    readonly provider: string;
    readonly host: string | null;
    readonly account: string | null;
  };
}

/**
 * The accounts are the ones a pass uses (`accountOfMapping`), and the provider
 * is the target connection's kind, for the page to put a name to. Null when
 * the migration has no destination, which `grantLinkAsk` refuses before any
 * page is drawn.
 */
export function whereFromAndTo(rows: GrantRows): WhereFromAndTo | null {
  if (!rows.target) return null;
  return {
    from: accountOfMapping(rows.source, rows.sourceOverride) ?? null,
    to: {
      provider: rows.target.kind,
      host: hostOf(rows.target.config),
      account: accountOfMapping(rows.target, rows.targetOverride) ?? null,
    },
  };
}
