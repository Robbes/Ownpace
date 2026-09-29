// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * WHAT A PERSON ACCEPTED, AND WHETHER ANYTHING IS DUE (workplan 0139 T3;
 * managed migration 0032).
 *
 * Two things the request path does with the record: read whether the current
 * version of each text has been accepted by this person in this organisation,
 * and record an acceptance. Both run inside the organisation's own
 * transaction (`withTenant`), so the table's policies hold each read and write
 * to it, and a write may only name one of its members.
 *
 * ## The rules
 *
 *  - **Due** is per person and organisation: any text whose current version
 *    this person has not accepted here. A colleague's acceptance is theirs.
 *  - **Only the current version** can be accepted. An offer naming any other
 *    number is refused whole, and writes nothing: a stale tab must not accept
 *    a text nobody shows any more, and the refusal names what is current.
 *  - **A repeat adds nothing.** The first acceptance of a version is the
 *    record, with its time and language; pressing again changes neither.
 *  - **A new version is a new row**, beside the old one, which stays.
 *
 * The current versions default to `LEGAL_VERSIONS` and are a parameter only so
 * a test can make a text change its number.
 */

import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from '@openmig/ledger/db';
import { legalAcceptance } from './schema-managed.ts';
import {
  LEGAL_DOCUMENTS,
  LEGAL_VERSIONS,
  type LegalDocument,
  type LegalLanguage,
  type LegalVersions,
} from './legal-versions.ts';

/** One text, at its current version, and whether this person accepted that version. */
export interface DocumentAcceptance {
  readonly document: LegalDocument;
  readonly version: string;
  readonly accepted: boolean;
}

/** What `GET /api/me` reports while the deployment asks. */
export interface AcceptanceState {
  /** True while any text's current version is not accepted. */
  readonly due: boolean;
  /** Every text, in the order the screen lists them. */
  readonly documents: readonly DocumentAcceptance[];
}

/** What recording an acceptance came to. */
export type RecordAcceptanceOutcome =
  | {
      readonly kind: 'recorded';
      /** Rows written: nought for a repeat. */
      readonly written: number;
      readonly state: AcceptanceState;
    }
  | {
      /** A version that is not the current one; nothing was written. */
      readonly kind: 'not_current';
      readonly stale: readonly LegalDocument[];
      readonly current: LegalVersions;
    };

/** Whether each text's current version is accepted by this person in this organisation. */
export async function readAcceptance(
  db: PgDatabase,
  tenantId: string,
  subject: string,
  current: LegalVersions = LEGAL_VERSIONS,
): Promise<AcceptanceState> {
  const rows = await db
    .select({ document: legalAcceptance.document, version: legalAcceptance.version })
    .from(legalAcceptance)
    .where(and(eq(legalAcceptance.tenantId, tenantId), eq(legalAcceptance.subject, subject)));
  const accepted = new Set(rows.map((r) => `${r.document}@${r.version}`));
  const documents = LEGAL_DOCUMENTS.map((document) => ({
    document,
    version: current[document],
    accepted: accepted.has(`${document}@${current[document]}`),
  }));
  return { due: documents.some((d) => !d.accepted), documents };
}

/**
 * Record that this person accepted these versions, read in this language.
 * Every version offered must be the current one, or nothing is written.
 */
export async function recordAcceptance(
  db: PgDatabase,
  tenantId: string,
  subject: string,
  offered: Partial<Record<LegalDocument, string>>,
  language: LegalLanguage,
  current: LegalVersions = LEGAL_VERSIONS,
): Promise<RecordAcceptanceOutcome> {
  const named = LEGAL_DOCUMENTS.filter((d) => offered[d] !== undefined);
  const stale = named.filter((d) => offered[d] !== current[d]);
  if (stale.length > 0) return { kind: 'not_current', stale, current };

  let written = 0;
  if (named.length > 0) {
    const inserted = await db
      .insert(legalAcceptance)
      .values(named.map((document) => ({ tenantId, subject, document, version: current[document], language })))
      .onConflictDoNothing({
        target: [legalAcceptance.tenantId, legalAcceptance.subject, legalAcceptance.document, legalAcceptance.version],
      })
      .returning({ id: legalAcceptance.id });
    written = inserted.length;
  }
  return { kind: 'recorded', written, state: await readAcceptance(db, tenantId, subject, current) };
}
