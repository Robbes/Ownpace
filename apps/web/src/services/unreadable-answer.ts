// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ANSWER THIS PAGE COULD NOT READ, TOLD TO THE SERVER ONCE (workplan 0145;
 * the owner's "Log it", 2026-09-29).
 *
 * `serverMessage` words the failure, and the reference in its sentence comes
 * from here, as does the report to the server. The server keeps the report
 * under that reference on the log page (`/support/log`, or the appliance's
 * own), with the detail on a line of its output; `parseUnreadableAnswer` in
 * `@openmig/shared` says what that may hold. Quoting the reference finds both,
 * and the problem report form carries it by itself (`recent-errors.ts`).
 *
 * THE PAGE NUMBERS IT, not the server: the sentence is on screen the moment
 * the read fails, and waiting for the server would leave it without a number,
 * or change the number under the reader. Made with `getRandomValues`, which
 * every page has: `randomUUID` exists only over HTTPS and on localhost, and the
 * appliance is often opened by its address on the home network.
 *
 * ONCE PER FAILURE, NOT PER RENDER: the same code at the same place on the same
 * page is the same failure, for as long as it keeps being shown and for five
 * minutes after. A screen that polls would otherwise report every few seconds,
 * and show a new number each time.
 *
 * NOTHING HERE CHANGES THE SCREEN. The report goes by `fetch`, not through
 * `apiClient`, whose interceptors sign somebody out on a 401 and open the
 * acceptance screen on a refusal. A report that fails is simply not kept, and
 * the sentence already on screen stays true. It leaves after the render that
 * showed the number, never during it.
 */

import { pageForLog, type UnreadableAnswerBody } from '@openmig/shared';
import { operatingBaseUrl } from './edition.ts';
import { uiBuild } from './build-identity.ts';
import { RECENT_ERROR_MS, rememberUnreadableAnswer } from './recent-errors.ts';

/** What the page could not read: the first issue's code, and where, as the log keeps it. */
export interface UnreadableAnswer {
  readonly code: string;
  readonly path: string;
}

/** Each failure shown, by what makes it the same one, with its number and when it was last shown. */
const shown = new Map<string, { readonly reference: string; readonly at: number }>();

/** Eight hex characters, as every reference is (`APP_EVENT_REFERENCE`). */
function newReference(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Send the report, and forget it: nothing that happens to it reaches the screen. */
function send(body: UnreadableAnswerBody): void {
  let token: string | null = null;
  try {
    token = globalThis.localStorage?.getItem('auth_token') ?? null;
  } catch {
    // Storage unavailable (private mode): sent without, as the appliance's is.
  }
  try {
    void fetch(`${operatingBaseUrl()}/unreadable-answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // No fetch at all: the report is not kept, and the sentence stands.
  }
}

/**
 * The reference this failure is shown with: the one it already had, or a new
 * one, sent to the server once.
 */
export function referenceFor(found: UnreadableAnswer, now: number = Date.now()): string {
  for (const [key, entry] of shown) if (now - entry.at > RECENT_ERROR_MS) shown.delete(key);
  const where = (globalThis as unknown as { location?: { pathname?: string } }).location;
  const page = pageForLog(where?.pathname ?? '/');
  const key = `${found.code} ${found.path} ${page}`;
  const known = shown.get(key);
  const reference = known?.reference ?? newReference();
  shown.set(key, { reference, at: now });
  rememberUnreadableAnswer(reference, now);
  if (!known) {
    const build = uiBuild();
    const body: UnreadableAnswerBody = {
      reference,
      code: found.code,
      path: found.path,
      page,
      build: { version: build.version, commit: build.commit },
    };
    queueMicrotask(() => send(body));
  }
  return reference;
}

/** Forget every failure shown: on signing out, and on signing in, as the faults are. */
export function forgetUnreadableAnswers(): void {
  shown.clear();
}
