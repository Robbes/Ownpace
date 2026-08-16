// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The completion report (workplan 0047) — the numbers on the closing document
 * an owner hands over, pinned. The builder is pure, so every claim the
 * document makes is provable here without a database; both editions call
 * exactly this code (rule 5), so there is no second document to drift.
 */

import { describe, it, expect } from 'vitest';
import {
  buildCompletionReport,
  renderCompletionReportMarkdown,
  type CompletionReportInputs,
} from './completion-report';
import type { DomainStatusReport, ItemDeletion, ItemFailure, ItemMove } from './index';

const domain = (over: Partial<DomainStatusReport> = {}): DomainStatusReport => ({
  domain: 'email',
  state: 'completed',
  itemsSynced: 100,
  itemsFailed: 0,
  bytesTransferred: 12345,
  itemsRetrying: 0,
  itemsNeedingDecision: 0,
  ...over,
});

const move = (over: Partial<ItemMove> = {}): ItemMove => ({
  domain: 'file',
  naturalKeyHash: 'k',
  from: 'a',
  to: 'b',
  ...over,
});

const deletion = (over: Partial<ItemDeletion> = {}): ItemDeletion => ({
  domain: 'file',
  naturalKeyHash: 'k',
  collection: 'a',
  absentPasses: 0,
  confirmed: true,
  evidence: 'trashed',
  ...over,
});

const failure = (over: Partial<ItemFailure> = {}): ItemFailure => ({
  domain: 'email',
  naturalKeyHash: 'k',
  attempts: 3,
  lastError: 'boom',
  needsDecision: true,
  ...over,
});

const inputs = (over: Partial<CompletionReportInputs> = {}): CompletionReportInputs => ({
  mappingId: 'map-1',
  sourceType: 'gmail',
  targetType: 'jmap',
  lifecycle: 'active',
  generatedAt: '2026-08-16T12:00:00.000Z',
  domains: [domain()],
  moves: [],
  deletions: [],
  failures: [],
  ...over,
});

describe('the verdict is derived, never hand-set', () => {
  it('complete: every enabled domain completed, no queue waiting', () => {
    expect(buildCompletionReport(inputs()).verdict).toBe('complete');
  });

  it('a SKIPPED domain does not block completion — scoping is not unfinished work', () => {
    const report = buildCompletionReport(
      inputs({ domains: [domain(), domain({ domain: 'file', state: 'skipped' })] }),
    );
    expect(report.verdict).toBe('complete');
  });

  it('an in-progress or failed enabled domain makes it a progress snapshot', () => {
    for (const state of ['in_progress', 'failed', 'pending'] as const) {
      const report = buildCompletionReport(
        inputs({ domains: [domain(), domain({ domain: 'file', state })] }),
      );
      expect(report.verdict, state).toBe('in_progress');
    }
  });

  it('open queue items keep a completed migration from reading as closed', () => {
    // A report that says done while a queue holds open items would be the
    // exact silence the queues exist to prevent.
    expect(buildCompletionReport(inputs({ moves: [move()] })).verdict).toBe(
      'complete_with_decisions_pending',
    );
    expect(buildCompletionReport(inputs({ deletions: [deletion()] })).verdict).toBe(
      'complete_with_decisions_pending',
    );
    expect(buildCompletionReport(inputs({ failures: [failure()] })).verdict).toBe(
      'complete_with_decisions_pending',
    );
    // Decided items do not: an acknowledged move is an answered question.
    expect(
      buildCompletionReport(inputs({ moves: [move({ acknowledgedAt: 'x' })] })).verdict,
    ).toBe('complete');
  });
});

describe('the queue summary counts what the screens count', () => {
  it('splits open from acknowledged, and relocations from plain moves', () => {
    const report = buildCompletionReport(
      inputs({
        moves: [
          move(),
          move({ naturalKeyHash: 'k2', toNaturalKeyHash: 'k2-new' }),
          move({ naturalKeyHash: 'k3', acknowledgedAt: 'x' }),
        ],
        deletions: [
          deletion(),
          deletion({ naturalKeyHash: 'k4', acknowledgedAt: 'x' }),
          // Unconfirmed = watched, not reported — the queue does not show it,
          // so the report must not count it as waiting.
          deletion({ naturalKeyHash: 'k5', confirmed: false, evidence: 'inferred' }),
        ],
        failures: [failure(), failure({ naturalKeyHash: 'k6', needsDecision: false })],
      }),
    );
    expect(report.queues).toEqual({
      movesOpen: 2,
      movesAcknowledged: 1,
      relocationsOpen: 1,
      deletionsOpen: 1,
      deletionsAcknowledged: 1,
      failuresNeedingDecision: 1,
    });
  });
});

describe('the Markdown document', () => {
  it('carries the verdict sentence, the per-domain table and the queue numbers', () => {
    const md = renderCompletionReportMarkdown(
      buildCompletionReport(inputs({ name: 'Acme mail', moves: [move()] })),
    );
    expect(md).toContain('# Migration completion report — Acme mail');
    expect(md).toContain('gmail → jmap');
    expect(md).toContain('| email | completed | 100 | 0 | 12345 |');
    expect(md).toContain('Moves open: **1**');
    expect(md).toContain('not closed until they are answered');
  });

  it('says what a skipped domain means instead of leaving a hole', () => {
    const md = renderCompletionReportMarkdown(
      buildCompletionReport(
        inputs({ domains: [domain(), domain({ domain: 'calendar', state: 'skipped' })] }),
      ),
    );
    expect(md).toContain('calendar: not selected for this migration');
  });

  it('an edition without receipts SAYS so — zeros would read as "nothing was ever removed"', () => {
    const withoutReceipts = renderCompletionReportMarkdown(buildCompletionReport(inputs()));
    expect(withoutReceipts).toContain('run log');
    expect(withoutReceipts).not.toContain('Deletions applied: 0');

    const withReceipts = renderCompletionReportMarkdown(
      buildCompletionReport(
        inputs({ applied: { deletionsApplied: 3, relocationsApplied: 2, refused: 1 } }),
      ),
    );
    expect(withReceipts).toContain('Deletions applied: 3');
    expect(withReceipts).toContain('relocations applied');
    expect(withReceipts).toContain('system:auto-apply');
  });
});
