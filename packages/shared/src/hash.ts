import { createHash } from 'node:crypto';
import { calendarFingerprint, contactFingerprint } from './dav-canonical';
import type { MailItem } from './mail';
import type { CalendarEvent } from './calendar';
import type { Contact } from './contact';
import type { FileItem } from './file';

/**
 * Normalize an RFC 5322 Message-ID for use as a stable natural key:
 * trim surrounding whitespace and strip a single surrounding pair of angle brackets.
 * (Message-IDs are case-sensitive per spec, so casing is preserved.)
 */
export function normalizeMessageId(messageId: string): string {
  return messageId
    .trim()
    .replace(/^<(.*)>$/, '$1')
    .trim();
}

/**
 * Natural-key hash: the idempotency anchor recorded as
 * UNIQUE(tenant_id, mapping_id, natural_key_hash) in the ledger.
 */
export function naturalKeyHash(messageId: string): string {
  return sha256Hex(`mid:${normalizeMessageId(messageId)}`);
}

export function naturalKeyForItem(item: MailItem): string {
  return naturalKeyHash(item.messageId);
}

/**
 * Calendar natural key hash from UID.
 * Calendar UIDs are case-insensitive per RFC 5545, so we normalize to lowercase.
 */
export function calendarNaturalKeyHash(uid: string): string {
  return sha256Hex(`cal:${uid.toLowerCase()}`);
}

export function naturalKeyForCalendar(event: CalendarEvent): string {
  return calendarNaturalKeyHash(event.uid);
}

/**
 * Contact natural key hash from UID.
 * vCard UIDs are case-sensitive, so we preserve the original casing.
 */
export function contactNaturalKeyHash(uid: string): string {
  return sha256Hex(`card:${uid}`);
}

export function naturalKeyForContact(contact: Contact): string {
  return contactNaturalKeyHash(contact.uid);
}

/**
 * File natural key hash from path.
 * File paths are typically case-sensitive, but we normalize to handle case-insensitive filesystems.
 */
export function fileNaturalKeyHash(path: string): string {
  return sha256Hex(`file:${path}`);
}

export function naturalKeyForFile(file: FileItem): string {
  return fileNaturalKeyHash(file.path);
}

/**
 * Content hash over the raw RFC822 bytes, carried in the ledger to detect that an
 * already-migrated message changed. Bytes are hashed verbatim (no header
 * normalization) so byte-level fidelity is detectable. See ADR-0019 (to be written)
 * if/when normalization rules are formalized.
 */
export function contentHash(rfc822: Uint8Array): string {
  return createHash('sha256').update(rfc822).digest('hex');
}

/**
 * Content hash for calendar events (iCalendar data).
 *
 * A CANONICAL fingerprint, not a hash of the bytes. CalDAV servers re-serialize
 * what they store — refolding lines, reordering properties, adding their own
 * PRODID/VERSION/X- properties — so a byte hash computed on the source can
 * never equal one computed back off the target. That is why `contentHashFor`
 * was withdrawn for this domain (#143) and why §20's content leg stopped
 * running for it entirely. See dav-canonical.ts for what is compared, what a
 * match does and does not claim, and why timing properties are excluded.
 *
 * Nothing reads `item.content_hash` to make a decision — deduplication is by
 * `natural_key_hash` — so changing what it contains does not affect the sync.
 * Fingerprints are version-tagged so a row written by an older build is
 * reported as unmeasured rather than as corruption.
 */
export function calendarContentHash(icalendar: string): string {
  return calendarFingerprint(icalendar);
}

/**
 * Content hash for contacts (vCard data). Canonical fingerprint — see
 * `calendarContentHash`.
 */
export function contactContentHash(vcard: string): string {
  return contactFingerprint(vcard);
}

/**
 * Content hash for file content.
 */
export function fileContentHash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
