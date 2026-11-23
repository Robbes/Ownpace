// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * A REPORT THAT KEPT ITS ADDRESSES (workplan 0168 §6.3; the review of the
 * screens, S8 (a)).
 *
 * The report page parses the completion report before it draws it, and a
 * `z.object` keeps only what it names. Its schema named no `addressChanges`,
 * so *Addresses changed* / *Gewijzigde adressen* was stripped on the way in:
 * the declared change reached the English download and no screen. This reads
 * a report as the server sends it, through the page's own parse.
 */
import { describe, it, expect, vi } from 'vitest';
import { fetchReport } from './report-service.ts';

const { fetchCompletionReportMock } = vi.hoisted(() => ({ fetchCompletionReportMock: vi.fn() }));
vi.mock('./operating-service', () => ({ fetchCompletionReport: fetchCompletionReportMock }));

const SAID = {
  heading: { en: 'Addresses changed', nl: 'Gewijzigde adressen' },
  lines: [
    {
      en: '1 address change was confirmed for this organisation.',
      nl: '1 adreswijziging is bevestigd voor deze organisatie.',
    },
  ],
};

describe('the report page’s parse', () => {
  it('keeps the address changes the server sent, with their sentences in both languages', async () => {
    fetchCompletionReportMock.mockResolvedValue({
      report: {
        mappingId: 'm1',
        sourceType: 'gmail',
        targetType: 'soverin',
        lifecycle: 'active',
        generatedAt: '2026-11-23T10:00:00.000Z',
        domains: [],
        queues: {
          movesOpen: 0,
          movesAcknowledged: 0,
          relocationsOpen: 0,
          deletionsOpen: 0,
          deletionsAcknowledged: 0,
          failuresNeedingDecision: 0,
        },
        addressChanges: { rows: 1, digest: 'd1', byDomain: [{ domain: 'contact', changed: 4, older: 0 }], said: SAID },
        verdict: 'in_progress',
      },
      markdown: '# report',
    });
    const { report } = await fetchReport('m1');
    expect(report.addressChanges).toEqual({
      rows: 1,
      digest: 'd1',
      byDomain: [{ domain: 'contact', changed: 4, older: 0 }],
      said: SAID,
    });
  });
});
