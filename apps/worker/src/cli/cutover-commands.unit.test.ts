// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Workplan 0009 T2 — the `--yes` approval gate on state-changing cutover
// subcommands (arch doc §11.2 control actions, AGENTS.md hard rule 2:
// nothing irreversible without approval).
//
// This gate was previously *claimed* done in the workplan while the code did
// the opposite: `rollbackCutover()` printed "Confirm rollback? …" and then
// proceeded unconditionally. These tests exist so that regression is caught
// rather than re-documented.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { asTenantId, asMappingId } from '@openmig/shared';
import type { VerificationResult } from '@openmig/core';
import * as core from '@openmig/core';
import {
  confirmed,
  rollbackCutover,
  verifyCutover,
  executeCutover,
  completeCutover,
  type CutoverCliDeps,
} from './cutover-commands.ts';

const TENANT = asTenantId('5e1b0000-e29b-41d4-a716-4466554402a1' as never);
const MAPPING = asMappingId('5e1b0000-e29b-41d4-a716-4466554402a2' as never);

/** Minimal CutoverStore stand-in recording whether the state was mutated. */
function makeStore(currentState = 'GRACE_PERIOD') {
  return {
    loadCutoverState: vi.fn().mockResolvedValue({ currentState, state: currentState }),
    transitionState: vi.fn().mockResolvedValue({ currentState: 'ROLLED_BACK' }),
  };
}

function makeDeps(store: ReturnType<typeof makeStore>, assumeYes?: boolean): CutoverCliDeps {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    cutoverPersistence: store as unknown as CutoverCliDeps['cutoverPersistence'],
    dnsDomain: 'example.com',
    targetMailServer: 'mail.example.com',
    ...(assumeYes === undefined ? {} : { assumeYes }),
  };
}

describe('confirmed()', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows the action when --yes was passed', () => {
    expect(confirmed({ assumeYes: true }, 'do a thing', ['consequence'])).toBe(true);
  });

  it('refuses when --yes is absent', () => {
    expect(confirmed({ assumeYes: false }, 'do a thing', ['consequence'])).toBe(false);
  });

  it('refuses when assumeYes is undefined (missing flag defaults to refusing)', () => {
    expect(confirmed({}, 'do a thing', ['consequence'])).toBe(false);
  });

  it('prints each consequence so the operator sees what they are approving', () => {
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });

    confirmed({}, 'roll this cutover back', ['first consequence', 'second consequence']);

    const output = logged.join('\n');
    expect(output).toContain('first consequence');
    expect(output).toContain('second consequence');
    expect(output).toContain('--yes');
  });
});

describe('rollbackCutover() approval gate', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // process.exit must not actually kill the test runner; throw instead so we
    // can assert it was reached AND that nothing ran after it.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT transition state when --yes is missing', async () => {
    const store = makeStore();

    await expect(rollbackCutover(makeDeps(store))).rejects.toThrow('process.exit(1)');

    // The actual regression guard: the ledger was never mutated.
    expect(store.transitionState).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('transitions state to ROLLED_BACK when --yes is passed', async () => {
    const store = makeStore();

    await rollbackCutover(makeDeps(store, true));

    expect(store.transitionState).toHaveBeenCalledTimes(1);
    expect(store.transitionState).toHaveBeenCalledWith(
      TENANT,
      MAPPING,
      'ROLLED_BACK',
      expect.objectContaining({ rolledBackBy: 'cli' }),
    );
  });

  it('does not claim DNS was restored — it names the manual step instead', async () => {
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });

    await rollbackCutover(makeDeps(makeStore(), true));

    const output = logged.join('\n');
    expect(output).toContain('MANUAL STEP REQUIRED');
    expect(output).toContain('example.com');
    // The old wording implied an automatic restore that never happened.
    expect(output).not.toContain('DNS records should be restored');
  });
});

// ---------------------------------------------------------------------------
// verify: the §20 data gate
//
// `verifyCutover()` used to print "Data verification requires ledger
// integration - skipping for now" and then push `{ check: 'Data Completeness',
// status: 'PASS' }` into the results table — the mandatory pre-cutover data
// check reporting a pass it had never performed (hard rule 9). Worse, `verify`
// wrote no state at all, while `approve` refuses unless the state is
// READY_FOR_CUTOVER and nothing else in the CLI sets it: `approve` was
// unreachable no matter what the operator did.
// ---------------------------------------------------------------------------

/** A VerificationResult with the verdict we want and nothing else invented. */
function verdict(overallStatus: 'PASS' | 'WARN' | 'FAIL'): VerificationResult {
  const canProceed = overallStatus !== 'FAIL';
  return {
    overallStatus,
    canProceedToCutover: canProceed,
    score: canProceed ? 1 : 0.4,
    totalItemsSource: 10,
    totalItemsTarget: canProceed ? 10 : 4,
    totalDiscrepancies: canProceed ? 0 : 6,
    recommendations: canProceed ? [] : ['Re-sync 6 missing mail item(s)'],
  } as unknown as VerificationResult;
}

describe('verifyCutover() data gate', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    // DNS is a separate leg; stub it green so these tests isolate the data gate.
    vi.spyOn(core, 'verifyAllDns').mockResolvedValue({
      mxVerified: true,
      spfVerified: true,
      dkimVerified: true,
      dmarcVerified: true,
      autodiscoverVerified: true,
      errors: [],
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function depsWith(
    runDataVerification: CutoverCliDeps['runDataVerification'],
    currentState = 'PREPARING',
  ) {
    const store = {
      loadCutoverState: vi.fn().mockResolvedValue({ currentState, state: currentState }),
      transitionState: vi.fn().mockResolvedValue({ currentState: 'READY_FOR_CUTOVER' }),
    };
    const deps: CutoverCliDeps = {
      tenantId: TENANT,
      mappingId: MAPPING,
      cutoverPersistence: store as unknown as CutoverCliDeps['cutoverPersistence'],
      dnsDomain: 'example.com',
      targetMailServer: 'mail.example.com',
      ...(runDataVerification ? { runDataVerification } : {}),
    };
    return { deps, store };
  }

  it('calls the data gate rather than skipping it', async () => {
    const gate = vi.fn().mockResolvedValue(verdict('PASS'));
    const { deps } = depsWith(gate);

    await verifyCutover(deps);

    expect(gate).toHaveBeenCalledTimes(1);
    // The exact string that used to stand in for running it.
    expect(logged.join('\n')).not.toContain('skipping for now');
  });

  it('FAILS overall when the data gate FAILS', async () => {
    const { deps } = depsWith(vi.fn().mockResolvedValue(verdict('FAIL')));

    expect(await verifyCutover(deps)).toBe(false);
    expect(logged.join('\n')).toContain('Data verification FAILED');
  });

  it('FAILS overall when the data gate cannot run at all', async () => {
    const { deps, store } = depsWith(vi.fn().mockRejectedValue(new Error('ledger unreachable')));

    expect(await verifyCutover(deps)).toBe(false);
    expect(logged.join('\n')).toContain('ledger unreachable');
    // A gate that could not run has not passed — and must not advance state.
    expect(store.transitionState).not.toHaveBeenCalled();
  });

  it('FAILS when no data gate is wired at all, instead of reporting a pass', async () => {
    const { deps, store } = depsWith(undefined);

    expect(await verifyCutover(deps)).toBe(false);
    expect(logged.join('\n')).toContain('NOT VERIFIED');
    expect(store.transitionState).not.toHaveBeenCalled();
  });

  it('advances PREPARING -> READY_FOR_CUTOVER on a pass, so approve becomes reachable', async () => {
    const { deps, store } = depsWith(vi.fn().mockResolvedValue(verdict('PASS')));

    expect(await verifyCutover(deps)).toBe(true);
    expect(store.transitionState).toHaveBeenCalledWith(
      TENANT,
      MAPPING,
      'READY_FOR_CUTOVER',
      expect.objectContaining({ verifiedBy: 'cli' }),
    );
  });

  it('leaves a non-PREPARING state alone', async () => {
    const { deps, store } = depsWith(vi.fn().mockResolvedValue(verdict('PASS')), 'APPROVED');

    expect(await verifyCutover(deps)).toBe(true);
    expect(store.transitionState).not.toHaveBeenCalled();
  });

  it('does not advance state when the data gate FAILS', async () => {
    const { deps, store } = depsWith(vi.fn().mockResolvedValue(verdict('FAIL')));

    await verifyCutover(deps);

    expect(store.transitionState).not.toHaveBeenCalled();
  });

  it('surfaces the gate recommendations so the operator knows what broke', async () => {
    const { deps } = depsWith(vi.fn().mockResolvedValue(verdict('FAIL')));

    await verifyCutover(deps);

    expect(logged.join('\n')).toContain('Re-sync 6 missing mail item(s)');
  });
});

// ---------------------------------------------------------------------------
// execute + complete: the state machine's actual edges
//
// `executeCutover()` used to transition CUTOVER_IN_PROGRESS -> COMPLETED, an
// edge VALID_TRANSITIONS (cutover-state.ts) does not have — the store threw
// "Invalid transition" AFTER the operator had already switched DNS, stranding
// the ledger in CUTOVER_IN_PROGRESS with a non-zero exit. The happy path is
// CUTOVER_IN_PROGRESS -> GRACE_PERIOD, and COMPLETED is only reachable from
// there — which is what the `complete` subcommand now does.
// ---------------------------------------------------------------------------

describe('executeCutover() follows the state machine', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lands in GRACE_PERIOD, never COMPLETED, when propagation confirms', async () => {
    vi.spyOn(core, 'checkPropagation').mockResolvedValue(true as never);
    const store = makeStore('APPROVED');

    await executeCutover(makeDeps(store, true));

    const states = store.transitionState.mock.calls.map((c) => c[2]);
    expect(states).toEqual(['CUTOVER_IN_PROGRESS', 'GRACE_PERIOD']);
    expect(states).not.toContain('COMPLETED');
  });

  it('refuses without --yes and leaves the ledger untouched', async () => {
    const store = makeStore('APPROVED');

    await expect(executeCutover(makeDeps(store))).rejects.toThrow('process.exit(1)');

    expect(store.transitionState).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('marks FAILED when propagation times out', async () => {
    vi.spyOn(core, 'checkPropagation').mockResolvedValue(false as never);
    const store = makeStore('APPROVED');

    await expect(executeCutover(makeDeps(store, true))).rejects.toThrow('process.exit(1)');

    const states = store.transitionState.mock.calls.map((c) => c[2]);
    expect(states).toEqual(['CUTOVER_IN_PROGRESS', 'FAILED']);
  });
});

describe('completeCutover()', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes GRACE_PERIOD -> COMPLETED with --yes', async () => {
    const store = makeStore('GRACE_PERIOD');

    await completeCutover(makeDeps(store, true));

    expect(store.transitionState).toHaveBeenCalledTimes(1);
    expect(store.transitionState).toHaveBeenCalledWith(
      TENANT,
      MAPPING,
      'COMPLETED',
      expect.objectContaining({ completedBy: 'cli' }),
    );
  });

  it('refuses without --yes and leaves the ledger untouched', async () => {
    const store = makeStore('GRACE_PERIOD');

    await expect(completeCutover(makeDeps(store))).rejects.toThrow('process.exit(1)');

    expect(store.transitionState).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('refuses from a non-GRACE_PERIOD state (COMPLETED is only reachable from there)', async () => {
    const store = makeStore('CUTOVER_IN_PROGRESS');

    await expect(completeCutover(makeDeps(store, true))).rejects.toThrow('process.exit(1)');

    expect(store.transitionState).not.toHaveBeenCalled();
  });
});
