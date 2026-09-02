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
      return t('probe.connected', {
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
