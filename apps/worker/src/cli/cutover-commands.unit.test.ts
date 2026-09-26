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
import type { ContentEvidence, VerificationResult } from '@openmig/core';
import * as core from '@openmig/core';
import {
  confirmed,
  rollbackCutover,
  verifyCutover,
  executeCutover,
  completeCutover,
  startCutover,
  showStatus,
  lifecycleLine,
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

/**
 * The mapping's lifecycle as a rollback (ADR-0047) or a cutover step (ADR-0048)
 * sees it: what it is now, and a recorder for what the command set it to —
 * and WHEN, relative to the ledger write, because the order is part of the
 * contract.
 */
function makeMapping(status = 'cutover', order: string[] = []) {
  return {
    readStatus: vi.fn().mockResolvedValue(status),
    setStatus: vi.fn(async (c: { from: string; to: string }) => {
      order.push(`mapping:${c.from}->${c.to}`);
    }),
  };
}

function makeDeps(
  store: ReturnType<typeof makeStore>,
  assumeYes?: boolean,
  mapping: ReturnType<typeof makeMapping> = makeMapping(),
): CutoverCliDeps {
  return {
    tenantId: TENANT,
    mappingId: MAPPING,
    cutoverPersistence: store as unknown as CutoverCliDeps['cutoverPersistence'],
    mappingLifecycle: mapping,
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

  it('does NOT transition state when --yes is missing — neither the ledger nor the mapping', async () => {
    const store = makeStore();
    const mapping = makeMapping();

    await expect(rollbackCutover(makeDeps(store, undefined, mapping))).rejects.toThrow('process.exit(1)');

    // The actual regression guard: nothing was mutated.
    expect(store.transitionState).not.toHaveBeenCalled();
    expect(mapping.setStatus).not.toHaveBeenCalled();
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

  it('reactivates the mapping — the half this command never did — and does it BEFORE the ledger', async () => {
    // ADR-0047. Until 2026-09-19 this command wrote the ledger and left
    // `mailbox_mapping` where it was, so an operator who ran it and walked
    // away believed their sync was running again when it was not. The order
    // matters too: ROLLED_BACK admits no second rollback, so the retryable write goes first.
    const order: string[] = [];
    const store = {
      ...makeStore(),
      transitionState: vi.fn(async (_t: unknown, _m: unknown, to: string) => {
        order.push(`ledger:${to}`);
        return { currentState: to };
      }),
    };
    const mapping = makeMapping('cutover', order);

    await rollbackCutover(makeDeps(store, true, mapping));

    expect(mapping.setStatus).toHaveBeenCalledWith({ from: 'cutover', to: 'active', via: 'rollback' });
    expect(order).toEqual(['mapping:cutover->active', 'ledger:ROLLED_BACK']);
  });

  it("refuses a finished ('done') mapping before writing anything, and says nothing changed", async () => {
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    const store = makeStore();
    const mapping = makeMapping('done');

    await expect(rollbackCutover(makeDeps(store, true, mapping))).rejects.toThrow('process.exit(1)');

    expect(store.transitionState).not.toHaveBeenCalled();
    expect(mapping.setStatus).not.toHaveBeenCalled();
    const output = logged.join('\n');
    expect(output).toContain('finished');
    expect(output).toContain('Nothing was changed');
  });

  it('tells the person approving what will happen to THIS mapping, not a generic sentence', async () => {
    // The consequence list is printed only when --yes is absent, which is the
    // one moment somebody is reading it to decide. It has to be true for the
    // mapping in front of them: an active one is left alone and the list must
    // say so, rather than promise a reactivation that will not happen.
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });

    await expect(rollbackCutover(makeDeps(makeStore(), undefined, makeMapping('active')))).rejects.toThrow(
      'process.exit(1)',
    );

    const output = logged.join('\n');
    expect(output).toContain('already syncing');
    expect(output).not.toContain("back to 'active'");
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

  it('says on the --yes path that mail on the target stays there', async () => {
    // `confirmed()` returns early on --yes and never prints its consequence
    // bullets, so anything an operator must hear has to print AFTER the action.
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });

    await rollbackCutover(makeDeps(makeStore(), true));

    expect(logged.join('\n')).toContain('stays on the target');
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
function verdict(
  overallStatus: 'PASS' | 'WARN' | 'FAIL',
  contentEvidence: ContentEvidence = 'checked',
): VerificationResult {
  const canProceed = overallStatus !== 'FAIL';
  return {
    overallStatus,
    contentEvidence,
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
      mappingLifecycle: makeMapping(),
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

  it('says on the PASSING line how much content it actually compared', async () => {
    // The appliance's own route to the same decision the web screens carry
    // (2026-09-21). "Data verification passed" is the sentence an operator
    // acts on, and it read identically whether every sampled item was compared
    // or none of them could be.
    const { deps } = depsWith(vi.fn().mockResolvedValue(verdict('PASS', 'none')));

    expect(await verifyCutover(deps)).toBe(true);
    const out = logged.join('\n');
    expect(out).toContain('Data verification passed');
    expect(out).toContain('content evidence: none');
  });

  it('says so on a pass that DID compare, so the line above is not boilerplate', async () => {
    const { deps } = depsWith(vi.fn().mockResolvedValue(verdict('PASS', 'checked')));

    await verifyCutover(deps);
    expect(logged.join('\n')).toContain('content evidence: checked');
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

  it('refuses without --yes and leaves the ledger untouched — and the mapping', async () => {
    const store = makeStore('APPROVED');
    const mapping = makeMapping('active');

    await expect(executeCutover(makeDeps(store, undefined, mapping))).rejects.toThrow('process.exit(1)');

    expect(store.transitionState).not.toHaveBeenCalled();
    expect(mapping.setStatus).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('marks FAILED when propagation times out', async () => {
    vi.spyOn(core, 'checkPropagation').mockResolvedValue(false as never);
    const store = makeStore('APPROVED');

    await expect(executeCutover(makeDeps(store, true))).rejects.toThrow('process.exit(1)');

    const states = store.transitionState.mock.calls.map((c) => c[2]);
    expect(states).toEqual(['CUTOVER_IN_PROGRESS', 'FAILED']);
  });

  it("stops the mapping ('active' -> 'cutover') BEFORE the ledger moves, through the cutover door", async () => {
    // ADR-0048. Until 2026-09-19 this command moved the ledger and left
    // `mailbox_mapping` where it was, so the appliance kept scheduling passes
    // — deletion detectors present — against a source that had just stopped
    // being the authority. The order matters too: CUTOVER_IN_PROGRESS beside
    // a running mapping is the defect, and execute refuses to run again from
    // that state, so the retryable write goes first.
    vi.spyOn(core, 'checkPropagation').mockResolvedValue(true as never);
    const order: string[] = [];
    const store = {
      ...makeStore('APPROVED'),
      transitionState: vi.fn(async (_t: unknown, _m: unknown, to: string) => {
        order.push(`ledger:${to}`);
        return { currentState: to };
      }),
    };
    const mapping = makeMapping('active', order);

    await executeCutover(makeDeps(store, true, mapping));

    expect(mapping.setStatus).toHaveBeenCalledWith({ from: 'active', to: 'cutover', via: 'cutover' });
    expect(order).toEqual(['mapping:active->cutover', 'ledger:CUTOVER_IN_PROGRESS', 'ledger:GRACE_PERIOD']);
  });

  it('says a running migration keeps copying until the grace period ends, and records that it does (0128 T2)', async () => {
    vi.spyOn(core, 'checkPropagation').mockResolvedValue(true as never);
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    const store = makeStore('APPROVED');

    await executeCutover(makeDeps(store, true, makeMapping('active')));

    expect(logged.join('\n')).toContain('Mapping active -> cutover: it keeps copying until the grace period ends, then stops.');
    expect(store.transitionState.mock.calls[0]![3]).toMatchObject({ copiesThroughGrace: true });
  });

  it("leaves a 'continuous' mapping alone and says why — the lane copies after cutover by design", async () => {
    vi.spyOn(core, 'checkPropagation').mockResolvedValue(true as never);
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    const store = makeStore('APPROVED');
    const mapping = makeMapping('continuous');

    await executeCutover(makeDeps(store, true, mapping));

    expect(mapping.setStatus).not.toHaveBeenCalled();
    expect(store.transitionState.mock.calls.map((c) => c[2])).toEqual(['CUTOVER_IN_PROGRESS', 'GRACE_PERIOD']);
    expect(logged.join('\n')).toContain('by design');
  });

  it('tells the person approving what will happen to THIS mapping, not a generic sentence', async () => {
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });

    await expect(executeCutover(makeDeps(makeStore('APPROVED'), undefined, makeMapping('active')))).rejects.toThrow(
      'process.exit(1)',
    );
    const active = logged.join('\n');
    expect(active).toContain("'active' -> 'cutover'");
    expect(active).toContain('no longer the authority');
    // 0128 T2: said before the operator approves, for THIS mapping.
    expect(active).toContain('it keeps copying until the grace period ends, then stops');
    expect(active).not.toContain('no pass runs after this');

    logged.length = 0;
    await expect(executeCutover(makeDeps(makeStore('APPROVED'), undefined, makeMapping('paused')))).rejects.toThrow(
      'process.exit(1)',
    );
    const paused = logged.join('\n');
    expect(paused).toContain("'paused' -> 'cutover'");
    expect(paused).toContain('it is not copying now, and stays stopped through the grace period');

    logged.length = 0;
    await expect(executeCutover(makeDeps(makeStore('APPROVED'), undefined, makeMapping('done')))).rejects.toThrow(
      'process.exit(1)',
    );
    const done = logged.join('\n');
    expect(done).toContain("Leave mapping");
    // The trap named before it is walked into: a finished migration cannot be rolled back.
    expect(done).toContain('rollback is refused');
    expect(done).not.toContain("'done' -> 'cutover'");
  });

  it('on a propagation timeout the mapping stays stopped, and the output says rollback resumes it', async () => {
    // Whether the MX record moved is exactly what is unknown after a timeout,
    // so no pass may run; the rollback is the explicit undo.
    vi.spyOn(core, 'checkPropagation').mockResolvedValue(false as never);
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    const order: string[] = [];
    const store = {
      ...makeStore('APPROVED'),
      transitionState: vi.fn(async (_t: unknown, _m: unknown, to: string) => {
        order.push(`ledger:${to}`);
        return { currentState: to };
      }),
    };
    const mapping = makeMapping('active', order);

    await expect(executeCutover(makeDeps(store, true, mapping))).rejects.toThrow('process.exit(1)');

    expect(order).toEqual(['mapping:active->cutover', 'ledger:CUTOVER_IN_PROGRESS', 'ledger:FAILED']);
    expect(order).not.toContain('mapping:cutover->active');
    expect(logged.join('\n')).toContain('rollback --yes');
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

  it("stops a mapping still 'active' — a cutover executed before ADR-0048 — BEFORE COMPLETED", async () => {
    // COMPLETED is terminal. Closing it over a mapping that is still
    // scheduling passes would leave the sync mirroring a source that stopped
    // being the authority, for good, with no cutover command left to stop it.
    const order: string[] = [];
    const store = {
      ...makeStore('GRACE_PERIOD'),
      transitionState: vi.fn(async (_t: unknown, _m: unknown, to: string) => {
        order.push(`ledger:${to}`);
        return { currentState: to };
      }),
    };
    const mapping = makeMapping('active', order);

    await completeCutover(makeDeps(store, true, mapping));

    expect(order).toEqual(['mapping:active->cutover', 'ledger:COMPLETED']);
  });

  it("converges on a 'cutover' mapping with no mapping write, and says where the migration is finished", async () => {
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    const store = makeStore('GRACE_PERIOD');
    const mapping = makeMapping('cutover');

    await completeCutover(makeDeps(store, true, mapping));

    expect(mapping.setStatus).not.toHaveBeenCalled();
    expect(store.transitionState).toHaveBeenCalledTimes(1);
    // The ledger closed; the migration's ending is a different decision with
    // its own rule, and the operator is pointed at where it lives.
    expect(logged.join('\n')).toContain('Finish page');
  });
});

// ---------------------------------------------------------------------------
// status: both halves, from the records that hold them
//
// `showStatus()` printed rows the read path never fills — "Started By" was
// always N/A and Rolled Back / Failed / Completed never printed — while the
// trail beside them had every fact, and its "Recent Events" were the OLDEST
// five. And it never showed the mapping's lifecycle at all, which since
// ADR-0048 is the half that says whether anything is still running.
// ---------------------------------------------------------------------------

type Ev = { timestamp: string; fromState: string | null; toState: string; triggeredBy: string; reason?: string; metadata?: Record<string, unknown>; eventType?: string; description?: string };

/** A trail in the order the store returns it: ascending. */
function trail(...events: Ev[]): Ev[] {
  return events;
}

function statusDeps(state: { currentState: string; rollbackAvailable: boolean } | undefined, events: Ev[], mapping = makeMapping('cutover')) {
  const store = {
    loadCutoverState: vi.fn().mockResolvedValue(
      state ? { ...state, state: state.currentState, startedAt: '2026-09-19T10:00:00.000Z', targetMailServer: 'mail.example.com' } : undefined,
    ),
    getEventHistory: vi.fn().mockResolvedValue(events),
  };
  return makeDeps(store as unknown as ReturnType<typeof makeStore>, true, mapping);
}

const INIT: Ev = { timestamp: '2026-09-19T10:00:00.000Z', fromState: null, toState: 'PREPARING', triggeredBy: 'cli', eventType: 'CUTOVER_INITIALIZED' };
const READY: Ev = { timestamp: '2026-09-19T10:05:00.000Z', fromState: 'PREPARING', toState: 'READY_FOR_CUTOVER', triggeredBy: 'cli' };
const APPROVED: Ev = { timestamp: '2026-09-19T10:10:00.000Z', fromState: 'READY_FOR_CUTOVER', toState: 'APPROVED', triggeredBy: 'cli', metadata: { approvedBy: 'cli' } };
const IN_PROGRESS: Ev = { timestamp: '2026-09-19T10:20:00.000Z', fromState: 'APPROVED', toState: 'CUTOVER_IN_PROGRESS', triggeredBy: 'cli', metadata: { startedBy: 'cli' } };
const GRACE: Ev = { timestamp: '2026-09-19T10:30:00.000Z', fromState: 'CUTOVER_IN_PROGRESS', toState: 'GRACE_PERIOD', triggeredBy: 'cli' };
const ROLLED_BACK: Ev = { timestamp: '2026-09-19T11:00:00.000Z', fromState: 'GRACE_PERIOD', toState: 'ROLLED_BACK', triggeredBy: 'cli', reason: 'mail bouncing', metadata: { rolledBackBy: 'trigger-job', rollbackReason: 'mail bouncing' } };

describe('showStatus()', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the mapping's lifecycle beside the ledger state, with what it means for the passes", async () => {
    await showStatus(statusDeps({ currentState: 'GRACE_PERIOD', rollbackAvailable: true }, trail(INIT, READY, APPROVED, IN_PROGRESS, GRACE), makeMapping('cutover')));

    const out = logged.join('\n');
    expect(out).toContain('Mapping lifecycle');
    expect(out).toContain('cutover — stopped for the cutover');
    expect(out).toContain('no pass runs');
  });

  it('says a cutover in its grace period still copies, and until when, from the ledger row (0128 T2)', async () => {
    const startedAt = new Date(Date.now() - 3_600_000).toISOString();
    const deps = statusDeps(
      { currentState: 'GRACE_PERIOD', rollbackAvailable: true },
      trail(INIT, READY, APPROVED, IN_PROGRESS, GRACE),
      makeMapping('cutover'),
    );
    const store = deps.cutoverPersistence as unknown as { loadCutoverState: ReturnType<typeof vi.fn> };
    store.loadCutoverState.mockResolvedValue({
      currentState: 'GRACE_PERIOD',
      state: 'GRACE_PERIOD',
      rollbackAvailable: true,
      startedAt: '2026-09-19T10:00:00.000Z',
      updatedAt: startedAt,
      gracePeriodStartedAt: startedAt,
      gracePeriodHours: 72,
      copiesThroughGrace: true,
    });

    await showStatus(deps);

    const out = logged.join('\n');
    const until = new Date(Date.parse(startedAt) + 72 * 3_600_000).toISOString();
    expect(out).toContain(`cutover — passes run until ${until}, when the grace period ends`);
    expect(out).not.toContain('no pass runs');
  });

  it('derives who and when from the trail — no N/A for a fact the row never carried', async () => {
    await showStatus(statusDeps({ currentState: 'ROLLED_BACK', rollbackAvailable: false }, trail(INIT, READY, APPROVED, IN_PROGRESS, GRACE, ROLLED_BACK), makeMapping('active')));

    const out = logged.join('\n');
    // The state row carries the event that entered it: when, by whom (from the
    // door's own metadata, not the ledger's coarse 'cli'), and why.
    expect(out).toMatch(/State\s+ROLLED_BACK — since 2026-09-19T11:00:00.000Z by trigger-job: mail bouncing/);
    expect(out).toMatch(/Started\s+2026-09-19T10:00:00.000Z by cli/);
    expect(out).not.toContain('N/A');
  });

  it('names the managed prepare job on the events it wrote (retriedBy, verifiedBy) — not the ledger\'s coarse "cli"', async () => {
    // The store calls every object-metadata transition 'cli'. The job's way
    // back to PREPARING and its READY_FOR_CUTOVER carry their own actor.
    const RESET: Ev = {
      timestamp: '2026-09-19T10:06:00.000Z', fromState: 'READY_FOR_CUTOVER', toState: 'PREPARING', triggeredBy: 'cli',
      reason: 'Re-preparing (attempt 2)', metadata: { retriedBy: 'trigger-job', attempt: 2 },
    };
    const READY_AGAIN: Ev = {
      timestamp: '2026-09-19T10:07:00.000Z', fromState: 'PREPARING', toState: 'READY_FOR_CUTOVER', triggeredBy: 'cli',
      metadata: { verifiedBy: 'trigger-job', attempt: 2 },
    };
    await showStatus(statusDeps({ currentState: 'READY_FOR_CUTOVER', rollbackAvailable: false }, trail(INIT, READY, RESET, READY_AGAIN), makeMapping('active')));

    const out = logged.join('\n');
    // The NEWEST entry into the current state, not the first: 10:07 by the job, not 10:05 by cli.
    expect(out).toMatch(/State\s+READY_FOR_CUTOVER — since 2026-09-19T10:07:00.000Z by trigger-job/);
    expect(out).toContain('READY_FOR_CUTOVER -> PREPARING  by trigger-job: Re-preparing (attempt 2)');
  });

  it('lists the NEWEST events first — the rollback is the one the old five-oldest list dropped', async () => {
    await showStatus(statusDeps({ currentState: 'ROLLED_BACK', rollbackAvailable: false }, trail(INIT, READY, APPROVED, IN_PROGRESS, GRACE, ROLLED_BACK)));

    const lines = logged.filter((l) => /-> [A-Z_]+/.test(l));
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('GRACE_PERIOD -> ROLLED_BACK');
    expect(lines[0]).toContain('mail bouncing');
    expect(lines[5]).toContain('— -> PREPARING');
  });

  it('says whether a rollback is admitted from here, as the machine decides it', async () => {
    await showStatus(statusDeps({ currentState: 'GRACE_PERIOD', rollbackAvailable: true }, trail(INIT, READY, APPROVED, IN_PROGRESS, GRACE)));
    expect(logged.join('\n')).toMatch(/Rollback\s+available — the state machine admits ROLLED_BACK from GRACE_PERIOD/);

    logged.length = 0;
    await showStatus(statusDeps({ currentState: 'COMPLETED', rollbackAvailable: false }, trail(INIT)));
    expect(logged.join('\n')).toMatch(/Rollback\s+not available from COMPLETED/);
  });

  it("still tells the mapping's lifecycle when there is no cutover at all", async () => {
    await showStatus(statusDeps(undefined, [], makeMapping('active')));

    const out = logged.join('\n');
    expect(out).toContain('No cutover found');
    expect(out).toContain('active — passes run; the source is the authority');
  });

  it('a mapping row that cannot be read is said so, and does not hide the ledger', async () => {
    const mapping = makeMapping('active');
    mapping.readStatus.mockRejectedValue(new Error('Mapping m-1 was not found for tenant t-1.'));

    await showStatus(statusDeps({ currentState: 'GRACE_PERIOD', rollbackAvailable: true }, trail(INIT, READY, APPROVED, IN_PROGRESS, GRACE), mapping));

    const out = logged.join('\n');
    expect(out).toContain('could not be read: Mapping m-1 was not found');
    expect(out).toContain('GRACE_PERIOD');
  });
});

describe('lifecycleLine()', () => {
  it('answers every lifecycle from the predicates the passes read, so the sentence cannot contradict the rules', () => {
    expect(lifecycleLine('active')).toContain('passes run; the source is the authority');
    expect(lifecycleLine('paused')).toContain('stopped by an operator');
    expect(lifecycleLine('cutover')).toContain('no pass runs');
    expect(lifecycleLine('continuous')).toContain('passes run after the cutover');
    expect(lifecycleLine('continuous')).toContain('deletions at the source are not mirrored');
    expect(lifecycleLine('done')).toContain('finished');
  });

  it("reads a cutover's own window: copying until the grace period ends, and not after (0128 T2)", () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    const grace = {
      state: 'GRACE_PERIOD',
      copiesThroughGrace: true,
      enteredAt: new Date('2026-09-24T10:00:00.000Z'),
      graceStartedAt: new Date('2026-09-24T10:00:00.000Z'),
      graceHours: 72,
    };

    expect(lifecycleLine('cutover', grace, now)).toBe(
      'cutover — passes run until 2026-09-27T10:00:00.000Z, when the grace period ends; ' +
        'deletions at the source are not mirrored',
    );
    expect(lifecycleLine('cutover', grace, new Date('2026-09-27T10:00:00.000Z'))).toContain('no pass runs');
    // Paused when execute ran: it stays stopped, in the grace period too.
    expect(lifecycleLine('cutover', { ...grace, copiesThroughGrace: false }, now)).toContain('no pass runs');
    // A rollback put the mapping back to active: the status says it, not the window.
    expect(lifecycleLine('active', { ...grace, state: 'ROLLED_BACK' }, now)).toContain('passes run; the source is');
    // Only `cutover` copies for a while: a finished migration beside a window is finished.
    expect(lifecycleLine('done', grace, now)).toContain('finished');
  });
});

// ---------------------------------------------------------------------------
// start-cutover: what already exists, said truthfully
//
// One ledger per mapping, and `initializeCutover` returns the existing row.
// `startCutover()` printed "Cutover initialized: ROLLED_BACK" for a row it had
// merely read back; `verify` then advanced nothing, and the runbook's retry
// from FAILED named a transition no command performed.
// ---------------------------------------------------------------------------

describe('startCutover()', () => {
  let logged: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  function startStore(
    existing: string | undefined,
    events: Array<{ toState: string }> = [],
    // Every ledger of the migration, as slice 5b's begin rule reads them.
    ledgers: Array<{ domain?: string; state: string }> = existing ? [{ state: existing }] : [],
  ) {
    return {
      loadLedgers: vi.fn().mockResolvedValue(ledgers),
      loadCutoverState: vi.fn().mockResolvedValue(existing ? { currentState: existing, state: existing } : undefined),
      initializeCutover: vi.fn().mockResolvedValue({ currentState: 'PREPARING', state: 'PREPARING' }),
      transitionState: vi.fn().mockResolvedValue({ currentState: 'PREPARING' }),
      getEventHistory: vi.fn().mockResolvedValue(events),
    };
  }

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initialises a ledger where there is none', async () => {
    const store = startStore(undefined);

    await startCutover(makeDeps(store as unknown as ReturnType<typeof makeStore>, true));

    expect(store.initializeCutover).toHaveBeenCalledTimes(1);
    expect(store.transitionState).not.toHaveBeenCalled();
    expect(logged.join('\n')).toContain('Cutover initialized: PREPARING');
  });

  it('says a ledger already exists, names its state and the next step, and initialises nothing', async () => {
    const store = startStore('GRACE_PERIOD');

    await startCutover(makeDeps(store as unknown as ReturnType<typeof makeStore>, true));

    expect(store.initializeCutover).not.toHaveBeenCalled();
    expect(store.transitionState).not.toHaveBeenCalled();
    const out = logged.join('\n');
    expect(out).toContain('already exists for this mapping: GRACE_PERIOD');
    expect(out).toContain('complete --yes');
    expect(out).not.toContain('initialized');
  });

  it('retries from FAILED — the FAILED -> PREPARING edge the machine always had — recorded as attempt N', async () => {
    // Two PREPARING entries in the trail already (the first start and one
    // earlier retry), so this is the third attempt.
    const store = startStore('FAILED', [{ toState: 'PREPARING' }, { toState: 'READY_FOR_CUTOVER' }, { toState: 'FAILED' }, { toState: 'PREPARING' }, { toState: 'FAILED' }]);

    await startCutover(makeDeps(store as unknown as ReturnType<typeof makeStore>, true));

    expect(store.initializeCutover).not.toHaveBeenCalled();
    expect(store.transitionState).toHaveBeenCalledWith(TENANT, MAPPING, 'PREPARING', expect.objectContaining({ retriedBy: 'cli', attempt: 3 }));
    expect(logged.join('\n')).toContain('Cutover retried: FAILED -> PREPARING (attempt 3)');
  });

  it('refuses a COMPLETED ledger out loud: terminal, one ledger per mapping, nothing changed', async () => {
    const store = startStore('COMPLETED');

    await expect(startCutover(makeDeps(store as unknown as ReturnType<typeof makeStore>, true))).rejects.toThrow('process.exit(1)');

    expect(store.initializeCutover).not.toHaveBeenCalled();
    expect(store.transitionState).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    const out = logged.join('\n');
    expect(out).toContain('COMPLETED — terminal');
    expect(out).toContain('Nothing was changed');
    expect(out).not.toContain('initialized');
  });

  it('attempts again after a rollback — ROLLED_BACK -> PREPARING (0009 T8, owner 2026-09-20), recorded as attempt N', async () => {
    // Until 2026-09-20 this refused and named the owner's call. A rollback is
    // a setback (ADR-0047); the owner opened the edge so it can be recovered from.
    const store = startStore('ROLLED_BACK', [
      { toState: 'PREPARING' }, { toState: 'READY_FOR_CUTOVER' }, { toState: 'APPROVED' },
      { toState: 'CUTOVER_IN_PROGRESS' }, { toState: 'ROLLED_BACK' },
    ]);

    await startCutover(makeDeps(store as unknown as ReturnType<typeof makeStore>, true));

    expect(store.initializeCutover).not.toHaveBeenCalled();
    expect(store.transitionState).toHaveBeenCalledWith(TENANT, MAPPING, 'PREPARING', expect.objectContaining({ retriedBy: 'cli', attempt: 2 }));
    expect(exitSpy).not.toHaveBeenCalled();
    const out = logged.join('\n');
    expect(out).toContain('Cutover attempted again: ROLLED_BACK -> PREPARING (attempt 2)');
    expect(out).toContain('on the target only');
    expect(out).not.toContain('0009 T8');
  });
});

// ---------------------------------------------------------------------------
// One data type, `--kind` (workplan 0128 T5, slice 5b): its own ledger and its
// own path, wired by the entrypoint; here, what the commands say and skip.
// Only mail has DNS, and a data type's cutover and the whole migration's are
// kept apart before anything is read as this cutover's ledger.
// ---------------------------------------------------------------------------

describe('the cutover of one data type', () => {
  let logged: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logged = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.join(' '));
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function ofKind(store: unknown, kind: 'email' | 'calendar', mapping = makeMapping('active')): CutoverCliDeps {
    return { ...makeDeps(store as ReturnType<typeof makeStore>, true, mapping), kind };
  }

  it("does not begin a data type's own while the whole migration's is under way", async () => {
    const store = {
      loadLedgers: vi.fn().mockResolvedValue([{ state: 'APPROVED' }]),
      loadCutoverState: vi.fn(),
      initializeCutover: vi.fn(),
      transitionState: vi.fn(),
    };
    await expect(startCutover(ofKind(store, 'calendar'))).rejects.toThrow('process.exit(1)');
    expect(store.loadCutoverState).not.toHaveBeenCalled();
    expect(store.initializeCutover).not.toHaveBeenCalled();
    expect(logged.join('\n')).toContain("The whole migration's cutover is under way (APPROVED)");
  });

  it("does not begin the whole migration's once a data type has its own, and says to go on with --kind", async () => {
    const store = {
      loadLedgers: vi.fn().mockResolvedValue([{ domain: 'email', state: 'COMPLETED' }]),
      loadCutoverState: vi.fn(),
      initializeCutover: vi.fn(),
      transitionState: vi.fn(),
    };
    await expect(startCutover(makeDeps(store as unknown as ReturnType<typeof makeStore>, true))).rejects.toThrow(
      'process.exit(1)',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(store.initializeCutover).not.toHaveBeenCalled();
    expect(logged.join('\n')).toContain('--kind');
  });

  it('checks no DNS for calendars, and still runs the data gate', async () => {
    // Stubbed, so a DNS check that did run would answer at once rather than reach the network.
    const dns = vi.spyOn(core, 'verifyAllDns').mockResolvedValue({
      mxVerified: true,
      spfVerified: true,
      dkimVerified: true,
      dmarcVerified: true,
      autodiscoverVerified: true,
      errors: [],
    } as never);
    const store = {
      loadCutoverState: vi.fn().mockResolvedValue({ currentState: 'PREPARING', state: 'PREPARING' }),
      transitionState: vi.fn().mockResolvedValue({ currentState: 'READY_FOR_CUTOVER' }),
    };
    const gate = vi.fn().mockResolvedValue({
      overallStatus: 'PASS',
      canProceedToCutover: true,
      score: 1,
      totalItemsSource: 3,
      totalItemsTarget: 3,
      totalDiscrepancies: 0,
      recommendations: [],
      contentEvidence: 'sampled' as ContentEvidence,
    } as unknown as VerificationResult);

    expect(await verifyCutover({ ...ofKind(store, 'calendar'), runDataVerification: gate })).toBe(true);
    expect(dns).not.toHaveBeenCalled();
    expect(gate).toHaveBeenCalledTimes(1);
    expect(logged.join('\n')).toContain('No DNS to check');
  });

  it('enters the grace period at once for calendars: no MX record to wait for', async () => {
    // Stubbed, so a wait that did run would answer at once rather than poll the network.
    const propagation = vi.spyOn(core, 'checkPropagation').mockResolvedValue(true as never);
    const store = makeStore('APPROVED');
    const mapping = makeMapping('active');

    await executeCutover(ofKind(store, 'calendar', mapping));

    expect(store.transitionState.mock.calls.map((c) => c[2])).toEqual(['CUTOVER_IN_PROGRESS', 'GRACE_PERIOD']);
    expect(propagation).not.toHaveBeenCalled();
    expect(mapping.setStatus).toHaveBeenCalledWith({ from: 'active', to: 'cutover', via: 'cutover' });
    expect(logged.join('\n')).not.toContain('MX record');
  });

  it('still waits for the MX record when the data type is mail', async () => {
    const propagation = vi.spyOn(core, 'checkPropagation').mockResolvedValue(true as never);
    const store = makeStore('APPROVED');

    await executeCutover(ofKind(store, 'email'));

    expect(propagation).toHaveBeenCalledTimes(1);
    expect(logged.join('\n')).toContain('MX record');
  });

  it('rolls calendars back without a word about mail or its MX record', async () => {
    const store = makeStore('GRACE_PERIOD');

    await rollbackCutover(ofKind(store, 'calendar', makeMapping('cutover')));

    const out = logged.join('\n');
    expect(out).toContain('The calendar path cutover -> active');
    expect(out).not.toContain('MX record');
    expect(out).not.toContain('stays on the target');
  });
});
