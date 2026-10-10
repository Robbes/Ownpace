// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * What an organisation's VAT number stands for right now: the buyer's details
 * as stored, and the latest VIES answer FOR THE NUMBER AS STORED (workplan
 * 0111 T2).
 *
 * Read in one place because three readers ask it: the billing page (`GET
 * /api/billing/party`), since 2026-09-23 the grant page (workplan 0108 T8a),
 * which shows the company name VIES gave for that number, and since 0111
 * slice 5 the push, which decides the invoice's VAT treatment from it. It
 * lived in the API until the push needed it in a task. The log of
 * consultations is append-only, so which row speaks is decided here, by
 * matching what `billing_party` says now. A number changed since its last
 * check therefore has no consultation, which is correct: nothing has checked
 * the number as it now stands.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import { parseVatForVies } from './vies.ts';
import * as schema from './schema-managed.ts';

/** The buyer's details as the billing page sees them. */
export const billingPartyColumns = {
  tenantId: schema.billingParty.tenantId,
  kind: schema.billingParty.kind,
  name: schema.billingParty.name,
  addressLine1: schema.billingParty.addressLine1,
  addressLine2: schema.billingParty.addressLine2,
  postalCode: schema.billingParty.postalCode,
  city: schema.billingParty.city,
  countryCode: schema.billingParty.countryCode,
  vatNumber: schema.billingParty.vatNumber,
  createdAt: schema.billingParty.createdAt,
  updatedAt: schema.billingParty.updatedAt,
} as const;

/**
 * The consultation as the page sees it — everything the row holds except the
 * tenant id the caller already is.
 */
export const vatConsultationColumns = {
  id: schema.vatConsultation.id,
  countryCode: schema.vatConsultation.countryCode,
  vatNumber: schema.vatConsultation.vatNumber,
  valid: schema.vatConsultation.valid,
  requestDate: schema.vatConsultation.requestDate,
  consultationNumber: schema.vatConsultation.consultationNumber,
  traderName: schema.vatConsultation.traderName,
  traderAddress: schema.vatConsultation.traderAddress,
  checkedAt: schema.vatConsultation.checkedAt,
} as const;

/** The stored details and the latest answer for the number as stored, inside the caller's tenant transaction. */
export async function readVatStanding(db: PgDatabase, tenantId: string) {
  const rows = await db
    .select(billingPartyColumns)
    .from(schema.billingParty)
    .where(eq(schema.billingParty.tenantId, tenantId));
  const party = rows[0] ?? null;

  if (!party || party.kind !== 'business' || !party.vatNumber) {
    return { party, vatConsultation: null };
  }
  const parsed = parseVatForVies(party.countryCode, party.vatNumber);
  if (!parsed.ok) return { party, vatConsultation: null };

  const consultations = await db
    .select(vatConsultationColumns)
    .from(schema.vatConsultation)
    .where(
      and(
        eq(schema.vatConsultation.tenantId, tenantId),
        eq(schema.vatConsultation.countryCode, parsed.memberState),
        eq(schema.vatConsultation.vatNumber, parsed.number),
      ),
    )
    .orderBy(desc(schema.vatConsultation.checkedAt))
    .limit(1);
  return { party, vatConsultation: consultations[0] ?? null };
}
