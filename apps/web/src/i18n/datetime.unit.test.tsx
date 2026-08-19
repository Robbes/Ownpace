// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * Locale-aware date/time/number formatting (workplan 0024 T3, ADR-0013).
 *
 * The formatters are keyed on the APP locale, not the browser's — the tests
 * pin both languages explicitly. `now` is injected for the relative cases and
 * `timeZone: 'UTC'` for the absolute one, so nothing here depends on when or
 * where the suite runs.
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { LocaleProvider, useFormatters } from './index.tsx';
import { formatRelativeToNow, formatDateTime, formatNumber, formatCurrency } from './datetime.ts';

const NOW = new Date('2026-08-02T12:00:00Z');

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('formatRelativeToNow', () => {
  it('speaks both languages', () => {
    const twoHoursAgo = new Date('2026-08-02T10:00:00Z');
    expect(formatRelativeToNow(twoHoursAgo, 'en', NOW)).toBe('2 hours ago');
    expect(formatRelativeToNow(twoHoursAgo, 'nl', NOW)).toBe('2 uur geleden');
  });

  it('picks the largest fitting unit', () => {
    expect(formatRelativeToNow(new Date('2026-08-02T11:59:30Z'), 'en', NOW)).toBe('30 seconds ago');
    expect(formatRelativeToNow(new Date('2026-08-02T11:15:00Z'), 'en', NOW)).toBe('45 minutes ago');
    expect(formatRelativeToNow(new Date('2026-07-28T12:00:00Z'), 'en', NOW)).toBe('5 days ago');
    expect(formatRelativeToNow(new Date('2026-03-02T12:00:00Z'), 'en', NOW)).toBe('5 months ago');
    expect(formatRelativeToNow(new Date('2023-08-02T12:00:00Z'), 'en', NOW)).toBe('3 years ago');
  });

  it("lets Intl say 'yesterday' instead of '1 day ago' (numeric: auto)", () => {
    const yesterday = new Date('2026-08-01T12:00:00Z');
    expect(formatRelativeToNow(yesterday, 'en', NOW)).toBe('yesterday');
    expect(formatRelativeToNow(yesterday, 'nl', NOW)).toBe('gisteren');
  });

  it('accepts the ISO strings the API serves', () => {
    expect(formatRelativeToNow('2026-08-02T10:00:00Z', 'en', NOW)).toBe('2 hours ago');
  });
});

describe('formatDateTime', () => {
  it('renders the absolute timestamp in each language’s conventions', () => {
    const when = '2026-07-31T14:30:00Z';
    const en = formatDateTime(when, 'en', { timeZone: 'UTC' });
    const nl = formatDateTime(when, 'nl', { timeZone: 'UTC' });
    // Month names differ per ICU build detail less than their language does:
    // assert the language-distinguishing parts, not one exact byte string.
    expect(en).toContain('2026');
    expect(en).toMatch(/Jul/);
    expect(nl).toContain('2026');
    expect(nl).toMatch(/jul/);
    expect(en).not.toBe(nl);
  });
});

describe('formatNumber', () => {
  it('groups with the language’s separators', () => {
    expect(formatNumber(1234567, 'en')).toBe('1,234,567');
    expect(formatNumber(1234567, 'nl')).toBe('1.234.567');
  });
});

const Probe: React.FC = () => {
  const { number, relativeToNow } = useFormatters();
  return (
    <div>
      <span data-testid="n">{number(9999)}</span>
      <span data-testid="r">{relativeToNow(new Date(Date.now() - 2 * 3600 * 1000))}</span>
    </div>
  );
};

describe('useFormatters', () => {
  it('binds to the active locale', () => {
    window.localStorage.setItem('openmig.locale', 'nl');
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('n').textContent).toBe('9.999');
    expect(screen.getByTestId('r').textContent).toBe('2 uur geleden');
  });

  it('degrades to English outside a provider, like useLocale does', () => {
    render(<Probe />);
    expect(screen.getByTestId('n').textContent).toBe('9,999');
    expect(screen.getByTestId('r').textContent).toBe('2 hours ago');
  });
});

describe('formatCurrency (0039 T6)', () => {
  it('renders cents as money in each language\u2019s conventions', () => {
    // en: point decimal, no space -- nl: comma decimal, space after the sign.
    expect(formatCurrency(1234, 'EUR', 'en')).toBe('\u20ac12.34');
    expect(formatCurrency(1234, 'EUR', 'nl')).toBe('\u20ac\u00a012,34');
  });

  it('honours the served currency code instead of assuming euros', () => {
    expect(formatCurrency(1234, 'USD', 'en')).toContain('12.34');
    expect(formatCurrency(1234, 'USD', 'en')).not.toContain('\u20ac');
  });
});

