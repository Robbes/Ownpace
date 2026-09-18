// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * ONE EXPORT CHOOSER, TWO PLACES THAT ASK (workplan 0125 T3).
 *
 * The question "what happens to your Google Docs" is now asked twice: by the
 * creation wizard, and by a running migration's settings. 0125 exists because
 * the two editions disagreed about whether that setting could change at all —
 * so building a second `<select>` for the settings panel would reintroduce the
 * same class of defect one level up, and a person would be told different
 * things about their Docs depending on which screen they happened to read.
 *
 * These guards hold the ONE chooser against the two tables that decide what it
 * may offer: the measured coverage table, and the parser both editions
 * validate a value with.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  NATIVE_FILE_POLICY_OPTIONS,
  NativeFilePolicyChooser,
} from './NativeFilePolicyChooser.tsx';
import {
  GOOGLE_EDITOR_KINDS,
  NATIVE_POLICY_COVERAGE,
  parseGoogleDriveSource,
  policyLeavesBehind,
  type GoogleNativeFilePolicy,
} from '@openmig/shared';
import { nativeKindKey } from '../i18n/native-kind-key.ts';
import { STRINGS } from '../i18n/strings.ts';

/** What the reader actually sees, so the assertion reads the dictionary the
 *  component reads rather than a second copy of these four words. */
const EN = STRINGS.en;

describe('what the chooser is allowed to offer', () => {
  /**
   * EVERY MEASURED POLICY REACHES THE SCREEN.
   *
   * The way this breaks is ordinary: a fourth format gets measured, somebody
   * adds it to `NATIVE_POLICY_COVERAGE` so the coverage sentences know about
   * it, and no `<option>` is ever written — so the product measures a format
   * nobody can pick. Red, naming the policy.
   */
  it('offers every policy the measured table carries, plus refuse', () => {
    const offered = NATIVE_FILE_POLICY_OPTIONS.map((o) => o.value);
    for (const policy of Object.keys(NATIVE_POLICY_COVERAGE)) {
      expect(offered, `${policy} is measured but cannot be chosen`).toContain(policy);
    }
    expect(offered).toContain('refuse');
  });

  /**
   * AND NOTHING THE PARSER WOULD REFUSE.
   *
   * `parseGoogleDriveSource` is what both editions validate with — the mapping
   * file on the appliance, the PUT route on managed. An option whose value it
   * refuses is a menu entry that saves as a 400, and a typo is exactly how that
   * happens (`export_office` for `export-office`).
   */
  it('offers only values the shared parser accepts', () => {
    for (const { value } of NATIVE_FILE_POLICY_OPTIONS) {
      expect(() => parseGoogleDriveSource({ nativeFilePolicy: value })).not.toThrow();
      expect(parseGoogleDriveSource({ nativeFilePolicy: value }).nativeFilePolicy).toBe(value);
    }
  });
});

describe('the line under the chooser', () => {
  /**
   * READ OFF THE MEASUREMENTS, not off the policy's name. A person picking
   * "OpenDocument — .odt, .ods, .odp" is choosing, unknowingly, to drop the
   * kind of file that label starts with, and this line is the only place that
   * is said before the run.
   */
  it.each(Object.keys(NATIVE_POLICY_COVERAGE))(
    '%s: names exactly the kinds the measurements say it drops',
    (policy) => {
      const dropped = policyLeavesBehind(policy as Exclude<GoogleNativeFilePolicy, 'refuse'>);
      render(
        <NativeFilePolicyChooser
          value={policy}
          onChange={() => {}}
          id={`chooser-${policy}`}
        />,
      );
      if (dropped.length === 0) {
        // The only policy measured to carry all four, and the one nothing comes
        // back editable from. Asked of the table rather than hard-coded to
        // `export-pdf`, because the interesting day is the one where that
        // stops being the answer.
        expect(screen.getByText(/Carries all four kinds/i)).toBeInTheDocument();
        return;
      }
      const line = screen.getByText(/leaves .* behind/i).textContent ?? '';
      for (const kind of dropped) {
        expect(line, `${policy} drops ${kind} and the line does not say so`).toContain(
          EN[nativeKindKey(kind)],
        );
      }
      // And names NOTHING it carries: a sentence that over-reports is how
      // somebody declines a format that would have moved their files.
      for (const kind of GOOGLE_EDITOR_KINDS.filter((k) => !dropped.includes(k))) {
        expect(line, `${policy} carries ${kind} and the line claims otherwise`).not.toContain(
          EN[nativeKindKey(kind)],
        );
      }
    },
  );

  /**
   * `refuse` is not an export policy and has no coverage: it carries nothing
   * by definition, and a reader asking "what does refuse carry" is asking the
   * wrong question. It gets its own sentence — each file reported by name.
   */
  it('offers the per-item sentence for refuse, not a coverage line', () => {
    render(<NativeFilePolicyChooser value="refuse" onChange={() => {}} />);
    expect(screen.getByText(/reported by name, with a reason/i)).toBeInTheDocument();
    expect(screen.queryByText(/leaves .* behind/i)).toBeNull();
  });

  /**
   * A VALUE THIS CONTROL DOES NOT OFFER SHOWS AS `refuse`, because that is what
   * the engine does with one — `parseNativeFilePolicy` refuses it and the
   * absent case defaults. A select rendering a value with no matching option
   * shows blank, which would read as "no answer yet" about a migration that has
   * already acted on one.
   */
  it('falls back to refuse rather than rendering a blank select', () => {
    render(<NativeFilePolicyChooser value="refuse" onChange={() => {}} />);
    const select = screen.getByLabelText(/Google Docs, Sheets, Slides and Drawings/i);
    expect((select as HTMLSelectElement).value).toBe('refuse');
  });
});
