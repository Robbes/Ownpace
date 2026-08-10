// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
/**
 * Which data types each wizard target protocol can actually receive
 * (workplan 0037 T4, ADR-0026's one-contract rule).
 *
 * Before this table existed, `carddav` + `email` (and friends) sailed through
 * the managed wizard, the API's CreateMappingSchema, and into scope_selection
 * rows the target protocol can never serve — failing later as sync errors the
 * admin cannot connect to a wizard choice. The table lives in shared because
 * TWO doors refuse the combination in the same words: the wizard constrains
 * the choice at the moment it is made, and the create API refuses it verbatim
 * for any other client. One hand-written matrix per door is one drift away
 * from the client offering what the server refuses.
 *
 * Ground truth is the engines, not aspiration:
 *  - `jmap`   — mail (JmapTargetWriter), contacts (JmapContactTarget), files
 *    (JmapFileTarget). NO calendar: workplan 0031 T1 is parked by owner
 *    decision — recurring events cannot round-trip over JMAP yet, so a JMAP
 *    calendar target would flatten a series into single events (data loss).
 *  - `imap`   — mail only (ImapFlowDavMailTarget's IMAP half).
 *  - `caldav` — calendars only; `carddav` — contacts only; `webdav` — files
 *    only (the per-domain DAV writers).
 *
 * The managed per-domain factories make the stakes concrete: they fall back
 * to carddav/webdav for any non-jmap connection kind, so an `imap` target
 * with a `contact` domain would aim a CardDAV client at an IMAP host.
 */

import type { DiscoveryDomain } from './discovery';

/** The wizard's target vocabulary (mirrors CreateMappingSchema.targetType). */
export type WizardTargetType = 'jmap' | 'imap' | 'caldav' | 'carddav' | 'webdav';

export const TARGET_TYPE_DOMAINS: Record<WizardTargetType, ReadonlyArray<DiscoveryDomain>> = {
  jmap: ['email', 'contact', 'file'],
  imap: ['email'],
  caldav: ['calendar'],
  carddav: ['contact'],
  webdav: ['file'],
};

const PROTOCOL_NAMES: Record<WizardTargetType, string> = {
  jmap: 'JMAP',
  imap: 'IMAP',
  caldav: 'CalDAV',
  carddav: 'CardDAV',
  webdav: 'WebDAV',
};

/** The selected domains the given target protocol cannot receive. */
export function incoherentTargetDomains(
  targetType: WizardTargetType,
  domains: ReadonlyArray<DiscoveryDomain>,
): DiscoveryDomain[] {
  const allowed = TARGET_TYPE_DOMAINS[targetType];
  return domains.filter((d) => !allowed.includes(d));
}

/**
 * The refusal sentence for an incoherent target/domain combination, naming
 * BOTH sides (prose boundary: rendered verbatim wherever it surfaces), or
 * null when the combination is coherent.
 */
export function targetDomainRefusal(
  targetType: WizardTargetType,
  domains: ReadonlyArray<DiscoveryDomain>,
): string | null {
  const bad = incoherentTargetDomains(targetType, domains);
  if (bad.length === 0) return null;
  const name = PROTOCOL_NAMES[targetType];
  const badList = bad.map((d) => `'${d}'`).join(', ');
  const allowedList = TARGET_TYPE_DOMAINS[targetType].map((d) => `'${d}'`).join(', ');
  const jmapCalendarNote =
    targetType === 'jmap' && bad.includes('calendar')
      ? ' There is deliberately no JMAP calendar target: recurring events cannot round-trip' +
        ' over JMAP yet, so writing calendars there would flatten a recurring series into' +
        ' single events. Use a CalDAV target for calendars.'
      : '';
  return (
    `A ${name} target cannot receive the ${badList} data type${bad.length > 1 ? 's' : ''} — ` +
    `${name} carries ${allowedList} only. Choose a target that speaks every selected data ` +
    `type, or drop the ones it cannot receive.${jmapCalendarNote}`
  );
}
