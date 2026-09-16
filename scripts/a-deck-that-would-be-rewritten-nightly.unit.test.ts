// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MEASURED-UNSTABLE EXPORT, COPIED ANYWAY (workplan 0042 T3 and T7,
 * ADR-0046, owner's decision 2026-09-16).
 *
 * `export-office` carries a Google Doc and a Google Sheet correctly. It does
 * not carry a Google Slides deck: measured on a real tenant, five draws, FIVE
 * members of the `.pptx` change content between two exports of a file nobody
 * touched, so ADR-0046's container hash — which settles the Doc and the Sheet —
 * leaves two draws still differing.
 *
 * ## What copying one would do
 *
 * Every later pass would hash the new export, see a value it has not seen,
 * conclude the deck changed, and re-copy it. Nightly. Forever. Every write
 * succeeding, every report green, and the owner's Drive quietly rewritten on a
 * schedule. That is the failure workplan 0042 exists to prevent, and the reason
 * `nativeFilePolicy` defaulted to `refuse` for a year.
 *
 * ## Why this file exists rather than trusting the connector
 *
 * The wiring that makes `export-office` usable landed in the same change as the
 * refusal that makes it safe, and only the pairing is correct. On its own the
 * wiring is the defect: it teaches `contentHash` to settle a rebuilt container,
 * which makes a Doc and a Sheet work and makes a Slides deck look like it
 * works. Somebody removing the refusal would not see anything break — the decks
 * would copy, the pass would be green, and the damage would show up as a
 * storage bill and a target full of duplicated versions weeks later.
 *
 * So the guard names the three places the rule lives and asserts they agree:
 * the table that records what was measured, the connector that refuses on it,
 * and the second gate that stops an export URL being built at all.
 *
 * ## The line between `unstable` and `unmeasured`, which this also holds
 *
 * Only `unstable` refuses. `unmeasured` is recorded and NOT acted on, and that
 * is a deliberate product line rather than an oversight: refusing on absence of
 * a measurement would turn off a Drawing under `export-office` — which a
 * previous change deliberately made work — and would take `export-pdf` on
 * Sheets and Slides with it, the escape hatch an owner reaches for when
 * `export-office` will not do. A blank is a reason to go and measure. A red is
 * a reason to refuse.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXPORT_STABILITY,
  NATIVE_EXPORT_TYPES,
  exportStabilityOf,
} from '@openmig/connectors';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const G = 'application/vnd.google-apps.';

describe('what the measurements say, as the code reads them', () => {
  it('holds a Slides deck under export-office UNSTABLE — the counterexample', () => {
    // The single most important entry in the table. If this flips, a container
    // hash that was only ever validated on a Doc and a Sheet starts deciding
    // whether a customer's decks are rewritten.
    expect(exportStabilityOf('export-office', `${G}presentation`)).toBe('unstable');
  });

  it('holds a Doc and a Sheet under export-office STABLE — why the policy exists', () => {
    // Container-only, both measured the same day on the same tenant. Without
    // these two `export-office` would have nothing to offer and ADR-0046 would
    // have no subject.
    expect(exportStabilityOf('export-office', `${G}document`)).toBe('stable');
    expect(exportStabilityOf('export-office', `${G}spreadsheet`)).toBe('stable');
  });

  it('holds a Doc under export-odf unstable — settings.xml, one format earlier', () => {
    expect(exportStabilityOf('export-odf', `${G}document`)).toBe('unstable');
  });

  it('answers `unmeasured` for a type nobody has run, and for one not listed', () => {
    // The third answer, and the honest one. A table with two answers would have
    // had to guess for every blank.
    expect(exportStabilityOf('export-pdf', `${G}presentation`)).toBe('unmeasured');
    expect(exportStabilityOf('export-office', 'application/vnd.google-apps.form')).toBe(
      'unmeasured',
    );
  });

  it('has an entry for every type each policy can render', () => {
    // The two tables are read together — a rendering with no stability entry
    // would silently answer `unmeasured` and, since `unmeasured` does not
    // refuse, would copy. That is the shape of a gap nobody would notice.
    for (const [policy, renderings] of Object.entries(NATIVE_EXPORT_TYPES)) {
      for (const mime of Object.keys(renderings)) {
        expect(
          EXPORT_STABILITY[policy as keyof typeof EXPORT_STABILITY][mime],
          `${policy} renders ${mime} and EXPORT_STABILITY does not list it, so it would read ` +
            'as `unmeasured` and be copied on no evidence at all',
        ).toBeDefined();
      }
    }
  });
});

describe('the connector acts on the table, in two places', () => {
  const source = read('packages/connectors/src/google-drive-source.ts');

  it('refuses at the per-item boundary, which is what actually holds', () => {
    // A preflight count is a snapshot; a deck added after it must still be
    // refused. This is the gate, and the count on the confirm screen is the
    // early warning — they are not interchangeable.
    expect(source).toMatch(/refusalFor\(file: DriveFile\)/);
    expect(source).toMatch(/exportStabilityOf\(this\.policy, file\.mimeType\) === 'unstable'/);
  });

  it('also refuses to BUILD the export URL, so an ordering cannot undo it', () => {
    // `fetch` asks `refusalFor` first and throws, so nothing unstable reaches
    // the URL builder today. That is an ordering, and orderings get reordered.
    const builder = source.slice(source.indexOf('private exportUrlFor'));
    expect(
      builder.slice(0, builder.indexOf('\n  }')),
      'exportUrlFor stopped consulting the measurement, so the only thing keeping an unstable ' +
        'export from being requested is the order of two statements in fetch()',
    ).toMatch(/exportStabilityOf/);
  });

  it('does NOT refuse an unmeasured combination — a blank is not a red', () => {
    // Asserted as an absence, because the failure mode is somebody "tightening"
    // this and silently turning off every Drawing and every export-pdf Sheet.
    expect(
      source,
      'the connector refuses on `unmeasured`, which turns off paths that work today on the ' +
        'strength of a run nobody has done — see this file\'s header',
    ).not.toMatch(/=== 'unmeasured'/);
  });
});

describe('the hash that makes the safe cases safe', () => {
  it('is reached only for bytes a source MARKED as a rendering', () => {
    // The narrowness is the safety argument (ADR-0046 rule 3). A `.zip` the
    // customer stored must keep being compared by its bytes: for that file the
    // container IS the content, and normalising its member order away would
    // hide a change they made.
    const sync = read('packages/core/src/dav-sync.ts');
    expect(sync).toMatch(/rendering/);
    expect(sync).toMatch(/containerContentHash\(bytes\) \?\? fileContentHash\(bytes\)/);
  });

  it('is set by the export branch and nowhere else in the tree', () => {
    // One writer. If a second appears, the trigger has stopped being "we asked
    // for this rendering" and become a guess about file shape.
    const hits = read('packages/connectors/src/google-drive-source.ts').match(
      /rendering: true as const/g,
    );
    expect(hits?.length, 'the rendering marker has more than one writer').toBe(1);
  });
});
