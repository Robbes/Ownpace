// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A stable Message-ID for mail that arrives without one.
 *
 * The natural key — the whole idempotency anchor (AGENTS.md hard rule 1) — is
 * the Message-ID. A message without one cannot be tracked, so the sync used to
 * skip it: never copied, never counted (until #145 counted it), and invisible
 * to both halves of the verification gate at once.
 *
 * Giving it one makes it migratable AND verifiable, but only if two properties
 * hold. Both are what this module exists to guarantee:
 *
 *  1. **Stable.** The same source message must produce the same id on every
 *     pass, forever. Derived from a sha256 of the message's original bytes —
 *     not from a UID, a timestamp, or a random value. An IMAP UID changes when
 *     a message moves folders and the whole namespace resets when UIDVALIDITY
 *     changes; either would mint a new key for a message already copied, and
 *     the next pass would copy it again.
 *
 *  2. **Readable back off the target.** The id is written INTO the message as a
 *     real `Message-ID` header, so the target reindexer — which reads keys from
 *     headers — sees exactly the key the ledger stored. A key derived but not
 *     written would migrate the message and leave it invisible to verification,
 *     which is the hole we are closing, not a smaller version of it.
 *
 * Injecting a header modifies the message. That is deliberate and is the reason
 * the caller must hash the RETURNED bytes for `content_hash`: the target stores
 * what we wrote, so checksum sampling has to compare against what we wrote.
 * Hashing the original bytes would flag every one of these as corrupt.
 */

import { createHash } from 'node:crypto';
import { headerValue } from './mail-headers.ts';

/**
 * Domain for generated ids. Not a resolvable host, and namespaced so an
 * operator reading a mailbox can tell at a glance which ids we minted.
 */
export const GENERATED_MESSAGE_ID_DOMAIN = 'generated.openmigrate.invalid';

/**
 * Does this raw message already carry a usable Message-ID header?
 *
 * Through `headerValue` since a second caller needed the same read (the
 * Subject, for the name a person recognises their mail by). The unfolding,
 * the case-insensitive match and the bound at the blank line all live there
 * now — one parser, so the two cannot disagree about where a header ends.
 */
export function readMessageId(rfc822: Uint8Array): string | undefined {
  return headerValue(rfc822, 'Message-ID');
}

/**
 * Derive the id this message would be given. Pure, and a function of the
 * message alone — so two runs, two machines, and two editions all agree.
 *
 * A hash of the message NORMALISED (ADR-0020's amendment of 2026-10-03, the
 * owner's option C), not of its raw bytes: a server that builds a message's
 * MIME when it is asked for it — Exchange, Microsoft 365's IMAP — can return
 * other bytes for the same message after an upgrade or a restore, and a key
 * that moved with them would copy the message again. See `keyMaterial` for
 * what is kept and what is left out.
 */
export function generateMessageId(rfc822: Uint8Array): string {
  const digest = createHash('sha256').update(keyMaterial(rfc822)).digest('hex');
  return `<${digest}@${GENERATED_MESSAGE_ID_DOMAIN}>`;
}

/**
 * The id this message was given before 2026-10-03: a hash of its raw bytes.
 *
 * Every copy made until then carries it in its `Message-ID`, and the ledger
 * holds it as that copy's key, so a pass asks for it when the normalised id
 * finds nothing (`asWrittenBefore`). Without that the switch itself would copy
 * every such message a second time.
 */
export function legacyGeneratedMessageId(rfc822: Uint8Array): string {
  const digest = createHash('sha256').update(rfc822).digest('hex');
  return `<${digest}@${GENERATED_MESSAGE_ID_DOMAIN}>`;
}

/**
 * Headers the SENDER writes, which no server on the way may rewrite: they are
 * what tells two messages apart, `Date` and `From` above all (ADR-0020
 * decision 4). Everything else in the header block is left out of the key:
 * `Received`, `Return-Path`, `Delivered-To`, `X-…` and the rest are added or
 * rewritten by the servers a message passes and the one that stores it.
 */
const KEYED_HEADERS = [
  'date',
  'from',
  'sender',
  'reply-to',
  'to',
  'cc',
  'subject',
  'in-reply-to',
  'references',
] as const;

/**
 * What the generated id hashes: the message with what a server may change
 * between two fetches of it taken out.
 *
 * - **Line endings** are unified to LF: a server may store LF and serve CRLF.
 * - **Headers** are the sender's own (`KEYED_HEADERS`), unfolded, in a fixed
 *   order rather than the message's (a server may reorder them), with their
 *   whitespace collapsed.
 * - **MIME boundaries** are replaced by their order of appearance: a server
 *   that rebuilds the MIME of a message mints new ones.
 * - **Trailing whitespace** at the end of each line and of the body is dropped.
 *
 * Read as latin1, so every byte maps to one character and back: the key stays a
 * function of the bytes, whatever their charset. A message with no blank line
 * after its headers is read as all body, so two such messages that differ
 * anywhere get two keys. Normalising further — decoding transfer encodings,
 * say — would risk making two different messages one, and is not done.
 */
export function keyMaterial(rfc822: Uint8Array): Buffer {
  const text = Buffer.from(rfc822).toString('latin1').replace(/\r\n?/g, '\n');
  const split = text.indexOf('\n\n');
  const headerBlock = split === -1 ? '' : text.slice(0, split);
  let body = split === -1 ? text : text.slice(split + 2);

  const fields = new Map<string, string[]>();
  for (const line of headerBlock.replace(/\n[ \t]+/g, ' ').split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!(KEYED_HEADERS as readonly string[]).includes(name)) continue;
    const value = line.slice(colon + 1).replace(/\s+/g, ' ').trim();
    fields.set(name, [...(fields.get(name) ?? []), value]);
  }

  // Every boundary the message declares, in order of first appearance, longest
  // first when replacing, so one that contains another is not cut in half.
  const boundaries: string[] = [];
  for (const m of text.matchAll(/boundary\s*=\s*"?([^";\s\n]+)"?/gi)) {
    if (!boundaries.includes(m[1]!)) boundaries.push(m[1]!);
  }
  for (const b of [...boundaries].sort((x, y) => y.length - x.length)) {
    body = body.split(b).join(`=_b${boundaries.indexOf(b)}_=`);
  }
  body = body.replace(/[ \t]+$/gm, '').replace(/\n+$/, '');

  const header = KEYED_HEADERS.flatMap((name) =>
    (fields.get(name) ?? []).map((value) => `${name}:${value}`),
  ).join('\n');
  return Buffer.from(`${header}\n\n${body}`, 'latin1');
}

/**
 * The bytes a message had before `ensureMessageId` gave it an id: the header
 * it prepended taken off again. A message whose first line is not one of our
 * generated ids is returned as it is.
 */
export function withoutGeneratedMessageId(rfc822: Uint8Array): Uint8Array {
  const head = Buffer.from(rfc822.subarray(0, 160)).toString('latin1');
  const m = /^Message-ID: <[0-9a-f]{64}@generated\.openmigrate\.invalid>(\r?\n)/.exec(head);
  return m ? rfc822.subarray(m[0].length) : rfc822;
}

/**
 * The message as a pass before 2026-10-03 wrote it, for one this pass gave an
 * id: the bytes the source served, under the id they were given then
 * (`legacyGeneratedMessageId`) instead of the one they are given now.
 *
 * A copy made then carries that id, and the ledger holds it as the copy's key.
 * So a message found under it, in the ledger or on the target, is handled as
 * it was then and written, if it must be, as it was written then: the ledger,
 * the target and verification keep naming each copy by one key.
 *
 * `undefined` for any message whose first line is not the id this pass gave
 * it, which is every message that came with a Message-ID of its own.
 */
export function asWrittenBefore(
  written: Uint8Array,
): { readonly messageId: string; readonly rfc822: Uint8Array } | undefined {
  const served = withoutGeneratedMessageId(written);
  if (served.byteLength === written.byteLength) return undefined;
  if (readMessageId(written) !== generateMessageId(served)) return undefined;
  const messageId = legacyGeneratedMessageId(served);
  return { messageId, rfc822: prependHeader(served, `Message-ID: ${messageId}`) };
}

/** Was this id one we minted? */
export function isGeneratedMessageId(messageId: string): boolean {
  return messageId.includes(`@${GENERATED_MESSAGE_ID_DOMAIN}`);
}

/** The outcome of making a message keyable. */
export interface EnsuredMessageId {
  /** The bytes to WRITE to the target. Identical to the input when nothing was added. */
  readonly rfc822: Uint8Array;
  /** The Message-ID to key by — existing or generated. */
  readonly messageId: string;
  /** True when we added the header. */
  readonly generated: boolean;
}

/**
 * Return the message with a usable Message-ID, generating one if absent.
 *
 * A message that already has one is returned byte-identical: we never rewrite
 * mail that does not need it, so the overwhelmingly common path stays a
 * verbatim copy and its content hash is unchanged.
 */
export function ensureMessageId(rfc822: Uint8Array): EnsuredMessageId {
  const existing = readMessageId(rfc822);
  if (existing) {
    return { rfc822, messageId: existing, generated: false };
  }

  const messageId = generateMessageId(rfc822);
  return { rfc822: prependHeader(rfc822, `Message-ID: ${messageId}`), messageId, generated: true };
}

/**
 * Insert a header line at the very top of the header block.
 *
 * Prepending rather than appending keeps this independent of how the message
 * ends its header section, and RFC 5322 §3.6 imposes no ordering on header
 * fields. The line ending matches the message's own: a message using bare LF
 * must not have CRLF spliced into it, or the header block is malformed for
 * anything parsing strictly.
 */
function prependHeader(rfc822: Uint8Array, headerLine: string): Uint8Array {
  const eol = usesCrLf(rfc822) ? '\r\n' : '\n';
  const prefix = new TextEncoder().encode(`${headerLine}${eol}`);
  const out = new Uint8Array(prefix.length + rfc822.length);
  out.set(prefix, 0);
  out.set(rfc822, prefix.length);
  return out;
}

/** Does the first line end with CRLF? */
function usesCrLf(rfc822: Uint8Array): boolean {
  for (let i = 0; i < rfc822.length; i++) {
    if (rfc822[i] === 0x0a) return i > 0 && rfc822[i - 1] === 0x0d;
  }
  // No line break at all: assume the RFC-correct CRLF.
  return true;
}
