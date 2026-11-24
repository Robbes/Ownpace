// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * TWO MICROSOFT PROMISES THE CODE DID NOT KEEP (2026-11-24, the owner:
 * *"two promises: YES, change the wording."*).
 *
 *  - Files said *OneDrive and SharePoint libraries*. `graph-drive-source`
 *    reads `{scope}/drive/root/delta`, the signed-in person's own OneDrive,
 *    and takes no site or drive id. An organisation was told its team files
 *    would migrate, and would have found them missing after the switch-over.
 *  - The online archive was neither read nor named. The IMAP and Graph mail
 *    sources read the primary mailbox only, and under Microsoft's default
 *    policy mail older than two years can sit in the archive, so the first
 *    copy left it behind without a word.
 *
 * Each is now said, with the way round it, in English and in Dutch.
 */

import { describe, it, expect } from 'vitest';
import { SCOPE_MANIFEST, scopeManifestFor, type ScopeManifestEntry } from './scope-manifest.ts';

const everyWord = (e: ScopeManifestEntry): string =>
  [e.item, e.detail, e.more ?? '', e.nl?.item ?? '', e.nl?.detail ?? '', e.nl?.more ?? ''].join(' ');

const row = (item: string): ScopeManifestEntry => {
  const found = SCOPE_MANIFEST.doesNotMigrate.find((e) => e.item === item);
  expect(found, `no "${item}" row under does not migrate`).toBeDefined();
  return found!;
};

describe('Microsoft files: OneDrive, and only OneDrive', () => {
  it('promises OneDrive under Migrates and no SharePoint or Teams library, in either language', () => {
    const files = SCOPE_MANIFEST.migrates.filter(
      (e) => e.item === 'Files' && (e.appliesTo ?? []).includes('microsoft'),
    );
    expect(files).toHaveLength(1);
    expect(files[0]!.detail).toMatch(/OneDrive/);
    expect(files[0]!.nl?.detail).toMatch(/OneDrive/);
    for (const entry of SCOPE_MANIFEST.migrates) {
      expect(everyWord(entry), `"${entry.item}" promises SharePoint or Teams`).not.toMatch(/SharePoint|Teams/);
    }
  });

  it('names SharePoint and Teams files as not migrated yet, with what to do meanwhile', () => {
    const r = row('SharePoint and Teams files');
    expect(r.appliesTo).toEqual(['microsoft']);
    expect(r.domains).toEqual(['file']);
    expect(r.detail).toMatch(/not migrated yet/i);
    expect(r.detail).toMatch(/OneDrive/);
    expect(r.more).toMatch(/Only the OneDrive of the account that signs in is read/);
    expect(r.more).toMatch(/Teams channel/);
    expect(r.nl?.detail).toMatch(/nog niet gemigreerd/);
    expect(r.nl?.more).toMatch(/OneDrive/);
    expect(r.guide).toBe('microsoft#not-yet');
  });

  it('no longer says every SharePoint file comes across, in the extras row’s fold', () => {
    const extras = row('SharePoint extras');
    expect(extras.more).toMatch(/OneDrive's files and folders/);
    expect(extras.more).toMatch(/not yet/);
    expect(extras.nl?.more).toMatch(/nog niet/);
  });
});

describe('the online archive: named, and not migrated yet', () => {
  it('has a row with its reason and its way forward, in both languages', () => {
    const r = row('Online archive');
    expect(r.appliesTo).toEqual(['microsoft']);
    expect(r.domains).toEqual(['email']);
    expect(r.detail).toMatch(/not migrated yet/i);
    expect(r.detail).toMatch(/into the mailbox/);
    expect(r.more).toMatch(/older than two years/);
    expect(r.more).toMatch(/Archive folder in your mailbox is something else, and does come across/);
    expect(r.nl?.item).toBe('Onlinearchief');
    expect(r.nl?.detail).toMatch(/nog niet gemigreerd/);
    expect(r.nl?.more).toMatch(/twee jaar/);
    expect(r.guide).toBe('microsoft#not-yet');
  });
});

describe('who is shown the two rows', () => {
  it('a Microsoft migration of mail and files sees both; a Google one neither', () => {
    const items = (families: Parameters<typeof scopeManifestFor>[1]) =>
      scopeManifestFor(SCOPE_MANIFEST, families, ['email', 'file']).doesNotMigrate.map((e) => e.item);
    expect(items(['microsoft'])).toEqual(expect.arrayContaining(['SharePoint and Teams files', 'Online archive']));
    expect(items(['google'])).not.toContain('SharePoint and Teams files');
    expect(items(['google'])).not.toContain('Online archive');
  });

  it('a Microsoft migration of mail alone sees the archive and not the files row', () => {
    const items = scopeManifestFor(SCOPE_MANIFEST, ['microsoft'], ['email']).doesNotMigrate.map((e) => e.item);
    expect(items).toContain('Online archive');
    expect(items).not.toContain('SharePoint and Teams files');
  });

  it('marks the change of the promise set with a new version', () => {
    expect(SCOPE_MANIFEST.version >= '2026-11-24').toBe(true);
  });
});

describe('the Dutch speaks the way the dictionary does', () => {
  it('says u and migratie, in both new rows', () => {
    for (const item of ['SharePoint and Teams files', 'Online archive']) {
      const dutch = `${row(item).nl?.detail} ${row(item).nl?.more}`;
      expect(dutch).toMatch(/\bu\b|\buw\b/);
      expect(dutch).toMatch(/gemigreerd/);
    }
  });
});
