// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * AN ANSWER THAT MUST MATCH ITS TWIN (2026-09-17).
 *
 * The owner measured `export-office` on a Drawing: 8324 bytes and one hash,
 * five draws. That reading belongs to `export-odf` as well, and not because
 * the two policies are similar — because they are, for a Drawing, THE SAME
 * REQUEST. `exportUrlFor` builds the export url from
 * `NATIVE_EXPORT_TYPES[policy][mimeType]` and nothing else; the policy's name
 * never reaches Google. A Drawing has neither an ODF nor an Office form, so
 * both entries read `image/svg+xml`, and both produce
 * `files/{id}/export?mimeType=image%2Fsvg%2Bxml`. One url, one answer.
 *
 * ## Why this is a guard and not a sentence in a comment
 *
 * The obvious failure is a later measurement recorded under one policy and not
 * its twin, leaving a blank beside a green for a request that has been run.
 * That is untidy. The failure that MATTERS is the other order: somebody
 * measures the Drawing unstable under one of them and moves one entry, and now
 * the connector refuses a Drawing under `export-office` and exports the
 * byte-identical response under `export-odf`. Half the migrations get a
 * failure row with a reason; the other half get the nightly rewrite the table
 * exists to prevent, and the table looks fully populated either way.
 *
 * A comment saying "keep these two together" is the thing this repo has
 * already watched expire once — the Drawing was "deliberately absent" from
 * `DriveFileKind` on reasoning that was sound when written and a hole by the
 * time `unmeasured`-copies was decided (#979). So: a rule, derived from the
 * url, that fails on the pair rather than on the two names.
 */
import { describe, it, expect } from 'vitest';
import {
  EXPORT_STABILITY,
  NATIVE_EXPORT_TYPES,
  exportStabilityOf,
  nativeFileWord,
  stablePoliciesFor,
  type NativeFilePolicy,
} from './google-drive-source.types.ts';

type ExportPolicy = Exclude<NativeFilePolicy, 'refuse'>;

const POLICIES = Object.keys(NATIVE_EXPORT_TYPES) as ExportPolicy[];

/** Every (source type, export type) that more than one policy asks Drive for. */
function twins(): Array<{ source: string; target: string; policies: ExportPolicy[] }> {
  const byRequest = new Map<string, { source: string; target: string; policies: ExportPolicy[] }>();
  for (const policy of POLICIES) {
    for (const [source, target] of Object.entries(NATIVE_EXPORT_TYPES[policy])) {
      const key = `${source} -> ${target}`;
      const found = byRequest.get(key) ?? { source, target, policies: [] };
      found.policies.push(policy);
      byRequest.set(key, found);
    }
  }
  return [...byRequest.values()].filter((entry) => entry.policies.length > 1);
}

describe('policies that issue the same request carry the same answer', () => {
  it('there is at least one such pair, or this guard is watching nothing', () => {
    // If this ever goes to zero the guard has stopped guarding and should be
    // deleted rather than left passing. Today it is the Drawing's SVG.
    expect(twins().length).toBeGreaterThan(0);
  });

  it.each(twins())(
    'every policy asking for $target on a $source answers alike',
    ({ source, target, policies }) => {
      const answers = policies.map((policy) => ({
        policy,
        stability: exportStabilityOf(policy, source),
      }));
      const distinct = new Set(answers.map((a) => a.stability));
      expect(
        distinct.size,
        `${policies.join(' and ')} send files/{id}/export?mimeType=${target} for a ` +
          `${nativeFileWord(source)}, so they are ONE request and cannot have ` +
          `${distinct.size} answers — got ` +
          answers.map((a) => `${a.policy}=${a.stability}`).join(', ') +
          '. Move them together, or change what one of them renders.',
      ).toBe(1);
    },
  );

  it('the Drawing is that pair, and the measurement reached both', () => {
    const drawing = 'application/vnd.google-apps.drawing';
    expect(NATIVE_EXPORT_TYPES['export-odf'][drawing]).toBe('image/svg+xml');
    expect(NATIVE_EXPORT_TYPES['export-office'][drawing]).toBe('image/svg+xml');
    expect(exportStabilityOf('export-odf', drawing)).toBe('stable');
    expect(exportStabilityOf('export-office', drawing)).toBe('stable');
  });

  it('export-pdf is NOT in that pair: a PDF of a Drawing is its own request', () => {
    const drawing = 'application/vnd.google-apps.drawing';
    expect(NATIVE_EXPORT_TYPES['export-pdf'][drawing]).toBe('application/pdf');
    // Still blank, and honestly so — nobody has run it. A twin rule that
    // dragged this to `stable` would be exactly the guess the table forbids.
    expect(exportStabilityOf('export-pdf', drawing)).toBe('unmeasured');
  });

  it('a PDF shared across DIFFERENT source types is not a twin', () => {
    // Doc, Sheet and Slide all render to application/pdf, and they are three
    // renderers and three requests. The rule is keyed on the pair, not on the
    // export type alone — otherwise one red Slide would condemn every Doc.
    const pdfSources = Object.keys(NATIVE_EXPORT_TYPES['export-pdf']);
    expect(pdfSources.length).toBeGreaterThan(1);
    expect(twins().some((t) => t.target === 'application/pdf')).toBe(false);
  });
});

describe('the measurement reaches the advice', () => {
  it('a Drawing now has two measured ways to carry it', () => {
    expect([...stablePoliciesFor('application/vnd.google-apps.drawing')].sort()).toEqual([
      'export-odf',
      'export-office',
    ]);
  });

  it('the Slide still has exactly one, and it is the PDF', () => {
    expect(stablePoliciesFor('application/vnd.google-apps.presentation')).toEqual(['export-pdf']);
  });

  it('every stable entry can actually be rendered by that policy', () => {
    // `stablePoliciesFor` consults both tables; this checks the tables agree at
    // the source, so a green never names a format Drive would answer 400 for.
    for (const policy of POLICIES) {
      for (const [source, stability] of Object.entries(EXPORT_STABILITY[policy])) {
        if (stability !== 'stable') continue;
        expect(
          NATIVE_EXPORT_TYPES[policy][source],
          `${policy} is measured stable for ${source} but renders nothing for it`,
        ).toBeDefined();
      }
    }
  });
});
