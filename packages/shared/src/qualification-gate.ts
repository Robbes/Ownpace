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

import { DISCOVERY_DOMAINS, type DiscoveryDomain } from './discovery.ts';

export interface QualifiedDomainRecord {
  readonly answer: 'yes' | 'no' | 'unknown';
  readonly detail: string;
}

/**
 * The stored record's own word for each domain. Exported since workplan 0113
 * T5, because the browser was writing this vocabulary out by hand — four
 * copies of `'mail' | 'calendar' | 'contact' | 'file'` in the probe text and
 * the mapping service — and a fifth face reached the record before any of
 * them knew. The same one-list rule the domains themselves live under (T1):
 * the record's words are derived from `DISCOVERY_DOMAINS`, so a sixth domain
 * is a compile error in `KEY_FOR_DOMAIN` and nowhere else.
 */
export type QualificationKey = 'mail' | 'calendar' | 'contact' | 'file' | 'task';

const KEY_FOR_DOMAIN: Readonly<Record<DiscoveryDomain, QualificationKey>> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contact',
  file: 'file',
  task: 'task',
};

/**
 * The record's faces IN DOMAIN ORDER — the order a person ticks them, so a
 * qualification line and a domain step list them the same way twice running.
 */
export const QUALIFICATION_KEYS: ReadonlyArray<QualificationKey> =
  DISCOVERY_DOMAINS.map((d) => KEY_FOR_DOMAIN[d]);

/** The wizard domain a record face belongs to — `KEY_FOR_DOMAIN`, inverted. */
export const DOMAIN_FOR_QUALIFICATION_KEY: Readonly<Record<QualificationKey, DiscoveryDomain>> =
  Object.fromEntries(DISCOVERY_DOMAINS.map((d) => [KEY_FOR_DOMAIN[d], d])) as Record<
    QualificationKey,
    DiscoveryDomain
  >;

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

/**
 * WHY A FACE IS NOT A TICK — the half the three-state rule deliberately does
 * not carry, added 2026-09-07 on the owner's reading of a live card.
 *
 * A Nextcloud target's card said, in three lines of prose:
 *
 *     Can carry: Email ? · Calendar ✓ 1 calendar · …
 *     Email ?: This connection carries no mail server address, so mail was
 *     not measured — mail is qualified on an imap or jmap connection.
 *
 * Every word of that is true, and none of it is any use: the person typed a
 * DAV address, never claimed a mailbox, and the sentence explains an
 * irrelevance at the top of the card. Meanwhile a Dropbox row spends four
 * lines saying it is not a calendar, a mailbox, an address book or a task
 * list — facts the front door stated before the connection existed.
 *
 * The cause is that ONE MARK CARRIES SEVERAL SITUATIONS. `?` is both "we
 * asked and could not tell" (a 401, a bad path — the sentence IS the remedy)
 * and "there was nothing to ask with". `✗` is both "this kind has no such
 * face" and "the consent left it out". A screen that cannot tell them apart
 * must either show all four or hide all four, and both are wrong.
 *
 * So the reason rides ALONGSIDE the answer rather than replacing it. The
 * stored `answer` keeps its three states, `qualifiedAnswerFor` keeps reading
 * it, and the gate below is untouched — what may CONSTRAIN a tick is exactly
 * what it was. This decides only what a screen says out loud.
 */
export const QUALIFICATION_REASONS = [
  /** This kind has no such face, and never did: a Dropbox is not a calendar. */
  'structural',
  /** The question could not be posed — this row carries no address for that
   *  face. A DAV connection has no mail server, so mail was never asked. */
  'notAskable',
  /** The face exists and the grant does not carry it. */
  'notGranted',
  /**
   * The face IS one this kind carries, and this row is missing a field that
   * would let us ask — a Soverin account with no `mailHost`. Distinct from
   * `notAskable` in the only way that matters to a reader: there is something
   * to go and do, and the sentence says what.
   */
  'incomplete',
  /** We asked and could not tell: a refusal, a timeout, a path that 404s. */
  'refused',
] as const;

export type QualificationReason = (typeof QUALIFICATION_REASONS)[number];

/**
 * Does this reason earn a sentence on a screen?
 *
 * ONE PLACE, so the card, the test panel, the wizard and the appliance's
 * report cannot drift into four different opinions about the same record.
 *
 * `refused` earns one: nothing answered, the cause is outside the product,
 * and the sentence is the only route to fixing it.
 *
 * `structural` does not: the front door already said what a Dropbox carries,
 * and repeating it under every connection is noise proportional to how many
 * faces the product supports — it gets worse with every domain we add.
 *
 * `notAskable` does not, for the same reason one step further out: the person
 * did not ask for that face, this row cannot express it, and there is nothing
 * to act on. `incomplete` DOES, and that pair is why the two are separate
 * reasons rather than one: a `nextcloud` row has no mail face to complete, a
 * `soverin` row has one and is a `mailHost` short of it, and the same silence
 * would be right for the first and a dead end for the second.
 *
 * `notGranted` does not, and this is the owner's call (2026-09-07): *"I don't
 * want to tell people they already know by not ticking a grant-to-request."*
 * It is SOUND rather than merely kind, because the consent door refuses to
 * store a partial grant — `exchangeCode` answers `ok: false` when Google
 * grants less than was asked, so nothing is written and the person is sent
 * back with every box ticked. A face missing from a STORED grant is therefore
 * a face nobody asked for. `a-grant-stored-with-less-than-was-asked` fails if
 * that door is ever loosened, because this silence depends on it: the day a
 * partial grant can be stored, this reason has something to say again.
 *
 * An ABSENT reason speaks, deliberately. A record written before this field
 * existed is read exactly as it was before — an `unknown` with a sentence
 * still shows it — so upgrading the build does not silently swallow the one
 * case that matters. The next Test writes a reason and the noise goes.
 */
export function reasonEarnsASentence(reason: QualificationReason | undefined): boolean {
  return reason === undefined || reason === 'refused' || reason === 'incomplete';
}
