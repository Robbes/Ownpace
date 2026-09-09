// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Billing Routes
 * 
 * API endpoints for billing, invoices, and payment methods.
 * All endpoints require authentication and enforce tenant isolation.
 * 
 * SECURITY: All tenant-data queries use withTenantDb for RLS enforcement.
 * tenant_id is ALWAYS from req.tenantId (authenticated context), never from client input.
 */

import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, getDbPool, withTenantDb } from '../../middleware/auth.ts';
import type { AuthenticatedRequest } from '../../types/api.ts';
import { calculateCost } from '../../services/billing-service.ts';
import { getMollieService } from '../../services/mollie/index.ts';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import {
  getUsageMetricsForPeriod,
  resolveTenantPricing,
  parseVatForVies,
  checkVat,
  decideVatTreatment,
  observedTier,
  PgOccupancyPeakStore,
  PgBytesMovedStore,
  type ViesRequester,
} from '@openmig/managed';
import * as schema from '@openmig/managed/schema-managed';
// The run ledger lives in @openmig/ledger (ADR-0036): compute derives from it.
import { run as runTable } from '@openmig/ledger/schema-pg';
// The live slot count, through the ONE authority on which states hold a slot
// (`holdsASlot`, wrapped by `slotsHeld`) rather than a second list here.
import { PgPathLifecycleStore } from '@openmig/ledger';
import { log, type TenantId } from '@openmig/shared';
import { NO_TIER_BILLING_CODE, NO_TIER_BILLING_REASON } from './no-bill-we-do-not-sell.ts';

/** Decimal GB, as `invoice-generation.ts` uses — a price list is not binary. */
const BYTES_PER_GB = 1_000_000_000;

/** The authenticated tenant id in the ledger's branded type, said once. */
const asTenantId = (id: string): TenantId => id as never as TenantId;
import { serverFault } from '../../server-fault.ts';
import {
  ISSUED_INVOICE_STATUSES,
  mergeUsageHistory,
  rowFromIssuedInvoice,
  type UsageHistoryRow,
} from '../../services/usage-history.ts';

const router = Router();

// Role guards (0039 T1). Every write that moves money or changes how money
// moves requires owner/admin, mirroring the Tenants routes' own pattern —
// until 2026-08-09 all of these ran on `authenticate` alone, so a VIEWER
// could trigger a real Mollie payment.
//
// READS are owner/admin too (owner decision 2026-08-10, overturning the
// 2026-08-09 recorded member-visible line): usage, invoices, payment
// methods and the estimate calculator are financial data the owner chose
// to keep with the roles that can act on it. Two names for one role set on
// purpose — the day reads and writes diverge again, the seam already
// exists and every route says which kind it is.
const requireBillingWrite = requireRole('owner', 'admin');
const requireBillingRead = requireRole('owner', 'admin');

// Lazy pool initialization - created on first use, not at module load
let _dbPool: ReturnType<typeof getDbPool> | null = null;
function getSharedPool() {
  if (!_dbPool) {
    _dbPool = getDbPool();
  }
  return _dbPool;
}

// Schema validation
const EstimateCostSchema = z.object({
  storageUsedGB: z.number().optional(),
  egressGB: z.number().optional(),
  computeHours: z.number().optional(),
  syncCount: z.number().optional(),
});

/**
 * The buyer, as the customer states them (workplan 0111 T1).
 *
 * Consumer-shaped first: `kind` DEFAULTS to consumer, so the minimal honest
 * body — a person, an address, a country — needs no flag, and business is the
 * variant that says so. The vat-number-only-on-business rule is enforced here
 * AND by `billing_party_vat_number_check` in the database; this copy exists to
 * answer with a 400 and a sentence instead of a constraint violation.
 *
 * What is deliberately NOT validated: whether the VAT number is real (VIES is
 * 0111 T2) and whether the country matches where the customer actually is
 * (evidence is 0111 T3). This route stores a statement, not a verdict.
 */
const BillingPartySchema = z
  .object({
    kind: z.enum(['consumer', 'business']).default('consumer'),
    name: z.string().trim().min(1).max(200),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().max(200).optional(),
    postalCode: z.string().trim().min(1).max(16),
    city: z.string().trim().min(1).max(100),
    // Uppercased before the shape check, so "nl" is accepted as the NL the
    // customer meant rather than refused on a case nobody chose deliberately.
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'countryCode must be a two-letter ISO 3166-1 code'),
    vatNumber: z.string().trim().max(32).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind !== 'business' && body.vatNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['vatNumber'],
        message: 'a VAT number belongs to a business — set kind to business, or leave it out',
      });
    }
  });

/**
 * The consultation as the page sees it — everything the row holds except the
 * tenant id the caller already is.
 */
const vatConsultationColumns = {
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

/**
 * The deployment's own identity for QUALIFIED VIES checks — the ones that
 * come back with a consultation number. An instance fact (the operating
 * entity is still an accountant conversation), so it rides the environment:
 * `VIES_REQUESTER_MEMBER_STATE` + `VIES_REQUESTER_VAT_NUMBER`, both or
 * neither. Half a pair REFUSES rather than silently downgrading every check
 * to an unqualified one — a typo that quietly cost the deployment its
 * consultation numbers would be invisible until an auditor asked for them.
 */
class ViesRequesterConfigError extends Error {}
function viesRequesterFromEnv(): ViesRequester | null {
  const ms = process.env.VIES_REQUESTER_MEMBER_STATE?.trim();
  const vat = process.env.VIES_REQUESTER_VAT_NUMBER?.trim();
  if (!ms && !vat) return null;
  if (!ms || !vat) {
    throw new ViesRequesterConfigError(
      'VIES_REQUESTER_MEMBER_STATE and VIES_REQUESTER_VAT_NUMBER must be set together — ' +
        'half a requester would silently downgrade every check to an unqualified one.',
    );
  }
  const parsed = parseVatForVies(ms, vat);
  if (!parsed.ok) {
    throw new ViesRequesterConfigError(`The VIES requester is misconfigured: ${parsed.reason}`);
  }
  return { memberStateCode: parsed.memberState, vatNumber: parsed.number };
}

/** One response shape for GET and PUT, so the page cannot see two dialects. */
const billingPartyColumns = {
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
 * GET /api/billing/usage
 * 
 * Get current usage metrics for the tenant
 * Uses T4's metering: storage/egress DERIVED from item ledger, compute/api_calls from upserts
 * Returns REAL usage from the actual migration runs - NOT from client input
 */
router.get('/usage', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }
    
    const periodStart = new Date().toISOString().slice(0, 7) + '-01'; // First day of current month
    const periodEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10); // Last day of current month

    // What was MEASURED this month, and the tier that measurement puts this
    // tenant in. Every read here is READ-ONLY on purpose: `currentTier` trues
    // the month up — it WRITES the peak it is about to read — because it runs
    // at a moment that prices something. A customer opening their own usage
    // screen prices nothing, so this assembles the same three numbers and
    // hands them to `observedTier`, which derives the identical answer with
    // nothing written (0109 T4's rule, applied to the tenant's own screen).
    const { metrics, peak, pathsNow, bytesMoved } = await withTenantDb(
      tenantId,
      getSharedPool(),
      async (db) => ({
        metrics: await getUsageMetricsForPeriod(db, asTenantId(tenantId), periodStart, periodEnd),
        peak: await new PgOccupancyPeakStore(db).forMonth(asTenantId(tenantId), new Date()),
        pathsNow: await new PgPathLifecycleStore(db).slotsHeld(asTenantId(tenantId)),
        bytesMoved: await new PgBytesMovedStore(db).total(asTenantId(tenantId)),
      }),
    );

    // DECIMAL GB, like every other reader of these bytes: `usage/history`
    // below, `invoice-generation.ts`, and the tier table's own data axis
    // ("1 TB = 1000 GB, the site's convention" — ADR-0014, tier-calculator).
    //
    // These two lines divided by 1024³ until 2026-09-09 — with BYTES_PER_GB
    // declared at the top of this same file, and used by `/usage/history` a
    // hundred lines below. So one screen showed the current month ~7% SMALLER
    // than the same tenant's earlier months, and smaller than the figure that
    // decides which tier they are on. Nothing was wrong with either number on
    // its own, which is why it survived: the defect existed only between them.
    const usage = {
      tenantId,
      period: periodStart.slice(0, 7), // YYYY-MM
      storageUsedGB: metrics.storageBytes / BYTES_PER_GB,
      egressGB: metrics.egressBytes / BYTES_PER_GB,
      computeHours: metrics.computeHours,
      syncCount: metrics.apiCallCount,
      lastUpdated: new Date().toISOString(),
    };

    const { tier, decidedBy, evidence } = observedTier(
      peak?.peakPaths ?? 0,
      pathsNow,
      Number(bytesMoved) / BYTES_PER_GB,
    );

    // NO `currentCost`. It used to carry `calculateCost` — base fee, per-GB
    // storage and egress, per-hour compute, VAT and a total — which is the
    // metered model ADR-0014 RETIRED on 2026-08-20 and that this API refuses
    // to mint an invoice from (0109 T0). Serving it here quoted a customer a
    // euro figure on a price list nothing would ever bill them at, itemised
    // and totalled so it read exactly like a bill. Deleted rather than left
    // behind a flag, per the same precedent as the generate route's body.
    //
    // What replaces it is what they WOULD be quoted: the tier, with the
    // evidence that decided it (workplan 0121 T4, owner 2026-09-09 — the
    // measurement is instrumentation, and the customer gets to see it).
    res.json({
      usage,
      // Null past the end of the table: the same deliberate "talk to us" the
      // site publishes and the calculator returns.
      tier: tier
        ? {
            id: tier.id,
            name: tier.name,
            paths: tier.paths,
            dataGb: tier.dataGb,
            setup: tier.setup,
            monthly: tier.monthly,
          }
        : null,
      decidedBy,
      evidence: {
        peakPaths: evidence.peakPaths,
        peakAt: peak?.peakAt ?? null,
        gbMoved: evidence.gbMoved,
      },
      period: periodStart.slice(0, 7),
    });
  } catch (error) {
    serverFault(res, 'usage_failed', 'reading your usage', error);
  }
});

/**
 * GET /api/billing/usage/history
 *
 * Get usage history for the tenant
 * Aggregates metrics by period
 */
router.get('/usage/history', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }

    /**
     * DERIVED per period, not read out of `usage_metric` (workplan 0121 T3).
     *
     * This used to sum stored rows. Nothing writes them any more — compute and
     * sync operations come from the `run` ledger, storage and egress from the
     * `item` ledger — so summing that table would answer zero for every month
     * and look exactly like a customer who had never synced.
     *
     * The months are taken from the run ledger, which is the record of when
     * this tenant actually ran. A month with passes in it is a month worth a
     * row; a month with none is not history, it is silence.
     */
    const { months, pricing, issued } = await withTenantDb(tenantId, getSharedPool(), async (db) => ({
      months: await db
        .select({ month: sql<string>`to_char(${runTable.createdAt}, 'YYYY-MM')` })
        .from(runTable)
        .where(eq(runTable.tenantId, tenantId))
        .groupBy(sql`to_char(${runTable.createdAt}, 'YYYY-MM')`)
        .orderBy(sql`to_char(${runTable.createdAt}, 'YYYY-MM') DESC`),
      pricing: await resolveTenantPricing(db, tenantId),
      /**
       * The months the run ledger can no longer answer for (0121 §4b).
       *
       * T5 prunes `run` after sixty days, so the GROUP BY above stops
       * returning older months entirely. T3 froze the measured quantities onto
       * the invoice for exactly this reason — `usage-history.ts` says which
       * side wins and why the money comes off the invoice rather than being
       * re-priced at today's list.
       */
      issued: await db
        .select({
          periodStart: schema.invoice.periodStart,
          subtotal: schema.invoice.subtotal,
          taxRate: schema.invoice.taxRate,
          taxAmount: schema.invoice.taxAmount,
          total: schema.invoice.total,
          metadata: schema.invoice.metadata,
        })
        .from(schema.invoice)
        .where(
          and(
            eq(schema.invoice.tenantId, tenantId),
            inArray(schema.invoice.status, [...ISSUED_INVOICE_STATUSES]),
          ),
        ),
    }));

    const usageHistory: UsageHistoryRow[] = [];
    for (const { month } of months) {
      const [year, mon] = month.split('-').map(Number);
      if (!year || !mon) continue;
      const periodStart = `${month}-01`;
      // Day 0 of the NEXT month is the last day of this one, in UTC so the
      // boundary does not move with the server's timezone.
      const periodEnd = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);

      const usage = await withTenantDb(tenantId, getSharedPool(), (db) =>
        getUsageMetricsForPeriod(db, asTenantId(tenantId), periodStart, periodEnd),
      );

      const shaped = {
        period: month,
        storageUsedGB: usage.storageBytes / BYTES_PER_GB,
        egressGB: usage.egressBytes / BYTES_PER_GB,
        computeHours: usage.computeHours,
        syncCount: usage.apiCallCount,
      };
      usageHistory.push({ ...shaped, cost: calculateCost(shaped, pricing), source: 'ledger' });
    }

    // Older periods, from the invoices that recorded them. `rowFromIssuedInvoice`
    // drops any invoice that cannot answer — one issued before T3 froze the
    // quantities has no `measured` block, and a row of zeros beside real months
    // reads as a month in which nothing happened.
    const fromInvoices = issued
      .map((row) => rowFromIssuedInvoice(row))
      .filter((row): row is UsageHistoryRow => row !== null);

    res.json({
      usage: mergeUsageHistory(usageHistory, fromInvoices),
    });
  } catch (error) {
    serverFault(res, 'usage_history_failed', 'reading your usage history', error);
  }
});

/**
 * POST /api/billing/estimate
 * 
 * Estimate cost based on projected usage
 * Pure calculation - no DB access needed
 */
router.post('/estimate', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }
    const body = EstimateCostSchema.parse(req.body);

    // Estimated at what THIS tenant pays, not the current price list: an
    // estimate that quietly used the template would tell an existing customer
    // a number their own invoice will never show.
    const pricing = await withTenantDb(tenantId, getSharedPool(), (db) =>
      resolveTenantPricing(db, tenantId),
    );
    const cost = calculateCost({
      storageUsedGB: body.storageUsedGB || 0,
      egressGB: body.egressGB || 0,
      computeHours: body.computeHours || 0,
      syncCount: body.syncCount || 0,
    }, pricing);

    res.json({
      estimate: cost.total,
      // The breakdown tracks PricingConfig via calculateCost — the hardcoded
      // 999 here survived a pricing change once already (0039 T3).
      breakdown: {
        baseFee: cost.baseFee,
        storage: cost.storage,
        egress: cost.egress,
        compute: cost.compute,
        tax: cost.tax,
        total: cost.total,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation error',
        details: error.issues,
      });
    } else {
      serverFault(res, 'estimate_failed', 'estimating the cost', error);
    }
  }
});

/**
 * GET /api/billing/party
 *
 * Who invoices are addressed to. `party: null` means "not yet provided" —
 * a real state the page shows as such (no row is how the database says it,
 * migration 0012), never an error.
 *
 * `vatConsultation` (0111 T2) is the latest VIES answer FOR THE NUMBER AS
 * CURRENTLY STORED — the log is append-only, so which row speaks is decided
 * here, by matching what `billing_party` says now. A number changed since
 * its last check therefore reads `null`, which is correct: nothing has
 * checked the number the next invoice would rely on.
 *
 * `vatTreatment` (0111 T3) is the decision those two feed: what an invoice
 * for THIS buyer would carry — a treatment, never a rate (ADR-0044; the
 * number belongs to the bookkeeping system). Computed fresh on every read
 * from the seller's configured country (`OWNPACE_SELLER_COUNTRY`, NL until
 * the entity decision) and the OSS switch (`VAT_OSS_ACTIVE`, false until the
 * owner's threshold decision flips).
 */
router.get('/party', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }

    const { party, vatConsultation } = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      const rows = await db
        .select(billingPartyColumns)
        .from(schema.billingParty)
        .where(eq(schema.billingParty.tenantId, tenantId));
      const stored = rows[0] ?? null;

      if (!stored || stored.kind !== 'business' || !stored.vatNumber) {
        return { party: stored, vatConsultation: null };
      }
      const parsed = parseVatForVies(stored.countryCode, stored.vatNumber);
      if (!parsed.ok) return { party: stored, vatConsultation: null };

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
      return { party: stored, vatConsultation: consultations[0] ?? null };
    });

    const vatTreatment = party
      ? decideVatTreatment({
          sellerCountry: process.env.OWNPACE_SELLER_COUNTRY?.trim() || 'NL',
          ossActive: process.env.VAT_OSS_ACTIVE?.trim().toLowerCase() === 'true',
          buyer: { kind: party.kind, countryCode: party.countryCode },
          consultation: vatConsultation ? { valid: vatConsultation.valid } : null,
        })
      : null;

    res.json({ party, vatConsultation, vatTreatment });
  } catch (error) {
    serverFault(res, 'billing_party_read_failed', 'reading your invoice details', error);
  }
});

/**
 * PUT /api/billing/party
 *
 * Create or replace the buyer's details — an UPSERT keyed on the tenant, so
 * sending the same body twice converges on the same row (hard rule 1) and
 * there is no separate create-vs-edit path to drift. The whole statement is
 * replaced each time: these fields are one fact about one buyer, and a partial
 * PATCH would let a kind switch strand a stale VAT number, which is exactly
 * the contradiction the database refuses.
 */
router.put('/party', authenticate, requireBillingWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }
    const body = BillingPartySchema.parse(req.body);

    // Normalised at the seam: optional strings that arrived empty are stored
    // as NULL, and a consumer's vat_number is NULL whatever was sent (the
    // schema already refused a non-empty one).
    const row = {
      kind: body.kind,
      name: body.name,
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2 || null,
      postalCode: body.postalCode,
      city: body.city,
      countryCode: body.countryCode,
      vatNumber: body.kind === 'business' && body.vatNumber ? body.vatNumber : null,
    };

    const [party] = await withTenantDb(tenantId, getSharedPool(), async (db) =>
      db
        .insert(schema.billingParty)
        .values({ tenantId, ...row })
        .onConflictDoUpdate({
          target: schema.billingParty.tenantId,
          set: { ...row, updatedAt: new Date() },
        })
        .returning(billingPartyColumns),
    );

    res.json({ party });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation error',
        details: error.issues,
      });
    } else {
      serverFault(res, 'billing_party_write_failed', 'saving your invoice details', error);
    }
  }
});

/**
 * POST /api/billing/party/check-vat
 *
 * Consult VIES about the stored VAT number, and keep the answer (workplan
 * 0111 T2). An unvalidated number is not a defence; the consultation number
 * this stores is.
 *
 * Three refusals, each with its own name, because they need different
 * remedies:
 *
 *   409 `nothing_to_check`   — no business party with a VAT number stored.
 *                              Save the details first.
 *   409 `vat_not_checkable`  — VIES can NEVER answer this one (a GB number,
 *                              a malformed one). Retrying changes nothing.
 *   503 `vies_unavailable`   — VIES could not answer NOW (its member-state
 *                              backends are famously intermittent). Nothing
 *                              is stored: "we could not ask" is not an
 *                              answer, and the log holds only answers.
 *
 * A 200 is an answer either way — `consultation.valid: false` is VIES saying
 * no, stored exactly like a yes, because both are evidence. Every 200
 * APPENDS: re-checking is legitimate (numbers get deregistered) and history
 * is the point of a log.
 */
router.post('/party/check-vat', authenticate, requireBillingWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }
    // Read the config BEFORE asking anything: a misconfigured requester must
    // fail loudly here, not silently strip every check of its consultation
    // number.
    const requester = viesRequesterFromEnv();

    const rows = await withTenantDb(tenantId, getSharedPool(), async (db) =>
      db
        .select(billingPartyColumns)
        .from(schema.billingParty)
        .where(eq(schema.billingParty.tenantId, tenantId)),
    );
    const party = rows[0];
    if (!party || party.kind !== 'business' || !party.vatNumber) {
      return res.status(409).json({
        error: 'nothing_to_check',
        reason:
          'Only a business with a stored VAT number can be checked against VIES — save the invoice details first.',
      });
    }

    const parsed = parseVatForVies(party.countryCode, party.vatNumber);
    if (!parsed.ok) {
      return res.status(409).json({ error: 'vat_not_checkable', reason: parsed.reason });
    }

    const outcome = await checkVat({ memberState: parsed.memberState, number: parsed.number }, requester);
    if (outcome.kind === 'not_checkable') {
      return res.status(409).json({ error: 'vat_not_checkable', reason: outcome.reason });
    }
    if (outcome.kind === 'unavailable') {
      return res.status(503).json({ error: 'vies_unavailable', reason: outcome.reason });
    }

    const [consultation] = await withTenantDb(tenantId, getSharedPool(), async (db) =>
      db
        .insert(schema.vatConsultation)
        .values({
          tenantId,
          countryCode: parsed.memberState,
          vatNumber: parsed.number,
          valid: outcome.valid,
          requestDate: outcome.requestDate,
          consultationNumber: outcome.consultationNumber,
          traderName: outcome.traderName,
          traderAddress: outcome.traderAddress,
        })
        .returning(vatConsultationColumns),
    );

    res.json({ consultation });
  } catch (error) {
    if (error instanceof ViesRequesterConfigError) {
      // Configuration, not VIES: retrying cannot help, and the sentence names
      // the two variables to fix.
      res.status(500).json({ error: 'vies_requester_misconfigured', message: error.message });
    } else {
      serverFault(res, 'vat_check_failed', 'checking this VAT number', error);
    }
  }
});

/**
 * POST /api/billing/invoices/generate
 *
 * Generate (or refresh) the invoice for a billing period from metered usage.
 * Body: { period?: "YYYY-MM" } — defaults to the current month. Idempotent; a
 * paid/void invoice is returned unchanged. Intended to be called by a
 * managed-mode scheduled job at period close (self-host never loads billing).
 */
router.post('/invoices/generate', authenticate, requireBillingWrite, (req: AuthenticatedRequest, res: Response) => {
  // REFUSED, and the body that used to be here is GONE rather than left
  // unreachable behind the refusal (workplan 0109 T0, the owner's decision of
  // 2026-08-27). Dead code under a `return` is code nobody maintains and
  // everybody assumes still works; git has the old body, and 0109 T5 writes
  // the real one against tiers.
  //
  // What it did, so the next reader need not dig: it read metered usage for a
  // period and called `generateInvoiceForPeriod`. That service still exists and
  // is now unreachable from the API — and, stated plainly because the opposite
  // would be more comfortable, it is no longer covered by a test: its only
  // coverage was through this route. Re-pinning its arithmetic was considered
  // and rejected, because the doc comment in `no-bill-we-do-not-sell.ts` names
  // three faults in exactly that arithmetic; a test asserting the old total
  // would be asserting a number this same change calls wrong. 0109 T5 replaces
  // the service, and `no-bill-we-do-not-sell.unit.test.ts` goes red the moment
  // it does.
  //
  // What is refused is MINTING A BILL, which is the one operation that turns a
  // retired model into a number somebody could be asked to pay. Every other
  // billing route is untouched.
  //
  // 409 rather than 501: the request is well-formed and this caller is
  // entitled to make it; the deployment cannot honour it. No tenant scoping
  // and no database work happens first, so a refused call leaves nothing
  // behind — not even a draft.
  if (!req.tenantId) {
    return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
  }
  res.status(409).json({ error: NO_TIER_BILLING_CODE, reason: NO_TIER_BILLING_REASON });
});

/**
 * GET /api/billing/invoices
 *
 * List all invoices for the tenant
 */
router.get('/invoices', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }

    const invoices = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      return await db.select({
        id: schema.invoice.id,
        tenantId: schema.invoice.tenantId,
        periodStart: schema.invoice.periodStart,
        periodEnd: schema.invoice.periodEnd,
        status: schema.invoice.status,
        subtotal: schema.invoice.subtotal,
        taxRate: schema.invoice.taxRate,
        taxAmount: schema.invoice.taxAmount,
        total: schema.invoice.total,
        currency: schema.invoice.currency,
        paymentMethod: schema.invoice.paymentMethod,
        paymentId: schema.invoice.paymentId,
        paidAt: schema.invoice.paidAt,
        dueDate: schema.invoice.dueDate,
        sentAt: schema.invoice.sentAt,
        metadata: schema.invoice.metadata,
        createdAt: schema.invoice.createdAt,
        updatedAt: schema.invoice.updatedAt,
      })
      .from(schema.invoice)
      .where(eq(schema.invoice.tenantId, tenantId))
      .orderBy(desc(schema.invoice.createdAt));
    });

    res.json({
      invoices,
    });
  } catch (error) {
    serverFault(res, 'invoices_failed', 'listing your invoices', error);
  }
});

/**
 * GET /api/billing/invoices/:invoiceId
 * 
 * Get invoice details
 */
router.get('/invoices/:invoiceId', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invoiceId = req.params.invoiceId;
    if (!invoiceId || Array.isArray(invoiceId)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invoice ID required' });
    }
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }

    const invoices = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      return await db.select({
        id: schema.invoice.id,
        tenantId: schema.invoice.tenantId,
        periodStart: schema.invoice.periodStart,
        periodEnd: schema.invoice.periodEnd,
        status: schema.invoice.status,
        subtotal: schema.invoice.subtotal,
        taxRate: schema.invoice.taxRate,
        taxAmount: schema.invoice.taxAmount,
        total: schema.invoice.total,
        currency: schema.invoice.currency,
        paymentMethod: schema.invoice.paymentMethod,
        paymentId: schema.invoice.paymentId,
        paidAt: schema.invoice.paidAt,
        dueDate: schema.invoice.dueDate,
        sentAt: schema.invoice.sentAt,
        metadata: schema.invoice.metadata,
        createdAt: schema.invoice.createdAt,
        updatedAt: schema.invoice.updatedAt,
      })
      .from(schema.invoice)
      .where(
        and(
          eq(schema.invoice.id, invoiceId),
          eq(schema.invoice.tenantId, tenantId),
        )
      );
    });

    if (invoices.length === 0) {
      res.status(404).json({
        error: 'Not found',
        message: 'Invoice not found',
      });
      return;
    }

    res.json({ invoice: invoices[0] });
  } catch (error) {
    serverFault(res, 'invoice_failed', 'reading this invoice', error);
  }
});

/**
 * POST /api/billing/invoices/:invoiceId/pay
 * 
 * Create payment for invoice using Mollie
 */
router.post('/invoices/:invoiceId/pay', authenticate, requireBillingWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invoiceId = req.params.invoiceId;
    if (!invoiceId || Array.isArray(invoiceId)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invoice ID required' });
    }
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }

    // Get invoice from database
    const invoices = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      return await db.select({
        id: schema.invoice.id,
        tenantId: schema.invoice.tenantId,
        periodStart: schema.invoice.periodStart,
        periodEnd: schema.invoice.periodEnd,
        status: schema.invoice.status,
        total: schema.invoice.total,
      })
      .from(schema.invoice)
      .where(
        and(
          eq(schema.invoice.id, invoiceId),
          eq(schema.invoice.tenantId, tenantId),
        )
      );
    });

    if (invoices.length === 0) {
      res.status(404).json({
        error: 'Not found',
        message: 'Invoice not found',
      });
      return;
    }

    const invoice = invoices[0];
    if (!invoice) {
      res.status(404).json({
        error: 'Not found',
        message: 'Invoice not found',
      });
      return;
    }

    // Refuse BEFORE creating a Mollie payment: a paid document has nothing
    // left to pay, and a void one is cancelled. The database's status
    // machine (managed migration 0014) would refuse the → sent write anyway,
    // but by then real money would already be moving — the order of these
    // two lines is the point.
    if (invoice.status === 'paid' || invoice.status === 'void') {
      res.status(409).json({
        error: 'Conflict',
        message: `Invoice is ${invoice.status} and cannot be paid`,
      });
      return;
    }

    // Get Mollie service
    const mollieService = getMollieService();

    // Create payment via Mollie
    const payment = await mollieService.createPayment({
      tenantId,
      amount: Number(invoice.total), // Amount in cents
      description: `Invoice ${invoice.id} for period ${invoice.periodStart} to ${invoice.periodEnd}`,
      // /billing, not /billing/invoices/:id — the SPA defines no invoice
      // detail route, so the old value landed the customer on a BLANK PAGE
      // immediately after paying (0039 T4). Point it at a route that renders
      // until an invoice detail exists.
      redirectUrl: `${process.env.WEB_URL || 'http://localhost:3123'}/billing`,
      webhookUrl: `${process.env.API_URL || 'http://localhost:3001'}/api/billing/webhooks/mollie`,
      // Round-trip the invoice + tenant so the webhook can correlate the payment
      // back to the exact invoice under the right RLS context.
      metadata: { invoiceId },
    });

    // Update invoice status in database
    await withTenantDb(tenantId, getSharedPool(), async (db) => {
      await db.update(schema.invoice)
        .set({
          status: 'sent',
          paymentId: payment.id,
          metadata: { mollieInvoiceId: payment.id },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.invoice.id, invoiceId),
            eq(schema.invoice.tenantId, tenantId),
          )
        );
    });

    res.json({
      paymentUrl: payment.redirectUrl,
      paymentId: payment.id,
      status: payment.status,
    });
  } catch (error: unknown) {
    log.error('Error creating payment:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (errorMessage.includes('MOLLIE_API_KEY')) {
      res.status(500).json({
        error: 'Configuration error',
        message: 'Mollie API key not configured',
      });
    } else {
      serverFault(res, 'payment_failed', 'creating this payment', error);
    }
  }
});

/**
 * GET /api/billing/payment-methods
 * 
 * List payment methods for the tenant
 */
router.get('/payment-methods', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }

    const paymentMethods = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      return await db.select({
        id: schema.paymentMethod.id,
        tenantId: schema.paymentMethod.tenantId,
        mollieId: schema.paymentMethod.mollieId,
        type: schema.paymentMethod.type,
        brand: schema.paymentMethod.brand,
        lastFour: schema.paymentMethod.lastFour,
        expiryMonth: schema.paymentMethod.expiryMonth,
        expiryYear: schema.paymentMethod.expiryYear,
        isDefault: schema.paymentMethod.isDefault,
        status: schema.paymentMethod.status,
        createdAt: schema.paymentMethod.createdAt,
        updatedAt: schema.paymentMethod.updatedAt,
      })
      .from(schema.paymentMethod)
      .where(eq(schema.paymentMethod.tenantId, tenantId));
    });

    res.json({
      paymentMethods,
    });
  } catch (error) {
    serverFault(res, 'payment_methods_failed', 'listing your payment methods', error);
  }
});

/**
 * POST /api/billing/payment-methods
 * 
 * Add a new payment method
 */
router.post('/payment-methods', authenticate, requireBillingWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    }
    const body = z.object({
      type: z.enum(['card', 'banktransfer', 'other']),
      last4: z.string().optional(),
      brand: z.string().optional(),
      expiryMonth: z.number().optional(),
      expiryYear: z.number().optional(),
      mollieId: z.string().optional(),
    }).parse(req.body);

    const [paymentMethod] = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      return await db.insert(schema.paymentMethod).values({
        tenantId,
        mollieId: body.mollieId || `pm-${Date.now()}`,
        type: body.type,
        brand: body.brand,
        lastFour: body.last4,
        expiryMonth: body.expiryMonth,
        expiryYear: body.expiryYear,
        isDefault: false,
        status: 'active',
      }).returning();
    });

    res.status(201).json({
      paymentMethod,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation error',
        details: error.issues,
      });
    } else {
      serverFault(res, 'payment_method_failed', 'adding this payment method', error);
    }
  }
});

/**
 * PATCH /api/billing/payment-methods/:paymentMethodId/default
 * 
 * Set default payment method
 */
router.patch(
  '/payment-methods/:paymentMethodId/default',
  authenticate,
  requireBillingWrite,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const paymentMethodId = req.params.paymentMethodId;
      if (!paymentMethodId || Array.isArray(paymentMethodId)) {
        return res.status(400).json({ error: 'Bad Request', message: 'Payment method ID required' });
      }
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
      }

      // First, unset all default payment methods for this tenant
      await withTenantDb(tenantId, getSharedPool(), async (db) => {
        await db.update(schema.paymentMethod)
          .set({ isDefault: false })
          .where(eq(schema.paymentMethod.tenantId, tenantId));
      });

      // Then set the requested payment method as default
      const [paymentMethod] = await withTenantDb(tenantId, getSharedPool(), async (db) => {
        return await db.update(schema.paymentMethod)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(
            and(
              eq(schema.paymentMethod.id, paymentMethodId),
              eq(schema.paymentMethod.tenantId, tenantId),
            )
          )
          .returning();
      });

      if (!paymentMethod) {
        res.status(404).json({
          error: 'Not found',
          message: 'Payment method not found',
        });
        return;
      }

      res.json({
        paymentMethod,
      });
    } catch (error) {
      serverFault(res, 'payment_method_default_failed', 'setting your default payment method', error);
    }
  }
);

export default router;
