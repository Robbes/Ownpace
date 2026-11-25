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
 *   minute*, and the qualification calls them `temporary`, not `refused`;
 * - and NOTHING ANSWERING AT ALL is temporary too (the same evening: a second
 *   Test said *"Files: … the face did not answer: fetch failed"*). undici's
 *   `fetch failed` carries the network's code on its `cause`, and a person
 *   reads what it means (*the connection was cut off*), never the code.
 *
 * Both languages are here, so the API's English and the screen's are one text
 * (`a-sentence-the-screen-and-the-api-word-apart`'s lesson, by construction).
 * The full message is unchanged for the operator's log and the ledger.
 */

import { PROVIDER_WORDS_CAP, RemoteRefusal, providerErrorWords, whatHappened } from './remote-refusal.ts';
import type { Bilingual } from './link-holder-refusals.ts';

/** The longest the provider's own words may be in a sentence a person reads. */
export const PROVIDER_ANSWER_WORDS_CAP = PROVIDER_WORDS_CAP;

/** Why nothing answered, as a person is told it: the network's codes, read (`NO_ANSWER`). */
export type NoAnswerCause = 'cut' | 'refused' | 'timedOut' | 'notFound' | 'noRoute';

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
  | { readonly kind: 'noSignIn'; readonly provider: string }
  /**
   * Nothing answered from the provider just now: the connection was cut off,
   * refused or timed out, or its address could not be looked up. Temporary,
   * like a 5xx: the account may be fine. `cause` is absent when undici said
   * only `fetch failed`, with no code under it.
   */
  | { readonly kind: 'unreachable'; readonly provider: string; readonly cause?: NoAnswerCause };

/** 5xx and 429: a temporary error at the provider, not a refusal. */
export function isTemporaryStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Whether a failure is a temporary one at the provider: a 5xx or 429, or no answer at all. */
export function isTemporaryFailure(failure: PlainFailure | undefined): boolean {
  if (failure?.kind === 'unreachable') return true;
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

/**
 * Node's and undici's codes for a network that did not answer, by what a
 * person is told: the codes `whatHappened` reads as `unreachable` for an
 * address a tester typed, and `throttling.ts` retries, with two more that
 * undici and Node give a connection closed under a request.
 */
const NO_ANSWER: ReadonlyMap<string, NoAnswerCause> = new Map<string, NoAnswerCause>([
  ['ECONNRESET', 'cut'],
  ['EPIPE', 'cut'],
  ['ECONNABORTED', 'cut'],
  ['UND_ERR_SOCKET', 'cut'],
  ['UND_ERR_CLOSED', 'cut'],
  ['ECONNREFUSED', 'refused'],
  ['ETIMEDOUT', 'timedOut'],
  ['UND_ERR_CONNECT_TIMEOUT', 'timedOut'],
  ['UND_ERR_HEADERS_TIMEOUT', 'timedOut'],
  ['UND_ERR_BODY_TIMEOUT', 'timedOut'],
  ['ENOTFOUND', 'notFound'],
  ['EAI_AGAIN', 'notFound'],
  ['EHOSTUNREACH', 'noRoute'],
  ['ENETUNREACH', 'noRoute'],
]);

/** Why nothing answered, from the codes on the error and the causes under it. */
function noAnswerCause(links: readonly unknown[]): NoAnswerCause | undefined {
  for (const e of links) {
    if (typeof e !== 'object' || e === null) continue;
    const code = (e as { code?: unknown }).code;
    const cause = typeof code === 'string' ? NO_ANSWER.get(code) : undefined;
    if (cause !== undefined) return cause;
    // `AbortSignal.timeout`'s DOMException, which carries a name and no code.
    if ((e as { name?: unknown }).name === 'TimeoutError') return 'timedOut';
  }
  return undefined;
}

/** undici's `fetch failed`: the `TypeError` fetch wraps every request that got no answer in. */
function isFetchFailed(e: unknown): boolean {
  return e instanceof Error && e.name === 'TypeError' && e.message === 'fetch failed';
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
 * What a provider answered, read from a failure: its status, or that nothing
 * answered at all (the network). `undefined` for anything else: a certificate
 * that did not verify, or a refusal of ours, each of which says its own
 * sentence.
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
    const rest = pattern.source.endsWith(' - ') ? after : colon === -1 ? '' : after.slice(colon + 2);
    const words = rest === '' ? undefined : wordsFrom(rest);
    return { kind: 'answered', provider, status: Number(m[1]), ...(words === undefined ? {} : { words }) };
  }
  // NOTHING ANSWERED (2026-11-25): no status anywhere, and the network's code
  // says why; or undici's bare `fetch failed` with nothing under it that is a
  // certificate, an answer, or a refusal of ours.
  const cause = noAnswerCause(links);
  if (cause !== undefined) return { kind: 'unreachable', provider, cause };
  if (links.some(isFetchFailed) && whatHappened(err).kind === 'unknown') return { kind: 'unreachable', provider };
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

/** What a person reads for each reason nothing answered. */
const NO_ANSWER_WORDS: Readonly<Record<NoAnswerCause, Bilingual>> = {
  cut: { en: 'the connection was cut off', nl: 'de verbinding werd verbroken' },
  refused: { en: 'the connection was refused', nl: 'de verbinding werd geweigerd' },
  timedOut: { en: 'no answer came in time', nl: 'er kwam niet op tijd antwoord' },
  notFound: { en: 'its address could not be looked up', nl: 'het adres kon niet worden opgezocht' },
  noRoute: { en: 'there was no network route to it', nl: 'er was geen netwerkroute naartoe' },
};

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
  if (failure.kind === 'unreachable') {
    const p = failure.provider;
    const why = failure.cause === undefined ? undefined : NO_ANSWER_WORDS[failure.cause];
    return {
      en: `${p} could not be reached just now${why === undefined ? '' : ` (${why.en})`}. Test again in a minute.`,
      nl: `${p} was zojuist niet bereikbaar${why === undefined ? '' : ` (${why.nl})`}. Test over een minuut opnieuw.`,
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
 * to be said from and is not the network (a refusal of ours, a certificate):
 * cut where markup or a JSON document begins, and capped.
 */
export function withoutABody(message: string): string {
  const at = message.search(/<\s*[!?a-z]|\{\s*"/i);
  const head = (at === -1 ? message : message.slice(0, at)).replace(/[\s:—-]+$/, '');
  return capped(head) ?? 'no reason was given';
}
