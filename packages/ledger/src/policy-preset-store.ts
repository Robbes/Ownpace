// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Standing answers, per tenant and category (workplan 0028 T5).
 *
 * `policy_preset` has been in the schema since ledger v1 with no reader and
 * no writer — one of the unowned features the 2026-08-02 sweep found. It only
 * became meaningful once something could actually raise a decision (T2's
 * detector), because a preset that pre-answers a category nothing detects
 * pre-answers nothing.
 *
 * `ask` is the default and the absence of a row means `ask`. That direction
 * matters: a tenant who has never expressed a preference must be ASKED, not
 * quietly auto-answered by a default somebody chose for them.
 *
 * ONE CATEGORY IS WIRED: `new_mailbox`. The other detector's category,
 * `shared_address_pattern`, is deliberately not — and `params` stays an unused
 * column (owner decision, 2026-08-04). `auto` means *the detector answers its
 * own decision*, and for a new mailbox there is an answer to give: noticed,
 * closed by a standing rule, nothing executed. For the S-or-D question there
 * is not — that decision exists BECAUSE the directory could not tell us which
 * it is, so answering it automatically can only mean *assume one of the two*,
 * which is the guess the detector refuses to make. The defensible version
 * (`params` carrying which pattern to assume) is described in workplan 0028
 * T5 along with the evidence that would justify building it. Until then, a
 * `shared_address_pattern` preset should not be added here: setting it wrong
 * migrates a mailbox full of mail as an empty group definition, and nothing
 * would say so at the time.
 */

import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from './db-types';
import * as schemaPg from './schema-pg';
import type { TenantId } from '@openmig/shared';

/** What to do when a decision in this category is raised. */
export type PresetAction = 'auto' | 'ask';

export interface PolicyPreset {
  readonly category: string;
  readonly action: PresetAction;
}

export class PgPolicyPresetStore {
  private readonly db: PgDatabase;
  constructor(db: PgDatabase) {
    this.db = db;
  }

  /**
   * The standing answer for a category, or `ask` when none was ever set.
   *
   * Defaulting to `ask` on a missing row rather than throwing, because the
   * common case IS a missing row and a detector should not fail over a
   * preference nobody expressed.
   */
  async get(tenantId: TenantId, category: string): Promise<PresetAction> {
    const rows = await this.db
      .select()
      .from(schemaPg.policyPreset)
      .where(
        and(
          eq(schemaPg.policyPreset.tenantId, tenantId),
          eq(schemaPg.policyPreset.category, category),
        ),
      )
      .limit(1);
    return rows[0]?.action ?? 'ask';
  }

  /** Every preset this tenant has expressed. Categories not listed are `ask`. */
  async list(tenantId: TenantId): Promise<readonly PolicyPreset[]> {
    const rows = await this.db
      .select()
      .from(schemaPg.policyPreset)
      .where(eq(schemaPg.policyPreset.tenantId, tenantId));
    return rows.map((r) => ({ category: r.category, action: r.action }));
  }

  /**
   * Set the standing answer. Idempotent per (tenant, category) — the unique
   * index makes this an upsert rather than a second row that silently shadows
   * the first.
   */
  async set(tenantId: TenantId, category: string, action: PresetAction): Promise<void> {
    await this.db
      .insert(schemaPg.policyPreset)
      .values({ tenantId, category, action })
      .onConflictDoUpdate({
        target: [schemaPg.policyPreset.tenantId, schemaPg.policyPreset.category],
        set: { action },
      });
  }
}
