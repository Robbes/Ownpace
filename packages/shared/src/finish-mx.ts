// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MX CHECK ON FINISH, read into one of four lines (workplan 0171 §7.3,
 * T10; the owner's D8 (a)).
 *
 * `verifyMX` (`packages/core/src/dns-verify-only.ts`) asks three public
 * DNS-over-HTTPS resolvers. This file says what their answers mean for the
 * person on Finish's step 4, and nothing else: it does no network.
 *
 *   ok        every host found is one of the destination's known MX hosts
 *   old       every host found is one of the old provider's known MX hosts
 *   other     found, and neither: shown for the person to judge
 *   disagree  fewer than two resolvers answered, or they answered differently
 *
 * Two more outcomes are not lines but are said as they are, never folded into
 * one of the four (hard rule 9): no resolver could be asked (`unreadable`),
 * and the resolvers agree there is no MX record at all (`none`).
 *
 * THE KNOWN HOSTS ARE A SHORT LIST ON PURPOSE (D8 (a): *"the list of known
 * hosts starts short"*). Each entry is a provider's own published value, cited
 * beside it with the day it was read, as `address-forms.ts` cites its domains;
 * nothing is added from memory. A destination not on the list is never called
 * right or wrong: its hosts are shown and the person judges. The one rule
 * beside the list is a destination the person runs themselves (Stalwart, any
 * JMAP or IMAP server): an MX host on the same domain as the destination's own
 * mail host is that destination's.
 */

/** One provider's published MX hosts, matched on whole labels. */
export interface KnownMx {
  readonly provider: string;
  /** Host suffixes: a host equal to one, or ending in `.` + one, matches. */
  readonly mx: readonly string[];
  /** Where the destination's mail host ends, so a connection can be placed. */
  readonly mailHosts?: readonly string[];
  /** Connection kinds that are this provider. */
  readonly kinds?: readonly string[];
  readonly source: { readonly url: string; readonly seen: string };
}

/**
 * Destinations whose MX hosts a published page states.
 *
 * Soverin, Infomaniak and mailbox.org are named by §7.3 and are not here yet:
 * their pages could not be read on the day this list was written, so their
 * hosts are shown for the person to judge until somebody reads and cites them.
 */
export const DESTINATION_MX: ReadonlyArray<KnownMx> = Object.freeze([
  {
    provider: 'Cirrux',
    // Cirrux help, "Domains & DNS", https://cirrux.co/help/domains, read
    // 2026-11-24: "You need two MX records: a primary server and a backup",
    // `smtp.cirrux.co.` at priority 10 and `mx-fallback.cirruxmail.com.` at 20.
    mx: ['smtp.cirrux.co', 'mx-fallback.cirruxmail.com'],
    mailHosts: ['cirrux.co'],
    kinds: ['cirrux'],
    source: { url: 'https://cirrux.co/help/domains', seen: '2026-11-24' },
  },
]);

/**
 * Old providers whose MX hosts a published page states, by source family.
 *
 * Google is not here yet: its page could not be read on the day this list was
 * written, so MX still at Google reads as `other`, shown for the person to
 * judge, never as `ok`.
 */
export const OLD_PROVIDER_MX: Readonly<Partial<Record<'microsoft' | 'google', KnownMx>>> = Object.freeze({
  microsoft: {
    provider: 'Microsoft',
    // Microsoft Learn, "How to set up a multifunction device or application to
    // send email using Microsoft 365 or Office 365",
    // https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365,
    // read 2026-11-24, of the domain's MX value: "This value uses the syntax
    // `<YourCustomDomain>-com.mail.protection.outlook.com`".
    mx: ['mail.protection.outlook.com'],
    source: {
      url: 'https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/how-to-set-up-a-multifunction-device-or-application-to-send-email-using-microsoft-365-or-office-365',
      seen: '2026-11-24',
    },
  },
});

/** Whether `host` is `suffix` or a host under it, on whole labels. */
export function hostUnder(host: string, suffix: string): boolean {
  const h = host.toLowerCase();
  const s = suffix.toLowerCase();
  return h === s || h.endsWith(`.${s}`);
}

/** An MX record's host, from a DoH answer's `"10 mx.example.net."`. */
export function mxHostOf(record: string): string {
  const parts = record.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? '').replace(/\.$/, '').toLowerCase();
}

/** The MX hosts the destination is known by, and the name the screen says. */
export interface DestinationMx {
  readonly name: string;
  readonly mx: readonly string[];
}

/**
 * The destination's known MX hosts: a listed provider, by its kind or its mail
 * host; otherwise the domain of the destination's own mail host (a server the
 * person runs, D8); otherwise nothing, and its hosts are shown to be judged.
 */
export function destinationMx(kind: string, mailHost: string | undefined): DestinationMx | undefined {
  const host = mailHost?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  const listed = DESTINATION_MX.find(
    (d) => (d.kinds ?? []).includes(kind) || (host !== '' && (d.mailHosts ?? []).some((m) => hostUnder(host, m))),
  );
  if (listed) return { name: listed.provider, mx: listed.mx };
  if (host === '' || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return undefined;
  const labels = host.split('.');
  // The host's own domain: `mail.example.net` is known by `example.net`; a host
  // of two labels is its own domain.
  const domain = labels.length > 2 ? labels.slice(1).join('.') : host;
  return { name: host, mx: [domain] };
}

/** One resolver's answer, as `verifyMX` reports it. */
export interface MxResolverAnswer {
  readonly success: boolean;
  readonly records: readonly string[];
  readonly error?: string;
}

/** What the screen shows: one of the four lines, or one of the two outcomes beside them. */
export type MxReading =
  | { readonly line: 'ok'; readonly hosts: readonly string[]; readonly destination: string }
  | { readonly line: 'old'; readonly hosts: readonly string[]; readonly provider: string }
  | { readonly line: 'other'; readonly hosts: readonly string[] }
  | { readonly line: 'disagree'; readonly hosts: readonly string[] }
  | { readonly line: 'none' }
  | { readonly line: 'unreadable'; readonly reasons: readonly string[] };

/**
 * The four lines from `verifyMX`'s per-resolver answers.
 *
 * Read per resolver, not from `found`, which is the union: two resolvers that
 * each answer a different host are a domain mid-change, and the union would
 * show both as if settled.
 */
export function mxReadingOf(
  resolverResults: Readonly<Record<string, MxResolverAnswer>>,
  destination: DestinationMx | undefined,
  old: KnownMx | undefined,
): MxReading {
  const all = Object.values(resolverResults);
  const answered = all.filter((r) => r.success && r.records.length > 0);
  const failed = all.filter((r) => r.error !== undefined);
  if (answered.length === 0) {
    // Every resolver failed: nothing was read. Asked and answered with no
    // record: the domain has none, said as such, never as "disagree".
    if (all.length === 0 || failed.length === all.length) {
      return { line: 'unreadable', reasons: failed.map((r) => r.error ?? '') };
    }
    return failed.length > 0 && all.length - failed.length < 2
      ? { line: 'disagree', hosts: [] }
      : { line: 'none' };
  }
  const sets = answered.map((r) => [...new Set(r.records.map(mxHostOf))].filter((h) => h !== '').sort());
  const hosts = [...new Set(sets.flat())].sort();
  const first = JSON.stringify(sets[0]);
  if (answered.length < 2 || sets.some((s) => JSON.stringify(s) !== first)) {
    return { line: 'disagree', hosts };
  }
  const every = (known: readonly string[]) => hosts.every((h) => known.some((k) => hostUnder(h, k)));
  if (destination && every(destination.mx)) return { line: 'ok', hosts, destination: destination.name };
  if (old && every(old.mx)) return { line: 'old', hosts, provider: old.provider };
  return { line: 'other', hosts };
}

/**
 * One MX check per mapping per ten seconds (§7.3): the button is pressed by a
 * person, and three public resolvers are not ours to hammer. In memory, per
 * process; a restart forgets it, which costs one extra check.
 */
export class MxCheckPace {
  private readonly last = new Map<string, number>();
  private readonly everyMs: number;

  constructor(everyMs = 10_000) {
    this.everyMs = everyMs;
  }

  /** Milliseconds to wait before `key` may check again, or 0 and the check is counted. */
  take(key: string, now: number = Date.now()): number {
    const at = this.last.get(key);
    if (at !== undefined && now - at < this.everyMs) return this.everyMs - (now - at);
    this.last.set(key, now);
    return 0;
  }
}
