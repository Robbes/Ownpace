// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * THREE REPORT BODIES, THREE DIFFERENT WAYS OF BEING WRONG.
 *
 * On 2026-09-07 the owner's Google connection card read:
 *
 *     Contacts — not measured: addressbook-query REPORT failed with status
 *     400: Request contains an invalid argument.
 *
 * RFC 6352 §10.3 gives `addressbook-query` this content model:
 *
 *     <!ELEMENT addressbook-query ((DAV:allprop | DAV:propname | DAV:prop)?,
 *                                  filter, limit?)>
 *
 * `filter` carries no `?`. Two of this repo's three bodies had none at all and
 * the third had a CalDAV `comp-filter` nesting borrowed from the calendar
 * writer sitting beside it. Servers that accepted the first two were being
 * generous; Google was not, and said so in a sentence naming no element.
 *
 * ## Why a guard rather than three fixes
 *
 * Because there were three, in two packages, written months apart, and each
 * looked right in isolation. The next one will too. This is the fan-out family
 * — `source-face-builders.ts`, `provider-clients.ts` and
 * `deployment-application.ts` each open with a version of the same sentence —
 * and the only thing that has ever caught it here is a test that DERIVES the
 * list rather than enumerating it.
 *
 * ## What it checks, and what it deliberately does not
 *
 * That every `addressbook-query` body in the repo carries a filter, that the
 * filter is namespaced with a prefix that body actually declares, and that
 * none of them contains a `comp-filter`. It says nothing about whether the
 * filter MATCHES anything — that is `carddav-query.unit.test.ts`'s question,
 * beside the two builders, where it can be asked of a value rather than of
 * source text.
 *
 * The three bodies it currently covers live in
 * `packages/connectors/src/carddav-source.ts` (the sync-collection fallback)
 * and `packages/engines/src/carddav-target-writer.ts` (the collection listing
 * and the per-item existence check). The builders are
 * `packages/shared/src/carddav-query.ts`.
 *
 * ROOT-LEVEL, SO VITEST AND NODE BUILTINS ONLY (AGENTS.md): a query body is
 * a template literal inside a private method, so there is nothing to import
 * and drive. It is read as text, which is what makes it a syntactic property.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CARDDAV_NS = 'urn:ietf:params:xml:ns:carddav';

/** Where a DAV request body can live. */
const DIRS = ['packages/connectors/src', 'packages/engines/src', 'packages/shared/src'];

interface Query {
  /** `packages/engines/src/carddav-target-writer.ts:296` */
  readonly at: string;
  /** The prefix bound to the CardDAV namespace in this body. */
  readonly prefix: string;
  /** Everything between the opening and closing `addressbook-query` tags. */
  readonly body: string;
}

/** Every `addressbook-query` request body written in this repo. */
function addressbookQueries(): Query[] {
  const out: Query[] = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!name.endsWith('.ts') || name.includes('.test.')) continue;
      const text = readFileSync(join(ROOT, dir, name), 'utf8');
      // `\1` — the closing tag must use the same prefix as the opening one,
      // so a body is never read as running past its own end.
      const pattern = /<([A-Za-z0-9_-]+):addressbook-query\b([\s\S]*?)<\/\1:addressbook-query>/g;
      for (const match of text.matchAll(pattern)) {
        const body = match[2] ?? '';
        const line = text.slice(0, match.index).split('\n').length;
        // The prefix the body itself binds to CardDAV — not assumed to be the
        // element's own, because a document may bind several.
        const bound = new RegExp(`xmlns:([A-Za-z0-9_-]+)="${CARDDAV_NS}"`).exec(body);
        out.push({
          at: `${dir}/${name}:${line}`,
          prefix: bound?.[1] ?? match[1] ?? '',
          body,
        });
      }
    }
  }
  return out;
}

describe('every addressbook-query carries the filter RFC 6352 requires', () => {
  const queries = addressbookQueries();

  it('finds the query bodies at all — this guard is not passing on an empty list', () => {
    // The failure this control exists for: a rename, a move, or a body
    // reformatted across lines makes the pattern match nothing, and every
    // assertion below passes having read no code.
    expect(
      queries.map((q) => q.at),
      'no addressbook-query body was found to check',
    ).toHaveLength(3);
  });

  it.each(queries.map((q) => [q.at, q]))('%s has a filter', (_at, query) => {
    const q = query as Query;
    // Either written out, or built by one of the two shared builders. Both
    // count; what does not count is nothing.
    const inline = new RegExp(`<${q.prefix}:filter[\\s>/]`).test(q.body);
    const built = /carddav(MatchAll|Uid)Filter\(/.test(q.body);
    expect(
      inline || built,
      `${q.at} sends an addressbook-query with no <filter>. RFC 6352 §10.3 does not make it ` +
        'optional and Google refuses the body with "Request contains an invalid argument" — ' +
        "use carddavMatchAllFilter(prefix) from @openmig/shared for a listing, or " +
        'carddavUidFilter(uid, prefix) to ask about one card',
    ).toBe(true);
  });

  it.each(queries.map((q) => [q.at, q]))('%s filters under a prefix it declares', (_at, query) => {
    const q = query as Query;
    // A builder called with the wrong prefix emits an undeclared namespace:
    // legal-looking text that a server either refuses or silently ignores.
    // This is the cost of passing the prefix in, and the reason it is worth
    // paying — a mismatch is checkable from here.
    const built = [...q.body.matchAll(/carddav(?:MatchAll|Uid)Filter\([^)]*'([^']+)'\s*\)/g)];
    for (const call of built) {
      expect(
        call[1],
        `${q.at} builds its filter with prefix '${call[1]}', but binds ${CARDDAV_NS} to ` +
          `'${q.prefix}' — the filter would carry an undeclared namespace prefix`,
      ).toBe(q.prefix);
    }
    // And the body must bind CardDAV somewhere, or there is no prefix to check.
    expect(q.body, `${q.at} declares no CardDAV namespace`).toContain(CARDDAV_NS);
  });

  it.each(queries.map((q) => [q.at, q]))('%s speaks CardDAV, not CalDAV', (_at, query) => {
    const q = query as Query;
    // The third defect: `<C:comp-filter name="VADDRESSBOOK"><C:comp-filter
    // name="VCARD">…`, copied from the calendar writer. RFC 6352 has no
    // comp-filter element — a vCard is not a container of components — and
    // §8.6's own example filters on a prop-filter directly.
    expect(
      q.body,
      `${q.at} nests a comp-filter inside an addressbook-query. That is RFC 4791 grammar; ` +
        'RFC 6352 §10.5 has only prop-filter',
    ).not.toContain('comp-filter');
  });
});
