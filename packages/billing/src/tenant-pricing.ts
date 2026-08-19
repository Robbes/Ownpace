// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * What THIS tenant pays — the agreement, not the current price list.
 *
 * Every path that turns usage into money goes through here: the API's usage,
 * history, estimate and invoice routes, and the worker's per-pass metering.
 * They must agree, because an invoice built from one price list and metered
 * rows built from another is a bill that cannot be reconciled with its own
 * line items.
 *
 * PIN ON FIRST USE. A tenant with no agreement gets today's template written
 * into `tenant.pricing`, and that is what it is billed at from then on. It
 * happens here, on the read path, rather than at tenant creation because
 * tenants are created by several bootstrap paths (the managed seed, the
 * onboarding flow, `ensureTenant`) and a price that depends on which door a
 * customer came through is a bug waiting to be found by an accountant. One
 * write, idempotent, at the first moment the tenant's money is actually
 * computed.
 *
 * The write runs in whatever tenant context the caller already opened — the
 * `tenant` table's RLS policies scope select and update by
 * `app.current_tenant`, so this can only ever pin the tenant it was asked
 * about.
 */

import { eq } from 'drizzle-orm';
import { log } from '@openmig/shared';
import type { PgDatabase } from '@openmig/ledger/db';
import * as schema from '@openmig/ledger/schema-pg';
import { type PricingConfig, parsePinnedPricing, pricingFromEnv } from './pricing';

/**
 * The tenant's agreed prices, pinning the operator's template if it has none.
 *
 * Falls back to the template WITHOUT pinning when the row cannot be read or
 * written — a billing screen that fails to load helps nobody, and the numbers
 * it shows are the same ones the next successful call will pin. The fallback
 * is logged rather than swallowed: a tenant that never manages to pin is a
 * tenant whose prices would follow the template forever, which is exactly the
 * thing this module exists to prevent.
 */
export async function resolveTenantPricing(
  db: PgDatabase,
  tenantId: string,
): Promise<PricingConfig> {
  const template = pricingFromEnv();
  try {
    const rows = await db
      .select({ pricing: schema.tenant.pricing })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenantId));

    const row = rows[0];
    if (!row) {
      // No row under this tenant context. Price at the template rather than
      // refusing: the caller is mid-request and the tenancy gate upstream has
      // already decided this caller may ask about this tenant.
      log.warn(`[pricing] tenant ${tenantId} not readable; using the operator template unpinned`);
      return template;
    }

    const agreed = parsePinnedPricing(row.pricing);
    if (agreed) return agreed;

    await db
      .update(schema.tenant)
      .set({ pricing: template })
      .where(eq(schema.tenant.id, tenantId));
    log.info(`[pricing] tenant ${tenantId} pinned to the current template`);
    return template;
  } catch (err) {
    log.warn(
      `[pricing] could not resolve stored pricing for tenant ${tenantId}; ` +
        `using the operator template unpinned: ${err instanceof Error ? err.message : String(err)}`,
    );
    return template;
  }
}
