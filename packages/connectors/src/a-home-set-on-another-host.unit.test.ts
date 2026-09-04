// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A HOME SET THE SERVER PUT ON A DIFFERENT HOST.
 *
 * Workplan 0115 T1. Both DAV sources normalised every href through a private
 * `normalizePath` whose only job was to guarantee a leading and a trailing
 * slash — and whose unwritten assumption was that its argument is a PATH.
 *
 * It is handed three things that can be absolute URLs: a redirect's `Location`,
 * the `calendar-home-set` / `addressbook-home-set` href, and a collection href
 * inside a multistatus. **Every provider this product had answers all three
 * with same-host paths**, so the assumption held, and the entire DAV suite
 * passed — and would have kept passing forever.
 *
 * iCloud is the provider it does not hold for. Apple partitions accounts across
 * hundreds of hosts and answers the home set with an absolute URL naming the
 * one that holds yours. Prefixed with `/`, that became
 *
 *     /https://p34-caldav.icloud.com/1234567890/calendars/
 *
 * a path, on `caldav.icloud.com`, that does not exist — so discovery
 * "succeeded" and every request after it went somewhere with no calendars in
 * it. Nothing threw. The account simply had no calendars.
 *
 * ## Why the helpers are tested and not the connector
 *
 * `normalizeDavHref` and `davPathOf` are where the decision now lives, they are
 * pure, and they are what both sources delegate to — so a test here fails for
 * exactly one reason. The alternative, a stubbed HTTP client per source
 * replaying an iCloud multistatus, would assert the same rule twice through two
 * hundred lines of discovery each, and go red for reasons that are not this.
 *
 * The two sources' delegation is pinned by the last describe block: a
 * `normalizePath` that stopped delegating would pass every test above.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDavHref, davPathOf } from './dav-http.types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** What iCloud actually answers `calendar-home-set` with. */
const ICLOUD_HOME_SET = 'https://p34-caldav.icloud.com/1234567890/calendars/';
/** What Soverin and Nextcloud answer with — the shape that always worked. */
const NEXTCLOUD_HOME_SET = '/remote.php/dav/calendars/someone/';

describe('a home set that names its own host keeps it', () => {
  it('leaves an absolute iCloud home set addressable', () => {
    // The defect, stated as the value it produced: a leading slash in front of
    // a scheme. If this ever comes back, it comes back exactly like this.
    const normalized = normalizeDavHref(ICLOUD_HOME_SET);
    expect(normalized).toBe(ICLOUD_HOME_SET);
    expect(normalized.startsWith('/https://')).toBe(false);
    expect(normalized).toContain('p34-caldav.icloud.com');
  });

  it('still normalises a path exactly as it always did', () => {
    // The regression this change could most easily cause. Every provider that
    // works today answers this shape, and must keep behaving identically.
    expect(normalizeDavHref(NEXTCLOUD_HOME_SET)).toBe(NEXTCLOUD_HOME_SET);
    expect(normalizeDavHref('remote.php/dav/calendars/someone')).toBe(
      '/remote.php/dav/calendars/someone/',
    );
    expect(normalizeDavHref('\\remote.php\\dav\\')).toBe('/remote.php/dav/');
  });

  it('adds the trailing slash to an absolute URL that lacks one', () => {
    expect(normalizeDavHref('https://p34-caldav.icloud.com/1234567890/calendars')).toBe(
      'https://p34-caldav.icloud.com/1234567890/calendars/',
    );
  });

  it('drops a query and a fragment, because a collection is a path', () => {
    expect(normalizeDavHref('https://p34-caldav.icloud.com/123/calendars/?x=1#frag')).toBe(
      'https://p34-caldav.icloud.com/123/calendars/',
    );
  });

  it('treats an absolute-looking href it cannot parse as a path, as before', () => {
    // Never throw during discovery over a malformed href: the pre-0115
    // behaviour was to treat it as a path, and a refusal here would turn a
    // strange server into a crash rather than an empty listing.
    expect(() => normalizeDavHref('https://[not-a-host/calendars/')).not.toThrow();
  });
});

describe('two hrefs naming one collection compare equal', () => {
  it('matches an absolute home set against the path beside it', () => {
    // iCloud's multistatus lists the home set itself with a PATH href while the
    // home set we hold carries a HOST. As strings those differ, and the home
    // set gets offered as an address book to migrate.
    expect(davPathOf(ICLOUD_HOME_SET)).toBe('/1234567890/calendars/');
    expect(davPathOf('/1234567890/calendars/')).toBe(davPathOf(ICLOUD_HOME_SET));
  });

  it('does not make two genuinely different collections equal', () => {
    // The control: the comparison must still say no to what is actually a
    // different collection, or the skip drops a real address book.
    expect(davPathOf('https://p34-caldav.icloud.com/123/calendars/work/')).not.toBe(
      davPathOf('https://p34-caldav.icloud.com/123/calendars/'),
    );
  });

  it('ignores the host, which is the whole point', () => {
    // Same account, two partition names (Apple has been observed to answer with
    // either the bare or the partitioned host). One collection.
    expect(davPathOf('https://caldav.icloud.com/123/calendars/')).toBe(
      davPathOf('https://p34-caldav.icloud.com/123/calendars/'),
    );
  });
});

describe('both sources delegate rather than keeping their own copy', () => {
  // Read as TEXT. The rule is that neither file re-implements the slash logic:
  // a private copy would pass every test above while iCloud stayed broken,
  // which is precisely the failure this file exists to prevent. Two identical
  // copies of `normalizePath` in two files is how the defect survived.
  const source = (name: string) => readFileSync(join(HERE, name), 'utf8');

  for (const file of ['caldav-source.ts', 'carddav-source.ts']) {
    it(`${file} normalises through the shared helper`, () => {
      const text = source(file);
      expect(text, `${file} no longer imports the shared helper`).toContain('normalizeDavHref');
      expect(
        /normalized\s*=\s*'\/'\s*\+\s*normalized/.test(text),
        `${file} has its own copy of the slash logic again — an absolute href will be ` +
          'turned into a path that cannot exist, and no other test in this repository ' +
          'will notice, because no provider but iCloud sends one',
      ).toBe(false);
    });
  }

  it('carddav compares home sets by path, not as strings', () => {
    expect(
      source('carddav-source.ts'),
      'the home-set skip is back to comparing raw strings: with an absolute home set and ' +
        'path hrefs beside it, the home set itself is offered as an address book',
    ).toContain('davPathOf(path) === davPathOf(homeSet)');
  });
});
