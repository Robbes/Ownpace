// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The lost-ledger startup warning (ADR-0020's on-startup half, 0026 T1
 * item 5). Wording is load-bearing: it must name the recovery command, and it
 * must admit the innocent cause — a first pass still running — so an operator
 * on a genuinely fresh install is not sent chasing a disaster.
 */

import { describe, it, expect } from 'vitest';
import { lostLedgerWarning } from './index';

describe('lostLedgerWarning', () => {
  it('warns on an active mapping with zero ledger rows, naming the reindex doorway', () => {
    const warning = lostLedgerWarning('acme-mail', 0);
    expect(warning).toBeDefined();
    expect(warning).toContain('acme-mail');
    expect(warning).toContain('ZERO rows');
    expect(warning).toContain('reindex');
    expect(warning).toContain('ADR-0020');
    // The innocent cause is admitted, not omitted.
    expect(warning).toContain('never completed a pass');
  });

  it('says nothing when the ledger has rows', () => {
    expect(lostLedgerWarning('acme-mail', 1)).toBeUndefined();
    expect(lostLedgerWarning('acme-mail', 5000)).toBeUndefined();
  });
});
