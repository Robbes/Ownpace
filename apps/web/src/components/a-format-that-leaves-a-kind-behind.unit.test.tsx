// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A FORMAT THAT LEAVES A KIND BEHIND, which no format does today.
 *
 * Until 2026-09-23 two did: OpenDocument dropped every Google Doc and Office
 * every Slides deck, refused because their exports differ between draws. That
 * refusal went (ADR-0046, amended), and `NATIVE_POLICY_COVERAGE` now has every
 * kind under every format. The chooser still reads the table rather than
 * assuming it is full, so the day a format cannot render a kind the screen
 * says so before anybody chooses it.
 *
 * That branch cannot be reached with the real table, so it is held here with
 * the table as it was, one empty cell: Office does not carry a deck.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@openmig/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@openmig/shared')>();
  return {
    ...real,
    NATIVE_POLICY_COVERAGE: {
      'export-odf': ['document', 'spreadsheet', 'presentation', 'drawing'],
      'export-office': ['document', 'spreadsheet', 'drawing'],
      'export-pdf': ['document', 'spreadsheet', 'presentation', 'drawing'],
    },
  };
});

import {
  LEAVE_ALL_BEHIND,
  NativeFilePolicyChooser,
  editableFormats,
  formatChoicesFor,
  kindsLeftBehind,
  type NativeFilePolicyByKind,
} from './NativeFilePolicyChooser.tsx';
import { nativeKindKey } from '../i18n/native-kind-key.ts';
import { STRINGS } from '../i18n/strings.ts';

const EN = STRINGS.en;
const OFFICE_DECK: NativeFilePolicyByKind = {
  ...LEAVE_ALL_BEHIND,
  document: 'export-office',
  spreadsheet: 'export-office',
  presentation: 'export-office',
  drawing: 'export-office',
};

describe('a format that leaves a kind behind', () => {
  it('is never offered for that kind', () => {
    expect(formatChoicesFor('presentation', 'refuse').map((c) => c.policy)).not.toContain(
      'export-office',
    );
  });

  it('is shown as what it does when it is the one in force', () => {
    render(<NativeFilePolicyChooser value={OFFICE_DECK} onChange={() => {}} />);
    const slides = screen.getByLabelText(EN[nativeKindKey('presentation')]) as HTMLSelectElement;
    expect(slides.value).toBe('export-office');
    expect(slides.selectedOptions[0]?.textContent).toBe(
      EN['wizard.nativePolicy.as.leftBehind'].replace(
        '{format}',
        EN['wizard.nativePolicy.as.office'].replace('{ext}', '.pptx'),
      ),
    );
  });

  it('is named on the line of kinds that stay behind, and "all editable" is not said', () => {
    render(<NativeFilePolicyChooser value={OFFICE_DECK} onChange={() => {}} />);
    const line = screen.getByText(/stay behind in Google/).textContent ?? '';
    expect(line).toContain(EN[nativeKindKey('presentation')]);
    expect(line).not.toContain(EN[nativeKindKey('document')]);
    expect(kindsLeftBehind(OFFICE_DECK)).toEqual(['presentation']);
    expect(screen.queryByText(EN['wizard.nativePolicy.allEditable'])).toBeNull();
  });

  it('is passed over by the editable press, which takes OpenDocument for that kind', () => {
    expect(editableFormats()).toEqual({
      document: 'export-office',
      spreadsheet: 'export-office',
      presentation: 'export-odf',
      drawing: 'export-office',
    });
    expect(editableFormats(OFFICE_DECK).presentation).toBe('export-odf');
  });
});
