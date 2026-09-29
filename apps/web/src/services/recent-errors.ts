// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE FAULTS THIS PAGE MET, AS A REPORT MAY CARRY THEM (workplan 0130 T6,
 * Part B; the owner's "Both parts", 2026-09-28).
 *
 * A "Something went wrong" answers with a reference (`serverFault` in the
 * API): *"… Reference 1a2b3c4d; quoting it finds the detail in the server
 * log."* It sits only inside that sentence, and somebody reporting the
 * problem had to copy it out by hand. So the web app's clients hand every
 * fault they meet to {@link rememberFault}, and the report form offers the
 * ones from the five minutes before it was opened.
 *
 * ONLY TWO WORDS OF A FAULT ARE KEPT: its reference and its code
 * (`list_failed`), each read in its own shape, and when it was met. Never the
 * error itself. What axios rejects with holds the whole request that met the
 * fault: its `config` carries the `Authorization` header with the sign-in
 * token, its address can carry a query, and its body and the answer's other
 * fields are whatever they were. Keeping the error, or anything read loosely
 * from it, is how a token ends up in a mail to support.
 *
 * In memory only, the newest {@link RECENT_ERRORS_KEPT}, each reference once,
 * and forgotten when the person signs out or anybody signs in
 * (`stores/auth-store.ts`): the faults are one session's, and a report is the
 * person's who is signed in.
 *
 * A fault here is an answer from 500 up whose body names a reference: a
 * refusal (4xx) is the person's to read, not a fault of ours, and a request
 * that got no answer has no reference to give. Or an answer the page could not
 * read, under the reference the page showed with it
 * ({@link rememberUnreadableAnswer}, workplan 0145).
 */

import { APP_EVENT_REFERENCE } from '@openmig/shared';

/** How long a fault counts as recent: five minutes. */
export const RECENT_ERROR_MS = 5 * 60_000;
/** How many are kept: the newest three. */
export const RECENT_ERRORS_KEPT = 3;

/** A fault as a report carries it. */
export interface RecentError {
  readonly reference: string;
  /** The API's code for it (`list_failed`), or `unknown` when it named none this reads. */
  readonly code: string;
}

/** The reference inside the sentence `serverFault` answers with. */
const REFERENCE_IN_SENTENCE = /\bReference ([0-9a-f]{8})\b/;
/** A code as `serverFault` names one; the API holds a report's to the same shape. */
const CODE = /^[a-z][a-z0-9_]{0,47}$/;

const kept: Array<RecentError & { readonly at: number }> = [];

/**
 * Keep a fault's reference and code, when `err` is an answer from 500 up whose
 * body names a reference; nothing otherwise. Reads the answer's status and
 * body only, and never the request.
 */
export function rememberFault(err: unknown, now: number = Date.now()): void {
  if (typeof err !== 'object' || err === null) return;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return;
  const { status, data } = response as { status?: unknown; data?: unknown };
  if (typeof status !== 'number' || status < 500) return;
  if (typeof data !== 'object' || data === null) return;
  const { error, reason, message } = data as { error?: unknown; reason?: unknown; message?: unknown };
  const said = typeof reason === 'string' ? reason : typeof message === 'string' ? message : '';
  const reference = REFERENCE_IN_SENTENCE.exec(said)?.[1];
  if (!reference || !APP_EVENT_REFERENCE.test(reference)) return;
  const code = typeof error === 'string' && CODE.test(error) ? error : 'unknown';
  keep(reference, code, now);
}

/** The code an answer the page could not read is kept under. */
export const UNREADABLE_ANSWER_CODE = 'answer_unreadable';

/**
 * Keep the reference an answer the page could not read was shown with
 * (workplan 0145): a fault of ours as well, and one the page numbered rather
 * than the server (`unreadable-answer.ts`), so a report carries it too.
 */
export function rememberUnreadableAnswer(reference: string, now: number = Date.now()): void {
  if (APP_EVENT_REFERENCE.test(reference)) keep(reference, UNREADABLE_ANSWER_CODE, now);
}

/** Newest first, each reference once, the newest {@link RECENT_ERRORS_KEPT}. */
function keep(reference: string, code: string, now: number): void {
  const again = kept.findIndex((e) => e.reference === reference);
  if (again !== -1) kept.splice(again, 1);
  kept.unshift({ reference, code, at: now });
  kept.length = Math.min(kept.length, RECENT_ERRORS_KEPT);
}

/** The faults met in the {@link RECENT_ERROR_MS} before `now`, newest first. */
export function recentErrors(now: number = Date.now()): RecentError[] {
  return kept
    .filter((e) => now - e.at <= RECENT_ERROR_MS && e.at <= now)
    .map(({ reference, code }) => ({ reference, code }));
}

/** Forget every fault: on signing out, and on signing in. */
export function forgetRecentErrors(): void {
  kept.length = 0;
}

/**
 * TEST SEAM ONLY: what the ring holds, entry by entry, as it holds it. The
 * guard holds each entry to its three fields: a ring that kept the request
 * and only handed out the two words would still keep the token.
 */
export function __keptForTests(): ReadonlyArray<Readonly<Record<string, unknown>>> {
  return kept.map((entry) => ({ ...entry }));
}
