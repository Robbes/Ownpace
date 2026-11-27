// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * HOW A PERSON'S PAGES SPEAK TO THEM, AS THE SERVER SAYS ITS OWN DUTCH
 * (workplan 0176 §11, T7; D8 (a)).
 *
 * The member chooses, per person, Dutch with *u*, Dutch with *je*, or
 * English (`person.voice`, managed migration 0068). The pages read their own
 * words in that register; the server's sentences on a person's link, a
 * refusal's `reasonNl` and the ending after a sign-in, are said in it too
 * (`reasonPair(text, register)` in `@openmig/shared`). Unset is *u*, as
 * before. A migration's own link is for no person and has no register.
 */

import type { Pool } from 'pg';
import type { LedgerDriver } from '@openmig/ledger';
import { readPersonVoice } from '@openmig/managed';
import { registerOf, type Register } from '@openmig/shared';
import { withTenantDb } from './middleware/auth.ts';

/** The register a person's link speaks in, read on the tenant's own connection. */
export async function registerOfPerson(source: Pool | LedgerDriver, tenantId: string, personId: string): Promise<Register> {
  return registerOf(await withTenantDb(tenantId, source, (db) => readPersonVoice(db, tenantId, personId)));
}
