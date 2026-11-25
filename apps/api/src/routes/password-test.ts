// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A PASSWORD TYPED ON A GRANT LINK, TESTED AS THE CREATE DOOR TESTS IT
 * (workplan 0174 §5.4, T3).
 *
 * The test is the create door's, never a second implementation: the probe
 * (`probeSourceConnection` / `probeTargetConnection`), then `qualifyAccount`
 * for each face the person's migrations on that account need, on the merged
 * config and credentials (the owner's config, the stored keys, the person's
 * values over them).
 *
 * `ok` only when the probe is ok AND no needed face answers `no`. A face that
 * answers `unknown` is not a refusal: the probe's own verdict stands, as at
 * the door. Three categories, and nothing else leaves this module about a
 * failure (§5.7: the owner, and the person, see the category, never the
 * server's words):
 *
 * - `refused_login`: the server answered and refused the credentials. Read
 *   from the probe's `refusedLogin`, which the probe sets from the error
 *   itself (`loginWasRefused`): an IMAP NO to LOGIN, an HTTP 401, Apple
 *   refusing an Apple Account password. The only category that counts a try
 *   (D4).
 * - `unreachable`: everything else that failed before a login was judged: no
 *   answer, TLS, a timeout, a 404 at the DAV address the owner typed, a
 *   refusal of ours. "This is not your password", and no try counted: a down
 *   server, or the owner's own typing, must not lock the person out.
 * - `face_missing`: the login worked and a needed face answered a measured
 *   `no` (Infomaniak's mail with an app password). A face that is not this
 *   kind's at all (`structural`: Apple's iCloud Drive) or that is another
 *   grant's (`notGranted`: Cirrux Drive, asked by its own sign-in card, 0174
 *   §4.4) is not the password's to answer, and is left out.
 *
 * The difference from the create door is deliberate (§5.4): the door stores a
 * failing row so the owner can fix it; a link stores nothing that failed.
 *
 * THE PASSWORD GOES NOWHERE FROM HERE. The probe's failure is passed through
 * `probeAnswers`, which logs the full text under a reference and answers
 * from its parts (0136 T3); this module returns a category, the faces, and
 * the secret to store, and logs nothing. Whether an error's text can carry
 * the password: imapflow sends LOGIN's password as a `sensitive` argument and
 * its `executedCommand` reads `(* value hidden *)`; the DAV and JMAP clients
 * put the URL, the status and the body in their errors, never a header. The
 * guard `a-password-the-link-never-says` holds the route to it.
 */

import type { AccountQualification, QualifiedDomain } from '@openmig/orchestration/account-qualification';
import { qualifyAccount } from '@openmig/orchestration/account-qualification';
import {
  probeSourceConnection,
  probeTargetConnection,
  type ProbeResult,
} from '@openmig/orchestration/probe-connection';
import type { DiscoveryDomain, WizardTargetType } from '@openmig/shared';
import type { ProbeAnswers } from '../probe-answer.ts';
import type { PasswordTest, PasswordTestInput } from './grant-providers.ts';

/** The faces a qualification names, by the discovery vocabulary's name. */
const QUALIFIED_FACE: Readonly<Record<DiscoveryDomain, keyof AccountQualification['domains']>> = {
  email: 'mail',
  calendar: 'calendar',
  contact: 'contact',
  file: 'file',
  task: 'task',
};

/** What the test needs from outside, so a unit test records the servers rather than reaching them. */
export interface PasswordTestDeps {
  readonly probeSource: typeof probeSourceConnection;
  readonly probeTarget: typeof probeTargetConnection;
  readonly qualify: typeof qualifyAccount;
}

const REAL: PasswordTestDeps = {
  probeSource: probeSourceConnection,
  probeTarget: probeTargetConnection,
  qualify: qualifyAccount,
};

/** The test's answer, and what the route remembers on the connection when it stores. */
export interface PasswordTestRun {
  readonly test: PasswordTest;
  /** The qualification as answered (`probeAnswers`), when one was taken. */
  readonly qualification?: AccountQualification;
}

/** The category of a probe that failed (§5.4): only the server refusing the login is `refused_login`. */
export function categoryOfProbe(probe: Extract<ProbeResult, { ok: false }>): 'refused_login' | 'unreachable' {
  return probe.refusedLogin === true ? 'refused_login' : 'unreachable';
}

/**
 * Whether a measured face refuses the password (§5.4): a `no` that is not a
 * fact of the kind (`structural`) and not another grant's (`notGranted`).
 */
function refusesThePassword(face: QualifiedDomain): boolean {
  return face.answer === 'no' && face.reason !== 'structural' && face.reason !== 'notGranted';
}

/**
 * The secret this test stores (§5.3 step 7): the keys the person gave, only.
 * The owner's keys stay where they are; the merge happens at the write.
 */
function personsSecret(credentials: Readonly<Record<string, string>>, personKeys: ReadonlyArray<string>) {
  return Object.fromEntries(personKeys.filter((k) => typeof credentials[k] === 'string').map((k) => [k, credentials[k]!]));
}

/**
 * Run the test. `personKeys` names the keys the person typed, which are the
 * secret an `ok` hands back; `answers` says a refusal from its parts and is
 * the request's own (0136 T3).
 */
export async function runPasswordTest(
  input: PasswordTestInput,
  personKeys: ReadonlyArray<string>,
  answers: ProbeAnswers,
  deps: PasswordTestDeps = REAL,
): Promise<PasswordTestRun> {
  const config = { ...input.config };
  const creds = { ...input.credentials };
  const raw =
    input.role === 'target'
      ? await deps.probeTarget(input.kind as WizardTargetType, config, creds)
      : await deps.probeSource(input.kind, config, creds);
  // Said from its parts, the full text logged under a reference: never
  // returned from here, and never the password (see the header).
  const probe = answers.result(raw);
  if (!probe.ok) return { test: { ok: false, category: categoryOfProbe(probe) } };

  let qualification: AccountQualification | undefined;
  try {
    const measured = await deps.qualify(input.kind, config, creds);
    qualification = measured === undefined ? undefined : answers.qualification(measured);
  } catch {
    // As at the door: a qualification that could not be taken never fails
    // the test, and the probe's verdict stands. Not logged here: the error
    // was raised with this request's credentials in hand, and the door's own
    // log line names nothing this one could add.
    qualification = undefined;
  }

  const needed = input.faces.filter((f) => !(input.kind === 'cirrux' && f === 'file'));
  const refused = qualification
    ? needed.filter((f) => refusesThePassword(qualification!.domains[QUALIFIED_FACE[f]]))
    : [];
  if (refused.length > 0) {
    return { test: { ok: false, category: 'face_missing', faces: refused }, ...(qualification ? { qualification } : {}) };
  }
  return {
    test: { ok: true, secret: personsSecret(creds, personKeys), faces: needed },
    ...(qualification ? { qualification } : {}),
  };
}

/**
 * `PasswordGrant.test` (§5.1): the same run, its answer only. The person's
 * keys are the ones the input carries over what the owner stored; the seam's
 * shape names none, so every credential key is handed back and the store
 * merges it over the same values. The route calls `runPasswordTest` itself,
 * with the keys and the request's answers.
 */
export async function testPassword(input: PasswordTestInput, answers: ProbeAnswers): Promise<PasswordTest> {
  return (await runPasswordTest(input, Object.keys(input.credentials), answers)).test;
}
