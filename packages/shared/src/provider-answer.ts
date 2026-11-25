// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * WHAT A PROVIDER ANSWERED, SAID IN PLAIN WORDS (2026-11-25, workplan 0174).
 *
 * A Test of a Google account on the managed test environment printed, on the
 * Accounts page, *"Contacts: The grant carries https://www.googleapis.com/auth/carddav,
 * but the face did not answer: PROPFIND failed with status 502: <!DOCTYPE html>
 * <html lang=en> …"* and then the whole of Google's temporary error page. A
 * temporary error at Google, read as a refusal, in the remote's own bytes and
 * the product's internal words.
 *
 * So a failure at a provider's own published service (Google, Microsoft,
 * Dropbox, Cirrux) is said from its PARTS, never from its body:
 *
 * - the HTTP status, read from the refusal (`RemoteRefusal`), a `status` on the
 *   error, or the message's own `… failed with status 502` / `… answered 403`;
 * - the provider's own words ONLY when they came as an error document of a kind
 *   we know (`providerErrorWords`), or as the short line a connector already
 *   reduced a body to; never markup, never a JSON body, and capped;
 * - 5xx and 429 are a TEMPORARY error at the provider, with *test again in a
 *   minute*, and the qualification calls them `temporary`, not `refused`.
 *
 * Both languages are here, so the API's English and the screen's are one text
 * (`a-sentence-the-screen-and-the-api-word-apart`'s lesson, by construction).
 * The full message is unchanged for the operator's log and the ledger.
 */

import { PROVIDER_WORDS_CAP, RemoteRefusal, providerErrorWords } from './remote-refusal.ts';
import type { Bilingual } from './link-holder-refusals.ts';

/** The longest the provider's own words may be in a sentence a person reads. */
export const PROVIDER_ANSWER_WORDS_CAP = PROVIDER_WORDS_CAP;

/** What a provider answered, in parts a sentence may be built from. */
export type PlainFailure =
  | {
      readonly kind: 'answered';
      /** The provider's name as people know it: `Google`, `Microsoft`, `Dropbox`, `Cirrux`. */
      readonly provider: string;
      readonly status: number;
      /** Its words from a recognised error document, or a connector's short line; capped. */
      readonly words?: string;
    }
  /** The account holds no sign-in from this provider yet (the row's, or a migration's). */
  | { readonly kind: 'noSignIn'; readonly provider: string };

/** 5xx and 429: a temporary error at the provider, not a refusal. */
export function isTemporaryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Whether a failure is a temporary one at the provider. */
export function isTemporaryFailure(failure: PlainFailure | undefined): boolean {
  return failure?.kind === 'answered' && isTemporaryStatus(failure.status);
}

/** Text that is a response body rather than a line: markup, or a JSON document. */
function looksLikeABody(text: string): boolean {
  const t = text.trim();
  return t.startsWith('{') || t.startsWith('[') || /<\s*[!?/a-z]/i.test(t);
}

function capped(text: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  return flat.length > PROVIDER_ANSWER_WORDS_CAP ? `${flat.slice(0, PROVIDER_ANSWER_WORDS_CAP - 1)}…` : flat;
}

/** The words a sentence may carry from what came after the status: a known document's, or a short plain line. */
function wordsFrom(rest: string): string | undefined {
  const known = providerErrorWords(rest);
  if (known !== undefined) return capped(known);
  if (looksLikeABody(rest)) return undefined;
  return capped(rest);
}

/** The ways the connectors put a status into a message, each with where the rest begins. */
const STATUS_IN_A_MESSAGE: ReadonlyArray<RegExp> = [
  /\bfailed with status (\d{3})\b/,
  /\banswered (\d{3})\b/,
  /\bAPI (\d{3})\b/,
  /\((\d{3})\)/,
  /: (\d{3}) - /,
];

function isAStatus(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 400 && n <= 599;
}

/** The error and the causes under it, a few levels deep. */
function chain(err: unknown): unknown[] {
  const all: unknown[] = [];
  let at: unknown = err;
  for (let depth = 0; depth < 6 && at !== undefined && at !== null; depth++) {
    all.push(at);
    at = (at as { cause?: unknown }).cause;
  }
  return all;
}

/**
 * What a provider answered, read from a failure, or `undefined` when the
 * failure carries no HTTP status (a socket error, a refusal of ours).
 */
export function providerAnswerFromError(err: unknown, provider: string): PlainFailure | undefined {
  const links = chain(err);
  const refusal = links.find((e): e is RemoteRefusal => e instanceof RemoteRefusal);
  if (refusal && isAStatus(refusal.status)) {
    return {
      kind: 'answered',
      provider,
      status: refusal.status,
      ...(refusal.providerWords === undefined ? {} : { words: capped(refusal.providerWords)! }),
    };
  }
  for (const e of links) {
    const status = typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined;
    if (isAStatus(status)) return { kind: 'answered', provider, status };
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  for (const pattern of STATUS_IN_A_MESSAGE) {
    const m = pattern.exec(message);
    if (!m || !isAStatus(Number(m[1]))) continue;
    const after = message.slice(m.index + m[0].length);
    // The words follow the first `: ` after the status (or begin at once, for
    // Graph's `what: 403 - words`), and never a URL or a path before it.
    const colon = after.indexOf(': ');
    const rest = pattern.source.endsWith(' - /') ? after : colon === -1 ? '' : after.slice(colon + 2);
    const words = rest === '' ? undefined : wordsFrom(rest);
    return { kind: 'answered', provider, status: Number(m[1]), ...(words === undefined ? {} : { words }) };
  }
  return undefined;
}

/** What a provider answered to a request, from its status and body. */
export function providerAnswerFromResponse(provider: string, status: number, body: string): PlainFailure {
  const words = isTemporaryStatus(status) ? undefined : wordsFrom(body);
  return { kind: 'answered', provider, status, ...(words === undefined ? {} : { words }) };
}

/** A short plain reason for a status the provider said nothing readable about. */
function statusReason(status: number): Bilingual {
  switch (status) {
    case 400:
      return { en: 'the request was not accepted', nl: 'het verzoek is niet aanvaard' };
    case 401:
      return { en: 'the sign-in was not accepted', nl: 'de aanmelding is niet aanvaard' };
    case 403:
      return { en: 'access was refused', nl: 'de toegang is geweigerd' };
    case 404:
      return { en: 'not found', nl: 'niet gevonden' };
    default:
      return { en: 'an error', nl: 'een fout' };
  }
}

function stopped(sentence: string): string {
  return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** The sentence, in both languages: the same words for the API and the screen. */
export function plainFailureText(failure: PlainFailure): Bilingual {
  if (failure.kind === 'noSignIn') {
    const p = failure.provider;
    return {
      en:
        `This account holds no sign-in from ${p} yet, so nothing was measured. Connect it with ` +
        `${p}, or send a grant link to the person whose account it is.`,
      nl:
        `Dit account heeft nog geen aanmelding bij ${p}, dus er is niets gemeten. Verbind het met ` +
        `${p}, of stuur een toegangslink naar de persoon van wie het account is.`,
    };
  }
  const { provider: p, status } = failure;
  if (isTemporaryStatus(status)) {
    return {
      en: `${p} had a temporary error (${status}). Test again in a minute.`,
      nl: `${p} had een tijdelijke fout (${status}). Test over een minuut opnieuw.`,
    };
  }
  if (failure.words !== undefined) {
    return {
      en: stopped(`${p} answered ${status}: ${failure.words}`),
      nl: stopped(`${p} antwoordde ${status}: ${failure.words}`),
    };
  }
  const why = statusReason(status);
  return { en: `${p} answered ${status}: ${why.en}.`, nl: `${p} antwoordde ${status}: ${why.nl}.` };
}

/**
 * A failure's message with no body in it, for a sentence that has no status
 * to be said from (a socket error, a refusal of ours): cut where markup or a
 * JSON document begins, and capped.
 */
export function withoutABody(message: string): string {
  const at = message.search(/<\s*[!?a-z]|\{\s*"/i);
  const head = (at === -1 ? message : message.slice(0, at)).replace(/[\s:—-]+$/, '');
  return capped(head) ?? 'no reason was given';
}
