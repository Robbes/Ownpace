// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The qualification gate (workplan 0106 T3a): what a stored account record
 * may CONSTRAIN, in the same words at both doors.
 *
 * Since T0 every qualified connection row carries what the account itself
 * answered per domain — measured, never assumed. This module is the one
 * place that record becomes a constraint: the wizard marks a domain the
 * account measured it cannot carry, and the create API refuses the same
 * combination verbatim for any other client (the `TARGET_TYPE_DOMAINS`
 * two-door argument, applied to the measured layer above the static one).
 *
 * THE THREE-STATE RULE IS THE SPINE, unchanged from T0: only a well-formed,
 * MEASURED `no` constrains anything. `unknown` is unmeasured — it never
 * refuses (a refusal is never a no, and neither is silence). A connection
 * with no stored record (never qualified, or created before 0029) never
 * refuses. A malformed record never refuses — refusing on garbage would
 * turn a corrupt row into a wall, when the honest reading is "unmeasured".
 *
 * The record's vocabulary says `mail` where the wizard's says `email`
 * (`DiscoveryDomain`); the mapping lives here so neither door hand-rolls it.
 */

import type { DiscoveryDomain } from './discovery.ts';

export interface QualifiedDomainRecord {
  readonly answer: 'yes' | 'no' | 'unknown';
  readonly detail: string;
}

type QualificationKey = 'mail' | 'calendar' | 'contact' | 'file';

const KEY_FOR_DOMAIN: Readonly<Record<DiscoveryDomain, QualificationKey>> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contact',
  file: 'file',
};

function asDomainRecord(value: unknown): QualifiedDomainRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const answer = (value as { answer?: unknown }).answer;
  if (answer !== 'yes' && answer !== 'no' && answer !== 'unknown') return undefined;
  const detail = (value as { detail?: unknown }).detail;
  return { answer, detail: typeof detail === 'string' ? detail : '' };
}

/**
 * The stored record's answer for a wizard domain, or undefined when there is
 * no well-formed answer — which callers must treat exactly like `unknown`.
 */
export function qualifiedAnswerFor(
  qualification: unknown,
  domain: DiscoveryDomain,
): QualifiedDomainRecord | undefined {
  if (typeof qualification !== 'object' || qualification === null) return undefined;
  const domains = (qualification as { domains?: unknown }).domains;
  if (typeof domains !== 'object' || domains === null) return undefined;
  return asDomainRecord((domains as Record<string, unknown>)[KEY_FOR_DOMAIN[domain]]);
}

/**
 * The refusal for asking a qualified account to carry a domain it MEASURED
 * it cannot — naming the domain, the account's own evidence, and the remedy
 * — or null when nothing measured stands in the way. Rendered verbatim at
 * both doors (prose boundary).
 */
export function measuredNoRefusal(
  qualification: unknown,
  domains: ReadonlyArray<DiscoveryDomain>,
): string | null {
  const refused = domains
    .map((d) => ({ domain: d, record: qualifiedAnswerFor(qualification, d) }))
    .filter((x): x is { domain: DiscoveryDomain; record: QualifiedDomainRecord } =>
      x.record?.answer === 'no',
    );
  if (refused.length === 0) return null;
  const list = refused.map((x) => `'${x.domain}'`).join(', ');
  const evidence = refused
    .map((x) => x.record.detail)
    .filter((d) => d.length > 0)
    .join(' ');
  return (
    `This account MEASURED that it cannot carry ${list}: ${evidence || 'the account answered without this capability.'} ` +
    'If the account has changed since, test the connection again to refresh its record — ' +
    'otherwise drop the data types it answered no to.'
  );
}
