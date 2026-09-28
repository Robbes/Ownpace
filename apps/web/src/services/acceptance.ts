// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Whether the texts wait to be accepted, and accepting them (workplan 0139 T3).
 *
 * `GET /api/me` carries `acceptance` while the deployment asks
 * (`OWNPACE_STAGE=alpha` on the API) and the caller acts as an organisation:
 * each text with its current version, and whether this person accepted that
 * version there. Absent means the deployment asks nobody, and the app shows no
 * screen. The versions come from the server, never from this bundle: the texts
 * change without the web image changing, and the screen must show the numbers
 * the server will record.
 *
 * `POST /api/me/acceptance` records the versions the screen showed, in the
 * language it showed them in. A version that changed while the screen was open
 * is refused (`version_not_current`), and the screen reads the texts again.
 */

import apiClient from './api.ts';
import type { Locale } from '../i18n/strings.ts';

/** The texts a tester accepts, in the order the screen lists them. */
export const ACCEPTED_DOCUMENTS = ['alpha', 'privacy', 'terms'] as const;
export type AcceptedDocument = (typeof ACCEPTED_DOCUMENTS)[number];

export interface DocumentAcceptance {
  readonly document: AcceptedDocument;
  readonly version: string;
  readonly accepted: boolean;
}

export interface Acceptance {
  readonly due: boolean;
  readonly documents: ReadonlyArray<DocumentAcceptance>;
}

/** The refusal of a version that is no longer current. */
export const VERSION_NOT_CURRENT = 'version_not_current';

/**
 * What `GET /api/me` says about acceptance: the state, or `null` where the
 * deployment asks nobody. A failed read throws, and is never read as "nothing
 * due" (hard rule 9).
 */
export async function readAcceptance(): Promise<Acceptance | null> {
  const response = await apiClient.get<{ acceptance?: Acceptance }>('/me');
  return response.data.acceptance ?? null;
}

/** Accept the versions the screen showed, read in this language. */
export async function acceptTexts(
  documents: ReadonlyArray<DocumentAcceptance>,
  language: Locale,
): Promise<Acceptance> {
  const versions = Object.fromEntries(documents.map((d) => [d.document, d.version]));
  const response = await apiClient.post<{ written: number; acceptance: Acceptance }>('/me/acceptance', {
    versions,
    language,
  });
  return response.data.acceptance;
}

/**
 * The answer a sign-in just read, handed to `AcceptanceGate` so that the page
 * the sign-in lands on does not ask `GET /api/me` a second time a moment
 * later, and shows the screen, or the page, at once. Taken once, for the
 * organisation it was read for; a page loaded afresh has none and asks.
 */
let fromSignIn: { readonly tenantId: string; readonly acceptance: Acceptance | null; readonly at: number } | null =
  null;

/** Called with `GET /api/me`'s answer where a sign-in (or a join) just read it. */
export function rememberSignIn(me: { readonly tenantId?: string; readonly acceptance?: Acceptance }): void {
  fromSignIn = { tenantId: me.tenantId ?? '', acceptance: me.acceptance ?? null, at: Date.now() };
}

/** How long a handed answer stands for a fresh one: a sign-in lands within seconds. */
const HANDED_FOR_MS = 60_000;

/** The answer handed over for this organisation, once; `undefined` when there is none. */
export function takeSignIn(tenantId: string): { readonly acceptance: Acceptance | null; readonly at: number } | undefined {
  const handed = fromSignIn;
  fromSignIn = null;
  if (!handed || handed.tenantId !== tenantId || Date.now() - handed.at > HANDED_FOR_MS) return undefined;
  return handed;
}

/** Whether a failed accept was the server saying the versions changed. */
export function isVersionNotCurrent(err: unknown): boolean {
  const data = (err as { response?: { status?: number; data?: { error?: unknown } } })?.response;
  return data?.status === 409 && data.data?.error === VERSION_NOT_CURRENT;
}
