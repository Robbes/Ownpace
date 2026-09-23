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

  it('holds EVERY editor type under export-pdf STABLE — the way out', () => {
    // Measured on the owner's tenant, five draws each, byte-identical:
    // Doc 195869, Sheet 54591, Slide 2017 (2026-09-16), Drawing 16854
    // (2026-09-17). The Slide is the one that matters — it is the only measured
    // way to carry a deck at all, and it is what turns the `export-office`
    // refusal above from a wall into a gate.
    //
    // A PDF is not a zip, so no container hash is involved in any of these:
    // they are greens on the bytes themselves.
    //
    // THE DRAWING WAS MISSING FROM THIS LOOP until 2026-09-17, and the test's
    // own name counted the types it covered — written when a Drawing was not a
    // kind this table could even name. It went green under `export-pdf` the day
    // it became one, and the pin that claimed to hold "the way out" was not
    // holding the way out for a quarter of the types it applies to.
    // Derived from what `export-pdf` can RENDER, so a type Drive adds is in
    // this loop the moment somebody teaches the policy to export it — and a
    // type that is rendered but not measured stable fails here rather than
    // waiting for a person to widen a hand-written list.
    const rendered = Object.keys(NATIVE_EXPORT_TYPES['export-pdf']);
    expect(rendered.length).toBeGreaterThan(3);
    for (const mime of rendered) {
      expect(exportStabilityOf('export-pdf', mime), `export-pdf on ${mime}`).toBe('stable');
    }
  });

  it('answers `unmeasured` for a type nobody has run, and for one not listed', () => {
    // The third answer, and the honest one. A table with two answers would have
    // had to guess for every blank.
    //
    // THE TABLE HAS NO BLANKS LEFT since 2026-09-17, so there is no longer a
    // measured combination to point at — every cell has been run. This test
    // used to name two of them and both have since gone green, which is the
    // pin working rather than the answer disappearing.
    //
    // `unmeasured` is now reachable only the way it will be reached in future:
    // a type this table has never met. That is precisely the case it exists
    // for — the day Drive adds a fifth editor type, its first pass must COPY
    // rather than refuse, and nothing here may quietly turn that into a red.
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
    //
    // Asked about the policy THIS file is exported under since each kind can
    // have its own (0042 T9): a deck set to Office on its own is refused the
    // same as a deck under an Office setting for all four.
    const gate = source.slice(source.indexOf('refusalFor(file: DriveFile)'));
    const body = gate.slice(0, gate.indexOf('\n  }'));
    expect(body).toMatch(/const policy = this\.policyFor\(file\.mimeType\);/);
    expect(body).toMatch(/exportStabilityOf\(policy, file\.mimeType\)/);
    expect(body).toMatch(/stability === 'unstable'/);
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
  it('sends a refused Slides deck to BOTH policies measured to carry it', () => {
    // The whole point of measuring a deck at all. Before `export-pdf` on a
    // Slide, the honest answer was "nothing will carry this". Since 2026-09-17
    // there are two, and the second one matters more than the count: a deck
    // under `export-odf` came back container-only, so the customer can now be
    // sent somewhere the deck stays EDITABLE rather than only to a fixed
    // rendering. The refusal has to offer both, and name the cost of the one
    // that has a cost.
    const refused = new NativeFileRefused(
      'Thema-avond',
      `${G}presentation`,
      'export-office',
      'unstable',
    );
    // "Slides deck", not "presentation": the sentence calls the file what its
    // owner calls it (`nativeFileWord`), because a refusal that asks somebody
    // to choose a policy starts with them recognising which file it means.
    expect(refused.message).toMatch(
      /"export-odf" and "export-pdf" are measured stable for a Slides deck/,
    );
    // The cost is attached to the ONE policy that has it, not to the clause.
    // With two alternatives and only one of them lossy, saying "not editable
    // afterwards" without naming which would make the editable route look
    // lossy too — and the editable route is the one that just became
    // available.
    expect(refused.message).toContain('("export-pdf" is not editable afterwards)');
    expect(refused.message).not.toMatch(/"export-odf".{0,40}not editable/);
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

  it('every refusable type has a measured way out — no refusal is a wall', () => {
    // THE DRAWING USED TO BE THE COUNTEREXAMPLE HERE, and stopped being one on
    // 2026-09-17: this test used to assert that a Drawing had no measured way
    // out and read the "no format to switch to" sentence. The measurement moved
    // it, which is the pin doing its job rather than a gap opening — so what is
    // pinned now is the property that replaced it.
    //
    // THE PROPERTY: every type a policy can RENDER has at least one policy
    // measured stable for it. That is what makes a refusal survivable — a
    // refused deck is sent to `export-pdf`, a refused Doc to `export-office`,
    // and neither customer is told their files cannot be migrated and left
    // there. `wayOutFor`'s empty branch is unreachable while this holds, and is
    // kept because this can stop holding: measure a Drawing's SVG unstable
    // while its PDF stays blank and a Drawing becomes the first wall. IF THIS
    // GOES RED, that is what happened — read the sentence that type now gets
    // before shipping it, then record the new state here.
    const walls = Object.keys(NATIVE_EXPORT_TYPES['export-office']).filter(
      (mime) => stablePoliciesFor(mime).length === 0,
    );
    expect(walls, `${walls.join(', ')} can be rendered but has no measured way out`).toEqual([]);
  });

  it('a type the render table never heard of gets no advice at all', () => {
    // The other half: `stablePoliciesFor` invents nothing for a Google product
    // this table has not met. A Jamboard is a real one
    // (`application/vnd.google-apps.jam`), and it takes the earlier branch —
    // Drive cannot export it in ANY format, so no policy is offered and none
    // should be.
    expect(stablePoliciesFor(`${G}jam`)).toEqual([]);
    const refused = new NativeFileRefused('Standup board', `${G}jam`, 'export-office', 'unstable');
    expect(refused.message).toContain('Drive cannot export a jam in any format');
    expect(refused.message).not.toMatch(/measured stable/);
  });

  it('offers a Drawing every policy but the one that just refused it', () => {
    // All three are measured stable for a Drawing now: two from the shared SVG
    // request, `export-pdf` from its own run. The advice still names only two,
    // and that is `wayOutFor` excluding the policy that did the refusing —
    // "switch to the policy you are already on" is the first sentence a
    // careless derivation would produce.
    expect([...stablePoliciesFor(`${G}drawing`)].sort()).toEqual([
      'export-odf',
      'export-office',
      'export-pdf',
    ]);
    const refused = new NativeFileRefused('Sketch', `${G}drawing`, 'export-pdf', 'unstable');
    expect(refused.message).toMatch(/"export-odf" and "export-office" are measured stable/);
    expect(refused.message).toContain('for a Drawing');
    expect(refused.message).not.toContain('not editable afterwards');
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
