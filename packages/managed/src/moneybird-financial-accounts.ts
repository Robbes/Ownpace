// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The financial account a payment through Mollie is booked on (workplan 0111,
 * slice 5f; the owner, 2026-10-11: *"Ownpace follows Mollie"*).
 *
 * When Mollie confirms a payment, Ownpace books it on its invoice in Moneybird
 * against one financial account, `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE`, and
 * Mollie's payouts reach the bank as transfers from that account, its fees
 * costs: nothing is counted twice. The owner makes the account in Moneybird;
 * `operator.sh moneybird check` lists what the administration holds, with ids,
 * and says whether the configured one is there and active.
 *
 * As with the rates and the workflows: ids are strings of digits, an entry
 * without an id and a name is nothing anybody could have configured, and a
 * field Moneybird leaves out is read as unknown, never as a refusal.
 */

import { moneybirdRead, type MoneybirdAccess, type SlowDown } from './moneybird-http.ts';

export interface MoneybirdFinancialAccount {
  readonly id: string;
  readonly name: string;
  /** Moneybird's kind of account, such as `FinancialAccount::BankAccount`; null when absent. */
  readonly type: string | null;
  /** The payment provider an account is linked to, such as `mollie`; null when absent. */
  readonly provider: string | null;
  /** null when Moneybird did not say. */
  readonly active: boolean | null;
}

export type FetchFinancialAccountsOutcome =
  | { readonly kind: 'ok'; readonly accounts: readonly MoneybirdFinancialAccount[] }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | SlowDown;

/** The administration's financial accounts, from Moneybird's own API. */
export async function fetchFinancialAccounts(
  access: MoneybirdAccess,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchFinancialAccountsOutcome> {
  const read = await moneybirdRead(access, 'financial_accounts.json', fetchImpl);
  if (read.kind !== 'ok') return read;
  if (!Array.isArray(read.body)) {
    return { kind: 'unavailable', reason: 'Moneybird answered a shape this client does not recognise.' };
  }
  const accounts: MoneybirdFinancialAccount[] = [];
  for (const entry of read.body) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    accounts.push({
      id: raw.id,
      name: raw.name,
      type: typeof raw.type === 'string' ? raw.type : null,
      provider: typeof raw.provider === 'string' ? raw.provider : null,
      active: typeof raw.active === 'boolean' ? raw.active : null,
    });
  }
  return { kind: 'ok', accounts };
}

export type ResolveFinancialAccountOutcome =
  | { readonly kind: 'resolved'; readonly account: MoneybirdFinancialAccount }
  | { readonly kind: 'unresolved'; readonly reason: string };

/** The configured account, if the administration holds it and it is not archived. */
export function resolveFinancialAccount(
  accountId: string,
  accounts: readonly MoneybirdFinancialAccount[],
): ResolveFinancialAccountOutcome {
  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    return {
      kind: 'unresolved',
      reason: `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE is ${accountId}, and the administration holds no financial account with that id.`,
    };
  }
  if (account.active === false) {
    return {
      kind: 'unresolved',
      reason: `MONEYBIRD_FINANCIAL_ACCOUNT_ID_MOLLIE names "${account.name}", which is not active in Moneybird.`,
    };
  }
  return { kind: 'resolved', account };
}
