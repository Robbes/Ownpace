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
 * into `tenant_pricing`, and that is what it is billed at from then on. It
 * happens here, on the read path, rather than at tenant creation because
 * tenants are created by several bootstrap paths (the managed seed, the
 * onboarding flow, `ensureTenant`) and a price that depends on which door a
 * customer came through is a bug waiting to be found by an accountant. One
 * write, idempotent, at the first moment the tenant's money is actually
 * computed.
 *
 * The write runs in whatever tenant context the caller already opened — the
 * `tenant_pricing` table's RLS policies scope select and insert by
 * `app.current_tenant`, so this can only ever pin the tenant it was asked
 * about.
 */

import { eq } from 'drizzle-orm';
import { log } from '@openmig/shared';
import type { PgDatabase } from '@openmig/ledger/db';
import { tenantPricing } from './schema-managed.ts';
import { type PricingConfig, parsePinnedPricing, pricingFromEnv } from './pricing.ts';

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
      .select({ pricing: tenantPricing.pricing })
      .from(tenantPricing)
      .where(eq(tenantPricing.tenantId, tenantId));

    // NO ROW is "nothing agreed yet" — the state this used to spell as a NULL
    // column, where it had to be documented as not meaning free. It is not
    // "tenant not readable": an unreadable tenant fails on the INSERT below,
    // because `tenant_pricing`'s WITH CHECK policy keys on the same
    // `app.current_tenant` the SELECT was scoped by, and that lands in the
    // catch. The RLS policy enforces it rather than a read that could be
    // skipped.
    const agreed = parsePinnedPricing(rows[0]?.pricing);
    if (agreed) return agreed;

    // Upsert, not insert. Two first-time reads can race — a billing page and
    // the worker's metering, on a tenant that has never been priced — and both
    // are writing the SAME template, so the loser must not fail. The DO UPDATE
    // is also what replaces a stored value that no longer parses, which is the
    // one case where following the template again is right: an unreadable
    // agreement is not an agreement.
    await db
      .insert(tenantPricing)
      .values({ tenantId, pricing: template })
      .onConflictDoUpdate({ target: tenantPricing.tenantId, set: { pricing: template } });
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
