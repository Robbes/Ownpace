// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A REFUSAL FROM A SERVER A TENANT NAMED, IN PARTS (workplan 0136 T3).
 *
 * The managed Test button connects to a host a tester typed and says what came
 * back. It used to say it in the remote's own bytes: a DAV source's refusal put
 * the response body into its message, the message was the answer, and a socket
 * error named the address it tried. So any address a tester could name, their
 * own server or one inside our network, could be read aloud through the
 * button: an HTML error page, a JSON document of some other kind, whatever
 * answered there.
 *
 * So a refusal carries its parts beside its message:
 *
 * - the HTTP status, when the server answered over HTTP;
 * - the provider's own words, ONLY when what it sent is an error document of a
 *   kind we know, as the document itself and not as something inside another
 *   page: Google's GData `errors` or its JSON error document, a WebDAV `error`
 *   (Sabre's, which is Nextcloud's, among them), a JMAP problem document, or an
 *   IMAP `NO` or `BAD` line. Capped. Anything else has no words.
 *
 * The managed API answers from the parts (`apps/api/src/probe-answer.ts`). The
 * MESSAGE does not change: the appliance's owner reads it whole, the ledger
 * keeps it for the operator, and on managed the API logs it under the
 * reference its answer carries.
 */

import { gdataRefusalWords, sabreRefusalWords } from './dav-refusal.ts';

/** The longest the provider's own words may be in an answer. */
export const PROVIDER_WORDS_CAP = 300;

/** What kind of server answered, which decides the error documents that apply. */
export type RefusalProtocol = 'dav' | 'jmap' | 'imap';

export interface RemoteRefusalParts {
  readonly protocol: RefusalProtocol;
  /** The HTTP status, when there was one. */
  readonly status?: number;
  /** The provider's words from a recognised error document, capped; absent otherwise. */
  readonly providerWords?: string;
}

/** A server's refusal, with the parts an answer may be built from. */
export class RemoteRefusal extends Error {
  readonly protocol: RefusalProtocol;
  readonly status: number | undefined;
  readonly providerWords: string | undefined;

  constructor(message: string, parts: RemoteRefusalParts, options?: { cause?: unknown }) {
    super(message);
    // `cause` by hand, as `Error`'s own options would set it: the browser's
    // program compiles this index against ES2020, where `Error` takes one
    // argument.
    if (options !== undefined && 'cause' in options) {
      Object.defineProperty(this, 'cause', { value: options.cause, writable: true, configurable: true });
    }
    this.name = 'RemoteRefusal';
    this.protocol = parts.protocol;
    this.status = parts.status;
    this.providerWords = parts.providerWords;
  }
}

function capped(words: string): string | undefined {
  const flat = words.replace(/\s+/g, ' ').trim();
  if (flat === '') return undefined;
  return flat.length > PROVIDER_WORDS_CAP ? `${flat.slice(0, PROVIDER_WORDS_CAP - 1)}…` : flat;
}

/**
 * The root element of an XML document: its prefix, its local name, what its
 * start tag declares, and where that tag ends. Only an XML declaration and
 * comments may come before it, so a page that merely CONTAINS an error
 * document somewhere is not one. The prefix's character class leaves out `.`,
 * which is legal in an XML name and a metacharacter in the pattern built from it
 * below.
 */
const XML_ROOT =
  /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:([A-Za-z_][A-Za-z0-9_-]*):)?([A-Za-z_][A-Za-z0-9_-]*)\b([^>]*)>/;

function declares(attributes: string, prefix: string | undefined, uri: string): boolean {
  const name = prefix === undefined ? 'xmlns' : `xmlns:${prefix}`;
  return attributes.includes(`${name}="${uri}"`) || attributes.includes(`${name}='${uri}'`);
}

/**
 * The words of an XML error document we know, or `undefined`.
 *
 * - Google's GData `errors`: its code and its reason.
 * - A WebDAV `error` (RFC 4918 §16) that is Sabre's: its exception and message.
 * - Any other WebDAV `error`: the names of the conditions it holds, such as
 *   `DAV:need-privileges`, or `DAV:error` when it names none.
 */
function xmlErrorWords(body: string): string | undefined {
  const root = XML_ROOT.exec(body);
  if (!root) return undefined;
  const [tag, prefix, name, attributes = ''] = root;
  if (name === 'errors' && prefix === undefined && declares(attributes, undefined, 'http://schemas.google.com/g/2005')) {
    return gdataRefusalWords(body) || undefined;
  }
  if (name !== 'error' || !declares(attributes, prefix, 'DAV:')) return undefined;
  const sabre = sabreRefusalWords(body);
  if (sabre) return sabre;
  const inner = new RegExp(`<${prefix === undefined ? '' : `${prefix}:`}([A-Za-z][A-Za-z0-9-]*)\\b`, 'g');
  const names = [...body.slice(tag.length).matchAll(inner)].map((m) => m[1] ?? '');
  const conditions = [...new Set(names.filter((n) => n !== 'error'))];
  return conditions.length > 0 ? conditions.map((n) => `DAV:${n}`).join(', ') : 'DAV:error';
}

/**
 * Google's JSON error document, in the shape Google's APIs answer with:
 * `{"error":{"code":400,"message":"…","status":"INVALID_ARGUMENT"}}`. All three
 * fields, and the status in Google's canonical form, because `{"error":…}` alone
 * is how half the JSON on the internet refuses.
 */
function googleJsonWords(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, message, status } = error as { code?: unknown; message?: unknown; status?: unknown };
  if (typeof code !== 'number' || typeof message !== 'string' || typeof status !== 'string') return undefined;
  if (!/^[A-Z][A-Z_]*$/.test(status)) return undefined;
  return message.trim() === '' ? status : `${status} — ${message}`;
}

/** A JMAP problem document (RFC 8620 §3.6.1): a `type` in JMAP's error namespace. */
function jmapProblemWords(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { type, detail } = parsed as { type?: unknown; detail?: unknown };
  if (typeof type !== 'string' || !type.startsWith('urn:ietf:params:jmap:error:')) return undefined;
  return typeof detail === 'string' && detail.trim() !== '' ? `${type} — ${detail}` : type;
}

/**
 * The provider's own words, when a body is an error document of a kind we
 * know, capped; `undefined` for anything else, which an answer then replaces
 * with a sentence of ours.
 */
export function providerErrorWords(body: string): string | undefined {
  const xml = xmlErrorWords(body);
  if (xml !== undefined) return capped(xml);
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const words = googleJsonWords(parsed) ?? jmapProblemWords(parsed);
  return words === undefined ? undefined : capped(words);
}

/** The parts of a DAV server's refusal: its status, and its words when it sent an error document. */
export function davRefusalParts(response: { readonly status: number; readonly body: string }): RemoteRefusalParts {
  const words = providerErrorWords(response.body);
  return { protocol: 'dav', status: response.status, ...(words === undefined ? {} : { providerWords: words }) };
}

/** The parts of a JMAP server's refusal, the same way. */
export function jmapRefusalParts(response: { readonly status: number; readonly body: string }): RemoteRefusalParts {
  const words = providerErrorWords(response.body);
  return { protocol: 'jmap', status: response.status, ...(words === undefined ? {} : { providerWords: words }) };
}

/**
 * A JMAP refusal's body as the MESSAGE carries it, for the operator: a problem
 * document's type and detail, or else the first 300 characters as they came,
 * which is what the session loader always put there. `davRefusalBody`'s twin:
 * the envelope goes, and nothing else changes. An answer to a tester is built
 * from the parts instead.
 */
export function jmapRefusalBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const words = jmapProblemWords(JSON.parse(trimmed));
      if (words !== undefined) return capped(words) ?? body.slice(0, 300);
    } catch {
      // Not JSON after all: the body as it came, below.
    }
  }
  return body.slice(0, 300);
}

/**
 * An IMAP `NO` or `BAD` line in the server's words, capped: the status, the
 * response code when the server gave one (`AUTHENTICATIONFAILED`, RFC 5530),
 * and its text.
 */
export function imapRefusalWords(
  status: string | undefined,
  text: string | undefined,
  code?: string,
): string | undefined {
  if (status !== 'NO' && status !== 'BAD') return undefined;
  const bracketed = code && /^[A-Z][A-Z0-9-]*$/i.test(code) ? ` [${code}]` : '';
  return capped(`${status}${bracketed} ${text ?? ''}`);
}

/**
 * What a failed attempt comes to, for an answer that must not carry the
 * remote's bytes. `answered` holds only the parts above. The others hold
 * nothing at all, so the address a socket tried cannot ride along:
 *
 * - `unreachable`: nothing usable answered at the address;
 * - `certificate`: the server's certificate did not verify;
 * - `insideOurNetwork`: the rule for a host a tenant gives us refused it
 *   (0136 T1), the host as typed or one a redirect named;
 * - `unknown`: everything else.
 */
export type WhatHappened =
  | {
      readonly kind: 'answered';
      readonly protocol: RefusalProtocol;
      readonly status?: number;
      readonly providerWords?: string;
    }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'certificate' }
  | { readonly kind: 'insideOurNetwork' }
  | { readonly kind: 'unknown' };

/**
 * What happened, as the managed API answers it (0136 T3): the parts above,
 * and the reference the full text is logged under. The API keeps them on the
 * probe's answer and on the stored face, so a screen can say them in its
 * reader's language; they hold nothing the English sentence does not. The
 * reference is what marks the parts as an answer: a result without one, the
 * appliance's or a row stored before, renders its own text as it always did.
 */
export type WhatHappenedAnswer = WhatHappened & { readonly reference?: string };

/**
 * The code the rule's refusal carries (`HostInsideOurNetwork` in
 * `reachable-host.ts`, 0136 T1). Read as a code, not as the class: that module
 * is Node's alone, and this one is in the index the browser imports.
 */
export const HOST_INSIDE_OUR_NETWORK = 'host_inside_our_network';

/** Socket and transport codes that mean nothing usable answered at the address. */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** A certificate that did not verify, by the codes Node and OpenSSL give it. */
const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

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

/** Sort a failure into what an answer may say about it. */
export function whatHappened(err: unknown): WhatHappened {
  const links = chain(err);
  const codes = links
    .map((e) => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined))
    .filter((c): c is string => typeof c === 'string');
  if (codes.includes(HOST_INSIDE_OUR_NETWORK)) return { kind: 'insideOurNetwork' };
  const refusal = links.find((e): e is RemoteRefusal => e instanceof RemoteRefusal);
  if (refusal) {
    return {
      kind: 'answered',
      protocol: refusal.protocol,
      ...(refusal.status === undefined ? {} : { status: refusal.status }),
      ...(refusal.providerWords === undefined ? {} : { providerWords: refusal.providerWords }),
    };
  }
  if (codes.some((c) => CERTIFICATE_CODES.has(c))) return { kind: 'certificate' };
  if (codes.some((c) => UNREACHABLE_CODES.has(c))) return { kind: 'unreachable' };
  return { kind: 'unknown' };
}
