// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A NAME NEXTCLOUD WILL NOT STORE (the owner's report, 2026-09-23).
 *
 * One file on his live OneDrive → Nextcloud migration failed five times, and
 * Nextcloud said why in its own words: `OCP\Files\ForbiddenException — Invalid
 * path`. The file was a `.htaccess`. Nextcloud refuses that name wherever it is
 * put (`forbidden_filenames`, default `['.htaccess']`), with a retry flag of
 * false, so no pass will ever get it in.
 *
 * It read `target_refused` through its `status 500`, and the Failures page put
 * "a full mailbox, a read-only folder or missing permission" under a FILE. The
 * owner: *"the text talking about 'full mailbox' is weird to read at the
 * Files-kind."* A destination refusing a name is `format_refused`, whose
 * remedy is about the file and not the account.
 *
 * The fixtures keep Nextcloud's words and the file's name. The folders are
 * invented; the owner's are his.
 */
import { describe, it, expect } from 'vitest';
import { classifyFailure } from './failure-category.ts';

/** The observed line, in the shape `davRefusalBody` makes of Sabre's error document. */
const OBSERVED =
  'PUT failed for Documents/website/.htaccess with status 500: ' +
  'OCP\\Files\\ForbiddenException — Invalid path: files/owner/Documents/website/.htaccess';

/**
 * The same refusal where Nextcloud's DAV layer does convert it: a 403 with the
 * same message. Read in `apps/dav/lib/Connector/Sabre/File.php`, not observed.
 */
const CONVERTED =
  'PUT failed for Documents/website/.htaccess with status 403: ' +
  'OCA\\DAV\\Connector\\Sabre\\Exception\\Forbidden — Invalid path: files/owner/Documents/website/.htaccess';

/** How a refusal from Nextcloud 30's `FilenameValidator` reaches the ledger (400, `InvalidPath`). */
const invalidPath = (message: string): string =>
  `PUT failed for Documents/website/x with status 400: OCA\\DAV\\Connector\\Sabre\\Exception\\InvalidPath — ${message}`;

describe('a name Nextcloud will never store', () => {
  it('reads the observed 500 as a refused name, not as a full mailbox', () => {
    expect(classifyFailure(OBSERVED, 'target')).toBe('format_refused');
  });

  it('reads it the same on a row that recorded no side', () => {
    // The words are the destination's own, so the side cannot change them.
    // The default reading of an unsided refusal is the target anyway.
    expect(classifyFailure(OBSERVED)).toBe('format_refused');
  });

  it('reads the converted 403 the same way', () => {
    expect(classifyFailure(CONVERTED, 'target')).toBe('format_refused');
  });

  it.each([
    ['a forbidden name', '".htaccess" is a forbidden file or folder name.'],
    ['a forbidden prefix', '"con.txt" is a forbidden prefix for file or folder names.'],
    ['a forbidden character', '"?" is not allowed inside a file or folder name.'],
    ['a forbidden ending', 'Filenames must not end with " ".'],
  ])("reads %s, as Nextcloud 30's filename check words it", (_what, message) => {
    // Published in `lib/private/Files/FilenameValidator.php`, and a 400 that
    // no other rule reads: without these each one was `unknown`, whose
    // remedy is "send it to us".
    expect(classifyFailure(invalidPath(message), 'target')).toBe('format_refused');
  });
});

describe('what the same exception says about something else', () => {
  it('leaves a refused symlink a plain refusal: it is not about a name', () => {
    // `Local.php` throws the same ForbiddenException for a symlink it will not
    // follow. Only `Invalid path` after it is the refused name.
    expect(
      classifyFailure(
        'PUT failed for a with status 500: OCP\\Files\\ForbiddenException — Following symlinks is not allowed',
        'target',
      ),
    ).toBe('target_refused');
  });

  it('leaves a bare Forbidden a plain refusal, as it always was', () => {
    expect(classifyFailure('PUT failed for /files/a.svg with status 403: Forbidden', 'target')).toBe(
      'target_refused',
    );
  });

  it('keeps the side: the same words from a source are the source refusing', () => {
    expect(classifyFailure(OBSERVED, 'source')).toBe('source_refused');
  });

  it('does not outrank an expired credential or a rate limit', () => {
    expect(classifyFailure(`invalid_grant after ${OBSERVED}`, 'target')).toBe('auth_expired');
    expect(classifyFailure(`429 too many requests; earlier ${OBSERVED}`, 'target')).toBe('rate_limited');
  });
});
