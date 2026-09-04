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
import { execFileSync } from 'node:child_process';
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
  // THE O365 HARNESS HAS NEVER RUN. e2e-o365.yml is workflow_dispatch-only and
  // has ZERO runs in its lifetime; the suite it invokes skips silently unless
  // O365_CLIENT_ID and O365_TENANT_ID are set, so even a run without them
  // would report pass having executed nothing. It was recorded here as
  // `driven` on first writing — the exact laundering of an appearance into an
  // assertion this file exists to prevent, caught by asking the API how many
  // times the workflow had actually run.
  'graph-mail': {
    owed:
      'a harness exists (test/e2e/o365-scenario.e2e.test.ts) and has never once ' +
      'executed. The tenant is real and available, so this is UNWIRED, not ' +
      'impossible: secrets are not set and no schedule fires it.',
  },
  'graph-calendar': {
    owed:
      'the tenant is real and read-only and could serve this, and no harness covers ' +
      'it — the O365 suite is mail-only, and has never run even for mail.',
  },
  'graph-contacts': { owed: 'same tenant, same absence of a harness, as graph-calendar.' },
  'graph-drive': { owed: 'same tenant, same absence of a harness, as graph-calendar.' },
  gmail: { uncoverable: 'needs a Google account and its OAuth consent. Nothing in CI can hold one.' },
  'google-calendar': { uncoverable: 'same Google account, same reason as gmail.' },
  'google-contacts': { uncoverable: 'same Google account, same reason as gmail.' },
  'google-drive': { uncoverable: 'same Google account, same reason as gmail.' },
  // The ACCOUNT kind (workplan 0106 T3b). Same wall, and one step higher: it
  // needs not only a Google account but a consent screen approved for SEVERAL
  // scopes at once — the thing no CI job can press.
  google: { uncoverable: 'same Google account, same reason as gmail — and its consent is multi-scope.' },
  // The MICROSOFT account kind (workplan 0114). `uncoverable` and not `owed`,
  // which is the opposite verdict from the four `graph-*` types above, and the
  // difference is the FLOW rather than the tenant. Those are owed because the
  // reference tenant is real and client-credentials could reach it unattended.
  // This row exists to carry a DELEGATED refresh token — the whole point of
  // the grant button — and a delegated token comes from a person pressing a
  // consent screen. Nothing in CI can press one. 0114 T8's managed-gate
  // assertions use a sentinel pair that is never followed to Microsoft: they
  // cover the client CONFIGURATION and deliberately not a sync, so they must
  // never be read as driving this.
  microsoft: {
    uncoverable:
      'needs a Microsoft 365 account and a delegated consent screen somebody presses. ' +
      'Client-credentials cannot substitute: this row exists for the delegated flow.',
  },
  dropbox: { uncoverable: 'needs a Dropbox app and a real account. Same class as gmail.' },
  box: { uncoverable: 'needs a Box app and a real account. Same class as gmail.' },
  // THE ONE SOURCE CI COULD FULLY DRIVE, and the only `owed` that is not
  // waiting on somebody else's tenant (workplan 0116 T1).
  //
  // Every `uncoverable` above says the same thing: it needs a real account at
  // a real provider and a consent nothing in CI can press. An archive needs
  // NEITHER. It is a folder of files, so a fixture tree checked into this
  // repository is a complete and honest stand-in — the same bytes a person's
  // export contains, minus the person. That makes this `owed` rather than
  // `uncoverable`, and it is 0116 T10: a tiny fixture archive of each shape,
  // imported end to end, asserting item count, hashes and a second import
  // writing nothing.
  //
  // `takeout-archive-reader.unit.test.ts` already drives the READER against
  // such a tree. It is not written here as `driven` because this table asks
  // what a GATE stands up, and a unit test is not a gate — recording it as
  // driven would be the laundering of an appearance into an assurance that
  // `graph-calendar` above exists to warn about.
  archive: {
    owed:
      'the only source type CI could drive completely — a fixture export tree needs no '
      + 'account, no consent and no network. Workplan 0116 T10.',
  },
};

/** Every TARGET type, and what has ever driven it. */
const TARGET_COVERAGE: Record<string, Verdict> = {
  jmap: { driven: 'e2e.yml — Stalwart JMAP, the mail target every nightly writes into' },
  caldav: { driven: 'e2e.yml — Nextcloud, calendar target' },
  carddav: { driven: 'e2e.yml — Nextcloud, contact target' },
  webdav: { driven: 'e2e.yml — Nextcloud, file target' },
  'imap-dav': {
    driven:
      "imap-dav-target.integration.test.ts drives the product's own buildDeps into a real " +
      'Stalwart from Testcontainers and confirms the write with an INDEPENDENT IMAP client. ' +
      'Runs on every pull request, on both architectures. Owed until 2026-08-24.',
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

describe('what is owed stays visible, and stays exact', () => {
  const owed = [
    ...Object.entries(SOURCE_COVERAGE).filter(([, v]) => v.owed).map(([t]) => `source:${t}`),
    ...Object.entries(TARGET_COVERAGE).filter(([, v]) => v.owed).map(([t]) => `target:${t}`),
  ];

  it('is exactly the list this repository has admitted to', () => {
    // A HARD list, not a ceiling. Adding a connector and marking it `owed`
    // fails here until somebody writes that decision down on purpose — which
    // is the moment to ask whether it should just be driven instead.
    //
    // Four of these five are the O365 family, and they are one decision, not
    // four: whether a real-tenant path is exercised by a harness nobody runs,
    // by a documented manual migration somebody actually performs, or not at
    // all. Until that is decided, saying so here is more honest than a
    // workflow file that has never executed.
    // imap-dav left this list on 2026-08-24 — the only entry that was ever
    // coverable with what the gates already stand up, and now driven.
    //
    // `source:archive` joined on 2026-09-04 (0116 T1) and is a DIFFERENT
    // admission from the four above it. Theirs is "we have a tenant and no
    // harness"; this one is "we need neither, and have not built the gate
    // yet" — a fixture export tree checked into this repository is a complete
    // stand-in, because an archive is a folder of files rather than an
    // account. It is therefore the entry most likely to be wrong to leave
    // here, which is exactly what a hard list is for.
    expect(owed).toEqual([
      'source:graph-mail',
      'source:graph-calendar',
      'source:graph-contacts',
      'source:graph-drive',
      'source:archive',
    ]);
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

describe('a "driven" verdict names something that actually runs', () => {
  /**
   * The O365 correction earlier in this file was caught by asking the API how
   * many times a workflow had run. That check cannot live in a unit test — but
   * a cheaper half can: a verdict that names a test FILE must name one that
   * exists, and a gate must actually invoke it. A verdict pointing at a
   * deleted file, or at one no workflow runs, is the same laundering one step
   * later.
   */
  const workflows = ['e2e.yml', 'e2e-managed.yml', 'e2e-o365.yml']
    .map((f) => readFileSync(REPO + '.github/workflows/' + f, 'utf8'))
    .join('\n');
  const ci = readFileSync(REPO + '.github/workflows/ci.yml', 'utf8');

  /** Where a named test file actually is, or '' if it is nowhere. */
  function locate(file: string): string {
    const candidates = execFileSync(
      'find',
      ['test', 'packages', 'apps', 'scripts', '-name', file, '-not', '-path', '*/node_modules/*'],
      { cwd: REPO, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);
    return candidates[0] ?? '';
  }

  it('every test file a verdict names exists, and something actually runs it', () => {
    const named = [...Object.values(SOURCE_COVERAGE), ...Object.values(TARGET_COVERAGE)]
      .map((v) => v.driven ?? '')
      .flatMap((reason) =>
        [...reason.matchAll(/([\w.-]+\.(?:e2e|integration)\.test\.ts)/g)].map((m) => m[1]!),
      );
    expect(named.length, 'no verdict names a test file — this test would be vacuous').toBeGreaterThan(0);
    for (const file of named) {
      const at = locate(file);
      expect(at, `${file} is named as driving a connector but exists nowhere`).not.toBe('');
      if (file.endsWith('.e2e.test.ts')) {
        // An e2e runs only if a workflow names the path.
        expect(workflows, `${file} exists but no gate runs it`).toContain(file);
      } else {
        // Integration tests run as a project, not by path — so what has to be
        // true is that CI runs that project at all.
        expect(ci, 'ci.yml does not run the integration project').toContain('pnpm test:integration');
      }
    }
  });
});
