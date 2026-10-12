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
  monthPeriod,
  resolveTenantPricing,
  parseVatForVies,
  checkVat,
  decideVatTreatment,
  observedTier,
  PgOccupancyPeakStore,
  PgBytesMovedStore,
  PgDataAllowanceStore,
  allowanceOf,
  billedTierOf,
  breakEvenOf,
  decidePathsYes,
  decidePick,
  decideYes,
  holdsAtCeiling,
  monthlyEur,
  pathsPastTheTierReason,
  pickedFloorOf,
  pickOffers,
  PgTierPickStore,
  readBilledNow,
  readCeiling,
  type BilledNow,
  type Ceiling,
  type ManagedTier,
  type PathsForecast,
  type ViesRequester,
  downloadInvoicePdf,
  moneybirdFromEnv,
  dayInWords,
  momentInWords,
  MANAGED_TIERS,
  readWithdrawalWindow,
  readYesAsksToBegin,
  withdraw,
  type AllowanceGrant,
  type WithdrawalWindow,
  creditedCents,
  CREDITED_CENTS_SQL,
  decideYear,
  monthWords,
  readYearOffer,
  recordYear,
  type YearOffer,
  type YearRecorded,
} from '@openmig/managed';
import { tell } from '../../access-notify.ts';
import * as schema from '@openmig/managed/schema-managed';
// The run ledger lives in @openmig/ledger (ADR-0036): compute derives from it.
import { run as runTable, tenant as tenantTable } from '@openmig/ledger/schema-pg';
// The live slot count, through the ONE authority on which states hold a slot
// (`holdsASlot`, wrapped by `slotsHeld`) rather than a second list here.
import { PgPathLifecycleStore, type PgDatabase } from '@openmig/ledger';
import { log, readTenantNotificationPrefs, termsUrl, type NotificationLocale, type TenantId } from '@openmig/shared';
import { readPathsForecast } from './paths-at-start.ts';
import {
  billingPartyColumns,
  readVatStanding,
  vatConsultationColumns,
} from '../../services/vat-standing.ts';

/** Decimal GB, as the tier table uses — a price list is not binary. */
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
    // Where Moneybird e-mails the invoice (0111 decision 11, managed 0048).
    // Optional; empty is none. One `@` with something either side, as the
    // column's check: whether the mailbox exists is the delivery's to find out.
    invoiceEmail: z
      .string()
      .trim()
      .max(254)
      .regex(/^([^@\s]+@[^@\s]+)?$/, 'invoiceEmail must be an e-mail address, or empty')
      .optional(),
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
    
    // `toISOString` so this is the UTC month — the one
    // `PgOccupancyPeakStore.forMonth` looks the peak up under below, and the
    // one `occupancy_peak.month` is documented to hold. Both period dates then
    // come from `monthPeriod`, which `/usage/history` also uses.
    //
    // The last day of the month was built here from `getFullYear()`/
    // `getMonth()` until 2026-09-09 — the server's LOCAL clock — which east of
    // Greenwich named the second-to-last day of the month as its last. See
    // `monthPeriod` for what that cost.
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM, UTC
    const { periodStart, periodEnd } = monthPeriod(period);

    // What was MEASURED this month, and the tier that measurement puts this
    // tenant in. Every read here is READ-ONLY on purpose: `currentTier` trues
    // the month up — it WRITES the peak it is about to read — because it runs
    // at a moment that prices something. A customer opening their own usage
    // screen prices nothing, so this assembles the same three numbers and
    // hands them to `observedTier`, which derives the identical answer with
    // nothing written (0109 T4's rule, applied to the tenant's own screen).
    const { metrics, peak, pathsNow, meter, grants, picks } = await withTenantDb(
      tenantId,
      getSharedPool(),
      async (db) => ({
        metrics: await getUsageMetricsForPeriod(db, asTenantId(tenantId), periodStart, periodEnd),
        peak: await new PgOccupancyPeakStore(db).forMonth(asTenantId(tenantId), new Date()),
        pathsNow: await new PgPathLifecycleStore(db).slotsHeld(asTenantId(tenantId)),
        // What counts, and what the alpha moved, which does not (managed 0040).
        meter: await new PgBytesMovedStore(db).read(asTenantId(tenantId)),
        grants: await new PgDataAllowanceStore(db).grants(asTenantId(tenantId)),
        // The tiers picked (0157 T6): the least the month bills.
        picks: await new PgTierPickStore(db).picks(asTenantId(tenantId)),
      }),
    );

    // DECIMAL GB, like every other reader of these bytes: `usage/history`
    // below, and the tier table's own data axis
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
      period,
      storageUsedGB: metrics.storageBytes / BYTES_PER_GB,
      egressGB: metrics.egressBytes / BYTES_PER_GB,
      computeHours: metrics.computeHours,
      syncCount: metrics.apiCallCount,
      lastUpdated: new Date().toISOString(),
    };

    const { tier, decidedBy, evidence } = observedTier(
      peak?.peakPaths ?? 0,
      pathsNow,
      Number(meter.counted) / BYTES_PER_GB,
    );
    // What the month bills: what it used, never above the agreed tier
    // (ADR-0014; the owner, 2026-10-04), and never below a tier picked (0157
    // T6). The page names it once the alpha ends; during the alpha nothing is
    // billed, and it names what was used.
    const allowance = allowanceOf(grants);
    const picked = pickedFloorOf(picks, new Date()).now;
    const billed = billedTierOf(tier, allowance, evidence.peakPaths, evidence.gbMoved, picked);
    const tierBody = (t: NonNullable<typeof tier>) => ({
      id: t.id,
      name: t.name,
      paths: t.paths,
      dataGb: t.dataGb,
      monthlyCents: t.monthlyCents,
      annualCents: t.annualCents,
    });

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
      // What was used. Null past the end of the table: the same deliberate
      // "talk to us" the site publishes and the calculator returns.
      tier: tier ? tierBody(tier) : null,
      decidedBy,
      evidence: {
        peakPaths: evidence.peakPaths,
        peakAt: peak?.peakAt ?? null,
        // As it counts: the alpha's data does not.
        gbMoved: evidence.gbMoved,
      },
      // What the month bills, and why, when what was used is past it, or the
      // pick is above what was used.
      billed: { tier: tierBody(billed.tier), beyond: billed.beyond, picked: billed.picked },
      // The data ceiling the data counts against, and the bands bought.
      ceilingGb: allowance.ceilingGb,
      topUps: allowance.topUps,
      // Moved during the alpha, which never counts (the owner, 2026-10-04).
      gbMovedInTheAlpha: Number(meter.inTheAlpha) / BYTES_PER_GB,
      // False during the alpha, where nothing is billed.
      holds: holdsAtCeiling(process.env.OWNPACE_STAGE),
      period: periodStart.slice(0, 7),
    });
  } catch (error) {
    serverFault(res, 'usage_failed', 'reading your usage', error);
  }
});

/**
 * The data ceiling as the Billing page shows it (workplan 0109 T6).
 *
 * `holds` says whether this deployment holds new first copies at the ceiling
 * and takes a yes: not during the alpha (the owner, 2026-10-03: *"A"*), where
 * nothing is charged and the ceiling only warns.
 */
function ceilingBody(c: Ceiling, holds: boolean, gbMovedInTheAlpha: number) {
  return {
    tier: {
      id: c.allowance.tier.id,
      name: c.allowance.tier.name,
      paths: c.allowance.tier.paths,
      monthly: monthlyEur(c.allowance.tier),
    },
    ceilingGb: c.allowance.ceilingGb,
    topUps: c.allowance.topUps,
    gbMoved: c.gbMoved,
    // Moved during the alpha, which never counts (the owner, 2026-10-04).
    gbMovedInTheAlpha,
    share: c.share,
    state: c.state,
    holds,
    moveUp: c.moveUp
      ? {
          tierId: c.moveUp.tier.id,
          name: c.moveUp.tier.name,
          paths: c.moveUp.tier.paths,
          monthlyEur: c.moveUp.monthlyEur,
          ceilingGb: c.moveUp.ceilingGb,
        }
      : null,
    topUp: c.topUp,
    // ADR-0014: "at 80%, offer both and show the break-even".
    breakEven: breakEvenOf(c),
  };
}

/** What the alpha moved, in decimal GB: shown beside the ceiling, never counted against it. */
async function alphaGbOf(db: Parameters<typeof readCeiling>[0], tenantId: string): Promise<number> {
  return Number((await new PgBytesMovedStore(db).read(asTenantId(tenantId))).inTheAlpha) / BYTES_PER_GB;
}

/**
 * GET /api/billing/ceiling
 *
 * Where the organisation's data stands against its ceiling, and the two ways
 * on: move up a tier, or a one-off top-up (ADR-0014's amendment of
 * 2026-10-03). Read-only.
 */
router.get('/ceiling', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const { ceiling, alphaGb } = await withTenantDb(tenantId, getSharedPool(), async (db) => ({
      ceiling: await readCeiling(db, asTenantId(tenantId)),
      alphaGb: await alphaGbOf(db, tenantId),
    }));
    res.json(ceilingBody(ceiling, holdsAtCeiling(process.env.OWNPACE_STAGE), alphaGb));
  } catch (error) {
    serverFault(res, 'ceiling_failed', 'reading your data ceiling', error);
  }
});

/**
 * `beginNow`: the order button the yes was given at said, in one sentence,
 * that we begin at once and what a withdrawal then costs (0111 slice 7e;
 * terms §7). Sent by a page that showed it; recorded when the yes does begin
 * within a withdrawal window (`readYesAsksToBegin`).
 */
const BeginNow = z.literal(true).optional();

const YesSchema = z.object({
  choice: z.enum(['move_up', 'top_up']),
  tierId: z.string().min(1),
  priceEur: z.number().int().min(0),
  beginNow: BeginNow,
});

/**
 * INVOICE DETAILS COME FIRST (workplan 0111, decision 14, the owner,
 * 2026-10-05: "ok"; "a yes or a pick that leaves Free asks for them
 * first"). Every yes and every pick of a paid tier is something an invoice
 * will charge, and an invoice is made out to somebody: the name and address
 * under Invoice details. Without them the invoice could be made and never
 * sent (invoice-push.ts refuses it by name), so the yes is refused instead,
 * before anything is recorded, and the page shows the way to the card.
 * Asked inside the yes's own transaction, after its lock.
 */
const INVOICE_DETAILS_FIRST =
  'Your invoice details come first: the name and address an invoice is made out to. ' +
  'Add them under Invoice details, then say yes again.';

async function hasInvoiceDetails(db: PgDatabase, tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ tenantId: schema.billingParty.tenantId })
    .from(schema.billingParty)
    .where(eq(schema.billingParty.tenantId, tenantId))
    .limit(1);
  return rows.length === 1;
}

/** A yes, recorded: what was ordered, when, whether its button asked to begin, and the window after it. */
interface RecordedOrder {
  readonly grant: AllowanceGrant & { readonly priceEur: number };
  readonly at: Date;
  readonly beganOnRequest: boolean;
  readonly window: WithdrawalWindow;
}

/**
 * Record one yes, in the yes's own transaction after its lock (0111 slice
 * 7e): `began_on_request` when the page said the sentence at the order button
 * (`beginNow`) and the yes does begin within a withdrawal window. Then the
 * window as it stands after it, for the order's confirmation.
 */
async function recordOrder(
  db: PgDatabase,
  tenantId: string,
  grant: AllowanceGrant & { readonly priceEur: number },
  by: string,
  axis: 'data' | 'paths' | 'pick',
  beginNow: true | undefined,
  now: Date = new Date(),
): Promise<RecordedOrder> {
  const beganOnRequest = beginNow === true && (await readYesAsksToBegin(db, asTenantId(tenantId), now));
  await new PgDataAllowanceStore(db).record(asTenantId(tenantId), grant, by, axis, beganOnRequest);
  return { grant, at: now, beganOnRequest, window: await readWithdrawalWindow(db, asTenantId(tenantId), now) };
}

/** Whole euros, as the mail says them in its language. */
const euros = (whole: number, locale: NotificationLocale) =>
  new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-IE', { style: 'currency', currency: 'EUR' }).format(whole);

/**
 * The order's confirmation (0111 T7, slice 7e; terms §6 and §7; article 8(7)
 * of the Consumer Rights Directive): after the commit, to the signed-in
 * address that gave the yes, in the organisation's language. What was
 * ordered, at which price, and when; while a consumer's fourteen days run, how
 * to withdraw and what it costs. Never a throw: the order stands whatever the
 * mail server does, and one not sent is logged, to be sent by hand.
 */
async function confirmOrder(req: AuthenticatedRequest, tenantId: string, order: RecordedOrder): Promise<void> {
  try {
    const [organisation] = await withTenantDb(tenantId, getSharedPool(), (db) =>
      db.select({ name: tenantTable.name, settings: tenantTable.settings }).from(tenantTable).where(eq(tenantTable.id, tenantId)),
    );
    const locale = readTenantNotificationPrefs(organisation?.settings).locale;
    const { grant, window } = order;
    const sent = req.userEmail
      ? await tell(req.userEmail, locale, {
          kind: 'order_confirmed',
          organisation: organisation?.name ?? tenantId,
          order:
            grant.kind === 'tier'
              ? { kind: 'tier', tier: tierName(grant.tierId), monthly: euros(grant.priceEur, locale) }
              : { kind: 'top_up', band: `${grant.bandGb} GB`, price: euros(grant.priceEur, locale) },
          orderedAt: momentInWords(order.at, locale),
          // The last day: `until` is the end of it, exclusive.
          withdrawUntil: window.kind === 'open' ? dayInWords(new Date(window.until.getTime() - 1), locale) : null,
          beganOnRequest: order.beganOnRequest,
          terms: termsUrl(locale, process.env),
        })
      : 'no_address';
    if (sent !== 'sent') {
      log.error(
        `[billing] organisation ${tenantId} ordered at ${order.at.toISOString()}, and its confirmation was not sent ` +
          `(${sent}): send it by hand to whoever gave the yes (terms §6, §7).`,
      );
    }
  } catch (error) {
    log.error(`[billing] organisation ${tenantId}: the order's confirmation could not be made:`, error);
  }
}

/**
 * POST /api/billing/ceiling/yes
 *
 * The customer's yes to the offer they were shown: a move up, or a top-up.
 * One append-only `data_allowance` row (managed 0037), carrying the price
 * shown, which the invoice will charge (0109 T5). Refused, with the offer as
 * it stands now, when the tier or the price sent is not what is offered.
 * Refused during the alpha, where nothing is charged.
 */
router.post('/ceiling/yes', authenticate, requireBillingWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const parsed = YesSchema.safeParse(req.body);
    if (!parsed.success) {
      const reason = 'Say which way on (move_up or top_up), the tier and the price you were shown.';
      return void res.status(400).json({ error: 'invalid_yes', message: reason, reason });
    }
    if (!holdsAtCeiling(process.env.OWNPACE_STAGE)) {
      const reason = 'Nothing is charged during the Alpha, so there is nothing to agree to yet.';
      return void res.status(409).json({ error: 'nothing_charged_during_the_alpha', message: reason, reason });
    }
    const outcome = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      // One yes at a time per organisation: two presses of the same offer
      // must not buy two bands. Released with the transaction.
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'data_allowance:' + tenantId}))`);
      if (!(await hasInvoiceDetails(db, tenantId))) return { detailsFirst: true } as const;
      const before = await readCeiling(db, asTenantId(tenantId));
      const alphaGb = await alphaGbOf(db, tenantId);
      const decision = decideYes(before, parsed.data);
      if (!decision.ok) return { refused: decision.reason, ceiling: before, alphaGb } as const;
      const order = await recordOrder(db, tenantId, decision.grant, req.userId ?? 'unknown', 'data', parsed.data.beginNow);
      return { ceiling: await readCeiling(db, asTenantId(tenantId)), alphaGb, order } as const;
    });
    if ('detailsFirst' in outcome) {
      return void res
        .status(409)
        .json({ error: 'invoice_details_first', message: INVOICE_DETAILS_FIRST, reason: INVOICE_DETAILS_FIRST });
    }
    const holds = holdsAtCeiling(process.env.OWNPACE_STAGE);
    if ('refused' in outcome) {
      const reason =
        outcome.refused === 'offer_changed'
          ? 'What is offered has changed since the page was shown. Look at the new offer before saying yes.'
          : outcome.refused === 'no_top_up_on_free'
            ? 'Free has no top-up: from Free the way on is moving up.'
            : 'There is no tier past this one. Talk to us.';
      return void res.status(409).json({
        error: outcome.refused,
        message: reason,
        reason,
        ceiling: ceilingBody(outcome.ceiling, holds, outcome.alphaGb),
      });
    }
    await confirmOrder(req, tenantId, outcome.order);
    res.json(ceilingBody(outcome.ceiling, holds, outcome.alphaGb));
  } catch (error) {
    serverFault(res, 'ceiling_yes_failed', 'recording your yes', error);
  }
});

/** A tier as the question at *Start* names it: how many at the same time, and its monthly. */
function pathsTier(t: ManagedTier) {
  return { id: t.id, name: t.name, paths: t.paths, monthlyEur: monthlyEur(t) };
}

/** The question at *Start*, as the page asks it (workplan 0109 T6, the path axis). */
function pathsBody(f: PathsForecast, holds: boolean) {
  return {
    holds,
    tier: pathsTier(f.tier),
    held: f.held,
    after: f.after,
    past: f.past !== null,
    // The smallest tier that runs them all; null past Extra large ("talk to us").
    needs: f.past?.needs ? pathsTier(f.past.needs) : null,
    reason: f.past ? pathsPastTheTierReason(f.past) : null,
    fits: f.fits,
  };
}

const StartingSchema = z
  .string()
  .max(50 * 37)
  .transform((s) => [...new Set(s.split(',').filter((id) => id !== ''))])
  .pipe(z.array(z.string().uuid()).min(1).max(50));

/**
 * GET /api/billing/paths?starting=<mapping id>,<mapping id>
 *
 * The question at *Start*, before the press (ADR-0014: *"a path waits for the
 * yes at activation"*; the owner, 2026-10-04: both ways side by side): what
 * starting these migrations would hold against the agreed tier, the smallest
 * tier that runs it all and its monthly, and which of them fit now. The
 * server's own rule, so the question is the refusal the start would get.
 * Read-only.
 */
router.get('/paths', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const starting = StartingSchema.safeParse(req.query['starting']);
    if (!starting.success) {
      const reason = 'Say which migrations Start would start: up to fifty ids, separated by commas.';
      return void res.status(400).json({ error: 'invalid_starting', message: reason, reason });
    }
    const forecast = await withTenantDb(tenantId, getSharedPool(), (db) =>
      readPathsForecast(db, asTenantId(tenantId), starting.data),
    );
    res.json(pathsBody(forecast, holdsAtCeiling(process.env.OWNPACE_STAGE)));
  } catch (error) {
    serverFault(res, 'paths_failed', 'reading how many may run at the same time', error);
  }
});

const PathsYesSchema = z.object({
  tierId: z.string().min(1),
  priceEur: z.number().int().min(0),
  beginNow: BeginNow,
});

/**
 * POST /api/billing/paths/yes
 *
 * The customer's yes, at *Start*, to a tier that runs more at the same time,
 * at the monthly they were shown. The same append-only row as a move up at
 * the data ceiling (one agreed tier for both axes, the owner's *"A"*), with
 * `axis` `paths` (managed 0039). Refused when the tier is not above the agreed
 * one or the price is not its monthly now, and during the alpha, where nothing
 * is charged. The page starts the migrations after it.
 */
router.post('/paths/yes', authenticate, requireBillingWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const parsed = PathsYesSchema.safeParse(req.body);
    if (!parsed.success) {
      const reason = 'Say the tier and the price you were shown.';
      return void res.status(400).json({ error: 'invalid_yes', message: reason, reason });
    }
    if (!holdsAtCeiling(process.env.OWNPACE_STAGE)) {
      const reason = 'Nothing is charged during the Alpha, so there is nothing to agree to yet.';
      return void res.status(409).json({ error: 'nothing_charged_during_the_alpha', message: reason, reason });
    }
    const outcome = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      // The data ceiling's lock: one yes at a time per organisation, on either
      // axis, so two presses of the same offer move up once.
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'data_allowance:' + tenantId}))`);
      if (!(await hasInvoiceDetails(db, tenantId))) return { detailsFirst: true } as const;
      const store = new PgDataAllowanceStore(db);
      const decision = decidePathsYes(allowanceOf(await store.grants(asTenantId(tenantId))), parsed.data);
      if (!decision.ok) return { refused: decision.reason } as const;
      const order = await recordOrder(db, tenantId, decision.grant, req.userId ?? 'unknown', 'paths', parsed.data.beginNow);
      return { tier: allowanceOf(await store.grants(asTenantId(tenantId))).tier, order } as const;
    });
    if ('detailsFirst' in outcome) {
      return void res
        .status(409)
        .json({ error: 'invoice_details_first', message: INVOICE_DETAILS_FIRST, reason: INVOICE_DETAILS_FIRST });
    }
    if ('refused' in outcome) {
      const reason =
        outcome.refused === 'offer_changed'
          ? 'The price has changed since the page was shown. Look at the new price before saying yes.'
          : 'Your organisation already runs that many at the same time. Start again to see where it stands.';
      return void res.status(409).json({ error: outcome.refused, message: reason, reason });
    }
    await confirmOrder(req, tenantId, outcome.order);
    res.json({ tier: pathsTier(outcome.tier) });
  } catch (error) {
    serverFault(res, 'paths_yes_failed', 'recording your yes', error);
  }
});

/** A tier as a pick names it: its room, and its prices in whole euros, the unit a pick is recorded in. */
function pickTier(t: ManagedTier) {
  return {
    id: t.id,
    name: t.name,
    paths: t.paths,
    dataGb: t.dataGb,
    monthlyEur: monthlyEur(t),
    annualEur: t.annualCents / 100,
  };
}

/** What may be picked, as the page shows it (workplan 0157 T6). */
function pickBody(state: BilledNow, holds: boolean) {
  const offers = pickOffers(state.billed.tier, state.floor);
  return {
    holds,
    // What this month bills now, a pick included.
    billed: pickTier(state.billed.tier),
    // The pick standing now and for the next month; null is none.
    picked: {
      now: state.floor.now ? pickTier(state.floor.now) : null,
      next: state.floor.next ? pickTier(state.floor.next) : null,
      nextFrom: state.floor.nextFrom.toISOString(),
    },
    // At once: every tier above what this month bills, and the one picked now
    // while a lower pick waits for the next month.
    raise: offers.raise.map(pickTier),
    // From the next month: every tier below the pick standing for it.
    lower: offers.lower.map(pickTier),
  };
}

/**
 * GET /api/billing/pick
 *
 * The tiers a person may pick (workplan 0157 T6; ADR-0014, *Amendment
 * 2026-10-04, evening*): every tier above the one this month bills, with its
 * room and its prices; the pick standing now and for the next month; and the
 * tiers a pick may be lowered to, from the next month. `holds` is false during
 * the alpha, where every tier is a tester's already and no pick is taken.
 * Read-only.
 */
router.get('/pick', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const state = await withTenantDb(tenantId, getSharedPool(), (db) =>
      readBilledNow(db, asTenantId(tenantId), new Date()),
    );
    res.json(pickBody(state, holdsAtCeiling(process.env.OWNPACE_STAGE)));
  } catch (error) {
    serverFault(res, 'pick_failed', 'reading the tiers you may pick', error);
  }
});

const PickSchema = z.object({
  tierId: z.string().min(1),
  priceEur: z.number().int().min(0),
  beginNow: BeginNow,
});

/**
 * POST /api/billing/pick
 *
 * The person's pick, at the monthly they were shown (workplan 0157 T6). A
 * higher tier counts at once, and each month bills at least it until it is
 * lowered; a lower one counts from the next month. One append-only `tier_pick`
 * row (managed 0044) and, for a tier above the agreed one, a yes in
 * `data_allowance` with `axis` `pick`, in the same transaction: picking is the
 * person's own yes (ADR-0014). Refused, with what is offered now, when the tier
 * or the price sent is not what is offered; and during the alpha, where
 * nothing is charged. `from` says when the pick counts.
 */
router.post('/pick', authenticate, requireBillingWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const parsed = PickSchema.safeParse(req.body);
    if (!parsed.success) {
      const reason = 'Say the tier you pick and the monthly price you were shown.';
      return void res.status(400).json({ error: 'invalid_pick', message: reason, reason });
    }
    if (!holdsAtCeiling(process.env.OWNPACE_STAGE)) {
      const reason = 'Nothing is charged during the Alpha, so there is nothing to agree to yet.';
      return void res.status(409).json({ error: 'nothing_charged_during_the_alpha', message: reason, reason });
    }
    const outcome = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      // The yeses' lock: one pick or yes at a time per organisation, so two
      // presses pick once, and a pick and a yes at the ceiling do not cross.
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'data_allowance:' + tenantId}))`);
      // A paid tier is invoiced; Free, the lower pick of none, is not.
      if (parsed.data.tierId !== 'free' && !(await hasInvoiceDetails(db, tenantId))) return { detailsFirst: true } as const;
      // One moment for the decision and the row, so the month the pick counts
      // in is the one the decision read.
      const now = new Date();
      const before = await readBilledNow(db, asTenantId(tenantId), now);
      const decision = decidePick(pickOffers(before.billed.tier, before.floor), before.allowance, parsed.data);
      if (!decision.ok) return { refused: decision.reason, state: before } as const;
      const by = req.userId ?? 'unknown';
      await new PgTierPickStore(db).record(asTenantId(tenantId), decision.pick, by, now);
      // A pick above the agreed tier is an order; a lower one is not.
      const order = decision.yes
        ? await recordOrder(db, tenantId, decision.yes, by, 'pick', parsed.data.beginNow, now)
        : null;
      return { from: decision.from, state: await readBilledNow(db, asTenantId(tenantId), now), order } as const;
    });
    if ('detailsFirst' in outcome) {
      return void res
        .status(409)
        .json({ error: 'invoice_details_first', message: INVOICE_DETAILS_FIRST, reason: INVOICE_DETAILS_FIRST });
    }
    const holds = holdsAtCeiling(process.env.OWNPACE_STAGE);
    if ('refused' in outcome) {
      const reason = 'What may be picked has changed since the page was shown. Look at the tiers again before picking.';
      return void res
        .status(409)
        .json({ error: outcome.refused, message: reason, reason, pick: pickBody(outcome.state, holds) });
    }
    if (outcome.order) await confirmOrder(req, tenantId, outcome.order);
    res.json({ from: outcome.from, ...pickBody(outcome.state, holds) });
  } catch (error) {
    serverFault(res, 'pick_save_failed', 'recording your pick', error);
  }
});

/** A year, as the Billing page reads it (0111 T11, slice Y2). */
function yearBody(offer: YearOffer, holds: boolean) {
  return {
    holds,
    billed: offer.billed,
    tiers: offer.tiers,
    placement: offer.placement,
    credit: offer.credit,
    heldCents: offer.heldCents,
    years: offer.years.map((y) => ({
      tierId: y.tierId,
      cents: y.cents,
      creditFrom: y.creditFrom,
      halfFrom: y.halfFrom,
      halfTo: y.halfTo,
    })),
    yearsBefore: offer.years.length,
  };
}

/**
 * GET /api/billing/year
 *
 * What a year paid ahead would be (workplan 0111 T11; ADR-0014, *Amendment
 * 2026-10-04*; terms §8): the tiers it may be bought for, the tier the month
 * bills or a higher one, each at six months of its monthly price; when it would
 * start (with the first month not yet billed); the credit left, and the years
 * bought. Read-only.
 */
router.get('/year', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const offer = await withTenantDb(tenantId, getSharedPool(), (db) =>
      readYearOffer(db, asTenantId(tenantId), new Date()),
    );
    res.json(yearBody(offer, holdsAtCeiling(process.env.OWNPACE_STAGE)));
  } catch (error) {
    serverFault(res, 'year_failed', 'reading what a year would be', error);
  }
});

const YearSchema = z.object({
  tierId: z.string().min(1),
  yearCents: z.number().int().min(1),
  yearsBefore: z.number().int().min(0),
  beginNow: BeginNow,
});

/** The organisation's language, for the year's invoice line. */
async function localeOf(db: PgDatabase, tenantId: string): Promise<NotificationLocale> {
  const [organisation] = await db
    .select({ settings: tenantTable.settings })
    .from(tenantTable)
    .where(eq(tenantTable.id, tenantId));
  return readTenantNotificationPrefs(organisation?.settings).locale;
}

/**
 * POST /api/billing/year
 *
 * A year paid ahead, ordered (workplan 0111 T11, slice Y2): its invoice, a
 * draft the hourly push takes to the books, placed with the first month not
 * yet billed (`recordYear`). A year for a tier above the one the month bills
 * is a pick of that tier as well, at once, with its yes, as the pick door
 * records one: the month then bills at least it. Refused, with what is offered
 * now, when the tier, the year's price or the years seen are not what is
 * offered (`decideYear`); before invoice details; and during the alpha, where
 * nothing is charged. One confirmation by email, for the year.
 */
router.post('/year', authenticate, requireBillingWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const parsed = YearSchema.safeParse(req.body);
    if (!parsed.success) {
      const reason = 'Say the tier, the price of the year you were shown, and how many years you saw.';
      return void res.status(400).json({ error: 'invalid_year', message: reason, reason });
    }
    if (!holdsAtCeiling(process.env.OWNPACE_STAGE)) {
      const reason = 'Nothing is charged during the Alpha, so there is nothing to order yet.';
      return void res.status(409).json({ error: 'nothing_charged_during_the_alpha', message: reason, reason });
    }
    const outcome = await withTenantDb(tenantId, getSharedPool(), async (db) => {
      // The yeses' lock: one order at a time per organisation, so two presses order once.
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'data_allowance:' + tenantId}))`);
      if (!(await hasInvoiceDetails(db, tenantId))) return { detailsFirst: true } as const;
      const now = new Date();
      const offer = await readYearOffer(db, asTenantId(tenantId), now);
      const decision = decideYear(offer, parsed.data);
      if (!decision.ok) return { refused: decision.reason, offer } as const;
      const by = req.userId ?? 'unknown';

      // A year above the tier the month bills is a pick of it, at once (0157 T6).
      let order: RecordedOrder | null = null;
      const place = (id: string) => MANAGED_TIERS.findIndex((t) => t.id === id);
      if (place(decision.tier.id) > place(offer.billed.id)) {
        const before = await readBilledNow(db, asTenantId(tenantId), now);
        const offered = pickOffers(before.billed.tier, before.floor).raise.find((t) => t.id === decision.tier.id);
        const pick = offered
          ? decidePick(pickOffers(before.billed.tier, before.floor), before.allowance, {
              tierId: offered.id,
              priceEur: monthlyEur(offered),
            })
          : null;
        if (!pick || !pick.ok) return { refused: 'offer_changed', offer } as const;
        await new PgTierPickStore(db).record(asTenantId(tenantId), pick.pick, by, now);
        if (pick.yes) order = await recordOrder(db, tenantId, pick.yes, by, 'pick', parsed.data.beginNow, now);
      }

      const tier = MANAGED_TIERS.find((t) => t.id === decision.tier.id)!;
      const year = await recordYear(
        db,
        asTenantId(tenantId),
        { tier, cents: decision.tier.yearCents, priceFrom: decision.tier.priceFrom },
        now,
        await localeOf(db, tenantId),
      );
      return {
        year,
        at: now,
        beganOnRequest: order?.beganOnRequest ?? false,
        window: await readWithdrawalWindow(db, asTenantId(tenantId), now),
        offer: await readYearOffer(db, asTenantId(tenantId), now),
      } as const;
    });
    if ('detailsFirst' in outcome) {
      return void res
        .status(409)
        .json({ error: 'invoice_details_first', message: INVOICE_DETAILS_FIRST, reason: INVOICE_DETAILS_FIRST });
    }
    const holds = holdsAtCeiling(process.env.OWNPACE_STAGE);
    if ('refused' in outcome) {
      const reason = 'What a year would be has changed since the page was shown. Look at it again before ordering.';
      return void res
        .status(409)
        .json({ error: outcome.refused, message: reason, reason, year: yearBody(outcome.offer, holds) });
    }
    // Invalidates nothing on failure: the order stands whatever the mail server does.
    await confirmYear(req, tenantId, outcome);
    const { year } = outcome;
    res.json({
      ordered: {
        tierId: year.tierId,
        cents: year.cents,
        creditFrom: year.creditFrom,
        halfFrom: year.halfFrom,
        halfTo: year.halfTo,
      },
      ...yearBody(outcome.offer, holds),
    });
  } catch (error) {
    serverFault(res, 'year_order_failed', 'recording your year', error);
  }
});

/**
 * The year's confirmation (0111 T11; terms §6, §7 and §8): one mail, as every
 * order has, after the commit, in the organisation's language. Never a throw.
 */
async function confirmYear(
  req: AuthenticatedRequest,
  tenantId: string,
  ordered: { year: YearRecorded; at: Date; beganOnRequest: boolean; window: WithdrawalWindow },
): Promise<void> {
  try {
    const [organisation] = await withTenantDb(tenantId, getSharedPool(), (db) =>
      db.select({ name: tenantTable.name, settings: tenantTable.settings }).from(tenantTable).where(eq(tenantTable.id, tenantId)),
    );
    const locale = readTenantNotificationPrefs(organisation?.settings).locale;
    const { year, window } = ordered;
    const sent = req.userEmail
      ? await tell(req.userEmail, locale, {
          kind: 'order_confirmed',
          organisation: organisation?.name ?? tenantId,
          order: {
            kind: 'year',
            tier: tierName(year.tierId),
            price: euros(year.cents / 100, locale),
            from: monthWords(year.creditFrom, locale),
            to: monthWords(year.halfTo, locale),
          },
          orderedAt: momentInWords(ordered.at, locale),
          withdrawUntil: window.kind === 'open' ? dayInWords(new Date(window.until.getTime() - 1), locale) : null,
          beganOnRequest: ordered.beganOnRequest,
          terms: termsUrl(locale, process.env),
        })
      : 'no_address';
    if (sent !== 'sent') {
      log.error(
        `[billing] organisation ${tenantId} ordered a year at ${ordered.at.toISOString()}, and its confirmation was not ` +
          `sent (${sent}): send it by hand to whoever ordered it (terms §6, §7).`,
      );
    }
  } catch (error) {
    log.error(`[billing] organisation ${tenantId}: the year's confirmation could not be made:`, error);
  }
}

/** The tier's name, as the screen and the mail say it. */
const tierName = (id: string) => MANAGED_TIERS.find((t) => t.id === id)?.name ?? id;

/** The withdrawal function's state, as the Billing page shows it. */
function withdrawalBody(window: WithdrawalWindow) {
  return {
    open: window.kind === 'open',
    ...(window.kind === 'closed' ? { reason: window.reason } : {}),
    since: window.since?.toISOString() ?? null,
    until: window.until?.toISOString() ?? null,
    tier: window.kind === 'open' ? { id: window.tier, name: tierName(window.tier) } : null,
  };
}

/** Why a withdrawal cannot be made now, in a sentence the page shows. */
const WITHDRAWAL_CLOSED: Record<Extract<WithdrawalWindow, { kind: 'closed' }>['reason'], string> = {
  nothing_paid: 'There is no paid contract to withdraw from: the organisation is on Free.',
  business: 'A business customer has no right of withdrawal (terms §7).',
  past: 'The fourteen days to withdraw are over (terms §7). You can still cancel at the end of the month.',
};

/**
 * GET /api/billing/withdrawal
 *
 * Whether the organisation may withdraw from its paid contract now (workplan
 * 0111 T7, decision 15; terms §7): open from the first yes after Free until
 * the end of the fourteenth day after it, for a consumer. With what the
 * withdrawal function (article 11a) fills in for the person to confirm: the
 * name on the invoice details and the signed-in address. And whether a yes
 * given now begins within a withdrawal window (`yesAsksToBegin`, slice 7e):
 * then each order button says so in one sentence. Read-only.
 */
router.get('/withdrawal', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const now = new Date();
    const { window, party, yesAsksToBegin } = await withTenantDb(tenantId, getSharedPool(), async (db) => ({
      window: await readWithdrawalWindow(db, asTenantId(tenantId), now),
      party: (
        await db.select({ name: schema.billingParty.name }).from(schema.billingParty).where(eq(schema.billingParty.tenantId, tenantId))
      )[0],
      yesAsksToBegin: await readYesAsksToBegin(db, asTenantId(tenantId), now),
    }));
    res.json({ ...withdrawalBody(window), name: party?.name ?? null, confirmTo: req.userEmail ?? null, yesAsksToBegin });
  } catch (error) {
    serverFault(res, 'withdrawal_read_failed', 'reading whether you may withdraw', error);
  }
});

const WithdrawalSchema = z.object({
  name: z.string().trim().min(1).max(200),
  confirmTo: z.string().trim().email().max(320),
});

/**
 * POST /api/billing/withdrawal
 *
 * Withdraw from the paid contract (workplan 0111 T7, decision 15; terms §7),
 * the second step of the withdrawal function: the name and the address the
 * person confirmed. In one transaction (`withdraw`): recorded, Free from this
 * moment, and each invoice of the contract credited for the days it paid for
 * and were not used. Then the acknowledgement goes to the address given, in
 * the organisation's language, and the answer says whether it went. Refused
 * with 409 and a sentence when there is nothing to withdraw from, for a
 * business, and after the fourteen days.
 */
router.post('/withdrawal', authenticate, requireBillingWrite, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });
    const parsed = WithdrawalSchema.safeParse(req.body);
    if (!parsed.success) {
      const reason = 'Say your name, and the email address the confirmation goes to.';
      return void res.status(400).json({ error: 'invalid_withdrawal', message: reason, reason });
    }
    const pool = getSharedPool();
    const [organisation] = await withTenantDb(tenantId, pool, (db) =>
      db.select({ name: tenantTable.name, settings: tenantTable.settings }).from(tenantTable).where(eq(tenantTable.id, tenantId)),
    );
    const locale = readTenantNotificationPrefs(organisation?.settings).locale;
    const outcome = await withTenantDb(tenantId, pool, (db) =>
      withdraw(
        db,
        asTenantId(tenantId),
        { by: req.userId ?? 'unknown', name: parsed.data.name, confirmTo: parsed.data.confirmTo, language: locale, via: 'screen' },
        new Date(),
      ),
    );
    if (outcome.kind === 'closed') {
      const reason = WITHDRAWAL_CLOSED[outcome.reason];
      return void res.status(409).json({ error: 'withdrawal_closed', why: outcome.reason, message: reason, reason });
    }
    // After the commit, and never a throw: the withdrawal stands whatever the
    // mail server does, and the answer says what became of the mail.
    const confirmation = await tell(parsed.data.confirmTo, locale, {
      kind: 'contract_withdrawn',
      organisation: organisation?.name ?? tenantId,
      name: parsed.data.name,
      tier: tierName(outcome.tier),
      since: dayInWords(outcome.since, locale),
      withdrawnAt: momentInWords(outcome.withdrawnAt, locale),
      confirmTo: parsed.data.confirmTo,
      credits: outcome.credits.length,
      beganOnRequest: outcome.beganOnRequest,
    });
    if (confirmation !== 'sent') {
      log.error(
        `[billing] organisation ${tenantId} withdrew at ${outcome.withdrawnAt.toISOString()}, and its confirmation ` +
          `was not sent (${confirmation}): send it by hand to the address on the withdrawal's row (terms §7).`,
      );
    }
    res.json({
      withdrawnAt: outcome.withdrawnAt.toISOString(),
      since: outcome.since.toISOString(),
      tier: { id: outcome.tier, name: tierName(outcome.tier) },
      credits: outcome.credits.length,
      beganOnRequest: outcome.beganOnRequest,
      confirmation,
    });
  } catch (error) {
    serverFault(res, 'withdrawal_failed', 'recording your withdrawal', error);
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
     *
     * `AT TIME ZONE 'UTC'` on all three expressions, because `created_at` is a
     * `timestamptz` and `to_char` renders one in the SESSION's timezone, which
     * nothing here sets. On a server in Amsterdam a run at 2026-09-30T23:30Z
     * was named `2026-10`, while `monthPeriod('2026-10')` asks for
     * `[Oct 1, Nov 1)` in UTC — which that run is not in. The month named it
     * and the window excluded it, so a September with passes in it came back
     * as a row of zeroes, or as no row at all. The grouping and the window
     * have to mean the same month.
     */
    const { months, issued } = await withTenantDb(tenantId, getSharedPool(), async (db) => ({
      months: await db
        .select({ month: sql<string>`to_char(${runTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')` })
        .from(runTable)
        .where(eq(runTable.tenantId, tenantId))
        .groupBy(sql`to_char(${runTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`)
        .orderBy(sql`to_char(${runTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM') DESC`),
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
      // The same helper `/usage` above uses, so the two screens cannot name
      // different days as one month's last.
      const { periodStart, periodEnd } = monthPeriod(month);

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
      // NO `cost`. These months carry what was MEASURED and no money.
      //
      // This line read `cost: calculateCost(shaped, pricing)` until 2026-09-09
      // — a live recomputation, in the same array as rows whose money is read
      // off a frozen invoice, under the same field name. The comment four
      // dozen lines above states the rule this broke in its own words: the
      // money comes off the invoice rather than being re-priced at today's
      // list. Half the array obeyed it.
      //
      // And the list it re-priced at is the retired one — base fee, per-GB,
      // per-hour — which ADR-0014 replaced on 2026-08-20 and this same API
      // has refused to invoice from since 2026-08-27.
      //
      // Deriving the month's TIER instead is not available: ADR-0014 needs
      // both axes as they stood then, and while `occupancy_peak` is per month,
      // `bytes_moved` is one lifetime total per tenant. Pricing an old month
      // against today's cumulative bytes would file it under whatever band the
      // customer has since grown into. See `usage-history.ts`.
      usageHistory.push({ ...shaped, source: 'ledger' });
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

    // The one reading of "the number as stored, and the latest answer for it",
    // shared with the grant page (`services/vat-standing.ts`).
    const { party, vatConsultation } = await withTenantDb(tenantId, getSharedPool(), (db) =>
      readVatStanding(db, tenantId),
    );

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
      invoiceEmail: body.invoiceEmail || null,
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
        // Moneybird's legal number and its date, once it numbered the
        // invoice (0111 slice 5): what the customer's own books will quote.
        invoiceNumber: schema.invoice.invoiceNumber,
        invoiceDate: schema.invoice.invoiceDate,
        // A credit note is said as one, and never offered to pay (0111 T7).
        kind: schema.invoice.kind,
        // What its credit notes take off it, in cents (0111 slice 7d): the
        // page offers Pay only on what is left.
        credited: sql<string>`${CREDITED_CENTS_SQL}`,
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
 * GET /api/billing/invoices/:invoiceId/pdf
 *
 * The invoice's document, Moneybird's own PDF (workplan 0111, T6): streamed
 * from the books to the person who asks, and kept nowhere here. Only an
 * invoice Moneybird has numbered has one; a draft is refused by name. Read in
 * the organisation's own scope, so an invoice of another organisation is not
 * found. The file is named by the invoice's legal number.
 */
router.get('/invoices/:invoiceId/pdf', authenticate, requireBillingRead, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invoiceId = req.params.invoiceId;
    if (!invoiceId || Array.isArray(invoiceId)) {
      return void res.status(400).json({ error: 'Bad Request', message: 'Invoice ID required' });
    }
    const tenantId = req.tenantId;
    if (!tenantId) return void res.status(401).json({ error: 'Unauthorized', message: 'Tenant ID required' });

    const rows = await withTenantDb(tenantId, getSharedPool(), async (db) =>
      db
        .select({
          status: schema.invoice.status,
          moneybirdId: schema.invoice.moneybirdId,
          moneybirdAdministrationId: schema.invoice.moneybirdAdministrationId,
          invoiceNumber: schema.invoice.invoiceNumber,
        })
        .from(schema.invoice)
        .where(and(eq(schema.invoice.id, invoiceId), eq(schema.invoice.tenantId, tenantId))),
    );
    const invoice = rows[0];
    if (!invoice) return void res.status(404).json({ error: 'Not found', message: 'Invoice not found' });
    if (!invoice.moneybirdId || !invoice.invoiceNumber || invoice.status === 'draft') {
      const reason = 'This invoice is being prepared and has no document yet: it has one once it is numbered.';
      return void res.status(409).json({ error: 'no_document_yet', message: reason, reason });
    }

    const books = moneybirdFromEnv(process.env);
    if (books.kind !== 'on' || books.config.administrationId !== invoice.moneybirdAdministrationId) {
      // Moneybird off, half set, or set to other books than the ones that
      // numbered this invoice: nothing here can fetch its document.
      log.warn('[billing] invoice pdf: the books that numbered it are not the ones configured', {
        invoiceId,
        configured: books.kind,
      });
      const reason = "The invoice's document cannot be fetched right now. Ask us for it, and name the invoice number.";
      return void res.status(503).json({ error: 'document_unavailable', message: reason, reason });
    }

    const fetched = await downloadInvoicePdf(books.config, invoice.moneybirdId);
    if (fetched.kind !== 'pdf') {
      log.warn('[billing] invoice pdf: not fetched', { invoiceId, kind: fetched.kind, reason: fetched.reason });
      const reason = "The invoice's document cannot be fetched right now. Try again in a minute.";
      return void res.status(503).json({ error: 'document_unavailable', message: reason, reason });
    }
    const filename = `Ownpace-invoice-${invoice.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(fetched.bytes));
  } catch (error) {
    serverFault(res, 'invoice_pdf_failed', "fetching the invoice's document", error);
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
        kind: schema.invoice.kind,
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
    // Nor a draft (workplan 0111 T5, managed 0045). This route used to set a
    // draft `sent` while asking Mollie for money, which issued an invoice
    // Moneybird never numbered. An invoice is issued when Moneybird numbers
    // it; until then there is nothing to pay, and the database now refuses
    // draft -> sent without the number anyway, after Mollie would have been
    // asked. So the refusal comes first.
    if (invoice.status === 'draft') {
      res.status(409).json({
        error: 'Conflict',
        message: 'This invoice has not been issued yet, so there is nothing to pay.',
      });
      return;
    }
    // Nor a credit note (0111 slice 7a): it is money owed to the
    // organisation, never money it pays, and its total is negative.
    if (invoice.kind === 'credit_note') {
      res.status(409).json({
        error: 'Conflict',
        message: 'This is a credit note: it is credited to you, and there is nothing to pay.',
      });
      return;
    }

    // What is left to pay: the total less what its credit notes take off
    // (0111 slice 7d). A withdrawal credits an unpaid invoice before anyone
    // pays it, and the customer pays only the rest, or nothing.
    const credited = await withTenantDb(tenantId, getSharedPool(), (db) =>
      creditedCents(db, asTenantId(tenantId), invoiceId),
    );
    const due = Number(invoice.total) - credited;
    if (due <= 0) {
      res.status(409).json({
        error: 'Conflict',
        message: 'This invoice is credited in full: there is nothing left to pay.',
      });
      return;
    }

    // Get Mollie service
    const mollieService = getMollieService();

    // Create payment via Mollie
    const payment = await mollieService.createPayment({
      tenantId,
      amount: due, // Amount in cents: the total, less what is credited
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

    // Record the payment on the invoice. Its status stays what it is (sent
    // or overdue): the webhook moves it to paid. The metadata is added to,
    // never replaced: whatever else it holds stays.
    await withTenantDb(tenantId, getSharedPool(), async (db) => {
      await db.update(schema.invoice)
        .set({
          paymentId: payment.id,
          metadata: sql`${schema.invoice.metadata} || ${JSON.stringify({ mollieInvoiceId: payment.id })}::jsonb`,
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
