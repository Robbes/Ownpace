// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * The name a download is saved under (the UX sweep): what it is, which
 * migration, and the day, never `completion-report-<uuid>.md`.
 */
import { describe, it, expect } from 'vitest';
import { downloadName, localIsoDate } from './download-name.ts';

describe('the name a download is saved under', () => {
  it('says what it is, which migration, and the day', () => {
    expect(downloadName('Ownpace report', 'Goog2NC', '2026-10-17', 'md')).toBe(
      'Ownpace report - Goog2NC - 2026-10-17.md',
    );
    expect(downloadName('Ownpace-rapport', 'Pieter — Microsoft 365 naar Nextcloud', '2026-10-17', 'md')).toBe(
      'Ownpace-rapport - Pieter — Microsoft 365 naar Nextcloud - 2026-10-17.md',
    );
  });

  it('leaves out every character a file name cannot carry on Windows, macOS or Linux', () => {
    expect(downloadName('Ownpace report', 'a\\b/c:d*e?f"g<h>i|j', '2026-10-17', 'csv')).toBe(
      'Ownpace report - abcdefghij - 2026-10-17.csv',
    );
  });

  it('says one space where leaving a character out left two', () => {
    expect(downloadName('Ownpace report', 'Box / Nextcloud', '2026-10-17', 'md')).toBe(
      'Ownpace report - Box Nextcloud - 2026-10-17.md',
    );
  });

  it('dates the file by the reader’s own calendar day', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localIsoDate(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});
