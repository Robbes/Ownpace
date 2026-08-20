// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The i18n foundation (workplan 0024 T1, ADR-0013).
 *
 * Key parity is compile-time (nl is typed against en's key set); the runtime
 * assertion here is belt-and-braces so a `as any` escape hatch cannot ship a
 * half-translated dictionary. The behavioral tests cover detection order
 * (storage beats navigator), persistence, and the un-provided fallback.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { STRINGS, LOCALES } from './strings.ts';
import { APPLY_FLAG_WARNING, APPLY_FLAG_WARNING_NL } from '@openmig/shared';
import { LocaleProvider, useLocale, detectLocale } from './index.tsx';
import { ReceiptStatus } from '../components/queues/primitives.tsx';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('the dictionary', () => {
  it('carries the exact same key set in every locale', () => {
    const enKeys = Object.keys(STRINGS.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(STRINGS[locale]).sort()).toEqual(enKeys);
    }
  });

  it('has no empty translations', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(STRINGS[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('the shared destructive-path warning exists in both languages and they differ', () => {
    expect(APPLY_FLAG_WARNING_NL.trim()).not.toBe('');
    expect(APPLY_FLAG_WARNING_NL).not.toBe(APPLY_FLAG_WARNING);
  });
});

describe('detectLocale', () => {
  it('prefers the persisted choice over the browser language', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('nl-NL');
    window.localStorage.setItem('openmig.locale', 'en');
    expect(detectLocale()).toBe('en');
  });

  it('falls back to the browser language (nl* -> nl)', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('nl-BE');
    expect(detectLocale()).toBe('nl');
  });

  it('defaults to English for anything else', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    expect(detectLocale()).toBe('en');
  });
});

const Probe: React.FC = () => {
  const { locale, setLocale, t } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="deletions">{t('nav.deletions')}</span>
      <button onClick={() => setLocale('nl')}>to-nl</button>
    </div>
  );
};

describe('LocaleProvider', () => {
  it('serves English by default and Dutch after the toggle — and persists the choice', () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId('deletions').textContent).toBe('Deletions');
    fireEvent.click(screen.getByText('to-nl'));
    expect(screen.getByTestId('deletions').textContent).toBe('Verwijderingen');
    expect(window.localStorage.getItem('openmig.locale')).toBe('nl');
  });

  it('boots in Dutch when the choice was persisted', () => {
    window.localStorage.setItem('openmig.locale', 'nl');
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('nl');
    expect(screen.getByTestId('deletions').textContent).toBe('Verwijderingen');
  });

  it('degrades to a fixed English handle outside a provider (isolated renders must not crash)', () => {
    render(<Probe />);
    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(screen.getByTestId('deletions').textContent).toBe('Deletions');
  });

  it('the queue primitives speak Dutch under nl — and the refusal stays the server verbatim', () => {
    window.localStorage.setItem('openmig.locale', 'nl');
    render(
      <LocaleProvider>
        <ReceiptStatus receipt={{ state: 'queued' } as never} />
        <ReceiptStatus
          receipt={{ state: 'refused', code: 'inferred_evidence', reason: 'Only positive evidence may be acted on' } as never}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText(/Verwijdering in de wachtrij/)).toBeTruthy();
    // Rule 2: the gates' words render untranslated, code included.
    expect(
      screen.getByText(/Only positive evidence may be acted on \(inferred_evidence\)/),
    ).toBeTruthy();
  });
});

describe('the 0035 T5 copy corrections stay corrected', () => {
  // Each of these was a MEANING drift found by the 2026-08-09 fleet's
  // native-copy-editor pass; pinned so a future retranslation cannot
  // silently reintroduce the wrong claim.
  it('NL: the auto-answer preset names a mailbox nothing migrates FOR', () => {
    expect(STRINGS.nl['decisions.presets.newMailbox']).toContain('waarvoor niets migreert');
  });

  it('NL: dismiss sets aside, it does not reject', () => {
    expect(STRINGS.nl['decisions.dismiss']).toBe('Terzijde leggen');
    expect(STRINGS.nl['decisionStatus.dismissed']).toBe('Terzijde gelegd');
  });

  it('NL: the failures count agrees in number (1 kon / 2 konden)', () => {
    expect(STRINGS.nl['finish.step2.failures.one']).toBe('kon niet worden gekopieerd');
    expect(STRINGS.nl['finish.step2.failures.many']).toBe('konden niet worden gekopieerd');
  });

  it('EN: moves.intro has its comparator back', () => {
    expect(STRINGS.en['moves.intro']).toContain('somewhere other than where they came from');
  });
});

