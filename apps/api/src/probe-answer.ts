// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT THE MANAGED TEST BUTTON SAYS ABOUT A HOST A TESTER TYPED (workplan 0136
 * T3).
 *
 * The Test button connects to whatever address a tester types, and it used to
 * answer with whatever came back: a DAV source put the response body into its
 * refusal, a socket error named the address it tried, and the refusal's message
 * was the answer. So the button would read aloud an HTML page, a JSON document
 * of some other kind, or the fact that a port inside our network was open, for
 * any address anybody typed.
 *
 * The probe now carries WHAT HAPPENED beside that message (`said`, sorted by
 * `whatHappened` in `@openmig/shared`), only for an address the tester typed,
 * and this is where the managed API answers from it:
 *
 * - a server that answered: its status, and its words only when they came as
 *   an error document of a kind we know (Google's, Sabre's, a WebDAV `error`, a
 *   JMAP problem document, an IMAP `NO` or `BAD` line). Anything else is said as
 *   *"with something that is not a DAV, JMAP or IMAP error"*;
 * - nothing answered: our sentence, with the outcome code `unreachable`, and no
 *   address;
 * - the rule for a host a tenant gives us (0136 T1): our sentence, with the
 *   outcome code `insideOurNetwork`, and no host;
 * - a certificate that did not verify: our sentence;
 * - anything else: our sentence, and nothing of what came back.
 *
 * THE OPERATOR KEEPS THE FULL TEXT, and hard rule 9 holds: the failure still
 * surfaces, with its category and its status. The full message goes to the
 * log under a reference, the operator's log page (0129 T1) records
 * `probe.refused` under the same reference, and every sentence said from the
 * parts ends with it. One request, one reference, however many of its answers
 * were said this way.
 *
 * A provider's fixed hosts (Graph, Google, Dropbox, Box, Apple's published
 * roots) carry no `said`, and their words render verbatim as before (workplan
 * 0080). The appliance does not come here: its only user is its owner, who
 * reads the full text.
 */

import { log, newAppEvent, recordAppEvent, type ProbeOutcome, type WhatHappened } from '@openmig/shared';
import type { ProbeResult } from '@openmig/orchestration/probe-connection';
import type {
  AccountQualification,
  QualifiedDomain,
} from '@openmig/orchestration/account-qualification';

/** The event on the operator's log page for a request answered from the parts. */
export const PROBE_REFUSED_EVENT = 'probe.refused';

/** A sentence ends with a stop, so the reference after it reads as its own. */
function stopped(sentence: string): string {
  return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** Our sentence for what happened: never the remote's bytes, never an address. */
export function whatHappenedSentence(said: WhatHappened): string {
  switch (said.kind) {
    case 'answered': {
      const who = said.protocol === 'imap' ? 'The mail server' : 'The server';
      const status = said.status === undefined ? '' : ` ${said.status}`;
      return said.providerWords === undefined
        ? `${who} answered${status} with something that is not a DAV, JMAP or IMAP error.`
        : stopped(`${who} answered${status}: ${said.providerWords}`);
    }
    case 'unreachable':
      return (
        'Nothing answered at that address: the name did not resolve, the connection was ' +
        'refused, or no answer came in time. Check the host name and the port.'
      );
    case 'certificate':
      return (
        "The server's certificate did not verify for that name, or it has expired, so the " +
        'test stopped before signing in.'
      );
    case 'insideOurNetwork':
      return (
        "That address is inside this service's own network, or the server sent the test on " +
        'to one that is, so we did not connect to it. Give the address the server has on ' +
        'the internet.'
      );
    case 'unknown':
      return 'The test failed, and what came back is not shown here. Check the address and the port.';
  }
}

/**
 * The outcome codes of our own for what happened, so a screen can say them in
 * its reader's language: `unreachable` (0136 T3) and the rule's refusal (T1).
 * Every other answer keeps the probe's code.
 */
function outcomeFor(said: WhatHappened): ProbeOutcome | undefined {
  if (said.kind === 'unreachable') return { code: 'unreachable' };
  if (said.kind === 'insideOurNetwork') return { code: 'insideOurNetwork' };
  return undefined;
}

/** The answers to one request, said from the parts under one reference. */
export interface ProbeAnswers {
  /** The probe's result as the tester is answered. */
  result(result: ProbeResult): ProbeResult;
  /** The qualification as it is stored and answered: every face said from its parts. */
  qualification(qualification: AccountQualification): AccountQualification;
}

/**
 * Answers for one request. `doing` completes the log line (*"testing a
 * connection"*); `tenantId` goes on the recorded event. The reference and the
 * event are made at the first answer said from the parts, and not at all when
 * none is.
 */
export function probeAnswers(doing: string, tenantId?: string): ProbeAnswers {
  let reference: string | undefined;
  const logged = new Set<string>();

  /** The request's reference, and the full text under it once. */
  const keep = (fullText: string): string => {
    if (reference === undefined) {
      const event = newAppEvent({
        level: 'warn',
        event: PROBE_REFUSED_EVENT,
        ...(tenantId ? { tenantId } : {}),
      });
      reference = event.reference;
      // Not awaited: `recordAppEvent` never throws, and the answer must not
      // wait on the log.
      void recordAppEvent(event);
    }
    if (!logged.has(fullText)) {
      logged.add(fullText);
      log.warn(`[probe] ${doing}: answered from its parts [ref ${reference}]: ${fullText}`);
    }
    return reference;
  };

  const face = (domain: QualifiedDomain): QualifiedDomain => {
    const { said, ...rest } = domain;
    if (said === undefined) return rest;
    const ref = keep(domain.detail);
    const sentence = whatHappenedSentence(said);
    return {
      ...rest,
      detail: `Unmeasured — ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)} Reference ${ref}.`,
    };
  };

  return {
    result(result) {
      if (result.ok) return result;
      const { said, ...rest } = result;
      if (said === undefined) return rest;
      const ref = keep(result.reason);
      return {
        ...rest,
        reason: `${whatHappenedSentence(said)} Reference ${ref}.`,
        outcome: outcomeFor(said) ?? rest.outcome,
      };
    },
    qualification(qualification) {
      const { mail, calendar, contact, file, task } = qualification.domains;
      return {
        ...qualification,
        domains: {
          mail: face(mail),
          calendar: face(calendar),
          contact: face(contact),
          file: face(file),
          task: face(task),
        },
      };
    },
  };
}
