// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MANIFEST THAT NAMED THE WRONG PROVIDER.
 *
 * The owner's own Google migration, live 2026-09-22, reviewed on the screen
 * where you press Start:
 *
 *     Files — OneDrive and SharePoint libraries
 *     Does not migrate: SharePoint extras · Teams chat & calls · Planner ·
 *     Power Automate · InfoPath · OneNote · Retention holds · Other O365 apps
 *
 * From all google2 (a Gmail account) to nextcloud.
 *
 * ONE LIST, FETCHED WITH NO ARGUMENT. `SCOPE_MANIFEST` was a single constant
 * and `GET /api/scope-manifest` took nothing, so every migration got every
 * row. The rows were written when the only source was Microsoft and stayed
 * true of Microsoft; nothing made them stop being shown when a second provider
 * arrived.
 *
 * THE COST IS NOT THE NOISE. `scope-manifest.ts`'s own header states §11.2 —
 * "what migrates, what doesn't, and why… Explicit and readable: no silent
 * omissions" — and for a Google source the omissions were total. Not one row
 * mentioned Drive, Gmail or Docs. The export-format decision a Drive migration
 * turns on is the largest fidelity choice it makes, and it appeared nowhere on
 * the screen that confirms it.
 *
 * THE ARGUMENT WAS ALREADY WON ONCE, one file over. `permissions.ts` carries
 * `googleMailboxDelegationNotRead` for exactly this reason: "a Google tenant
 * handed an Exchange Online PowerShell instruction is being sent on a *wrong
 * errand* — `Get-MailboxPermission` will never run against their account, so a
 * reader who follows it learns nothing and concludes the tool is broken". The
 * permissions REPORT was split per provider. The confirm SCREEN never was.
 *
 * SO THE RULE IS ABOUT VOCABULARY, NOT ABOUT A LIST OF ROWS. A row that names
 * somebody's product has to say whose. Written the other way round — a list of
 * the rows that happen to be Microsoft's today — it would pass the moment a
 * Google row was added carelessly, which is the same defect wearing the other
 * provider's coat.
 *
 * WHAT IT DELIBERATELY DOES NOT HOLD: whether the lists are COMPLETE. No test
 * can know what a provider does that this tool leaves behind; that is
 * editorial, it is the owner's to state, and §11.2 makes it their signature
 * rather than a checkable property. This holds the mechanical half — that
 * whatever is written is attributed — so the editorial half is the only thing
 * left to get wrong.
 */

import { describe, it, expect } from 'vitest';
import {
  SCOPE_MANIFEST,
  scopeFamilyOf,
  scopeManifestFor,
  type ScopeFamily,
  type ScopeManifestEntry,
} from './scope-manifest.ts';

const COLUMNS = ['migrates', 'partial', 'doesNotMigrate'] as const;

const everyEntry = (): ScopeManifestEntry[] => COLUMNS.flatMap((c) => [...SCOPE_MANIFEST[c]]);

/**
 * Words that belong to ONE provider. Not protocol names — IMAP, CalDAV,
 * WebDAV, JMAP and vCard are everybody's and say nothing about whose account
 * this is.
 */
const VOCABULARY: Readonly<Record<string, ScopeFamily>> = {
  SharePoint: 'microsoft',
  OneDrive: 'microsoft',
  OneNote: 'microsoft',
  Teams: 'microsoft',
  Planner: 'microsoft',
  InfoPath: 'microsoft',
  'Power Automate': 'microsoft',
  Exchange: 'microsoft',
  'Microsoft Graph': 'microsoft',
  O365: 'microsoft',
  'Office 365': 'microsoft',
  Google: 'google',
  Gmail: 'google',
  Drive: 'google',
  Docs: 'google',
  Sheets: 'google',
  Slides: 'google',
  Takeout: 'google',
  Dropbox: 'dropbox',
};

export interface Unattributed {
  readonly item: string;
  readonly word: string;
  readonly family: ScopeFamily;
}

/** Rows naming a provider's product without saying that the row is theirs. */
export function unattributed(entries: readonly ScopeManifestEntry[]): Unattributed[] {
  const found: Unattributed[] = [];
  for (const entry of entries) {
    const text = `${entry.item} ${entry.detail} ${entry.more ?? ''}`;
    for (const [word, family] of Object.entries(VOCABULARY)) {
      if (!new RegExp(`\\b${word}\\b`).test(text)) continue;
      if (entry.appliesTo?.includes(family)) continue;
      found.push({ item: entry.item, word, family });
    }
  }
  return found;
}

describe('a manifest that named the wrong provider', () => {
  it('attributes every row that names somebody\'s product', () => {
    const wrong = unattributed(everyEntry());
    expect(
      wrong,
      wrong.length === 0
        ? ''
        : 'These rows name a provider but are shown to everybody:\n  ' +
          wrong.map((w) => `"${w.item}" says ${w.word} — mark it appliesTo: ['${w.family}']`).join('\n  '),
    ).toEqual([]);
  });

  it('recognises an unattributed row, so the rule is not vacuous', () => {
    // Exactly the shape that shipped: Microsoft words, shown to everyone.
    expect(
      unattributed([{ item: 'Files', detail: 'OneDrive and SharePoint libraries.' }]),
    ).toHaveLength(2);
    // ...and the same row, attributed, is fine.
    expect(
      unattributed([
        { item: 'Files', detail: 'OneDrive and SharePoint libraries.', appliesTo: ['microsoft'] },
      ]),
    ).toEqual([]);
  });

  it('leaves protocol names alone — they are nobody\'s product', () => {
    expect(
      unattributed([
        { item: 'Contacts', detail: 'Address books and contacts (vCard), over CardDAV or JMAP.' },
        { item: 'Email', detail: 'Folders incl. Sent / Drafts / Archive, flags/keywords.' },
      ]),
    ).toEqual([]);
  });

  it('gives every Google source type the google family', () => {
    for (const type of ['google', 'gmail', 'google-calendar', 'google-contacts', 'google-drive']) {
      expect(scopeFamilyOf(type), type).toBe('google');
    }
  });

  it('answers undefined for a source it does not know, rather than guessing', () => {
    // The whole defect in one line: an unrecognised source must NOT inherit a
    // recognised one's promises.
    for (const type of ['', 'proton', 'jmap', 'not-a-source']) {
      expect(scopeFamilyOf(type), type).toBeUndefined();
    }
  });

  it('says no Microsoft word to a Google migration, nor the reverse', () => {
    // NOT "contains no row marked microsoft" — after filtering by family that
    // would be true by construction and would assert nothing. What the owner
    // actually read on screen was VOCABULARY, so that is what this reads back:
    // the words a Google migration is shown, and the words a Microsoft one is.
    const wordsIn = (m: typeof SCOPE_MANIFEST): string =>
      COLUMNS.flatMap((c) => [...m[c]])
        .map((e) => `${e.item} ${e.detail} ${e.more ?? ''}`)
        .join(' ');

    const google = wordsIn(scopeManifestFor(SCOPE_MANIFEST, ['google']));
    for (const [word, family] of Object.entries(VOCABULARY)) {
      if (family === 'microsoft') {
        expect(new RegExp(`\\b${word}\\b`).test(google), `a Google migration is shown "${word}"`)
          .toBe(false);
      }
    }

    const microsoft = wordsIn(scopeManifestFor(SCOPE_MANIFEST, ['microsoft']));
    for (const [word, family] of Object.entries(VOCABULARY)) {
      if (family === 'google') {
        expect(
          new RegExp(`\\b${word}\\b`).test(microsoft),
          `a Microsoft migration is shown "${word}"`,
        ).toBe(false);
      }
    }

    // And neither ended up empty, or both loops above would be free.
    expect(scopeManifestFor(SCOPE_MANIFEST, ['google']).doesNotMigrate.length).toBeGreaterThan(0);
    expect(
      scopeManifestFor(SCOPE_MANIFEST, ['microsoft']).doesNotMigrate.length,
    ).toBeGreaterThan(0);
  });

  it('keeps the rows true of everybody when it knows no family', () => {
    const neutral = scopeManifestFor(SCOPE_MANIFEST, []);
    expect(neutral.migrates.length).toBeGreaterThan(0);
    // Nothing provider-specific survives an empty family list.
    for (const column of COLUMNS) {
      for (const entry of neutral[column]) expect(entry.appliesTo).toBeUndefined();
    }
  });

  it('filters the manifest it is given, not the constant it can see', () => {
    // A client filters the SERVER's copy; a function reaching for its own
    // import would silently serve a stale promise set.
    const served = {
      version: 'served',
      migrates: [{ item: 'Only', detail: 'From the server.' }],
      partial: [],
      doesNotMigrate: [],
    };
    const out = scopeManifestFor(served, ['google']);
    expect(out.version).toBe('served');
    expect(out.migrates.map((e) => e.item)).toEqual(['Only']);
  });
});
