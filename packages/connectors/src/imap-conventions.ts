// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The conventions this product uses over IMAP, independent of any IMAP client.
 *
 * Every function here was previously exported from `imap-source.ts` or
 * `imap-dav-target.ts` — the two `imap-simple` connectors — so that their
 * `imapflow` replacements could call exactly the same code rather than a
 * transcription of it (workplan 0032 T1/T2). Workplan 0032 T3b deletes those
 * two files, and these had to move somewhere before that could happen.
 *
 * They are gathered here rather than folded into the two `imapflow` files
 * because **half of them are needed by both sides**, and the two sides are
 * inverses of each other: `mapImapFlagsToKeywords` and `KEYWORD_TO_FLAG` are
 * the same table read in opposite directions, and `messageIdFromEnvelopeValue`
 * and `extractMessageIdFromRfc822` are two ends of one decision about angle
 * brackets. Splitting a convention across two files is how the halves drift.
 *
 * **Nothing here knows what an IMAP client is.** No import from `imapflow`, no
 * import from `imap-simple`, no connection, no I/O — these are pure functions
 * over values a client has already handed back. That is deliberate and worth
 * keeping: it is what made them shareable in the first place, and what makes
 * the next client swap a smaller job than this one.
 *
 * @see docs/workplans/0032-imapflow-migration.md — T3b
 */

import type { DownloadMeter, SyncCursor, TokenProvider, MailKeyword, SpecialUse } from '@openmig/shared';

/**
 * The daily download meter an IMAP source spends against (workplan 0090 T3).
 *
 * The shared `DownloadMeter` shape under the connector's own name: the budget
 * is keyed by (tenant, provider) — a provider-endpoint limit is shared by
 * every mapping a tenant runs against it — so the connector carries the two
 * key halves alongside the budget rather than inventing its own. Optional
 * everywhere: a server with no ceiling gets no meter, and a meter invented
 * for it would only make migrations mysteriously slow.
 */
export type ImapByteMeter = DownloadMeter;

/**
 * Configuration for IMAP connection.
 */
export interface ImapSourceConfig {
  host: string;
  port: number;
  tls: boolean;
  auth: {
    user: string;
    password?: string;
    accessToken?: string; // For XOAUTH2
  };
  authType?: 'LOGIN' | 'XOAUTH2';
  /**
   * Verify the server certificate. Unset means TRUE — same default as
   * `ImapDavTargetConfig` below, and for the same reason: this connection
   * carries a mailbox password or an OAuth token, and an unverified TLS
   * socket hands both to whoever answers first. `false` is for a dev server
   * with a self-signed certificate, and is a per-config decision, never a
   * default.
   */
  rejectUnauthorized?: boolean;
}

/**
 * Extended configuration for IMAP connection with TokenProvider support.
 */
export interface ImapSourceConfigWithTokenProvider extends ImapSourceConfig {
  tokenProvider?: TokenProvider;
  /** Spent on every fetched body — absent means the endpoint has no ceiling. */
  byteMeter?: ImapByteMeter;
}

/**
 * Configuration for IMAP target connection.
 */
export interface ImapDavTargetConfig {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  rejectUnauthorized?: boolean; // For self-signed certs in dev
}

/**
 * Cursor encoding for IMAP: "UIDVALIDITY:UIDNEXT"
 */
export function encodeImapCursor(uidValidity: number, uidNext: number): string {
  return `${uidValidity}:${uidNext}`;
}

export function decodeImapCursor(cursor: SyncCursor): {
  uidValidity: number;
  uidNext: number;
} {
  const parts = cursor.value.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid IMAP cursor format: ${cursor.value}`);
  }
  const uidValidity = parseInt(parts[0]!, 10);
  const uidNext = parseInt(parts[1]!, 10);
  if (isNaN(uidValidity) || isNaN(uidNext)) {
    throw new Error(`Invalid IMAP cursor format: ${cursor.value}`);
  }
  return { uidValidity, uidNext };
}

/**
 * Map IMAP system flags to our MailKeyword type.
 *
 * The read half of the same table `KEYWORD_TO_FLAG` writes. A second copy of
 * either that drifted would show up as a lost flag on every message the two
 * sides disagreed about — the message is there, the count is right, and the
 * owner's unread state is wrong.
 */
export function mapImapFlagsToKeywords(flags: string[]): MailKeyword[] {
  const keywords: MailKeyword[] = [];
  for (const flag of flags) {
    const lower = flag.toLowerCase();
    if (lower === '\\seen') keywords.push('$seen');
    else if (lower === '\\flagged') keywords.push('$flagged');
    else if (lower === '\\draft') keywords.push('$draft');
    else if (lower === '\\answered') keywords.push('$answered');
  }
  return keywords;
}

/**
 * Map our MailKeyword to IMAP flags.
 *
 * The write half of `mapImapFlagsToKeywords`. See there.
 */
export const KEYWORD_TO_FLAG: Record<MailKeyword, string> = {
  $seen: '\\Seen',
  $flagged: '\\Flagged',
  $draft: '\\Draft',
  $answered: '\\Answered',
};

/**
 * Map IMAP special-use attributes to our SpecialUse type.
 *
 * **Reads the SERVER's own RFC 6154 flags and nothing else.** `imapflow` also
 * offers name-based inference — matching folder names against localised tables
 * — and workplan 0032 T1 deliberately switched it off: adopting it would change
 * which folders `excludeSpecialUse` keeps out of a migration, and which folder
 * the §11.1 deletion signal reads as the owner's bin, on servers that never
 * said so. That is owner-visible and does not belong inside a client swap.
 */
export function mapImapSpecialUse(attributes: string[]): SpecialUse {
  for (const attr of attributes) {
    const lower = attr.toLowerCase();
    if (lower === '\\inbox') return 'inbox';
    if (lower === '\\sent') return 'sent';
    if (lower === '\\drafts') return 'drafts';
    if (lower === '\\archive') return 'archive';
    if (lower === '\\junk' || lower === '\\spam') return 'junk';
    if (lower === '\\trash' || lower === '\\deleted') return 'trash';
  }
  return 'normal';
}

/**
 * An ENVELOPE's message-id as `MailItem.messageId` — angle brackets included.
 *
 * **The single most load-bearing line on the IMAP read path, and the reason
 * workplan 0032 had a parity harness at all.** `naturalKeyForItem()` hashes
 * this string, so if two clients produce different forms of it, every message
 * re-copies on the next pass and every write succeeds while it happens (hard
 * rule 1). No count is wrong and no error is raised — the mailbox is simply
 * twice its size.
 *
 * Note what sharing this bought and what it deliberately did not. It removed
 * the risk of OUR logic drifting between two files; it did NOT paper over a
 * difference in what the two CLIENTS handed in, because different input still
 * gives different output. That is precisely what the harness needed to be able
 * to see, and it saw it agree on a real server before the old client was
 * removed.
 *
 * Returns null when the envelope carried nothing — the caller counts that as
 * `unkeyable` and the sync derives an id from the body bytes.
 */
export function messageIdFromEnvelopeValue(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  // Already bracketed: returned VERBATIM. Trimming here would be a silent
  // normalisation, and the decision about whether a padded id should be
  // trimmed belongs in one place rather than smuggled into a helper.
  if (raw.startsWith('<') && raw.endsWith('>')) return raw;
  return `<${raw}>`;
}

/**
 * The Message-ID of a raw RFC822 message, WITHOUT angle brackets.
 *
 * **The bracket-stripping is the contract, not an implementation detail.** This
 * value becomes `UpsertResult.targetId`'s lookup key and is what
 * `findByNaturalKey` compares against, so both sides of the comparison must
 * strip identically or a message that IS on the target reads as absent — and an
 * absent message is APPENDED, which is a duplicate (hard rule 1).
 *
 * Note this is the OPPOSITE convention to `messageIdFromEnvelopeValue` above,
 * which keeps its brackets. The two never meet — one is the source's natural
 * key, the other the target's lookup key — and writing that down is cheaper
 * than rediscovering it. Keeping both in one file is the point of this file.
 */
export function extractMessageIdFromRfc822(raw: Uint8Array | string): string | null {
  const content = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf-8');
  const match = content.match(/Message-ID:\s*([^\r\n]+)/i);
  if (match) {
    return match[1]?.trim().replace(/[<>]/g, '') || null;
  }
  return null;
}

/**
 * The UID out of a `MailItem.sourceRef` (`"<folder>:<uid>"`).
 *
 * A folder path may itself contain a colon, so the UID is the LAST segment.
 * Two callers splitting that differently would fetch the WRONG message rather
 * than fail — which is why this is shared rather than inlined at each site.
 */
export function uidFromSourceRef(sourceRef: string): number {
  const parts = sourceRef.split(':');
  const uid = parseInt(parts[parts.length - 1] || '0', 10);
  return isNaN(uid) ? 0 : uid;
}
