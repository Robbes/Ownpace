// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE EXPORT CHOOSER, TWO PLACES THAT ASK (workplan 0125 T3), ONE FORMAT PER
 * KIND (workplan 0042 T9).
 *
 * The question "what happens to your Google Docs" is asked twice: by the
 * creation wizard, and by a running migration's settings. 0125 exists because
 * the two editions disagreed about whether that setting could change at all —
 * so building a second chooser for the settings panel would reintroduce the
 * same class of defect one level up.
 *
 * Since the owner's decision of 2026-09-23 (*"a per kind choice makes more
 * sense for the fileformats. Split that up."*) the chooser asks per kind, and
 * these guards hold each kind's select against the two tables that decide
 * what it may offer: the measured coverage table, and the parser both editions
 * validate a value with.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  LEAVE_ALL_BEHIND,
  NativeFilePolicyChooser,
  editableFormats,
  formatChoicesFor,
  kindsLeftBehind,
  type NativeFilePolicyByKind,
} from './NativeFilePolicyChooser.tsx';
import {
  GOOGLE_EDITOR_KINDS,
  NATIVE_POLICY_COVERAGE,
  NATIVE_POLICY_EXTENSIONS,
  parseGoogleDriveSource,
  type GoogleEditorKind,
  type GoogleNativeFilePolicy,
} from '@openmig/shared';
import { nativeKindKey } from '../i18n/native-kind-key.ts';
import { STRINGS } from '../i18n/strings.ts';

/** What the reader actually sees, so the assertion reads the dictionary the
 *  component reads rather than a second copy of these words. */
const EN = STRINGS.en;

type ExportPolicy = Exclude<GoogleNativeFilePolicy, 'refuse'>;
const POLICIES = Object.keys(NATIVE_POLICY_COVERAGE) as ExportPolicy[];

const selectFor = (kind: GoogleEditorKind) =>
  screen.getByLabelText(EN[nativeKindKey(kind)]) as HTMLSelectElement;

/** A choice with every kind left behind but the ones named. */
const choice = (over: Partial<Record<GoogleEditorKind, GoogleNativeFilePolicy>>) =>
  ({ ...LEAVE_ALL_BEHIND, ...over }) as NativeFilePolicyByKind;

describe('what each kind’s select is allowed to offer', () => {
  /**
   * EVERY FORMAT MEASURED TO CARRY A KIND REACHES ITS SELECT, AND NOTHING
   * ELSE DOES.
   *
   * The way the first half breaks is ordinary: a format gets measured, somebody
   * adds it to `NATIVE_POLICY_COVERAGE`, and no option is ever written — so
   * the product measures a format nobody can pick. The second half is the
   * defect a per-kind chooser exists to end: a format that leaves a kind
   * behind offered for that kind as though it would copy it.
   */
  it.each(GOOGLE_EDITOR_KINDS)(
    '%s: every file a carrying format makes, once, plus leave behind',
    (kind) => {
      render(<NativeFilePolicyChooser value={LEAVE_ALL_BEHIND} onChange={() => {}} />);
      const values = [...selectFor(kind).options].map((o) => o.value);
      expect(values[0]).toBe('refuse');
      const formats = values.slice(1) as ExportPolicy[];
      for (const policy of formats) {
        expect(NATIVE_POLICY_COVERAGE[policy], `${policy} leaves ${kind} behind`).toContain(kind);
      }
      const expected = new Set(
        POLICIES.filter((policy) => NATIVE_POLICY_COVERAGE[policy].includes(kind)).map(
          (policy) => NATIVE_POLICY_EXTENSIONS[policy][kind],
        ),
      );
      const shown = formats.map((policy) => NATIVE_POLICY_EXTENSIONS[policy][kind]);
      expect(new Set(shown)).toEqual(expected);
      expect(shown, 'one file offered twice').toHaveLength(expected.size);
    },
  );

  /**
   * AND NOTHING THE PARSER WOULD REFUSE. `parseGoogleDriveSource` is what both
   * editions validate with; an option whose value it refuses is a menu entry
   * that saves as a 400.
   */
  it('offers only values the shared parser accepts for that kind', () => {
    for (const kind of GOOGLE_EDITOR_KINDS) {
      for (const { policy } of formatChoicesFor(kind, 'refuse')) {
        expect(
          parseGoogleDriveSource({ nativeFilePolicies: { [kind]: policy } }).nativeFilePolicies?.[
            kind
          ],
        ).toBe(policy);
      }
    }
  });

  /**
   * A DRAWING IS AN .SVG UNDER BOTH DOCUMENT FAMILIES, so it is offered once,
   * standing for whichever of the two is in force: opening the page and
   * saving must not change a setting nobody touched.
   */
  it('offers a Drawing’s .svg once, standing for the format in force', () => {
    expect(NATIVE_POLICY_EXTENSIONS['export-odf'].drawing).toBe(
      NATIVE_POLICY_EXTENSIONS['export-office'].drawing,
    );
    const svg = (inForce: GoogleNativeFilePolicy) =>
      formatChoicesFor('drawing', inForce).filter((c) => c.extension === '.svg');
    expect(svg('export-office')).toEqual([
      { policy: 'export-office', extension: '.svg', carries: true },
    ]);
    expect(svg('export-odf')).toEqual([{ policy: 'export-odf', extension: '.svg', carries: true }]);
    expect(svg('refuse')).toHaveLength(1);
  });

  /**
   * A FORMAT IN FORCE THAT LEAVES ITS KIND BEHIND IS SHOWN AS WHAT IT DOES.
   * A deck under a migration-wide Office setting is left behind; a select
   * that showed "Leave behind" instead would be right about the outcome and
   * wrong about the setting, and one that showed nothing would be wrong
   * about both.
   */
  it('offers every format for every kind, now that every format carries every kind', () => {
    // Since 2026-09-23 (ADR-0046, amended). What the chooser does with a
    // format that does NOT carry a kind is held with a table that has one, in
    // `a-format-that-leaves-a-kind-behind.unit.test.tsx`.
    for (const kind of GOOGLE_EDITOR_KINDS) {
      expect(formatChoicesFor(kind, 'refuse').every((c) => c.carries), kind).toBe(true);
    }
    expect(formatChoicesFor('document', 'refuse').map((c) => c.policy)).toEqual([
      'export-odf',
      'export-office',
      'export-pdf',
    ]);
    expect(formatChoicesFor('presentation', 'refuse').map((c) => c.policy)).toEqual([
      'export-odf',
      'export-office',
      'export-pdf',
    ]);
  });
});

describe('the lines under the selects', () => {
  /**
   * READ OFF THE CHOICE AND THE TABLE, never off a format's name. Today only
   * a kind set to leave behind stays behind; a format that drops a kind would
   * be named too (held in `a-format-that-leaves-a-kind-behind`).
   */
  it('names exactly the kinds left behind, and nothing it carries', () => {
    render(
      <NativeFilePolicyChooser
        value={choice({
          document: 'export-office',
          presentation: 'export-office',
          drawing: 'export-office',
        })}
        onChange={() => {}}
      />,
    );
    const line = screen.getByText(/stay behind in Google/).textContent ?? '';
    expect(line).toContain(EN[nativeKindKey('spreadsheet')]);
    // A deck under Office is carried since 2026-09-23.
    expect(line).not.toContain(EN[nativeKindKey('presentation')]);
    expect(line).not.toContain(EN[nativeKindKey('document')]);
    expect(line).not.toContain(EN[nativeKindKey('drawing')]);
    // And never beside the promise that everything arrives: a screen saying
    // both is a screen somebody reads the wrong half of.
    expect(screen.queryByText(EN['wizard.nativePolicy.allEditable'])).toBeNull();
  });

  it('names exactly the kinds that arrive as a PDF nobody can edit', () => {
    render(
      <NativeFilePolicyChooser
        value={{
          document: 'export-office',
          spreadsheet: 'export-pdf',
          presentation: 'export-pdf',
          drawing: 'export-office',
        }}
        onChange={() => {}}
      />,
    );
    const line = screen.getByText(/arrive as PDF/).textContent ?? '';
    expect(line).toContain(EN[nativeKindKey('spreadsheet')]);
    expect(line).toContain(EN[nativeKindKey('presentation')]);
    expect(line).not.toContain(EN[nativeKindKey('document')]);
    expect(screen.queryByText(/stay behind in Google/)).toBeNull();
    expect(screen.queryByText(EN['wizard.nativePolicy.allEditable'])).toBeNull();
  });

  it('says all four arrive editable only when that is so', () => {
    render(<NativeFilePolicyChooser value={editableFormats()} onChange={() => {}} />);
    expect(screen.getByText(EN['wizard.nativePolicy.allEditable'])).toBeInTheDocument();
    expect(screen.queryByText(/stay behind in Google/)).toBeNull();
    expect(screen.queryByText(/arrive as PDF/)).toBeNull();
  });
});

describe('an editable format for every kind', () => {
  /**
   * Office where it carries the kind, OpenDocument where it does not, read off
   * the table. Office carries every kind since 2026-09-23, so it is Office for
   * all four; the OpenDocument fallback is held with a table where Office drops
   * a kind (`a-format-that-leaves-a-kind-behind`).
   */
  it('is read off the table, and leaves nothing behind', () => {
    expect(editableFormats()).toEqual({
      document: 'export-office',
      spreadsheet: 'export-office',
      presentation: 'export-office',
      drawing: 'export-office',
    });
    expect(kindsLeftBehind(editableFormats())).toEqual([]);
  });

  it('keeps a kind already in an editable format, and changes only the rest', () => {
    // A Drawing's .svg under OpenDocument is the same file under Office: a
    // press that switched it would count as a change that changes nothing.
    expect(
      editableFormats(
        choice({ spreadsheet: 'export-odf', presentation: 'export-pdf', drawing: 'export-odf' }),
      ),
    ).toEqual({
      document: 'export-office',
      spreadsheet: 'export-odf',
      presentation: 'export-office',
      drawing: 'export-odf',
    });
  });

  const Harness: React.FC<{ from: NativeFilePolicyByKind }> = ({ from }) => {
    const [value, setValue] = React.useState<NativeFilePolicyByKind>(from);
    return <NativeFilePolicyChooser value={value} onChange={setValue} />;
  };

  it('is one press away', async () => {
    render(<Harness from={LEAVE_ALL_BEHIND} />);
    await userEvent.click(screen.getByRole('button', { name: EN['wizard.nativePolicy.editable'] }));
    expect(selectFor('document').value).toBe('export-office');
    expect(selectFor('presentation').value).toBe('export-office');
    expect(screen.getByText(EN['wizard.nativePolicy.allEditable'])).toBeInTheDocument();
  });

  it('leaves what is already editable as it is, on the screen too', async () => {
    render(<Harness from={choice({ spreadsheet: 'export-odf' })} />);
    await userEvent.click(screen.getByRole('button', { name: EN['wizard.nativePolicy.editable'] }));
    expect(selectFor('spreadsheet').value).toBe('export-odf');
    expect(selectFor('document').value).toBe('export-office');
  });
});
