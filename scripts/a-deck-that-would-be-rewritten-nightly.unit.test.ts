// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A MEASURED-UNSTABLE EXPORT, AND WHY IT IS NO LONGER REWRITTEN NIGHTLY
 * (workplan 0042 T3, T7 and T10 (c); ADR-0046, amended 2026-09-23).
 *
 * `export-office` does not carry a Google Slides deck byte for byte: measured on
 * a real tenant, five draws, FIVE members of the `.pptx` change content between
 * two exports of a file nobody touched. A Doc under `export-odf` is the same
 * one format earlier: its `settings.xml` moves.
 *
 * ## What copying one used to do
 *
 * Every later pass hashed the new export, saw a value it had not seen,
 * concluded the deck had changed, and re-copied it. Nightly. Forever. That is
 * why the connector refused both combinations from 2026-09-16 (the owner's
 * decision then), and why this file held that refusal in place.
 *
 * ## Why that no longer happens, and what holds it now
 *
 * Two things changed underneath the refusal. A document is copied again when
 * Drive says it was edited (its `modifiedTime`), never because its bytes
 * differ (#1083), and a renamed one is paired by its Drive id rather than by
 * its bytes (ADR-0030, amended). The refusal then protected nothing, and it
 * went, so every format is offered for every kind: the owner's aim was
 * *"working fileformats that suite the user"*.
 *
 * What stops the nightly rewrite now is proved end to end, through the real
 * Drive connector and the real file pass, in
 * `packages/core/src/a-deck-copied-once-not-nightly.unit.test.ts`: a deck
 * whose export differs on every fetch is copied once, and again only when
 * Drive's modified time moves. This file keeps the other half: the
 * measurements are still recorded as what they are, and the connector no
 * longer reads them to refuse anything.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPORT_STABILITY, NATIVE_EXPORT_TYPES, exportStabilityOf } from '@openmig/connectors';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const G = 'application/vnd.google-apps.';

describe('what the measurements say, as the code reads them', () => {
  it('holds a Slides deck under export-office UNSTABLE — the counterexample', () => {
    // Still true, and still worth knowing: a rewrite no longer depends on it,
    // but whoever reads a deck's bytes back must not expect two exports to
    // agree.
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
    // (2026-09-17).
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
    // for: the day Drive adds a fifth editor type, it is a blank until somebody
    // measures it.
    expect(exportStabilityOf('export-office', 'application/vnd.google-apps.form')).toBe(
      'unmeasured',
    );
  });

  it('has an entry for every type each policy can render', () => {
    // The two tables are read together: a rendering with no stability entry
    // would silently answer `unmeasured`, a record with a hole in it.
    for (const [policy, renderings] of Object.entries(NATIVE_EXPORT_TYPES)) {
      for (const mime of Object.keys(renderings)) {
        expect(
          EXPORT_STABILITY[policy as keyof typeof EXPORT_STABILITY][mime],
          `${policy} renders ${mime} and EXPORT_STABILITY does not list it, so it would read ` +
            'as `unmeasured`',
        ).toBeDefined();
      }
    }
  });
});

describe('the connector no longer refuses on the table', () => {
  const source = read('packages/connectors/src/google-drive-source.ts');

  it('never reads the measurements: no refusal and no URL depends on them', () => {
    // Asserted as an absence, because the failure mode is somebody putting the
    // gate back without the reason for it: the connector refusing a deck the
    // version already keeps from being rewritten, which is the owner's decks
    // parked on the Failures screen for nothing. Code only: the comment that
    // says why the gate went may name the table.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/exportStabilityOf|EXPORT_STABILITY/);
  });

  it('builds the export URL from the rendering table alone', () => {
    const builder = source.slice(source.indexOf('private exportUrlFor'));
    const body = builder.slice(0, builder.indexOf('\n  }'));
    expect(body).toMatch(/NATIVE_EXPORT_TYPES\[policy\]\[file\.mimeType\]/);
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
