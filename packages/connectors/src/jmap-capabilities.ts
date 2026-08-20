// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Ask a JMAP server which domains it can actually carry (workplan 0031 T4).
 *
 * T4's last open item is *"the target picker offering JMAP per domain only
 * where the server speaks it"*, and nothing could answer that question. This
 * is the answer, as a function rather than a screen: the picker is a separate
 * slice and a different decision, but neither it nor anything else can offer a
 * per-domain choice without first being able to ask.
 *
 * It has standalone value today. `TargetConfig` has allowed `type: 'jmap'` for
 * contacts and files since those connectors landed, and a mapping that names it
 * against a server which does not serve that URN currently discovers the
 * problem at WRITE time, mid-migration, as an opaque method error. This turns
 * that into a question that can be asked before anything is copied.
 *
 * ============================================================================
 * THE THREE THINGS IT KEEPS APART, BECAUSE CONFLATING THEM WOULD LIE
 * ============================================================================
 *
 * **1. "The server advertises the capability" is not "the server can carry the
 * domain."** Every JMAP writer here resolves its account from
 * `primaryAccounts[urn]` and REFUSES rather than guessing when there isn't one
 * (writing a customer's contacts into somebody else's account is the worst
 * thing those files could do). A capability advertised with no account behind
 * it is therefore a URN this product cannot write to, and reporting it as
 * available would move the failure from here to mid-migration.
 *
 * **2. "The server speaks it" is not "this product can carry it."** Stalwart
 * advertises `urn:ietf:params:jmap:calendars`, and there is no JMAP calendar
 * target — 0031 T1 is PARKED because that server refuses `recurrenceRules`
 * over JMAP, so a calendar target would write a recurring series as a single
 * event plus orphaned overrides, silently. A picker that offered JMAP
 * calendars because the URN was present would be offering a data-loss bug.
 * So `serverSpeaks` and `supportedByThisProduct` are separate fields and
 * `usable` is the conjunction.
 *
 * **3. "I could not look" is not "the server speaks nothing."** A session that
 * cannot be loaded — wrong host, wrong credentials, TLS refused — must NOT
 * come back as a report full of `false`, because that reads as a definitive
 * negative answer and hard rule 9 forbids turning a failure into an empty
 * result. This throws, with the cause attached.
 *
 * @see docs/workplans/0031-jmap-full-target.md — T4
 * @see scripts/jmap-target-spike.ts — where these URNs were established
 */

import { loadJmapSession } from './jmap-session.ts';

/** The four domains a mapping can carry. */
export type JmapDomain = 'mail' | 'calendar' | 'contact' | 'file';

/**
 * The URN each domain needs, and whether this product has a writer for it.
 *
 * Named per domain rather than as a list because they fail INDEPENDENTLY: a
 * server can serve contacts and not files, and "JMAP is not ready" would be the
 * wrong summary of that.
 *
 * `parse` is listed for contacts because `JmapContactTarget` is built on route
 * (2) — it uploads the vCard and lets the SERVER convert it via
 * `ContactCard/parse`, which is the whole fidelity argument for that connector.
 * A server serving `contacts` but not `contacts:parse` cannot be written to by
 * the connector as it exists, so the requirement is recorded here rather than
 * discovered as a method error on the first card.
 */
const DOMAIN_REQUIREMENTS: ReadonlyArray<{
  readonly domain: JmapDomain;
  /** The capability URN, which is also the `primaryAccounts` key. */
  readonly urn: string;
  /** Additional capabilities the connector needs, beyond the account one. */
  readonly alsoNeeds: ReadonlyArray<string>;
  /** Does a writer exist in this codebase? */
  readonly supportedByThisProduct: boolean;
  /** Stated when this product cannot carry the domain regardless of the server. */
  readonly unsupportedReason?: string;
}> = [
  {
    domain: 'mail',
    urn: 'urn:ietf:params:jmap:mail',
    alsoNeeds: [],
    supportedByThisProduct: true,
  },
  {
    domain: 'contact',
    urn: 'urn:ietf:params:jmap:contacts',
    alsoNeeds: ['urn:ietf:params:jmap:contacts:parse'],
    supportedByThisProduct: true,
  },
  {
    domain: 'file',
    urn: 'urn:ietf:params:jmap:filenode',
    alsoNeeds: [],
    supportedByThisProduct: true,
  },
  {
    domain: 'calendar',
    urn: 'urn:ietf:params:jmap:calendars',
    alsoNeeds: [],
    supportedByThisProduct: false,
    unsupportedReason:
      'This product has no JMAP calendar target. Workplan 0031 T1 is parked by owner decision: ' +
      'Stalwart v0.16.10 refuses `recurrenceRules` over JMAP while its own CalDAV path accepts ' +
      'them, so a JMAP calendar target would write a recurring series as a single event plus ' +
      'orphaned overrides — silently, since every write succeeds. Calendars travel over CalDAV.',
  },
];

/** What one domain's answer looks like. */
export interface JmapDomainCapability {
  readonly domain: JmapDomain;
  /** The capability URN this domain needs. */
  readonly urn: string;
  /** The server advertises the capability AND an account to use it with. */
  readonly serverSpeaks: boolean;
  /** A writer for this domain exists in this codebase. */
  readonly supportedByThisProduct: boolean;
  /** Both of the above. The only field a picker should gate an option on. */
  readonly usable: boolean;
  /** Why not, verbatim, when `usable` is false. Absent when it is true. */
  readonly reason?: string;
}

export interface JmapCapabilityReport {
  /** Per domain, in a stable order. */
  readonly domains: ReadonlyArray<JmapDomainCapability>;
  /** Every capability URN the session advertised, for the record. */
  readonly advertised: ReadonlyArray<string>;
}

export interface JmapCapabilityProbeConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  /** Optional well-known discovery path (default: /.well-known/jmap). */
  readonly wellKnownPath?: string;
}

interface JmapSession {
  readonly capabilities?: Record<string, unknown>;
  readonly primaryAccounts?: Record<string, string>;
}

/**
 * One HTTP request: what can this server carry?
 *
 * Throws when the session cannot be read. That is the point — see (3) in the
 * header. A caller that wants to present "we could not check" must catch this
 * and say so, rather than being handed a report of `false` it cannot
 * distinguish from a real negative.
 */
export async function probeJmapCapabilities(
  config: JmapCapabilityProbeConfig,
): Promise<JmapCapabilityReport> {
  const authHeader = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  const sessionUrl = `${config.baseUrl}${config.wellKnownPath ?? '/.well-known/jmap'}`;

  // **NOT `JamClient.loadSession`, and this is the whole reason `jmap-session.ts`
  // exists.** That helper is one line — `fetch(url, {headers}).then(r => r.json())`
  // — and it NEVER CHECKS `response.ok`. A 401 or 404 carrying a JSON body parses
  // perfectly happily, so it RESOLVES with the error document: an object with no
  // `capabilities` and no `primaryAccounts`.
  //
  // Read through this function, that document said "the server advertises
  // nothing" — the exact conflation (3) in the header exists to prevent,
  // arriving by a route a `try/catch` could never see, because the library does
  // not throw. A wrong password would have been reported to a picker as "this
  // server speaks no JMAP", sending an operator off to configure a different
  // protocol.
  //
  // Found by this file's own integration test on its first real run against
  // Stalwart; the three tests that check what the server DOES say all passed.
  // The three JMAP writers were calling `loadSession` too, so the fix moved into
  // a shared loader rather than staying here — a second copy of "check the
  // status" is a second place for it to go missing.
  //
  // The wrapping below is not ceremony. `loadJmapSession` reports what failed;
  // this function additionally has to say what that failure does NOT mean, and
  // only this caller has a reason to say it.
  let session: JmapSession;
  try {
    session = (await loadJmapSession(sessionUrl, authHeader)) as JmapSession;
  } catch (err) {
    throw unknownRatherThanNone(sessionUrl, err instanceof Error ? err.message : String(err), err);
  }

  const advertised = Object.keys(session.capabilities ?? {});
  const accounts = session.primaryAccounts ?? {};

  return {
    advertised,
    domains: DOMAIN_REQUIREMENTS.map((req) => describe(req, advertised, accounts)),
  };
}

/**
 * The one error this function raises, so every route to "I could not look"
 * says the same thing.
 *
 * The wording is load-bearing: a caller that renders this as "no JMAP here"
 * has misread it, and the message says so rather than leaving the distinction
 * to a comment nobody reads at 2am.
 */
function unknownRatherThanNone(sessionUrl: string, cause: string, err?: unknown): Error {
  return new Error(
    `Could not read the JMAP session at ${sessionUrl}, so which domains this server can carry ` +
      `is UNKNOWN — not "none". Reporting it as none would present a connection failure as a ` +
      `definitive answer about the server. Cause: ${cause}`,
    err === undefined ? undefined : { cause: err },
  );
}

function describe(
  req: (typeof DOMAIN_REQUIREMENTS)[number],
  advertised: ReadonlyArray<string>,
  accounts: Record<string, string>,
): JmapDomainCapability {
  const hasCapability = advertised.includes(req.urn);
  const hasAccount = typeof accounts[req.urn] === 'string' && accounts[req.urn] !== '';
  const missingExtras = req.alsoNeeds.filter((urn) => !advertised.includes(urn));
  const serverSpeaks = hasCapability && hasAccount && missingExtras.length === 0;

  const base = {
    domain: req.domain,
    urn: req.urn,
    serverSpeaks,
    supportedByThisProduct: req.supportedByThisProduct,
    usable: serverSpeaks && req.supportedByThisProduct,
  };
  if (base.usable) return base;

  // The reason names the FIRST thing that is actually wrong, most fundamental
  // first, because "and also…" on a server that speaks none of this is noise.
  // Both halves are reported when both are true, since an operator choosing a
  // target needs to know whether waiting for the server would help.
  const reasons: string[] = [];
  if (!hasCapability) {
    reasons.push(`the server does not advertise ${req.urn}`);
  } else if (missingExtras.length > 0) {
    reasons.push(
      `the server advertises ${req.urn} but not ${missingExtras.join(', ')}, which this ` +
        `product's connector requires`,
    );
  } else if (!hasAccount) {
    // Advertised with no account is the subtle one: it looks like support and
    // is not, because every writer here resolves its account from this map and
    // refuses rather than guessing.
    reasons.push(
      `the server advertises ${req.urn} but offers no primaryAccounts entry for it, so there is ` +
        `no account to write to — and guessing one would risk writing a customer's data into ` +
        `somebody else's account`,
    );
  }
  if (!req.supportedByThisProduct && req.unsupportedReason) {
    reasons.push(req.unsupportedReason);
  }

  return { ...base, reason: reasons.join('. ') };
}

/** The domains a picker may offer over JMAP. Convenience, so callers agree. */
export function usableJmapDomains(report: JmapCapabilityReport): ReadonlyArray<JmapDomain> {
  return report.domains.filter((d) => d.usable).map((d) => d.domain);
}
