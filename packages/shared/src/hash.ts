// Copyright 2026 The Ownpace authors (Apache-2.0)
import { createHash } from 'node:crypto';
import { calendarFingerprint, contactFingerprint } from './dav-canonical.ts';
import type { MailItem } from './mail.ts';
import type { CalendarEvent } from './calendar.ts';
import type { Contact } from './contact.ts';
import type { FileItem } from './file.ts';

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

/**
 * The natural key for a calendar event, series and exceptions alike.
 *
 * A recurring series and each of its modified occurrences share a UID (RFC
 * 5545), so the UID alone does not identify one of them. RECURRENCE-ID is
 * what tells them apart, and it is part of the key for exactly that reason.
 *
 * Unchanged for an ordinary event: no RECURRENCE-ID means the key is the UID,
 * exactly as before, so nothing already migrated is re-keyed.
 */
export function naturalKeyForCalendar(event: CalendarEvent): string {
  return calendarNaturalKeyHash(
    event.recurrenceId ? `${event.uid}|${event.recurrenceId}` : event.uid,
  );
}

/**
 * Task natural key hash from UID — its OWN prefix, not the calendar one
 * (workplan 0113).
 *
 * A VTODO and a VEVENT can carry the same UID. RFC 5545 says a UID identifies
 * one calendar component, so a single collection holding both under one UID is
 * malformed — but two collections on one account may each hold one, and that
 * is ordinary. Under `cal:` they would hash to the same key, and the ledger's
 * uniqueness is `(tenant, mapping, item_type, natural_key_hash)` where
 * `item_type` is a legacy column nothing writes: the two rows would collide,
 * and whichever arrived second would be adopted as "already migrated" and
 * never copied.
 *
 * That is #597's shape again — a key that does not identify what it names —
 * and the fifth domain is the moment to give tasks their own space rather than
 * inherit a collision. Nothing is re-keyed by this: no task has ever been
 * written under the task DOMAIN, because the domain did not exist. A task
 * carried under `calendar` from a mixed collection keeps its `cal:` row and
 * its history, which is what it should do.
 */
export function taskNaturalKeyHash(uid: string): string {
  return sha256Hex(`todo:${uid.toLowerCase()}`);
}

/**
 * The natural key for a task, with RECURRENCE-ID for the same reason a
 * calendar event has one: RFC 5545 lets a VTODO recur, and an exception shares
 * the series' UID.
 */
export function naturalKeyForTask(task: CalendarEvent): string {
  return taskNaturalKeyHash(
    task.recurrenceId ? `${task.uid}|${task.recurrenceId}` : task.uid,
  );
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
 *
 * CORRECTED 2026-08-05: this said "we normalize to handle case-insensitive
 * filesystems". **It does not, and never did** — it hashes the string it is
 * given, verbatim. The claim mattered because it describes the natural key: a
 * reader building a second producer of these paths (0031 T3's JMAP
 * parent-chain reconstruction is the first) would fold case to match a
 * normalisation that is not there, and every capitalised or accented path
 * would then key differently per transport — silently, because a mismatched
 * key is a re-copy and a re-copy is a successful write.
 *
 * The path handed in must already be in the ONE agreed shape: root-relative,
 * percent-decoded, no leading or trailing slash, no case folding, no Unicode
 * normalisation — whatever `webdav-source.ts`'s `toRelativePath` produces. See
 * `jmap-file-path.ts` for the second producer and the test that pins them
 * together.
 */
export function fileNaturalKeyHash(path: string): string {
  return sha256Hex(`file:${path}`);
}

export function naturalKeyForFile(file: FileItem): string {
  return fileNaturalKeyHash(file.path);
}

// ===================== The same key, in plain text =====================
//
// Every hash above is `sha256Hex('<prefix>:<something>')`, and that
// `<something>` is the item's own identifier: a Message-ID, a UID, a file
// path. The hash is the ledger's key and is all any ACTION needs (§17). The
// plain text is what a PERSON needs, and it has exactly one consumer: the
// confirmed list and its CSV export — the document somebody reconciles
// against the account they are about to empty. `confirmed-list.ts` argues
// that exception at length; this is the other end of it.
//
// Two things about these that look like mistakes and are not:
//
// **A calendar event and a task produce the same text.** Their hashes differ
// (`cal:` against `todo:`, so a VTODO and a VEVENT sharing a UID cannot
// collide), but their identifier is the same UID, and the row's `domain`
// column is what tells a reader which one they are looking at. Inventing a
// `todo:` prefix for the screen would show somebody a string their calendar
// server has never heard of.
//
// **The text is NOT always the exact string that was hashed.** A calendar UID
// is case-insensitive (RFC 5545) so the hash lowercases it; the text keeps the
// case the server gave, because that is what the person will search their old
// account for. `hash.unit.test.ts` pins the relationship rather than the
// equality: normalising the text the way its own hash function does reproduces
// the hash, for every domain.

/** The Message-ID, angle brackets and surrounding space removed. */
export function naturalKeyTextForItem(item: MailItem): string {
  return normalizeMessageId(item.messageId);
}

/**
 * The UID — with RECURRENCE-ID appended for a modified occurrence, exactly as
 * `naturalKeyForCalendar` keys it, because otherwise every exception in a
 * series would show the same identifier and the list could not tell them apart.
 */
export function naturalKeyTextForCalendar(event: CalendarEvent): string {
  return event.recurrenceId ? `${event.uid}|${event.recurrenceId}` : event.uid;
}

/** The UID, by the same rule a calendar event follows. See the note above. */
export function naturalKeyTextForTask(task: CalendarEvent): string {
  return task.recurrenceId ? `${task.uid}|${task.recurrenceId}` : task.uid;
}

/** The vCard UID, case preserved — `contactNaturalKeyHash` preserves it too. */
export function naturalKeyTextForContact(contact: Contact): string {
  return contact.uid;
}

/** The root-relative path, in the one agreed shape `fileNaturalKeyHash` demands. */
export function naturalKeyTextForFile(file: FileItem): string {
  return file.path;
}

/**
 * THE NAME A PERSON CALLS IT (the owner, 2026-09-17: *"Why not show calander
 * item names and contact names?"*).
 *
 * ## The identifier is not a name
 *
 * `naturalKeyTextFor*` above solved half the problem: the confirmed list can
 * say WHICH item a row is, in the source's own vocabulary. For a file that is a
 * path and for mail a Message-ID, both of which a person can search their old
 * account for. For a calendar event and a contact it is a UID, and a UID is not
 * something anybody has ever seen.
 *
 * The cost was not theoretical. Two of the owner's contacts failed against a
 * live Nextcloud, and every surface that could have told him which two printed
 * `926caf98adce563`. His answer was *"I can not find these contacts, or atleast
 * i do no know how"* — which is the correct answer, because there was nothing
 * to find them by.
 *
 * ## Beside the key, never instead of it
 *
 * The key stays exactly as it is. A name is not unique, is not stable, and is
 * not what anything looks a row up by; two people called Jan Jansen are two
 * rows and must stay two rows. This is a LABEL, and the row it labels is still
 * identified by its hash.
 *
 * ## Which domains, and why not the other two
 *
 * Calendar, tasks and contacts: each has a name the person wrote, sitting on
 * the parsed item already (`CalendarEvent.summary`, `Contact.name`), so this is
 * field selection and not a second parse of the body.
 *
 * FILES have nothing to add: their key IS the path, which is the name. A second
 * copy of it on the same row would be noise.
 *
 * MAIL is not here, and that is a gap rather than a decision: the human label
 * is the Subject, `MailItem` does not carry one, and it lives in the RFC 822
 * bytes behind RFC 2047 encoded-words and header folding. Decoding that
 * correctly is its own piece of work with its own way to be wrong, and half of
 * it — a mojibake subject on the one document somebody empties their account on
 * — is worse than the Message-ID it would replace.
 *
 * ## Whatever the source says, including its placeholder
 *
 * `CalendarEvent.summary` and `Contact.name` are required, and a source with no
 * SUMMARY or no FN fills them with its own placeholder. That placeholder is
 * stored too. It is what every other screen in the product already calls that
 * item, and a row that disagreed with the rest of the product about what an
 * item is called would be a worse problem than the one this solves.
 */

/**
 * How much of a name is kept. Long enough for a real event title, short enough
 * that a pathological one cannot make a ledger row expensive to read: this
 * column is selected by the confirmed list for every row on the page.
 */
export const DISPLAY_NAME_LIMIT = 200;

/**
 * One name, bounded and on one line, or `undefined` when there is nothing to
 * say.
 *
 * Whitespace is collapsed rather than preserved: a summary can arrive carrying
 * the newline of a folded line the source un-folded badly, and a name that
 * breaks a table row is a name that makes the table harder to read than the UID
 * it replaced. `undefined` rather than `''` so a caller with nothing to say
 * leaves the column alone, the same rule `naturalKey` follows.
 */
export function boundDisplayName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const flat = name.replace(/\s+/gu, ' ').trim();
  if (flat === '') return undefined;
  // `Array.from` rather than `slice`: cutting a string at a code UNIT can split
  // a surrogate pair and leave half a character, and an emoji in a calendar
  // title is ordinary.
  const points = Array.from(flat);
  if (points.length <= DISPLAY_NAME_LIMIT) return flat;
  return `${points.slice(0, DISPLAY_NAME_LIMIT).join('')}\u2026`;
}

/**
 * READING A LABEL MUST NEVER THROW, which is why all three of these take an
 * item that may be absent.
 *
 * `RawCalendarEvent.item` and `RawContact.item` are declared non-optional, and
 * the DAV target writers do not need them: a writer takes its UID from the
 * BODY, so a caller handing it bytes and nothing else has always been served.
 * Twenty-four tests in `packages/engines` do exactly that.
 *
 * The first version of these read `event.summary` directly, and those callers
 * stopped being served — a write path crashing on the way to fetching a LABEL.
 * A name is the least important thing on the row and it must not be able to
 * fail somebody's migration; if there is no item to name, there is no name, and
 * the screen falls back to the identifier exactly as it does for a file.
 */

/** The event's SUMMARY — what the person typed in their calendar. */
export function displayNameForCalendar(event: CalendarEvent | undefined): string | undefined {
  return boundDisplayName(event?.summary);
}

/** The task's SUMMARY, by the same rule a calendar event follows. */
export function displayNameForTask(task: CalendarEvent | undefined): string | undefined {
  return boundDisplayName(task?.summary);
}

/** The card's FN — the person's full name as their address book holds it. */
export function displayNameForContact(contact: Contact | undefined): string | undefined {
  return boundDisplayName(contact?.name);
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

/**
 * The same hash, over bytes nobody is holding.
 *
 * `fileContentHash` takes the whole file, which is fine when the whole file is
 * already in memory and is the reason it could not be otherwise: hashing was
 * one of the three places a large file had to be buffered (see `FileBody`).
 * This one folds chunk by chunk, so a 40 GB file costs one chunk of memory
 * and the same 64 hex characters at the end.
 *
 * It hashes AS THE BYTES PASS rather than in a read of its own: a second read
 * would double the transfer, and on a metered source (0090's daily ceiling)
 * would double what the customer is charged against their own limit. So it is
 * a TRANSFORM — hand it the stream going to the target, write what comes out,
 * then ask for the digest.
 *
 *   const hasher = streamingFileContentHash();
 *   await upload(source.pipeThrough(hasher.through));
 *   const hash = hasher.digest();
 *
 * `digest()` before the stream has finished is a lie about a file nobody has
 * read to the end, so it refuses rather than answering a hash of a prefix —
 * which would compare equal to nothing and unequal to everything, silently.
 */
export interface StreamingContentHash {
  /** Pipe the bytes through this; it changes nothing and counts everything. */
  readonly through: TransformStream<Uint8Array, Uint8Array>;
  /** The hex digest. Throws until the stream has been read to its end. */
  digest(): string;
  /** Bytes seen so far — the truth about what actually crossed. */
  bytesSeen(): number;
}

export function streamingFileContentHash(): StreamingContentHash {
  const hash = createHash('sha256');
  let seen = 0;
  let done = false;
  let digested: string | undefined;
  const through = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      hash.update(chunk);
      seen += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush() {
      done = true;
    },
  });
  return {
    through,
    digest(): string {
      if (!done) {
        throw new Error(
          'refusing to hash a file that has not been read to the end — a digest over a prefix ' +
            'compares equal to nothing and unequal to everything, and would be recorded as if ' +
            'it were the file',
        );
      }
      digested ??= hash.digest('hex');
      return digested;
    },
    bytesSeen: () => seen,
  };
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
