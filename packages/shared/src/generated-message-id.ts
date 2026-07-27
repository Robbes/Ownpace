// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

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

/**
 * Domain for generated ids. Not a resolvable host, and namespaced so an
 * operator reading a mailbox can tell at a glance which ids we minted.
 */
export const GENERATED_MESSAGE_ID_DOMAIN = 'generated.openmigrate.invalid';

/** Does this raw message already carry a usable Message-ID header? */
export function readMessageId(rfc822: Uint8Array): string | undefined {
  const header = decodeHeaderSection(rfc822);
  // Unfold first (RFC 5322 §2.2.3): a long Message-ID may be split across
  // lines, and reading only the first physical line would truncate it.
  const unfolded = header.replace(/\r?\n[ \t]+/g, ' ');
  const match = /^message-id[ \t]*:(.*)$/im.exec(unfolded);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/**
 * Derive the id this message would be given. Pure, and a function of the
 * message's bytes alone — so two runs, two machines, and two editions all agree.
 */
export function generateMessageId(rfc822: Uint8Array): string {
  const digest = createHash('sha256').update(rfc822).digest('hex');
  return `<${digest}@${GENERATED_MESSAGE_ID_DOMAIN}>`;
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

/**
 * Decode just the header section as latin1.
 *
 * Headers are ASCII by spec (non-ASCII is encoded per RFC 2047), and latin1
 * maps every byte to exactly one character — so a UTF-8 body cannot corrupt the
 * scan or shift offsets, unlike a UTF-8 decode of the whole message.
 */
function decodeHeaderSection(rfc822: Uint8Array): string {
  const end = findHeaderEnd(rfc822);
  return Buffer.from(rfc822.subarray(0, end)).toString('latin1');
}

/** Offset of the blank line separating headers from body, or the whole length. */
function findHeaderEnd(rfc822: Uint8Array): number {
  for (let i = 0; i + 1 < rfc822.length; i++) {
    // CRLFCRLF
    if (
      rfc822[i] === 0x0d &&
      rfc822[i + 1] === 0x0a &&
      rfc822[i + 2] === 0x0d &&
      rfc822[i + 3] === 0x0a
    ) {
      return i;
    }
    // LFLF (bare-LF messages, which real servers do produce)
    if (rfc822[i] === 0x0a && rfc822[i + 1] === 0x0a) return i;
  }
  return rfc822.length;
}
