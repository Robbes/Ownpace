// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * DOES THIS TARGET SCHEDULE? Measured, never assumed (0103 T3, ADR-0043).
 *
 * RFC 6638 §2.1 requires a server that implements calendar auto-scheduling to
 * advertise the compliance class `calendar-auto-schedule` in the `DAV:`
 * response header. That is the one question a migration can ask a customer's
 * target with NOTHING but the API and no side effects: one OPTIONS request,
 * no object written, no mail risked — which matters, because the only
 * stronger measurement (an owner-as-organiser canary with a live attendee)
 * risks sending the exact mail this whole workplan exists to prevent.
 *
 * What the answer means for a migration into that target:
 *
 *   - `auto-schedule`: the server WILL act on ATTENDEE/ORGANIZER unless told
 *     not to. T1's SCHEDULE-AGENT=CLIENT and T5's Schedule-Reply: F are the
 *     telling; both are RFC-defined on this same compliance class, so a
 *     server honest enough to advertise it is expected to honour them.
 *   - `none`: no scheduling engine is advertised. Fan-out cannot happen
 *     through RFC 6638 on this target.
 *   - `unknown`: the target did not answer OPTIONS usefully. Not a verdict —
 *     report it as unmeasured, never as safe (the run-#6 lesson: a check
 *     that could not run is not a check that passed).
 */

import type { HttpClient } from './dav-http.types.ts';

export type CaldavSchedulingCapability = 'auto-schedule' | 'none' | 'unknown';

/** One OPTIONS request against a calendar collection or home set URL. */
export async function detectCaldavScheduling(
  url: string,
  authorization: string,
  httpClient: HttpClient,
): Promise<CaldavSchedulingCapability> {
  try {
    const response = await httpClient.request({
      method: 'OPTIONS',
      url,
      headers: { Authorization: authorization },
    });
    if (response.status < 200 || response.status >= 400) return 'unknown';
    // Header lookup is case-insensitive by HTTP; the transport may hand back
    // either casing, and the value is a comma-separated compliance list.
    const dav = Object.entries(response.headers ?? {}).find(([k]) => k.toLowerCase() === 'dav')?.[1];
    if (!dav) return 'unknown';
    return /(^|,)\s*calendar-auto-schedule\s*(,|$)/i.test(dav) ? 'auto-schedule' : 'none';
  } catch {
    return 'unknown';
  }
}
