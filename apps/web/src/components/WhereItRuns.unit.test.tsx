// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * *OWNPACE RUNS IN {COUNTRY}.* (workplan 0176 D16 (a)): one fixed sentence,
 * from the deployment's one setting, which the web build bakes in as
 * `VITE_OWNPACE_COUNTRY`. Here the real setting is turned on, as the Alpha
 * note's tests turn on the stage (`vi.stubEnv`), rather than the question
 * being mocked away. A person's link page draws this part under its first
 * line, and *Everything on one page* under its own.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { LocaleProvider } from '../i18n/index.tsx';
import { WhereItRuns } from './WhereItRuns.tsx';

function renderIn(locale: 'en' | 'nl') {
  window.localStorage.setItem('ownpace.locale', locale);
  return render(
    <LocaleProvider>
      <WhereItRuns className="mt-2" />
    </LocaleProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  window.localStorage.removeItem('ownpace.locale');
});

describe('where the service runs, said in one sentence', () => {
  it('names the country the deployment set, in English', () => {
    vi.stubEnv('VITE_OWNPACE_COUNTRY', 'DE');
    renderIn('en');
    expect(screen.getByText('Ownpace runs in Germany.')).toBeInTheDocument();
  });

  it('and in Dutch, the name from the browser’s own list in the reader’s language', () => {
    vi.stubEnv('VITE_OWNPACE_COUNTRY', 'de');
    renderIn('nl');
    expect(screen.getByText('Ownpace draait in Duitsland.')).toBeInTheDocument();
  });

  it('with the article the sentence needs', () => {
    vi.stubEnv('VITE_OWNPACE_COUNTRY', 'GB');
    renderIn('nl');
    expect(screen.getByText('Ownpace draait in het Verenigd Koninkrijk.')).toBeInTheDocument();
  });

  it('says nothing at all when the deployment sets nothing', () => {
    vi.stubEnv('VITE_OWNPACE_COUNTRY', '');
    const { container } = renderIn('en');
    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing where the browser has no name for the code, rather than the code', () => {
    // A code this browser's list does not hold. The build refuses one its own
    // list does not name; a browser's list can be older than the build's.
    vi.stubEnv('VITE_OWNPACE_COUNTRY', 'XX');
    const { container } = renderIn('en');
    expect(container).toBeEmptyDOMElement();
  });
});
