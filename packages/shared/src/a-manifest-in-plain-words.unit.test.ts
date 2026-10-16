// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THE MANIFEST IN PLAIN WORDS, IN BOTH LANGUAGES (workplan 0013, 2026-10-14).
 *
 * Every managed Alpha tester reads *What migrates, and what does not* twice:
 * on *Start a migration* and on *Review and start*. On 2026-10-14 a scan of
 * what a tester can see found it written for us, not for them:
 *
 *     Distribution lists (Pattern D) — … (§14.2 — covered, not necessarily
 *     automated)
 *     Shared mailboxes — Pattern S … same idempotency and verification as any
 *     mailbox
 *     Contacts — Address books and contacts (vCard), over CardDAV or JMAP …
 *     content-checksum sampling does not run
 *     Google Photos — Not migrated — not reachable through the Drive API this
 *     tool uses
 *
 * The labels are the architecture's (§14.1's two patterns, §14.2's guided
 * write step), a tester has none of them, and the Photos line was wrong in the
 * way that matters: the wizard offers photos from a Takeout export, and the
 * line said nothing of it. It was also the one block of those screens that
 * stayed English under `nl`.
 *
 * So two things are held here, for every word a reader can reach (a row's
 * label, its line and its fold, in either language):
 *
 * 1. **No internal label.** No *Pattern S/D*, no *§*, no *idempotency*, no
 *    *ledger*, no all-caps environment variable, and no protocol a tester does
 *    not choose a destination by. *JMAP* stays allowed: it is a destination
 *    card's name, and the contacts fold is about that destination.
 * 2. **Every row has its Dutch**, with a fold where the English has one, and
 *    a line a column can show.
 *
 * What the words SAY is held elsewhere: each caveat a customer acts on by
 * `a-promise-compressed-out-of-existence`, and whose row names whose product
 * by `a-manifest-that-named-the-wrong-provider`.
 */

import { describe, it, expect } from 'vitest';
import { SCOPE_MANIFEST, scopeManifestWords, type ScopeManifestEntry } from './scope-manifest.ts';

const COLUMNS = ['migrates', 'partial', 'doesNotMigrate'] as const;

const everyEntry = (): ScopeManifestEntry[] => COLUMNS.flatMap((c) => [...SCOPE_MANIFEST[c]]);

/** Every text of one row a reader can reach, in both languages, with where it sits. */
function textsOf(entry: ScopeManifestEntry): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [];
  for (const locale of ['en', 'nl'] as const) {
    const words = scopeManifestWords(entry, locale);
    out.push([`${locale} item`, words.item], [`${locale} detail`, words.detail]);
    if (words.more !== undefined) out.push([`${locale} more`, words.more]);
  }
  return out;
}

/** Words for us, not for a tester: what each one is, and how to find it. */
const DEVELOPER_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['an architecture pattern label', /Pattern /],
  ['a section sign', /§/],
  ['idempotency', /idempoten/i],
  ['the ledger', /\bledger\b/i],
  ['an architecture document', /\bSAD\b/],
  ['an all-caps environment variable', /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/],
  // VTODO and iCalendar since the Tasks rows (2026-10-16): what a task IS on
  // the wire, which is how the code and its guides speak of Reminders.
  ['a protocol no destination card is named after', /\b(?:vCard|ICS|CardDAV|CalDAV|WebDAV|JSContact|VTODO|VEVENT|iCalendar)\b/],
  ['a checksum', /checksum/i],
  ['an API this product reads through', /\b(?:Drive API|Microsoft Graph|Graph)\b/],
];

/** Each developer word a text says, by name. */
export function developerWordsIn(text: string): string[] {
  return DEVELOPER_WORDS.filter(([, pattern]) => pattern.test(text)).map(([what]) => what);
}

describe('the manifest says nothing a tester needs us to explain', () => {
  it('no text a reader can reach carries an internal label', () => {
    const found = everyEntry().flatMap((entry) =>
      textsOf(entry).flatMap(([where, text]) =>
        developerWordsIn(text).map((what) => `"${entry.item}" (${where}) says ${what}: ${text}`),
      ),
    );
    expect(found, found.join('\n')).toEqual([]);
  });

  it('recognises each kind of label, so the rule is not vacuous', () => {
    // The shapes that shipped before 2026-10-14, word for word.
    expect(developerWordsIn('Distribution lists (Pattern D)')).toEqual(['an architecture pattern label']);
    expect(developerWordsIn('(§14.2 — covered, not necessarily automated)')).toEqual(['a section sign']);
    expect(developerWordsIn('same idempotency and verification as any mailbox')).toEqual(['idempotency']);
    expect(developerWordsIn('set GRAPH_FILES_READ_CONSENTED=true')).toContain('an all-caps environment variable');
    expect(developerWordsIn('Address books and contacts (vCard), over CardDAV or JMAP.')).toEqual([
      'a protocol no destination card is named after',
    ]);
    expect(developerWordsIn('Reminders are VTODO components in the same CalDAV account')).toEqual([
      'a protocol no destination card is named after',
    ]);
    expect(developerWordsIn('content-checksum sampling does not run')).toEqual(['a checksum']);
    expect(developerWordsIn('not reachable through the Drive API this tool uses')).toEqual([
      'an API this product reads through',
    ]);
    // …and leaves alone what a tester does read: a destination card's name,
    // an email header, a product.
    expect(developerWordsIn('a JMAP destination cannot hand a contact back')).toEqual([]);
    expect(developerWordsIn('Mail with no Message-ID')).toEqual([]);
    expect(developerWordsIn('OneDrive and SharePoint libraries: files and folders.')).toEqual([]);
  });

  it('says Google Photos can come from a Takeout export, and links the guide that says how', () => {
    // The wizard offers *Photos: from a Takeout export* under Google; the row
    // that said photos were out of reach said nothing of it.
    const photos = SCOPE_MANIFEST.doesNotMigrate.find((e) => e.item === 'Google Photos');
    expect(photos).toBeDefined();
    expect(photos!.detail).toMatch(/Takeout export/);
    expect(photos!.more ?? '').toMatch(/Photos: from a Takeout export/);
    expect(photos!.nl?.more ?? '').toMatch(/Foto's: uit een Takeout-export/);
    expect(photos!.guide).toBe('google#photos');
  });
});

describe('every row in Dutch too', () => {
  it('has its Dutch beside its English, with a fold where the English has one', () => {
    for (const entry of everyEntry()) {
      expect(entry.nl, `"${entry.item}" has no Dutch`).toBeDefined();
      expect(entry.nl!.item.trim(), `"${entry.item}": no Dutch label`).not.toBe('');
      expect(entry.nl!.detail.trim(), `"${entry.item}": no Dutch line`).not.toBe('');
      expect(entry.nl!.more !== undefined, `"${entry.item}": a fold in one language only`).toBe(
        entry.more !== undefined,
      );
    }
  });

  it('keeps each Dutch line to what a column can show, as the English', () => {
    for (const entry of everyEntry()) {
      const line = entry.nl?.detail ?? '';
      expect(line.length, `"${entry.item}" is ${line.length} characters in Dutch`).toBeLessThanOrEqual(90);
    }
  });

  it('speaks Dutch the way the dictionary does', () => {
    // The glossary's register and the owner's words: *u*, never *je* or
    // *jij*; *migratie*, never any form of *verhuizen*.
    for (const entry of everyEntry()) {
      const dutch = `${entry.nl?.item ?? ''} ${entry.nl?.detail ?? ''} ${entry.nl?.more ?? ''}`;
      expect(dutch, `"${entry.item}"`).not.toMatch(/\b(?:je|jij|jouw|jullie)\b/i);
      expect(dutch, `"${entry.item}"`).not.toMatch(/verhui[sz]/i);
    }
  });

  it('answers the English where a row has no Dutch, and the Dutch where it has', () => {
    const english = { item: 'Only', detail: 'English.' };
    expect(scopeManifestWords(english, 'nl')).toEqual(english);
    const both = { ...english, more: 'Folded.', nl: { item: 'Alleen', detail: 'Nederlands.', more: 'Gevouwen.' } };
    expect(scopeManifestWords(both, 'nl')).toEqual(both.nl);
    expect(scopeManifestWords(both, 'en')).toEqual({ item: 'Only', detail: 'English.', more: 'Folded.' });
  });
});
