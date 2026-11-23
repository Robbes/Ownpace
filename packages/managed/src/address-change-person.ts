// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHOSE ADDRESS CHANGES, ON MANAGED (ADR-0055; workplan 0168 T2, §4.2; managed
 * migration 0063).
 *
 * The shared chain's `address_change` is the organisation's table; which
 * person a row is for is a managed row of its own, `address_change_person`,
 * because `person` is managed-only (hard rule 5). This file reads and writes
 * that link, and turns the stored rows into the answer the managed routes give:
 * each with its person, and who set and confirmed it said as the member's
 * address (`tenant_member.email`), never as the sign-in's subject.
 *
 * Every function runs inside the organisation's own transaction
 * (`withTenant`), and filters by the tenant as well as row security does.
 */

import { sql } from 'drizzle-orm';
import { saidBy, type AddressChange, type StoredAddressChange } from '@openmig/shared';
import type { PgDatabase } from '@openmig/ledger/db';

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] => ((result as { rows?: Row[] }).rows ?? []) as Row[];

/** The person each row is for, by old key. */
export async function readAddressChangePeople(
  db: PgDatabase,
  tenantId: string,
): Promise<Map<string, { readonly id: string; readonly displayName: string }>> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT l.old_key, p.id, p.display_name
        FROM address_change_person l
        JOIN person p ON p.id = l.person_id AND p.tenant_id = l.tenant_id
       WHERE l.tenant_id = ${tenantId}::uuid`),
  );
  return new Map(rows.map((r) => [String(r.old_key), { id: String(r.id), displayName: String(r.display_name) }]));
}

/** Whether the organisation has this person. */
export async function hasPerson(db: PgDatabase, tenantId: string, personId: string): Promise<boolean> {
  const rows = rowsOf(
    await db.execute(sql`SELECT 1 FROM person WHERE id = ${personId}::uuid AND tenant_id = ${tenantId}::uuid`),
  );
  return rows.length > 0;
}

/** Link a row to a person, or unlink it with null. Saying it again changes nothing. */
export async function linkAddressChangePerson(
  db: PgDatabase,
  tenantId: string,
  oldKey: string,
  personId: string | null,
): Promise<void> {
  if (personId === null) {
    await db.execute(
      sql`DELETE FROM address_change_person WHERE tenant_id = ${tenantId}::uuid AND old_key = ${oldKey}`,
    );
    return;
  }
  await db.execute(sql`
    INSERT INTO address_change_person (tenant_id, old_key, person_id)
    VALUES (${tenantId}::uuid, ${oldKey}, ${personId}::uuid)
    ON CONFLICT (tenant_id, old_key) DO UPDATE SET person_id = EXCLUDED.person_id, linked_at = now()
     WHERE address_change_person.person_id IS DISTINCT FROM EXCLUDED.person_id`);
}

/** Each member's address by their sign-in subject: how a stored setter is said. */
export async function memberLabels(db: PgDatabase, tenantId: string): Promise<Map<string, string>> {
  const rows = rowsOf(
    await db.execute(sql`SELECT user_id, email FROM tenant_member WHERE tenant_id = ${tenantId}::uuid`),
  );
  return new Map(rows.filter((r) => r.user_id && r.email).map((r) => [String(r.user_id), String(r.email)]));
}

/** A stored row as the managed routes answer it, for the member who asks. */
export function addressChangeAnswer(
  row: StoredAddressChange,
  facts: {
    readonly labels: ReadonlyMap<string, string>;
    readonly people: ReadonlyMap<string, { readonly id: string; readonly displayName: string }>;
    readonly asker: string | undefined;
  },
): AddressChange {
  const label = (s: string): string | null => facts.labels.get(s) ?? null;
  return {
    oldAddress: row.oldAddress,
    oldKey: row.oldKey,
    newAddress: row.newAddress,
    state: row.state,
    setBy: saidBy(row.setBy, label),
    setByYou: facts.asker !== undefined && row.setBy === facts.asker,
    confirmedBy: saidBy(row.confirmedBy, label),
    confirmedByYou: facts.asker !== undefined && row.confirmedBy === facts.asker,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    person: facts.people.get(row.oldKey) ?? null,
  };
}
