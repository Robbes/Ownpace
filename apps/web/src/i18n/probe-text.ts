// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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
 */

import type { ProbeOutcome, ProbeUnit } from '@openmig/shared';
import type { StringKey } from './strings';

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
export function probeText(t: Translate, outcome: ProbeOutcome | undefined, fallback: string): string {
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
    case 'providerRefused':
      // Theirs. Verbatim, always — this is the string somebody pastes into a
      // provider's console, and the only thing translating it could do is
      // make it useless.
      return fallback;
    default:
      return fallback;
  }
}
