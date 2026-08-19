// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Reading the owner's bin out of a Nextcloud trashbin PROPFIND.
 *
 * The file domain had only absence-counting: a file stops appearing twice in a row,
 * so it has probably been deleted. The answer was one endpoint away the whole time
 * — the bin, with the ORIGINAL PATH of everything in it.
 *
 * Every test below is really about one thing: the paths have to come out in exactly
 * the form `FileItem.path` takes. The sync loop matches by natural key
 * (`file:<path>`), so a path that differs by a leading slash, a percent-escape or a
 * `rootPath` prefix hashes to something no ledger row has — and the result is not
 * an error, it is SILENCE. That is the failure mode nobody notices, which is why
 * the normalisation has its own function and its own tests rather than being
 * trusted to two code paths agreeing by coincidence.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTrashbinOriginalLocations,
  nextcloudTrashbinUrl,
  trashbinPathToKeyPath,
} from './webdav-trashbin.ts';

/** What Nextcloud actually answers: mangled hrefs, real paths in the property. */
const TRASHBIN_BODY = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/trashbin/alice/trash/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/trashbin/alice/trash/report.pdf.d1697029384</d:href>
    <d:propstat>
      <d:prop>
        <nc:trashbin-original-location>Documents/report.pdf</nc:trashbin-original-location>
        <nc:trashbin-deletion-time>1697029384</nc:trashbin-deletion-time>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/trashbin/alice/trash/notes.txt.d1697029999</d:href>
    <d:propstat>
      <d:prop>
        <nc:trashbin-original-location>notes.txt</nc:trashbin-original-location>
        <nc:trashbin-deletion-time>1697029999</nc:trashbin-deletion-time>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe('parseTrashbinOriginalLocations', () => {
  it('reads the original locations and ignores the bin itself', () => {
    // The trash root has no original location, so it drops out by itself — no
    // resourcetype check needed, which is one fewer thing to get wrong.
    expect(parseTrashbinOriginalLocations(TRASHBIN_BODY)).toEqual([
      'Documents/report.pdf',
      'notes.txt',
    ]);
  });

  it('takes the ORIGINAL location, never the mangled href', () => {
    // Nextcloud renames what it trashes: `report.pdf` becomes
    // `report.pdf.d1697029384`, in a directory that has nothing to do with where
    // the file lived. Keying off the href would produce a path that matches no
    // ledger row and never has.
    const found = parseTrashbinOriginalLocations(TRASHBIN_BODY);
    expect(found.some((p) => p.includes('.d1697029384'))).toBe(false);
    expect(found.some((p) => p.includes('trashbin'))).toBe(false);
  });

  it('tolerates whatever namespace prefix the server chose', () => {
    const body = `<?xml version="1.0"?>
      <D:multistatus xmlns:D="DAV:" xmlns:NC="http://nextcloud.org/ns">
        <D:response>
          <D:href>/remote.php/dav/trashbin/alice/trash/x.txt.d1</D:href>
          <D:propstat>
            <D:prop><NC:trashbin-original-location>Archive/x.txt</NC:trashbin-original-location></D:prop>
            <D:status>HTTP/1.1 200 OK</D:status>
          </D:propstat>
        </D:response>
      </D:multistatus>`;
    expect(parseTrashbinOriginalLocations(body)).toEqual(['Archive/x.txt']);
  });

  it('decodes XML entities, because the property is text and not a URI', () => {
    // A file called `Q&A <draft>.txt` arrives escaped. Left encoded, its natural
    // key would be a hash of `Q&amp;A ...` and would match nothing.
    const body = `<d:multistatus xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">
      <d:response>
        <d:href>/remote.php/dav/trashbin/alice/trash/qa.txt.d1</d:href>
        <d:propstat><d:prop>
          <nc:trashbin-original-location>Notes/Q&amp;A &lt;draft&gt;.txt</nc:trashbin-original-location>
        </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
      </d:response>
    </d:multistatus>`;
    expect(parseTrashbinOriginalLocations(body)).toEqual(['Notes/Q&A <draft>.txt']);
  });

  it('skips an entry whose original location the server could not give', () => {
    // Answered as an empty element inside a 404 propstat. There is nothing to match
    // it against, so it is dropped rather than turned into a guess.
    const body = `<d:multistatus xmlns:d="DAV:" xmlns:nc="http://nextcloud.org/ns">
      <d:response>
        <d:href>/remote.php/dav/trashbin/alice/trash/mystery.d1</d:href>
        <d:propstat><d:prop><nc:trashbin-original-location/></d:prop>
          <d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
      </d:response>
    </d:multistatus>`;
    expect(parseTrashbinOriginalLocations(body)).toEqual([]);
  });

  it('returns nothing for an empty bin or an empty body', () => {
    expect(
      parseTrashbinOriginalLocations(
        `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/remote.php/dav/trashbin/alice/trash/</d:href></d:response></d:multistatus>`,
      ),
    ).toEqual([]);
    expect(parseTrashbinOriginalLocations('')).toEqual([]);
  });
});

describe('nextcloudTrashbinUrl', () => {
  it('derives the bin from the files endpoint', () => {
    expect(nextcloudTrashbinUrl('https://cloud.example.com/remote.php/dav/files/alice/')).toBe(
      'https://cloud.example.com/remote.php/dav/trashbin/alice/trash/',
    );
  });

  it('takes the user from the URL, not from anywhere else', () => {
    // An admin reading another account's files must get THAT account's bin. The
    // configured username can legitimately be a third value.
    expect(
      nextcloudTrashbinUrl('https://cloud.example.com/remote.php/dav/files/bob/Documents'),
    ).toBe('https://cloud.example.com/remote.php/dav/trashbin/bob/trash/');
  });

  it('survives an install under a subdirectory', () => {
    // Anchored on `/dav/files/` rather than the whole `/remote.php/...` prefix,
    // because reverse-proxied installs are ordinary.
    expect(nextcloudTrashbinUrl('https://example.com/nc/remote.php/dav/files/alice/')).toBe(
      'https://example.com/nc/remote.php/dav/trashbin/alice/trash/',
    );
  });

  it('says there is no bin for anything that is not a Nextcloud files endpoint', () => {
    // A plain WebDAV server has no trashbin — RFC 4918 has no such concept — and
    // guessing a URL for one would mean probing a path that means something else
    // entirely on somebody else's server.
    expect(nextcloudTrashbinUrl('https://dav.example.com/webdav/')).toBeUndefined();
    expect(nextcloudTrashbinUrl('https://cloud.example.com/remote.php/webdav')).toBeUndefined();
    expect(nextcloudTrashbinUrl('not a url')).toBeUndefined();
    // `/dav/files/` with no account named after it.
    expect(nextcloudTrashbinUrl('https://cloud.example.com/remote.php/dav/files/')).toBeUndefined();
  });
});

describe('trashbinPathToKeyPath', () => {
  it('matches the form FileItem.path takes', () => {
    // `toRelativePath` strips both slashes; so does this. One leading slash is
    // enough to make every natural key miss.
    expect(trashbinPathToKeyPath('Documents/report.pdf')).toBe('Documents/report.pdf');
    expect(trashbinPathToKeyPath('/Documents/report.pdf')).toBe('Documents/report.pdf');
    expect(trashbinPathToKeyPath('Documents/')).toBe('Documents');
  });

  it('does NOT percent-decode', () => {
    // The property is XML element text, so it already holds real characters —
    // unlike an href, which `toRelativePath` decodes. Decoding again would corrupt
    // any name containing a literal `%`, and a file called `100%.txt` is not exotic.
    expect(trashbinPathToKeyPath('Reports/100%.txt')).toBe('Reports/100%.txt');
    expect(trashbinPathToKeyPath('Reports/a%20b.txt')).toBe('Reports/a%20b.txt');
  });

  it('strips the configured rootPath, because FileItem.path is relative to it', () => {
    // A mapping syncing only `Projects/` records `alpha/plan.md`, while the bin
    // reports `Projects/alpha/plan.md`. Without this the two never meet.
    expect(trashbinPathToKeyPath('Projects/alpha/plan.md', 'Projects')).toBe('alpha/plan.md');
    expect(trashbinPathToKeyPath('Projects/alpha/plan.md', '/Projects/')).toBe('alpha/plan.md');
  });

  it('drops anything deleted outside the sync scope', () => {
    // Not our business, and worse: reporting it would attach a deletion to a key we
    // never wrote a row for, or — with a `rootPath` that happens to be a name
    // prefix — to the wrong file entirely.
    expect(trashbinPathToKeyPath('Personal/taxes.pdf', 'Projects')).toBeUndefined();
    expect(trashbinPathToKeyPath('Projects', 'Projects')).toBeUndefined();
    // `ProjectsOld/` is not inside `Projects/`, and a naive prefix test would say
    // it was — then hand back `Old/notes.md` as if it were a path in scope.
    expect(trashbinPathToKeyPath('ProjectsOld/notes.md', 'Projects')).toBeUndefined();
  });

  it('drops an empty location', () => {
    expect(trashbinPathToKeyPath('')).toBeUndefined();
    expect(trashbinPathToKeyPath('/')).toBeUndefined();
  });
});
