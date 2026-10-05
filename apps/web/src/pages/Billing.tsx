// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Billing — the screen where numbers become money (workplan 0039).
 *
 * Rebuilt from the fleet's findings: the Base Fee line rendered the entire
 * subtotal (itemized lines summed to double the printed subtotal), the VAT
 * label hardcoded 21% beside a served rate, every amount was hand-formatted
 * EN-style, the invoice period rendered "Period:" followed by nothing (the
 * client typed Stripe vocabulary against a Mollie enum), `overdue` — the one
 * status demanding action — wore neutral gray, the Payment Methods card
 * hardcoded its empty state without ever performing the read, and the two
 * buttons on the screen did nothing at all.
 *
 * Fully bilingual since 0035 T2/T4 (the 0024-T5 fold executed) — every
 * sentence goes through the dictionary.
 */
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, CreditCard, Loader2 } from 'lucide-react';
import { DISCOVERY_DOMAINS, type DiscoveryDomain, type ProgressReport } from '@openmig/shared';
import {
  billingApi,
  type Invoice,
  type BillingPartyInput,
  type BillingPartyRead,
  type UsageResponse,
} from '../services/billing-service.ts';
import { serverMessage } from '../services/api.ts';
import { useAuthStore } from '../stores/auth-store.ts';
import { useT, useFormatters, useLocale } from '../i18n/index.tsx';
import StateChip from '../components/StateChip.tsx';
import { isAlpha } from '../components/AlphaNote.tsx';
import DataCeiling from '../components/DataCeiling.tsx';
import TierPick from '../components/TierPick.tsx';
import { DataTypeIcon, ICON_OF_DOMAIN } from '../components/icons/data-type-icons.tsx';
import { DOMAIN_STRING_KEY } from '../i18n/domain-words.ts';
import { fetchProgress } from '../services/progress-service.ts';

/** A failed read said as such (hard rule 9 / 0033 T2) — before this, a failed
 *  usage read rendered "No usage data available yet" and a failed invoices
 *  read rendered a silent blank, both on the screen where numbers are money. */
const ReadFailed: React.FC<{ heading: string; error: unknown }> = ({ heading, error }) => (
  <div className="flex items-start gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
    <div>
      <p className="font-medium">{heading}</p>
      <p className="mt-1">{serverMessage(error)}</p>
    </div>
  </div>
);

/**
 * The countries the picker offers: the EU-27 plus the EEA (IS, LI, NO),
 * Switzerland and the UK — where the people this product bills actually are
 * (NL-first launch, EU consumers primary). The API accepts any ISO 3166-1
 * alpha-2 code, so widening this is a UI decision, not a schema change. The
 * NAMES come from Intl.DisplayNames in the viewer's own language; only the
 * codes are stated here, because the codes are the stable fact.
 */
const BILLABLE_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO', 'CH', 'GB',
] as const;

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelClass = 'block text-sm text-gray-600 mb-1';

/**
 * Who invoices are addressed to (workplan 0111 T1) — the buyer, as data.
 *
 * CONSUMER-SHAPED FIRST: the form opens as a private person, and "business" is
 * the variant you choose, which then — and only then — offers a VAT number
 * field. That mirrors the server exactly (`kind` defaults to consumer; a
 * consumer with a VAT number is refused by the database itself), so the form
 * cannot submit a shape the API would have to talk the customer out of.
 *
 * No row yet is a real state, said as one: the amber sentence, not an error —
 * and the form below it IS the remedy, so the ask and the answer share a card.
 */
/**
 * A tier that costs nothing (Free, since 2026-09-24): nothing a month, nothing
 * a year, and no invoice, so the screen says "free" rather than "€0.00", and
 * asks for no invoice details (ADR-0014).
 */
const isFreeTier = (tier: { monthlyCents: number; annualCents: number }): boolean =>
  tier.monthlyCents === 0 && tier.annualCents === 0;

const InvoiceDetailsCard: React.FC<{ free: boolean }> = ({ free }) => {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime } = useFormatters();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['billing-party'],
    queryFn: () => billingApi.getBillingParty(),
  });
  const party = data?.party ?? null;
  // The VIES answer FOR THE NUMBER AS STORED (0111 T2) — the server joins on
  // what billing_party currently says, so a changed number honestly reads
  // "not checked" until somebody checks it.
  const consultation = data?.vatConsultation ?? null;
  // What an invoice for THIS buyer would carry (0111 T3): the server's
  // decision, rendered in the customer's own words below — never a number,
  // because the rate belongs to the bookkeeping system.
  const treatment = data?.vatTreatment?.treatment ?? null;
  const treatmentText =
    treatment === 'domestic_standard'
      ? t('billing.party.vat.treatment.domestic')
      : treatment === 'reverse_charge'
        ? t('billing.party.vat.treatment.reverseCharge')
        : treatment === 'destination_oss'
          ? t('billing.party.vat.treatment.oss')
          : treatment === 'outside_eu'
            ? t('billing.party.vat.treatment.outsideEu')
            : null;

  const [form, setForm] = React.useState<BillingPartyInput>({
    kind: 'consumer',
    name: '',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    countryCode: 'NL',
    vatNumber: '',
  });
  const [saved, setSaved] = React.useState(false);

  // Seed the form from the stored row. Re-runs after a save (the mutation
  // writes the server's answer into the query), which re-syncs the form to
  // what was actually stored — trimming included.
  React.useEffect(() => {
    if (!party) return;
    setForm({
      kind: party.kind,
      name: party.name,
      addressLine1: party.addressLine1,
      addressLine2: party.addressLine2 ?? '',
      postalCode: party.postalCode,
      city: party.city,
      countryCode: party.countryCode,
      vatNumber: party.vatNumber ?? '',
    });
  }, [party]);

  // Ask VIES about the stored number and keep the answer (0111 T2). Refusals
  // and outages arrive as sentences (`reason`) and render verbatim below the
  // field — an unreachable VIES is a state, not a crash.
  const checkMutation = useMutation({
    mutationFn: () => billingApi.checkVat(),
    onSuccess: (fresh) => {
      const prev = queryClient.getQueryData<BillingPartyRead>(['billing-party']);
      if (prev) queryClient.setQueryData(['billing-party'], { ...prev, vatConsultation: fresh });
    },
  });

  const mutation = useMutation({
    mutationFn: (input: BillingPartyInput) => billingApi.putBillingParty(input),
    onSuccess: (stored) => {
      // A consultation only ever speaks for the number it checked: keep it
      // across a save that did not touch the number, drop it otherwise.
      const prev = queryClient.getQueryData<BillingPartyRead>(['billing-party']);
      const sameNumber =
        prev?.party?.kind === stored.kind && prev?.party?.vatNumber === stored.vatNumber;
      const kept = sameNumber ? (prev?.vatConsultation ?? null) : null;
      queryClient.setQueryData(['billing-party'], { party: stored, vatConsultation: kept });
      setSaved(true);
      // A business number just saved and never checked gets checked NOW,
      // unasked: an unchecked number is a task somebody would have to
      // remember, and the failure mode of forgetting is a wrong invoice.
      // If VIES is down, the status line says so and the button remains.
      if (stored.kind === 'business' && stored.vatNumber && !kept) {
        checkMutation.mutate();
      }
    },
  });

  const set = (field: keyof BillingPartyInput, value: string) => {
    setSaved(false);
    setForm((f) => ({ ...f, [field]: value }));
  };

  const countries = React.useMemo(() => {
    // Intl.DisplayNames is everywhere this app runs, but a missing region name
    // must degrade to the code, never to a blank option on a tax form.
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      names = null;
    }
    return BILLABLE_COUNTRIES.map((code) => ({ code, label: names?.of(code) ?? code })).sort(
      (a, b) => a.label.localeCompare(b.label, locale),
    );
  }, [locale]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({
      kind: form.kind,
      name: form.name.trim(),
      addressLine1: form.addressLine1.trim(),
      addressLine2: form.addressLine2?.trim() || undefined,
      postalCode: form.postalCode.trim(),
      city: form.city.trim(),
      countryCode: form.countryCode,
      vatNumber:
        form.kind === 'business' && form.vatNumber?.trim() ? form.vatNumber.trim() : undefined,
    });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">{t('billing.party.title')}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('billing.party.intro')}</p>
      </div>
      <div className="p-6">
        {error != null ? (
          <ReadFailed
            heading={t('billing.party.loadFailed')}
            error={error}
          />
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {party == null &&
              (free ? (
                <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3">
                  {t('billing.party.notNeeded')}
                </p>
              ) : (
                <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {t('billing.party.missing')}
                </p>
              ))}

            <div className="flex gap-6">
              {(['consumer', 'business'] as const).map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="billing-party-kind"
                    checked={form.kind === kind}
                    onChange={() => set('kind', kind)}
                  />
                  {kind === 'consumer'
                    ? t('billing.party.kindConsumer')
                    : t('billing.party.kindBusiness')}
                </label>
              ))}
            </div>

            <div>
              <label className={labelClass} htmlFor="party-name">{t('billing.party.name')}</label>
              <input
                id="party-name"
                className={inputClass}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
                maxLength={200}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="party-address1">{t('billing.party.addressLine1')}</label>
              <input
                id="party-address1"
                className={inputClass}
                value={form.addressLine1}
                onChange={(e) => set('addressLine1', e.target.value)}
                required
                maxLength={200}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="party-address2">{t('billing.party.addressLine2')}</label>
              <input
                id="party-address2"
                className={inputClass}
                value={form.addressLine2 ?? ''}
                onChange={(e) => set('addressLine2', e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="party-postal">{t('billing.party.postalCode')}</label>
                <input
                  id="party-postal"
                  className={inputClass}
                  value={form.postalCode}
                  onChange={(e) => set('postalCode', e.target.value)}
                  required
                  maxLength={16}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="party-city">{t('billing.party.city')}</label>
                <input
                  id="party-city"
                  className={inputClass}
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                  required
                  maxLength={100}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="party-country">{t('billing.party.country')}</label>
                <select
                  id="party-country"
                  className={inputClass}
                  value={form.countryCode}
                  onChange={(e) => set('countryCode', e.target.value)}
                >
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {form.kind === 'business' && (
              <div>
                <label className={labelClass} htmlFor="party-vat">{t('billing.party.vatNumber')}</label>
                <input
                  id="party-vat"
                  className={inputClass}
                  value={form.vatNumber ?? ''}
                  onChange={(e) => set('vatNumber', e.target.value)}
                  maxLength={32}
                />
                {/* The check status describes the STORED number (the server
                    joins on it), so it renders only when one exists — a draft
                    in the field above has no status until it is saved. */}
                {party?.kind === 'business' && party.vatNumber && (
                  <div className="mt-2 text-sm space-y-1">
                    {checkMutation.isPending ? (
                      <p className="flex items-center gap-1 text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('billing.party.vat.checking')}
                      </p>
                    ) : consultation ? (
                      consultation.valid ? (
                        <div className="space-y-1">
                          <p className="text-green-700">
                            {t('billing.party.vat.valid', { date: dateTime(consultation.checkedAt) })}
                          </p>
                          {consultation.traderName && (
                            <p className="text-gray-600">
                              {t('billing.party.vat.registeredTo', { name: consultation.traderName })}
                            </p>
                          )}
                          <p className="text-gray-600">
                            {consultation.consultationNumber
                              ? t('billing.party.vat.consultationNumber', {
                                  number: consultation.consultationNumber,
                                })
                              : t('billing.party.vat.unqualified')}
                          </p>
                        </div>
                      ) : (
                        <p className="text-red-800">
                          {t('billing.party.vat.invalid', { date: dateTime(consultation.checkedAt) })}
                        </p>
                      )
                    ) : (
                      <p className="text-gray-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        {t('billing.party.vat.notChecked')}
                      </p>
                    )}
                    {checkMutation.isError && (
                      <p className="text-red-800">
                        <span className="font-medium">{t('billing.party.vat.checkFailed')}</span>{' '}
                        {serverMessage(checkMutation.error)}
                      </p>
                    )}
                    {!checkMutation.isPending && (
                      <button
                        type="button"
                        onClick={() => checkMutation.mutate()}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        {t('billing.party.vat.checkNow')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* The treatment describes the STORED buyer, like the VIES status
                above — a draft in the form has no treatment until saved. */}
            {party != null && treatmentText != null && (
              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
                <span className="font-medium text-gray-700">
                  {t('billing.party.vat.treatmentLabel')}
                </span>{' '}
                {treatmentText}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="inline-flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('billing.party.save')}
              </button>
              {saved && <span className="text-sm text-green-700">{t('billing.party.saved')}</span>}
              {mutation.isError && (
                <span className="text-sm text-red-800">
                  <span className="font-medium">{t('billing.party.saveFailed')}</span>{' '}
                  {serverMessage(mutation.error)}
                </span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

/**
 * What stands under the title: what the page is for, or, during the alpha,
 * that nothing on it is a bill (workplan 0131 T3).
 *
 * The alpha is free (0131 D1) and nothing in the code can charge: the invoice
 * route answers 409 to every call. A subtitle about managing "your
 * subscription" and "payments", above a paid tier's set-up fee and monthly
 * price, read like a bill all the same. So while the deployment runs the
 * alpha, the subtitle gives way to one line, and everything below it stays:
 * the tier block keeps its prices, because the measurement is one of the
 * things worth trying (0121 T4), and a free tier keeps saying "free" (0109
 * T8). The two agree: the line says nothing is charged during the alpha, the
 * tier says nothing is invoiced on Free.
 *
 * The second sentence is the free tier's own, word for word (owner,
 * 2026-09-24, 0131 open question 7: *"show the free tier's 'not needed' text
 * instead, also in the second sentence"*), and the invoice details card says
 * the same during the alpha, on every tier.
 *
 * A viewer or member is shown no figures and no invoice details (the reads
 * are owner and admin only), so they read the first sentence alone: the
 * second is about a form they are not shown.
 */
const Subtitle: React.FC<{ figuresShown: boolean }> = ({ figuresShown }) => {
  const t = useT();
  if (!isAlpha()) return <p className="text-gray-500 mt-1">{t('billing.subtitle')}</p>;
  return (
    <p className="text-gray-500 mt-1">
      {t('alpha.nothingCharged')}
      {figuresShown && (
        <>
          {' '}
          {t('billing.party.notNeeded')}
        </>
      )}
    </p>
  );
};

/**
 * The tier the panel names: once the alpha is over, what the month bills
 * (what it used, never above the agreed tier); during the alpha, where
 * nothing is billed, what was used. Null past the end of the table.
 */
const shownTier = (usage: UsageResponse) => (usage.holds ? usage.billed.tier : usage.tier);

/**
 * Decimal, like the published table: 1 TB = 1000 GB, and 1 GB = 1000 MB. Below
 * a GB it says MB, so a migration that has begun does not read *0.0 GB*.
 */
function sizeOf(gb: number, number: (n: number) => string): string {
  if (gb >= 1000) return `${number(Math.round(gb / 100) / 10)} TB`;
  const mb = Math.round(gb * 1000);
  if (gb > 0 && mb < 1000) return `${number(Math.max(1, mb))} MB`;
  return `${number(Math.round(gb * 10) / 10)} GB`;
}

/**
 * Items moved, per data type, over every migration: the counts each
 * migration's page shows (0154 T2), read from the same answer, so the two
 * cannot disagree. Every data type the app moves, in its order, tasks
 * included, and 0 for one that moved none: a counted zero is an answer (the
 * owner, 2026-10-05: *"and how about tasks? We still dont show tasks"*).
 */
export function itemsMovedByKind(
  progress: ProgressReport,
): ReadonlyArray<{ readonly domain: DiscoveryDomain; readonly items: number }> {
  const sums = new Map<DiscoveryDomain, number>();
  for (const m of progress.mappings) {
    for (const d of m.domains) sums.set(d.domain, (sums.get(d.domain) ?? 0) + d.itemsSynced);
  }
  return DISCOVERY_DOMAINS.map((domain) => ({ domain, items: sums.get(domain) ?? 0 }));
}

/**
 * WHAT HAS MOVED (the owner, 2026-10-05).
 *
 * Four cards stood here: Storage, Data Transfer, Compute Time and API calls.
 * None was something a customer moved or pays for. *Storage* was the bytes
 * written to the new home this month, though Ownpace keeps none of the data;
 * *Data Transfer* was the same bytes again; *Compute Time* the hours its
 * passes ran; *API calls* the number of passes. The owner: *"Perhaps we just
 * need to show the usages that counts: data moved and number of objects
 * moved"*, and, when the first version left the size to the tier block below:
 * *"it now does not show moved MB or GB? It should also show that"*.
 *
 * So, in total, across every migration:
 * - **All data**, first: what the meter counted, the alpha's share included.
 *   It is the meter the tier reads (`/api/billing/usage`), so it and the tier
 *   block's *Data moved, in total* are one figure, the alpha's share aside.
 * - **Each kind's items**, after it, every kind the app moves, tasks included:
 *   an email, a contact and a 4 GB film are not one unit, so their sum is a
 *   number nobody can check, and a kind is what a person can hold against
 *   their old account. They are counted as each migration's page counts them,
 *   from the same read, and a kind that moved none says 0 rather than leaving
 *   the row a different shape.
 */
const WhatMoved: React.FC<{ usage: UsageResponse }> = ({ usage }) => {
  const t = useT();
  const { number } = useFormatters();
  const progress = useQuery({ queryKey: ['progress'], queryFn: fetchProgress });
  const kinds = progress.data ? itemsMovedByKind(progress.data) : [];
  const tile = 'flex items-center gap-3 rounded-lg bg-gray-50 p-4';
  return (
    <div>
      <h3 className="font-medium text-gray-900">{t('billing.moved')}</h3>
      <p className="mt-1 text-sm text-gray-600">{t('billing.moved.where')}</p>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <li data-moved="data" className={tile}>
          <ArrowRight className="w-5 h-5 shrink-0 text-blue-700" aria-hidden="true" />
          <div>
            <p className="text-sm text-gray-600">{t('billing.moved.data')}</p>
            <p className="text-lg font-semibold text-gray-900">
              {sizeOf(usage.evidence.gbMoved + usage.gbMovedInTheAlpha, number)}
            </p>
          </div>
        </li>
        {kinds.map(({ domain, items }) => (
          <li key={domain} data-moved={domain} className={tile}>
            <DataTypeIcon name={ICON_OF_DOMAIN[domain]} className="shrink-0 text-blue-700" />
            <div>
              <p className="text-sm text-gray-600">{t(DOMAIN_STRING_KEY[domain])}</p>
              <p className="text-lg font-semibold text-gray-900">{number(items)}</p>
            </div>
          </li>
        ))}
      </ul>
      {progress.error != null ? (
        <div className="mt-3">
          <ReadFailed heading={t('billing.moved.failed')} error={progress.error} />
        </div>
      ) : progress.isPending ? (
        <Loader2 className="mt-3 w-5 h-5 animate-spin text-gray-400" />
      ) : kinds.every(({ items }) => items === 0) ? (
        <p className="mt-3 text-sm text-gray-700">{t('billing.moved.none')}</p>
      ) : null}
    </div>
  );
};

/**
 * WHAT THIS MONTH BILLS (workplan 0109 T6; the owner, 2026-10-04).
 *
 * The headline is the tier the month bills once the alpha is over: what it
 * used, never above the agreed tier. Under it, always, what was used: the most
 * migrations at once this month, and the data moved in total, for ever, against
 * the ceiling it counts toward (the owner, 2026-10-04: *"In total for ever"*).
 * What the alpha moved never counts, and is said on a line of its own.
 *
 * When what was used is past the tier billed, one sentence says why: bands
 * bought cover the data (a top-up keeps the tier), more ran at the same time
 * than the tier runs, or more moved than its ceiling. During the alpha the
 * panel names what was used, as it always did, under its old title.
 */
const TierPanel: React.FC<{ usage: UsageResponse }> = ({ usage }) => {
  const t = useT();
  const { currency, dateTime, number } = useFormatters();
  const tier = shownTier(usage);
  const size = (gb: number) => sizeOf(gb, number);
  const capped = usage.holds && usage.billed.beyond.length > 0;
  return (
    <div className="mt-6 p-4 bg-gray-50 rounded-lg">
      <h3 className="font-medium text-gray-900 mb-3">{t(usage.holds ? 'billing.monthBills' : 'billing.yourTier')}</h3>
      {tier ? (
        <div className="space-y-2">
          {/* Wraps on a phone, where the tier's sentence would squeeze its name. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
            <span className="text-lg font-semibold text-gray-900">{tier.name}</span>
            {isFreeTier(tier) ? (
              <span className="font-medium">{t('billing.tierFree')}</span>
            ) : (
              <span className="font-medium">
                {currency(tier.monthlyCents, 'EUR')} {t('billing.tierPerMonth')}
                {' · '}
                {currency(tier.annualCents, 'EUR')} {t('billing.tierPerYear')}
              </span>
            )}
          </div>
          {usage.holds && usage.billed.picked ? (
            // A tier the person picked is above what was used (0157 T6).
            <p className="text-sm text-gray-600">{t('billing.tierPicked', { tier: tier.name })}</p>
          ) : capped ? (
            usage.billed.beyond.map((why) => (
              <p key={why} className="text-sm text-gray-600">
                {why === 'bands'
                  ? t('billing.tierBeyond.bands', { count: usage.topUps, tier: tier.name })
                  : why === 'paths'
                    ? t('billing.tierBeyond.paths', { tier: tier.name })
                    : t('billing.tierBeyond.data', { tier: tier.name })}
              </p>
            ))
          ) : (
            <p className="text-sm text-gray-600">
              {usage.decidedBy === 'paths'
                ? t('billing.tierDecidedByPaths')
                : usage.decidedBy === 'data'
                  ? t('billing.tierDecidedByData')
                  : t('billing.tierDecidedByBoth')}
            </p>
          )}
        </div>
      ) : (
        /* Past the end of the published table. Not an error, and it
           must not render as one: it is the site's own ending. */
        <p className="text-sm text-gray-600">{t('billing.tierBeyondTable')}</p>
      )}
      <div className="space-y-2 mt-2 pt-2 border-t">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">{t('billing.tierPeakPaths')}</span>
          <span className="font-medium">
            {usage.evidence.peakPaths}
            {usage.evidence.peakAt ? ` · ${dateTime(usage.evidence.peakAt)}` : ''}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">{t('billing.tierDataMoved')}</span>
          <span className="font-medium">
            {t('billing.tierDataOf', { moved: size(usage.evidence.gbMoved), ceiling: size(usage.ceilingGb) })}
          </span>
        </div>
        {usage.gbMovedInTheAlpha > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">{t('billing.tierAlphaMoved')}</span>
            <span className="font-medium">{size(usage.gbMovedInTheAlpha)}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const Billing: React.FC = () => {
  const t = useT();
  const { currency, dateTime } = useFormatters();
  const { user } = useAuthStore();
  // Mirrors the server's requireRole('owner','admin') — which since the
  // 2026-08-10 owner decision guards the billing READS as well as the
  // writes. A lesser role gets a clean sentence instead of three fetches
  // that can only come back 403 as red error cards.
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  const { data: usage, isLoading: usageLoading, error: usageError } = useQuery({
    queryKey: ['billing-usage'],
    queryFn: () => billingApi.getCurrentUsage(),
    enabled: canManage,
  });

  const { data: invoices, isLoading: invoicesLoading, error: invoicesError, refetch: refetchInvoices } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () => billingApi.listInvoices(),
    enabled: canManage,
  });

  // The Payment Methods read is PERFORMED now (0039 T4) — the old card
  // hardcoded "no payment methods configured" without asking, so a tenant
  // WITH stored methods was told they had none.
  const { data: methods, isLoading: methodsLoading, error: methodsError } = useQuery({
    queryKey: ['billing-payment-methods'],
    queryFn: () => billingApi.getPaymentMethods(),
    enabled: canManage,
  });

  // The Mollie pay loop, finally reachable (0039 T4): create the payment,
  // follow the checkout URL. Failures render at the row, verbatim.
  const [payError, setPayError] = React.useState<{ invoiceId: string; text: string } | null>(null);
  const payMutation = useMutation({
    mutationFn: (invoiceId: string) => billingApi.createPayment(invoiceId),
    onSuccess: (result) => {
      window.location.href = result.paymentUrl;
    },
    onError: (error, invoiceId) => {
      setPayError({ invoiceId, text: serverMessage(error) });
      void refetchInvoices();
    },
  });

  // Billing is owner/admin territory in both directions (2026-08-10): for a
  // lesser role, say so — the nav entry is hidden too, but a typed URL still
  // lands here and deserves the sentence, not a spinner over three 403s.
  if (!canManage) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('billing.title')}</h1>
          <Subtitle figuresShown={false} />
        </div>
        <p className="text-sm text-gray-600 bg-amber-50 border border-amber-200 rounded-lg p-4">
          {t('billing.adminOnly')}
        </p>
      </div>
    );
  }

  if (usageLoading || invoicesLoading || methodsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('billing.title')}</h1>
        <Subtitle figuresShown />
      </div>

      {/* Current Usage */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('billing.currentUsage')}</h2>
          {usage && (
            // WHICH month, and how fresh — the served period and lastUpdated
            // were discarded before (0039 T2; 0036's as-of species).
            <p className="text-sm text-gray-500">
              {t('billing.usagePeriod')} {usage.usage.period} · {t('billing.asOf')}{' '}
              {dateTime(usage.usage.lastUpdated)}
            </p>
          )}
        </div>

        {usageError != null ? (
          <ReadFailed
            heading={t('billing.usageLoadFailed')}
            error={usageError}
          />
        ) : usage ? (
          <div className="space-y-4">
            {/* WHAT HAS MOVED (`WhatMoved`; the owner, 2026-10-05): all the
                data, then each kind's items; below it, what the tier counts. */}
            <WhatMoved usage={usage} />

            {/* WHAT THIS MONTH BILLS — not a sum of metered lines.
                Until 2026-09-09 this block itemised a base fee, per-GB
                storage and egress, per-hour compute, VAT and a total. Every
                figure was arithmetically correct and none of them was a
                price: ADR-0014 replaced metered billing with five tiers on
                2026-08-20, and the API has refused to mint an invoice from
                the old model since 2026-08-27. A customer reading this saw a
                euro total nothing would ever charge them.

                The tier IS the answer to "what does this cost me", and the
                evidence beside it is the whole point of measuring (workplan
                0121 T4, owner 2026-09-09: the measurement is instrumentation,
                and the customer gets to see it).

                MONEY UNIT: `currency` takes CENTS, and so does the tier
                (`monthlyCents: 500` is €5). There is no setup fee since
                2026-10-03 (ADR-0014). A free tier prints no money at all.

                Once the alpha is over the headline is the tier the month
                BILLS, what it used and never above the agreed tier, with what
                was used under it (`TierPanel`; the owner, 2026-10-04). */}
            <TierPanel usage={usage} />
          </div>
        ) : (
          <p className="text-gray-500">{t('billing.noUsage')}</p>
        )}
      </div>

      {/* A tier the person picks, for its pace or its room (0157 T6): each
          month then bills at least it, until they lower it. */}
      <TierPick />

      {/* The data ceiling and the yes that moves it (0109 T6): where the data
          stands against what was agreed to, and from 80% both ways on. */}
      <DataCeiling />

      {/* Who invoices are addressed to — above the invoices it will be on. */}
      {/* During the alpha nothing is invoiced on any tier (0131 T3, owner's
          answer to open question 7), so the card says so as it does on a
          free tier, instead of asking for details nobody needs yet. */}
      <InvoiceDetailsCard free={isAlpha() || (usage != null && shownTier(usage) != null && isFreeTier(shownTier(usage)!))} />

      {/* Invoices */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{t('billing.invoices')}</h2>
        </div>
        <div className="p-6">
          {invoicesError != null ? (
            <ReadFailed
              heading={t('billing.invoicesLoadFailed')}
              error={invoicesError}
            />
          ) : invoices?.invoices?.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{t('billing.noInvoices')}</p>
          ) : (
            <div className="space-y-4">
              {invoices?.invoices?.map((invoice: Invoice) => (
                <div key={invoice.id} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">
                        {t('billing.invoice')} {invoice.id.slice(0, 8)}
                      </p>
                      {/* The period the server actually serves —
                          periodStart/periodEnd. The old field ("period")
                          existed only in the client type, so this line
                          rendered "Period:" followed by nothing. */}
                      <p className="text-sm text-gray-500">
                        {t('billing.period')} {invoice.periodStart} – {invoice.periodEnd}
                      </p>
                    </div>
                    <div className="flex items-center space-x-4">
                      <StateChip entity="invoice" state={invoice.status} />
                      <span className="font-medium text-gray-900">
                        {currency(invoice.total, invoice.currency)}
                      </span>
                      {canManage && (invoice.status === 'draft' || invoice.status === 'sent' || invoice.status === 'overdue') && (
                        <button
                          onClick={() => {
                            setPayError(null);
                            payMutation.mutate(invoice.id);
                          }}
                          disabled={payMutation.isPending}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                        >
                          {payMutation.isPending && payMutation.variables === invoice.id && (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          )}
                          {t('billing.pay')}
                        </button>
                      )}
                    </div>
                  </div>
                  {payError?.invoiceId === invoice.id && (
                    <p className="mt-2 text-sm text-red-800">
                      <span className="font-medium">{t('billing.payFailed')}</span> {payError.text}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Payment Methods — served rows or an honest failure; the "Add
          Payment Method" button is GONE rather than dead (0039 T4): adding
          one requires a Mollie flow that is not built, and a button that
          does nothing on a billing screen reads as broken payments. */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{t('billing.paymentMethods')}</h2>
        </div>
        <div className="p-6">
          {methodsError != null ? (
            <ReadFailed
              heading={t('billing.paymentMethodsLoadFailed')}
              error={methodsError}
            />
          ) : methods?.paymentMethods?.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{t('billing.noPaymentMethods')}</p>
          ) : (
            <div className="space-y-3">
              {methods?.paymentMethods?.map((method) => (
                <div
                  key={method.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-gray-500" />
                    <div>
                      <p className="font-medium text-gray-900">
                        {method.brand ?? method.type}
                        {method.lastFour ? ` •••• ${method.lastFour}` : ''}
                      </p>
                      {method.expiryMonth != null && method.expiryYear != null && (
                        <p className="text-sm text-gray-500">
                          {String(method.expiryMonth).padStart(2, '0')}/{method.expiryYear}
                        </p>
                      )}
                    </div>
                  </div>
                  {method.isDefault && (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      {t('billing.default')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Billing;
