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
