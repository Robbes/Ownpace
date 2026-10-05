// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * `operator.sh moneybird check`: what this deployment would invoice with,
 * asked of the administration itself (workplan 0111, slice 1 of §"The build,
 * sliced").
 *
 * Two reads and nothing else: the sales tax rates and the workflows. No
 * contact, no invoice, no e-mail, so it costs nothing of a sandbox's monthly
 * allowance. It prints each rate and workflow with its id, what each VAT
 * treatment resolves to, and the workflow invoices would go through, with
 * whether its prices include VAT.
 *
 * It is useful before the set is complete: with the token and the
 * administration id alone it lists the ids to pick from and names the keys
 * still unset. `ok` is true only when nothing needs doing: Moneybird off, or
 * every required piece set and found in the administration. The outside-EU
 * rate is optional, so its refusal is printed and does not fail the check;
 * OSS refuses by design until the threshold decision flips.
 *
 * The token appears in no line. The guard is `moneybird-check.unit.test.ts`.
 */

import { moneybirdAccessFromEnv, moneybirdFromEnv, type MoneybirdSettings } from './moneybird-config.ts';
import type { MoneybirdAccess } from './moneybird-http.ts';
import { fetchSalesTaxRates, resolveTaxRateId, type MoneybirdTaxRate } from './moneybird-tax-rates.ts';
import { fetchWorkflows, resolveInvoiceWorkflow, type MoneybirdWorkflow } from './moneybird-workflows.ts';
import type { VatTreatment } from './vat-treatment.ts';

export interface MoneybirdCheck {
  /** True when nothing needs doing: Moneybird off, or on with every required piece found. */
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** Every treatment, in the order the check prints them. */
const TREATMENTS: readonly VatTreatment[] = ['domestic_standard', 'reverse_charge', 'outside_eu', 'destination_oss'];

/** The treatments a buyer can need today; the others refuse until they are set up. */
const REQUIRED: ReadonlySet<VatTreatment> = new Set(['domestic_standard', 'reverse_charge']);

function percentageOf(rate: { readonly percentage: string | null }): string {
  return rate.percentage === null ? 'no percentage' : `${rate.percentage}%`;
}

function rateLine(rate: MoneybirdTaxRate): string {
  const notes = [percentageOf(rate)];
  if (rate.country) notes.push(rate.country);
  if (!rate.active) notes.push('INACTIVE');
  return `  ${rate.id}  ${rate.name}  (${notes.join(', ')})`;
}

function pricesOf(workflow: MoneybirdWorkflow): string {
  if (workflow.pricesAreInclTax === null) return 'prices: Moneybird did not say whether they include VAT';
  return workflow.pricesAreInclTax ? 'prices include VAT' : 'prices exclude VAT';
}

function workflowLine(workflow: MoneybirdWorkflow): string {
  const notes = [workflow.type ?? 'type not given'];
  if (workflow.isDefault) notes.push('default');
  if (workflow.active === false) notes.push('INACTIVE');
  notes.push(pricesOf(workflow));
  return `  ${workflow.id}  ${workflow.name}  (${notes.join(', ')})`;
}

/** Reads the administration the environment names and says what it would invoice with. */
export async function checkMoneybird(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl?: typeof fetch,
): Promise<MoneybirdCheck> {
  const outcome = moneybirdFromEnv(env);
  if (outcome.kind === 'off') {
    return {
      ok: true,
      lines: ['Moneybird is off: no MONEYBIRD_* key is set. Nothing is invoiced, and nothing is asked of Moneybird.'],
    };
  }

  const config: MoneybirdSettings | null = outcome.kind === 'on' ? outcome.config : null;
  const access: MoneybirdAccess | null = config ?? moneybirdAccessFromEnv(env);
  const lines: string[] = [];
  let ok = outcome.kind === 'on';

  if (outcome.kind === 'refused') lines.push(`Moneybird is not ready: ${outcome.reason}`);
  if (access === null) {
    lines.push(
      'Nothing was asked of Moneybird: that takes MONEYBIRD_API_TOKEN and MONEYBIRD_ADMINISTRATION_ID, ' +
        'the administration id as digits.',
    );
    return { ok: false, lines };
  }
  if (outcome.kind === 'refused') lines.push('What the administration holds, to pick the rest from:');
  const administration = access;
  lines.push('', `Administration ${administration.administrationId}`);

  const rates = await fetchSalesTaxRates(administration, fetchImpl);
  lines.push('');
  if (rates.kind !== 'ok') {
    lines.push(`Sales tax rates: not read. ${rates.reason}`);
    ok = false;
  } else {
    lines.push(`Sales tax rates (${rates.rates.length}):`, ...rates.rates.map(rateLine));
    if (config) {
      lines.push('', 'Each VAT treatment:');
      for (const treatment of TREATMENTS) {
        const resolved = resolveTaxRateId(treatment, config.taxRates, rates.rates);
        if (resolved.kind === 'resolved') {
          lines.push(`  ${treatment}: ${resolved.taxRateId} "${resolved.name}" (${percentageOf(resolved)})`);
          continue;
        }
        const needed = REQUIRED.has(treatment);
        lines.push(`  ${treatment}: refused${needed ? '' : ' (expected until it is set up)'}. ${resolved.reason}`);
        if (needed) ok = false;
      }
    }
  }

  const workflows = await fetchWorkflows(administration, fetchImpl);
  lines.push('');
  if (workflows.kind !== 'ok') {
    lines.push(`Workflows: not read. ${workflows.reason}`);
    ok = false;
  } else {
    lines.push(`Workflows (${workflows.workflows.length}):`, ...workflows.workflows.map(workflowLine));
    if (config) {
      const resolved = resolveInvoiceWorkflow(config.workflowId, workflows.workflows);
      lines.push('');
      if (resolved.kind === 'resolved') {
        lines.push(
          `Invoices go through workflow ${resolved.workflow.id} "${resolved.workflow.name}" ` +
            `(${pricesOf(resolved.workflow)}).`,
        );
      } else {
        lines.push(`The invoice workflow: refused. ${resolved.reason}`);
        ok = false;
      }
    }
  }

  if (config) {
    lines.push(
      '',
      config.delivery === 'manual'
        ? 'Delivery: manual. Moneybird numbers each invoice and e-mails nothing.'
        : "Delivery: email. Moneybird e-mails each invoice to the buyer's invoice address.",
    );
  }

  lines.push(
    '',
    ok
      ? 'RESULT: ready. The rates and the workflow this deployment would invoice with are in the administration.'
      : 'RESULT: not ready. Fix what is named above, then run the check again.',
  );
  return { ok, lines };
}
