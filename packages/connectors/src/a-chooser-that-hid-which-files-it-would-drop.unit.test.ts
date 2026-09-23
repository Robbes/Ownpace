// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A CHOOSER THAT OFFERS THREE FORMATS AS EQUALS, WHEN TWO OF THEM DROP A WHOLE
 * CATEGORY OF THE PERSON'S FILES.
 *
 * The wizard's export-policy `<select>` reads:
 *
 *   Leave them behind, and tell me about each one
 *   OpenDocument — .odt, .ods, .odp (drawings as .svg)
 *   Microsoft Office — .docx, .xlsx, .pptx (drawings as .svg)
 *   PDF — everything as .pdf
 *
 * Three formats, differing by file extension. Except that `EXPORT_STABILITY`
 * has said since 2026-09-16 that **OpenDocument leaves every Google Doc
 * behind** and **Microsoft Office leaves every Slides deck behind** — and the
 * label for the first of those starts with `.odt`.
 *
 * The information existed the whole time, on the screen after this one: at
 * discovery (`discovery.refusedNative.*`, "Google Docs will not be copied …
 * Choose another format") and per file in the failures queue. Both are
 * downstream of a choice already made, and the second one arrives after the run.
 *
 * `NATIVE_POLICY_COVERAGE` in `@openmig/shared` is that fact where the chooser
 * can read it — `apps/web` depends on `shared` and not on this package, which
 * is correct and is why the table cannot simply be imported. THIS FILE IS THE
 * JOIN: the shared table is derived here from the measurements and asserted
 * equal, so a cell that flips colour breaks the build rather than leaving a
 * stale promise in front of a customer.
 */

import { describe, it, expect } from 'vitest';
import {
  GOOGLE_EDITOR_KINDS,
  NATIVE_POLICY_COVERAGE,
  NATIVE_POLICY_EXTENSIONS,
  googleEditorMime,
  policyCarries,
  policyCarriesEveryKind,
  policyLeavesBehind,
  type GoogleEditorKind,
  type GoogleNativeFilePolicy,
} from '@openmig/shared';
import {
  EXPORT_STABILITY,
  NATIVE_EXPORT_EXTENSIONS,
  NATIVE_EXPORT_TYPES,
  exportStabilityOf,
} from './google-drive-source.types.ts';

type ExportPolicy = Exclude<GoogleNativeFilePolicy, 'refuse'>;

const POLICIES = Object.keys(NATIVE_EXPORT_TYPES) as ExportPolicy[];

/**
 * What a policy carries, derived from the two tables the connector acts on.
 *
 * **`unstable` is the only thing that drops a file**, and that is the whole
 * subtlety of this derivation. `refusalFor` refuses a combination the table
 * calls `unstable` and copies everything else, `unmeasured` included — a blank
 * is recorded, not acted on (`google-drive-source.ts`: "ONLY `unstable`
 * REFUSES"). Deriving from `=== 'stable'` instead would put a warning on the
 * wizard for a type nobody has measured, about a refusal that never happens.
 */
function derivedCoverage(policy: ExportPolicy): GoogleEditorKind[] {
  return GOOGLE_EDITOR_KINDS.filter((kind) => {
    const mime = googleEditorMime(kind);
    // A policy with no rendering for a type cannot carry it however green the
    // stability column is; both tables are maintained by hand.
    if (NATIVE_EXPORT_TYPES[policy][mime] === undefined) return false;
    return exportStabilityOf(policy, mime) !== 'unstable';
  });
}

describe('the shared coverage table IS the measurements', () => {
  it.each(POLICIES)('%s carries exactly what the tables say it carries', (policy) => {
    // THE HEADLINE. One assertion per policy rather than one over all three, so
    // a failure names which format's sentence has gone wrong.
    expect(policyCarries(policy)).toEqual(derivedCoverage(policy));
  });

  it('covers every export policy, with none invented', () => {
    // Read off `NATIVE_EXPORT_TYPES`'s own keys: a policy added there without a
    // coverage row would otherwise render on the wizard with no sentence, and a
    // row here for a policy that does not exist would name a format nobody can
    // pick.
    expect(Object.keys(NATIVE_POLICY_COVERAGE).sort()).toEqual([...POLICIES].sort());
  });

  it('leaves `refuse` out, rather than carrying it as an empty list', () => {
    // It is not an export policy. An empty list would read as "this policy
    // carries nothing", which is true and is not what the wizard says about it.
    expect('refuse' in NATIVE_POLICY_COVERAGE).toBe(false);
  });
});

describe('what the wizard will actually say', () => {
  it('OpenDocument leaves Google Docs behind — the label starts with .odt', () => {
    // The sharpest case, and the reason this file exists.
    expect(policyLeavesBehind('export-odf')).toEqual(['document']);
  });

  it('Microsoft Office leaves the decks behind', () => {
    expect(policyLeavesBehind('export-office')).toEqual(['presentation']);
  });

  it('PDF is the only policy that leaves nothing behind', () => {
    expect(policyLeavesBehind('export-pdf')).toEqual([]);
    const complete = POLICIES.filter(policyCarriesEveryKind);
    expect(complete).toEqual(['export-pdf']);
  });

  it('names what it drops in the same order every time', () => {
    // Two sentences about two policies have to read the same way round, so the
    // order is the kinds' own and not the order a filter happened to find them.
    for (const policy of POLICIES) {
      const dropped = policyLeavesBehind(policy);
      const inOrder = GOOGLE_EDITOR_KINDS.filter((k) => dropped.includes(k));
      expect(dropped).toEqual(inOrder);
    }
  });
});

describe('every editor kind is a type the tables know', () => {
  it.each(GOOGLE_EDITOR_KINDS)('%s is a row in EXPORT_STABILITY under every policy', (kind) => {
    // The other direction from `a-deck-that-would-be-rewritten-nightly`: that
    // one holds every RENDERING to a stability entry, this holds every kind the
    // CHOOSER will talk about to one. A kind with no row would be described on
    // the wizard as carried, on the strength of `unmeasured`, with nobody
    // having decided that.
    for (const policy of POLICIES) {
      expect(EXPORT_STABILITY[policy][googleEditorMime(kind)]).toBeDefined();
    }
  });

  it('is the four editor types and nothing else', () => {
    // Forms, Sites, My Maps and Apps Scripts export in no format at all, so no
    // policy can carry them and naming one as a remedy sends somebody to a
    // setting that changes nothing.
    expect([...GOOGLE_EDITOR_KINDS]).toEqual([
      'document',
      'spreadsheet',
      'presentation',
      'drawing',
    ]);
  });
});

describe('what a chooser says each format turns each kind into', () => {
  /**
   * THE PER-KIND CHOOSER'S LABELS ARE THE CONNECTOR'S EXTENSIONS (workplan
   * 0042 T9). A screen offering "OpenDocument (.odp)" for Slides must be
   * offering the file the connector writes; a table kept by hand beside the
   * export table is how the two come to disagree about a suffix.
   */
  it.each(POLICIES)('%s: the extension shown for each kind is the one it lands under', (policy) => {
    for (const kind of GOOGLE_EDITOR_KINDS) {
      const exported = NATIVE_EXPORT_TYPES[policy][googleEditorMime(kind)];
      expect(exported, `${policy} has no rendering for ${kind}`).toBeDefined();
      expect(NATIVE_POLICY_EXTENSIONS[policy][kind], `${policy} on ${kind}`).toBe(
        NATIVE_EXPORT_EXTENSIONS[exported!],
      );
    }
  });

  it('names every export policy, with none invented', () => {
    expect(Object.keys(NATIVE_POLICY_EXTENSIONS).sort()).toEqual([...POLICIES].sort());
  });
});
