// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The invoice workflow every document goes through (workplan 0111, slice 1 of
 * §"The build, sliced").
 *
 * A Moneybird workflow decides how a sales invoice behaves once it exists: its
 * payment term, its reminders, its language, and whether the prices on its
 * lines include VAT (`prices_are_incl_tax`). That last one is why the workflow
 * is configuration (`MONEYBIRD_WORKFLOW_ID`) and never Moneybird's default: on
 * the sandbox the owner set the Ownpace workflow to prices including VAT
 * (2026-10-05), and a line priced for the other setting gains or loses the VAT
 * without any error. Slice 2 states the setting on every invoice; this module
 * reads what the configured workflow says, so the check prints it beside the
 * rates.
 *
 * `resolveInvoiceWorkflow` refuses by name, as `resolveTaxRateId` does: an id
 * the administration does not hold, a workflow for estimates, an inactive one.
 * A field Moneybird leaves out is read as unknown, never as a refusal: a
 * missing `active` is not an archived workflow.
 */

import { moneybirdRead, type MoneybirdAccess, type SlowDown } from './moneybird-http.ts';

export interface MoneybirdWorkflow {
  readonly id: string;
  readonly name: string;
  /** `InvoiceWorkflow` or `EstimateWorkflow`, as Moneybird names them; null when absent. */
  readonly type: string | null;
  /** null when Moneybird did not say. */
  readonly active: boolean | null;
  readonly isDefault: boolean;
  /** Whether a line's price includes VAT under this workflow; null when Moneybird did not say. */
  readonly pricesAreInclTax: boolean | null;
  readonly language: string | null;
}

export type FetchWorkflowsOutcome =
  | { readonly kind: 'ok'; readonly workflows: readonly MoneybirdWorkflow[] }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/** The administration's workflows, invoice and estimate alike, from Moneybird's own API. */
export async function fetchWorkflows(
  access: MoneybirdAccess,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchWorkflowsOutcome> {
  const read = await moneybirdRead(access, 'workflows.json', fetchImpl);
  if (read.kind !== 'ok') return read;
  if (!Array.isArray(read.body)) {
    return { kind: 'unavailable', reason: 'Moneybird answered a shape this client does not recognise.' };
  }
  const workflows: MoneybirdWorkflow[] = [];
  for (const entry of read.body) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    // As with the rates: ids are strings of digits, and an entry without an
    // id and a name is nothing anybody could have configured.
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    workflows.push({
      id: raw.id,
      name: raw.name,
      type: typeof raw.type === 'string' ? raw.type : null,
      active: typeof raw.active === 'boolean' ? raw.active : null,
      isDefault: raw.default === true,
      pricesAreInclTax: typeof raw.prices_are_incl_tax === 'boolean' ? raw.prices_are_incl_tax : null,
      language: typeof raw.language === 'string' ? raw.language : null,
    });
  }
  return { kind: 'ok', workflows };
}

export type ResolveWorkflowOutcome =
  | { readonly kind: 'resolved'; readonly workflow: MoneybirdWorkflow }
  | { readonly kind: 'unresolved'; readonly reason: string };

/** The configured workflow, if the administration holds it as an active invoice workflow. */
export function resolveInvoiceWorkflow(
  workflowId: string,
  workflows: readonly MoneybirdWorkflow[],
): ResolveWorkflowOutcome {
  const workflow = workflows.find((w) => w.id === workflowId);
  if (!workflow) {
    return {
      kind: 'unresolved',
      reason:
        `Workflow ${workflowId} (MONEYBIRD_WORKFLOW_ID) does not exist in the Moneybird administration — ` +
        'pick one of its invoice workflows.',
    };
  }
  if (workflow.type !== null && workflow.type !== 'InvoiceWorkflow') {
    return {
      kind: 'unresolved',
      reason:
        `Workflow ${workflowId} ("${workflow.name}", MONEYBIRD_WORKFLOW_ID) is an ${workflow.type}, ` +
        'not an invoice workflow — an invoice cannot be sent through it.',
    };
  }
  if (workflow.active === false) {
    return {
      kind: 'unresolved',
      reason:
        `Workflow ${workflowId} ("${workflow.name}", MONEYBIRD_WORKFLOW_ID) is INACTIVE in Moneybird — ` +
        'somebody archived it; pick its replacement in the administration.',
    };
  }
  return { kind: 'resolved', workflow };
}
