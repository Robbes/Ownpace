// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
import { confirmed, rollbackCutover, type CutoverCliDeps } from './cutover-commands';

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
