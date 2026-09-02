// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A probe result in the reader's language — except the half that is not ours
 * (workplan 0080; 0068 T10d asked for exactly this).
 *
 * The owner met *Connected. 12 folders visible.* in a Dutch UI and reported
 * it. The naive fix — translate the probe result — is wrong, and the reason
 * is the whole design: half of what a probe returns is the PROVIDER's. When
 * Dropbox answers `invalid_client`, that string is the one you paste into
 * their console, and a Dutch rendering of it would be a Dutch rendering of
 * somebody else's identifier (rule 9, `docs/i18n-prose-boundary.md`).
 *
 * So the probe now says whose words these are, as a code plus data, and this
 * is where that gets read: our codes become dictionary sentences, and
 * `providerRefused` falls through to the verbatim text. A result with no
 * outcome at all — an older API, a cached response — also falls through, so
 * this can never render less than what arrived.
 *
 * `credentialsRefused` (workplan 0083) is the case that was on the wrong side
 * of that line: *dropbox source: clientId … are not set* reads like a
 * provider's error and is not one — we wrote it — so it was rendering verbatim
 * in a Dutch UI under a rule meant for somebody else's strings.
 */

import { refusalText, type ProbeOutcome, type ProbeUnit, type RefusalLocale } from '@openmig/shared';
import type { StringKey } from './strings.ts';
import { formatBytes } from './bytes.ts';

type Translate = (key: StringKey, vars?: Readonly<Record<string, string | number>>) => string;

/** The counted noun, in the right number. */
function unitWord(t: Translate, unit: ProbeUnit, count: number): string {
  const suffix = count === 1 ? 'one' : 'many';
  return t(`probe.unit.${unit}.${suffix}` as StringKey);
}

/**
 * The sentence to show for a probe result.
 *
 * `fallback` is the server's own English (`detail` or `reason`) and is what
 * comes back whenever the outcome is the provider's or is missing — never a
 * blank, and never a worse sentence than the one that arrived.
 */
export function probeText(
  t: Translate,
  outcome: ProbeOutcome | undefined,
  fallback: string,
  locale: RefusalLocale = 'en',
): string {
  if (!outcome) return fallback;
  switch (outcome.code) {
    case 'connected':
      // A count that stopped at the listing's cap is a floor, and says so.
      return t(outcome.floor ? 'probe.connected.floor' : 'probe.connected', {
        count: outcome.count,
        unit: unitWord(t, outcome.unit, outcome.count),
      });
    case 'connectedSession':
      return t('probe.connectedSession');
    case 'targetStatus':
      return `${t('probe.targetStatus', { url: outcome.url, status: outcome.status })} ${
        outcome.status === 401 ? t('probe.targetStatus.refused') : t('probe.targetStatus.check')
      }`;
    case 'noProbe':
      return t('probe.noProbe', { kind: outcome.kind });
    case 'timedOut':
      // Ours: unknown, not refused — the credentials may be fine.
      return t('probe.timedOut', { seconds: outcome.seconds });
    case 'credentialsRefused':
      // OURS, so it gets translated — the opposite of the case below, and the
      // distinction the outcome exists to carry. The field names inside the
      // sentence are still verbatim in both languages: they are the literal
      // thing the operator has to go and set (workplan 0083).
      return refusalText(outcome.refusal, locale);
    case 'providerRefused':
      // Theirs. Verbatim, always — this is the string somebody pastes into a
      // provider's console, and the only thing translating it could do is
      // make it useless.
      return fallback;
    default:
      return fallback;
  }
}

/**
 * The scheduling verdict a DAV target's probe carries (0105 T0), in the
 * reader's language. The capability is OURS — a closed code measured by one
 * OPTIONS request — so it gets dictionary sentences; a code this build does
 * not know falls back to the server's own English `sentence`, never a blank.
 * Returns null when the probe carried no verdict (a source, a mail target,
 * an older API), so callers can render nothing at all.
 */
export function schedulingText(
  t: Translate,
  scheduling: { capability: string; sentence: string } | undefined,
): string | null {
  if (!scheduling) return null;
  switch (scheduling.capability) {
    case 'auto-schedule':
      return t('probe.scheduling.autoSchedule');
    case 'none':
      return t('probe.scheduling.none');
    case 'unknown':
      return t('probe.scheduling.unknown');
    default:
      return scheduling.sentence;
  }
}

/**
 * The account's per-domain qualification (0106 T0), as one line: what the
 * last test measured this account can carry. Three marks, deliberately
 * three: ✓ and ✗ both required an ANSWER; `?` is unmeasured, and rendering
 * it as either yes or no would be the exact lie the third state exists to
 * prevent. The hint sentence rides along whenever a `?` is on the line.
 */
export function qualificationText(
  t: Translate,
  qualification:
    | {
        domains: Record<
          'mail' | 'calendar' | 'contact' | 'file',
          { answer: 'yes' | 'no' | 'unknown'; detail: string; count?: number; unit?: ProbeUnit }
        >;
      }
    | undefined,
): string | null {
  if (!qualification) return null;
  const mark = { yes: '✓', no: '✗', unknown: '?' } as const;
  const label: Record<'mail' | 'calendar' | 'contact' | 'file', StringKey> = {
    mail: 'domain.email',
    calendar: 'domain.calendar',
    contact: 'domain.contact',
    file: 'domain.file',
  };
  const order = ['mail', 'calendar', 'contact', 'file'] as const;
  // The count beside the tick, when the face was reached and listed
  // (2026-09-02): "Calendar ✓ 5 calendars" — the owner's "a bit more info
  // on the other three", on the line itself rather than in a hover a phone
  // has not got. An older record, a no and an unknown carry no count.
  const line = order
    .map((domain) => {
      const d = qualification.domains[domain];
      const counted =
        d.answer === 'yes' && d.count !== undefined && d.unit
          ? ` ${d.count} ${unitWord(t, d.unit, d.count)}`
          : '';
      return `${t(label[domain])} ${mark[d.answer]}${counted}`;
    })
    .join(' · ');
  const anyUnknown = order.some((domain) => qualification.domains[domain].answer === 'unknown');
  return `${t('probe.qualify.lead')} ${line}${anyUnknown ? ` — ${t('probe.qualify.unknownHint')}` : ''}`;
}

/**
 * The evidence behind every `?` on the line (2026-09-02), as lines to SHOW.
 *
 * The line above says "Contacts ?", and the sentence that says why — Google's
 * own, naming the API and the page since #722 — sat in a hover title. The
 * owner read the line on a phone, which has no hover, and could not learn
 * which switch to flip. A `?` is the one state whose sentence IS the remedy,
 * so its sentence goes on screen; a yes carries its count on the line and a
 * no its re-consent remedy in the matrix, neither of which needs a second
 * line here.
 *
 * The sentence is the server's evidence line: our English around the
 * provider's words, exactly as the hover had it. Not translated, for the
 * reason the hover was not — the provider's half is the string somebody
 * pastes into a console.
 */
export function qualificationEvidence(
  t: Translate,
  qualification:
    | {
        domains: Record<
          'mail' | 'calendar' | 'contact' | 'file',
          {
            answer: 'yes' | 'no' | 'unknown';
            detail: string;
            volume?: {
              items?: number;
              bytes?: number;
              estimated?: boolean;
              nativeFilesExcluded?: boolean;
              failed?: string;
            };
          }
        >;
      }
    | undefined,
): string[] {
  if (!qualification) return [];
  const label: Record<'mail' | 'calendar' | 'contact' | 'file', StringKey> = {
    mail: 'domain.email',
    calendar: 'domain.calendar',
    contact: 'domain.contact',
    file: 'domain.file',
  };
  const lines: string[] = [];
  for (const domain of ['mail', 'calendar', 'contact', 'file'] as const) {
    const d = qualification.domains[domain];
    if (d.answer === 'unknown') lines.push(`${t(label[domain])} ?: ${d.detail}`);
    // A face that answered but could not be MEASURED (2026-09-02): the
    // reason on screen too, or the Measured line simply lacks a face and
    // nobody learns why.
    else if (d.volume?.failed) {
      lines.push(`${t(label[domain])} ✓, ${t('probe.measured.failed')}: ${d.volume.failed}`);
    }
  }
  return lines;
}

type Measured = {
  domains: Record<
    'mail' | 'calendar' | 'contact' | 'file',
    {
      answer: 'yes' | 'no' | 'unknown';
      volume?: {
        items?: number;
        bytes?: number;
        estimated?: boolean;
        nativeFilesExcluded?: boolean;
        failed?: string;
      };
    }
  >;
};

/**
 * The measured-volume line (2026-09-02): how MUCH each reached face holds,
 * beside the capability line and never instead of it — *Measured: Email
 * 12,400 messages ≈ 3.2 GB · Contacts 412 cards · Files 1.8 GB (Docs, Sheets
 * and Slides not counted)*. Faces without a measure are left off the line;
 * with none at all the line is not shown. Counts are formatted for the
 * reader's locale; an extrapolated byte figure carries ≈, an exact one does
 * not, because the difference is the honesty of the number.
 */
export function measuredText(
  t: Translate,
  qualification: Measured | undefined,
  locale: RefusalLocale = 'en',
): string | null {
  if (!qualification) return null;
  const label: Record<'mail' | 'calendar' | 'contact' | 'file', StringKey> = {
    mail: 'domain.email',
    calendar: 'domain.calendar',
    contact: 'domain.contact',
    file: 'domain.file',
  };
  const numberFormat = new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-GB');
  const parts: string[] = [];
  for (const domain of ['mail', 'calendar', 'contact', 'file'] as const) {
    const v = qualification.domains[domain].volume;
    if (!v || v.failed) continue;
    const bits: string[] = [];
    if (v.items !== undefined) {
      const key: StringKey =
        domain === 'mail'
          ? v.items === 1
            ? 'probe.measured.message.one'
            : 'probe.measured.message.many'
          : domain === 'contact'
            ? v.items === 1
              ? 'probe.measured.card.one'
              : 'probe.measured.card.many'
            : v.items === 1
              ? 'probe.measured.item.one'
              : 'probe.measured.item.many';
      bits.push(t(key, { count: numberFormat.format(v.items) }));
    }
    if (v.bytes !== undefined) {
      bits.push(`${v.estimated ? '≈ ' : ''}${formatBytes(v.bytes)}`);
    }
    if (v.nativeFilesExcluded) bits.push(`(${t('probe.measured.driveNote')})`);
    if (bits.length > 0) parts.push(`${t(label[domain])} ${bits.join(' ')}`);
  }
  if (parts.length === 0) return null;
  return `${t('probe.measured.lead')} ${parts.join(' · ')}`;
}
