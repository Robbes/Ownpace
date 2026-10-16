// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE MANAGED API SAYS WHEN THE NEW SYSTEM REFUSES A SHARE (workplan 0136
 * T3, a share's refusal on apply).
 *
 * Applying a share (`…/sharing/:grantId/decision`, `apply-all`,
 * `apply-folder`) asks the target's OCS endpoint, at an address a tester
 * typed, to create it. Its refusal used to be the answer: OCS's own message,
 * or the first 300 characters of the body when OCS sent none. So any address
 * named as a Nextcloud could be read aloud through the Sharing page, as the
 * Test button could before T3.
 *
 * The connector carries the refusal's parts beside its message
 * (`createNextcloudShare`, `ShareRefused`), and this is where the managed API
 * answers from them, the way `probe-answer.ts` answers a Test:
 *
 * - the tester reads OUR sentence, chosen by what failed (`shareRefusalSaid`,
 *   `@openmig/shared`), in English as `reason` and in Dutch as `reasonNl`,
 *   each ending with the reference;
 * - the operator keeps the full text: the message goes to the log once under
 *   that reference, and the operator's log page records `share.refused`
 *   under it. One request, one reference, however many rows it refused. The
 *   message is the server's reply and our prose around it; the password the
 *   share was asked with is in a header, never in it.
 *
 * The appliance does not come here: its only user is its owner, who reads the
 * full text, as T3 left a Test there.
 */

import { log, newAppEvent, recordAppEvent, shareRefusalSaid, type ShareRefused } from '@openmig/shared';

/** The event on the operator's log page for a request whose share was refused. */
export const SHARE_REFUSED_EVENT = 'share.refused';

/** A refusal as the connector returns it: the server's words, and the parts. */
export interface ShareRefusal {
  readonly reason: string;
  readonly said: ShareRefused;
}

/** A refusal as the tester is answered: our sentence, in both languages. */
export interface ShareRefusalAnswer {
  readonly ok: false;
  readonly reason: string;
  readonly reasonNl: string;
}

/**
 * Answers for one request. `doing` completes the log line (*"applying a
 * share"*). The reference and the event are made at the first refusal, and
 * not at all when nothing is refused.
 */
export function shareRefusalAnswers(
  doing: string,
  tenantId: string,
  mappingId: string,
): (refusal: ShareRefusal) => ShareRefusalAnswer {
  let reference: string | undefined;
  const logged = new Set<string>();

  return (refusal) => {
    if (reference === undefined) {
      const event = newAppEvent({ level: 'warn', event: SHARE_REFUSED_EVENT, tenantId, mappingId });
      reference = event.reference;
      // Not awaited: `recordAppEvent` never throws, and the answer must not
      // wait on the log.
      void recordAppEvent(event);
    }
    if (!logged.has(refusal.reason)) {
      logged.add(refusal.reason);
      log.warn(`[share] ${doing}: answered in our words [ref ${reference}]: ${refusal.reason}`);
    }
    const said = shareRefusalSaid(refusal.said);
    return {
      ok: false,
      reason: `${said.en} Reference ${reference}.`,
      reasonNl: `${said.nl} Referentie ${reference}.`,
    };
  };
}
