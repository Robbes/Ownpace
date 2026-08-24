// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * Which connectors any gate has ever actually driven.
 *
 * ## The question that produced this file
 *
 * "Do the e2e gates have sufficient coverage?" — and the answer, found by
 * deriving the connector list from `config.ts` and grepping all three gates,
 * was that `imap-dav` is a first-class TARGET the API itself constructs
 * (`apps/api/src/routes/migrations/index.ts`), parses, and builds dependencies
 * for — and that no gate, seed, appliance config or smoke has ever selected
 * it. Mail written to an IMAP target rather than a JMAP one is a shipping
 * path that only unit tests have opinions about.
 *
 * That gap could not be seen from any one place. `gate-coverage.unit.test.ts`
 * derives ROUTE families from `index.ts` and asks whether the smoke requests
 * them; nothing did the same for the thing underneath a route — the connector
 * a migration actually runs on.
 *
 * ## Three answers, and only three
 *
 * Every source and target type must be classified, and the classification is
 * the point:
 *
 *   DRIVEN     a live gate stands the thing up and migrates through it.
 *   UNCOVERABLE something outside this repository is required — a third-party
 *              OAuth tenant, somebody's Google account — so a gate cannot
 *              honestly drive it. A REASON is mandatory.
 *   OWED       coverable here, with what the gates already stand up, and not
 *              done. This list is meant to shrink and must never grow
 *              silently.
 *
 * OWED is separate from UNCOVERABLE deliberately. Folding "we have not got to
 * it" in with "it needs a Google account" is how a closable gap becomes
 * permanent: both read as "not covered", and only one of them should ever be
 * accepted. `gate-coverage.unit.test.ts` requires a sentence for the same
 * reason; this file additionally requires that the sentence be TRUE about
 * whose fault the gap is.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string): string => readFileSync(REPO + path, 'utf8');

const config = read('packages/shared/src/config.ts');

/**
 * The types a parser actually accepts, read out of the parser rather than
 * listed here. A hand-kept list is the failure mode this whole family of
 * guards exists for.
 */
function typesAcceptedBy(fn: 'parseSource' | 'parseTarget', unsupportedMarker: string): string[] {
  const start = config.indexOf(`function ${fn}(`);
  const end = config.indexOf(unsupportedMarker, start);
  if (start < 0 || end < 0) return [];
  return [...new Set([...config.slice(start, end).matchAll(/type === '([a-z0-9-]+)'/g)].map((m) => m[1]!))];
}

const SOURCES = typesAcceptedBy('parseSource', 'source.type: unsupported');
const TARGETS = typesAcceptedBy('parseTarget', 'target.type: unsupported');

type Verdict = { driven?: string; uncoverable?: string; owed?: string };

/** Every SOURCE type, and what has ever driven it. */
const SOURCE_COVERAGE: Record<string, Verdict> = {
  'imap-oauth2': { driven: 'e2e.yml — Stalwart over IMAPS on 993, every nightly, both backends' },
  caldav: { driven: 'e2e.yml — Nextcloud calendars, seeded then migrated and verified' },
  carddav: { driven: 'e2e.yml — Nextcloud contacts, same pass' },
  webdav: { driven: 'e2e.yml — Nextcloud files, same pass' },
  'graph-mail': { driven: 'e2e-o365.yml — a real SMB tenant, read-only, secret-gated' },
  'graph-calendar': {
    uncoverable:
      'the O365 tenant is real and read-only, and e2e-o365.yml is secret-gated: it ' +
      'covers mail. Standing up a fake Graph would test the fake.',
  },
  'graph-contacts': { uncoverable: 'same tenant, same reason as graph-calendar.' },
  'graph-drive': { uncoverable: 'same tenant, same reason as graph-calendar.' },
  gmail: { uncoverable: 'needs a Google account and its OAuth consent. Nothing in CI can hold one.' },
  'google-calendar': { uncoverable: 'same Google account, same reason as gmail.' },
  'google-contacts': { uncoverable: 'same Google account, same reason as gmail.' },
  'google-drive': { uncoverable: 'same Google account, same reason as gmail.' },
  dropbox: { uncoverable: 'needs a Dropbox app and a real account. Same class as gmail.' },
  box: { uncoverable: 'needs a Box app and a real account. Same class as gmail.' },
};

/** Every TARGET type, and what has ever driven it. */
const TARGET_COVERAGE: Record<string, Verdict> = {
  jmap: { driven: 'e2e.yml — Stalwart JMAP, the mail target every nightly writes into' },
  caldav: { driven: 'e2e.yml — Nextcloud, calendar target' },
  carddav: { driven: 'e2e.yml — Nextcloud, contact target' },
  webdav: { driven: 'e2e.yml — Nextcloud, file target' },
  'imap-dav': {
    owed:
      'mail written to an IMAP target instead of a JMAP one. The API constructs this ' +
      'type (routes/migrations/index.ts), config.ts parses it and build-deps builds it — ' +
      'and no gate, seed or appliance config has ever selected it. COVERABLE HERE: the ' +
      'same Stalwart the gates already stand up serves IMAP on 993 and already has the ' +
      'target account provisioned, so this needs no new infrastructure and no credentials.',
  },
};

describe('every connector the config accepts is classified', () => {
  it('derived the real lists, rather than trusting one written here', () => {
    // Vacuity guard: an empty derivation would make every check below pass.
    expect(SOURCES.length, 'no source types derived from config.ts').toBeGreaterThan(8);
    expect(TARGETS.length, 'no target types derived from config.ts').toBeGreaterThan(3);
    expect(SOURCES).toContain('graph-mail');
    expect(TARGETS).toContain('imap-dav');
  });

  for (const [label, derived, coverage] of [
    ['source', SOURCES, SOURCE_COVERAGE],
    ['target', TARGETS, TARGET_COVERAGE],
  ] as const) {
    it(`every ${label} type config.ts accepts has a verdict`, () => {
      const missing = derived.filter((t) => !(t in coverage));
      expect(
        missing,
        `${label} type(s) ${missing.join(', ')} can be configured but no gate coverage verdict ` +
          'exists. Add one: driven (a gate stands it up), uncoverable (with the reason nothing ' +
          'here can), or owed (coverable and not done).',
      ).toEqual([]);
    });

    it(`no ${label} verdict describes a type that no longer exists`, () => {
      // The other direction: a connector deleted while its verdict stayed
      // leaves a coverage claim about nothing.
      const stale = Object.keys(coverage).filter((t) => !derived.includes(t));
      expect(stale, `verdict(s) for removed ${label} type(s): ${stale.join(', ')}`).toEqual([]);
    });

    it(`every ${label} verdict says exactly one thing, and says it in a sentence`, () => {
      for (const [type, v] of Object.entries(coverage)) {
        const given = (['driven', 'uncoverable', 'owed'] as const).filter((k) => v[k]);
        expect(given.length, `${label} ${type}: expected exactly one verdict, got ${given.length}`).toBe(1);
        // A one-word reason is how "not covered" becomes permanent.
        expect((v[given[0]!] ?? '').length, `${label} ${type}: the reason is too short to be one`).toBeGreaterThan(30);
      }
    });
  }
});

describe('what is owed stays visible, and stays small', () => {
  const owed = [
    ...Object.entries(SOURCE_COVERAGE).filter(([, v]) => v.owed).map(([t]) => `source:${t}`),
    ...Object.entries(TARGET_COVERAGE).filter(([, v]) => v.owed).map(([t]) => `target:${t}`),
  ];

  it('is exactly the list this repository has admitted to', () => {
    // A HARD list, not a ceiling. Adding a connector and marking it `owed`
    // fails here until somebody writes that decision down on purpose — which
    // is the moment to ask whether it should just be driven instead.
    expect(owed).toEqual(['target:imap-dav']);
  });

  it('nothing is filed as uncoverable when this repo can plainly cover it', () => {
    // Stalwart and Nextcloud are already stood up by e2e.yml, so any type
    // served by either is coverable by construction and may not hide in
    // UNCOVERABLE. imap-dav is the one this rule was written to catch.
    const localTypes = ['jmap', 'imap-dav', 'caldav', 'carddav', 'webdav', 'imap-oauth2'];
    for (const [type, v] of [...Object.entries(SOURCE_COVERAGE), ...Object.entries(TARGET_COVERAGE)]) {
      if (localTypes.includes(type)) {
        expect(v.uncoverable, `${type} is served by Stalwart or Nextcloud — it cannot be "uncoverable"`).toBeUndefined();
      }
    }
  });
});
