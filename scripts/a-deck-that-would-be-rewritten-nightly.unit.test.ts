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
 * previous change deliberately made work — and would have taken `export-pdf` on
 * Sheets and Slides with it. Those two were measured the day after, and both
 * came back STABLE: the escape hatch would have been shut on no evidence, one
 * day before the evidence arrived. A blank is a reason to go and measure. A red
 * is a reason to refuse.
 *
 * ## The way out, which is the other half of a refusal
 *
 * A gate that names no alternative is a wall. `export-pdf` is measured stable
 * on a Doc, a Sheet AND a Slide, so the deck this file is named after has a
 * format that carries it — and the refusal says which, derived from the table
 * by `stablePoliciesFor` rather than written into the sentence. It used to be
 * written into the sentence, as *"export-pdf is stable for a Doc"*, and it told
 * a customer whose DECK had been refused about a Doc. The last describe block
 * here is what keeps the advice and the measurements the same thing.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXPORT_STABILITY,
  NATIVE_EXPORT_TYPES,
  NativeFileRefused,
  exportStabilityOf,
  stablePoliciesFor,
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

  it('holds all three editor types under export-pdf STABLE — the way out', () => {
    // Measured 2026-09-16 on the owner's tenant, five draws each, byte-identical:
    // Doc 195869, Sheet 54591, Slide 2017. The Slide is the one that matters —
    // it is the only measured way to carry a deck at all, and it is what turns
    // the `export-office` refusal above from a wall into a gate.
    //
    // A PDF is not a zip, so no container hash is involved in any of these:
    // they are greens on the bytes themselves.
    for (const kind of ['document', 'spreadsheet', 'presentation']) {
      expect(exportStabilityOf('export-pdf', `${G}${kind}`), `export-pdf on a ${kind}`).toBe(
        'stable',
      );
    }
  });

  it('answers `unmeasured` for a type nobody has run, and for one not listed', () => {
    // The third answer, and the honest one. A table with two answers would have
    // had to guess for every blank.
    //
    // Every Drawing is still blank, under every policy — the live example now
    // that `export-pdf` on a Sheet and a Slide have been run. Whichever pair is
    // used here, the point is the same: this must be a combination nobody has
    // measured, or the test stops testing the third answer.
    expect(exportStabilityOf('export-pdf', `${G}drawing`)).toBe('unmeasured');
    expect(exportStabilityOf('export-odf', `${G}spreadsheet`)).toBe('unmeasured');
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

describe('the way out a refusal offers, derived from the same table', () => {
  it('sends a refused Slides deck to export-pdf, which is measured to carry it', () => {
    // The whole point of measuring `export-pdf` on a Slide. Before that run the
    // honest answer for a deck was "nothing will carry this"; now there is one,
    // and this asserts the refusal actually says so.
    const refused = new NativeFileRefused(
      'Thema-avond',
      `${G}presentation`,
      'export-office',
      'unstable',
    );
    // "Slides deck", not "presentation": the sentence calls the file what its
    // owner calls it (`nativeFileWord`), because a refusal that asks somebody
    // to choose a policy starts with them recognising which file it means.
    expect(refused.message).toMatch(/"export-pdf" is measured stable for a Slides deck/);
    expect(refused.message, 'the way out no longer names the editability cost').toMatch(
      /not editable afterwards/,
    );
  });

  it('does NOT tell that customer about a Doc, which is what it used to do', () => {
    // The defect this replaced, asserted as an absence so it cannot come back
    // by somebody re-hardcoding a clause that was true when they wrote it.
    const refused = new NativeFileRefused(
      'Thema-avond',
      `${G}presentation`,
      'export-office',
      'unstable',
    );
    expect(
      refused.message,
      'the refusal for a presentation mentions a Doc — the advice has been hard-coded again, ' +
        'and it is now the wrong file type for the person reading it',
    ).not.toMatch(/\bDoc\b/);
  });

  it('offers a Doc refused under export-odf the EDITABLE way out first', () => {
    // `export-office` is measured stable for a document and keeps it editable.
    // The old fixed clause sent this case to PDF, which was needlessly lossy —
    // deriving the advice fixed a second defect nobody had noticed.
    const refused = new NativeFileRefused('Q3 report', `${G}document`, 'export-odf', 'unstable');
    expect(refused.message).toMatch(/"export-office" and "export-pdf" are measured stable/);
  });

  it('never offers the policy that just refused the file', () => {
    // Trivially true today (a refusing policy is `unstable` for that type, so
    // it cannot be in the stable list) and worth pinning anyway: if the product
    // line on `unmeasured` is ever revisited, "switch to the policy you are
    // already on" is the first sentence that would appear.
    for (const kind of ['document', 'spreadsheet', 'presentation']) {
      const refused = new NativeFileRefused('x', `${G}${kind}`, 'export-pdf', 'unstable');
      expect(refused.message, `export-pdf refusing a ${kind} recommends itself`).not.toMatch(
        /"export-pdf" (is|and)/,
      );
    }
  });

  it('says plainly when nothing is measured stable, rather than naming a guess', () => {
    // A Drawing: blank under every policy. The empty case has to read as an
    // answer, because the alternative is a sentence recommending a format on
    // the strength of a run nobody has done.
    expect(stablePoliciesFor(`${G}drawing`)).toEqual([]);
    const refused = new NativeFileRefused('Sketch', `${G}drawing`, 'export-office', 'unstable');
    expect(refused.message).toMatch(/No export policy is measured stable for a Drawing/);
  });

  it('only ever names a policy that can actually render the type', () => {
    // Two hand-maintained tables. A `stable` beside a rendering that does not
    // exist would put a format in front of a customer that Drive would then
    // refuse to produce — a worse failure than the refusal it replaced.
    for (const mime of Object.keys(EXPORT_STABILITY['export-office'])) {
      for (const policy of stablePoliciesFor(mime)) {
        expect(
          NATIVE_EXPORT_TYPES[policy][mime],
          `${policy} is offered as a way out for ${mime} and has no rendering for it`,
        ).toBeDefined();
      }
    }
  });
});
