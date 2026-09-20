// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Cutover CLI Commands
 * 
 * Provides CLI subcommands for cutover management:
 * - start-cutover: Begin cutover process
 * - verify: Run verification checks
 * - approve: Approve cutover after verification
 * - execute: the mapping stops and the ledger enters the cutover; lands in GRACE_PERIOD (ADR-0048)
 * - complete: Close out the grace period (GRACE_PERIOD -> COMPLETED); a mapping still running is stopped
 * - rollback: the setback — ledger ROLLED_BACK and the mapping back to syncing (ADR-0047)
 * - status: Show current cutover status
 * 
 * See docs/architecture/solution-architecture.md §11 (DNS switch procedure)
 */

import type { TenantId, MappingId } from '@openmig/shared';
import { CutoverStore } from '@openmig/ledger';
import {
  verifyAllDns,
  checkPropagation,
  generateDnsRunbook,
  performRollback,
  RollbackRefused,
  TARGET_MAIL_STAYS,
  enterCutover,
  closeCutover,
  CutoverRefused,
  type MappingLifecyclePort,
  type VerificationResult,
} from '@openmig/core';
import {
  log,
  cutoverTransition,
  rollbackTransition,
  isAfterCutover,
  runsPasses,
  type CutoverTransition,
} from '@openmig/shared';

/** CLI dependencies */
export interface CutoverCliDeps {
  tenantId: TenantId;
  mappingId: MappingId;
  cutoverPersistence: CutoverStore;
  dnsDomain: string;
  targetMailServer: string;
  /**
   * The §20 data verification gate: ledger counts vs a target reindex, checksum
   * sampling, missing/extra detection. `verify` calls this — it used to print
   * "Data verification requires ledger integration - skipping for now" and then
   * push `status: 'PASS'` into the results table, so the mandatory pre-cutover
   * data check reported a pass it had never performed (hard rule 9).
   *
   * Injected so the CLI stays unit-testable without a live source/target; the
   * entrypoint wires the real `runVerification`.
   */
  runDataVerification?: () => Promise<VerificationResult>;
  /** DKIM selector to check/document (e.g. the "default" in default._domainkey.example.com). */
  dkimSelector?: string;
  /** IP for the autodiscover record, when it differs from targetMailServer. */
  targetIp?: string;
  /**
   * Explicit operator approval for a state-changing subcommand (`--yes`).
   * Workplan 0009 T2 / arch doc §11.2: nothing irreversible happens without it.
   * A flag rather than an interactive prompt on purpose — the CLI runs in
   * containers and CI where stdin is not a TTY, and a flag is scriptable and
   * shows up in shell history and audit logs.
   */
  assumeYes?: boolean;
  /**
   * The mapping's lifecycle — the half of a rollback this CLI never performed
   * until ADR-0047, and the half of a cutover it never performed until
   * ADR-0048. `mappingLifecyclePort` in `@openmig/ledger` is the real one
   * (the row plus its `mapping.status` audit record); the tests hand in a
   * fake that records what was written.
   */
  mappingLifecycle: MappingLifecyclePort;
  /** `--reason`: why the cutover is being rolled back, for its event trail. */
  rollbackReason?: string;
}

/** CLI output formatter */
export class CutoverCliOutput {
  static info(message: string): void {
    log.info(`\x1b[36mℹ\x1b[0m ${message}`);
  }

  static success(message: string): void {
    log.info(`\x1b[32m✓\x1b[0m ${message}`);
  }

  static warning(message: string): void {
    log.info(`\x1b[33m⚠\x1b[0m ${message}`);
  }

  static error(message: string): void {
    log.info(`\x1b[31m✗\x1b[0m ${message}`);
  }

  static section(title: string): void {
    log.info(`\n\x1b[1m${title}\x1b[0m`);
  }

  static table(rows: Array<{ label: string; value: string }>): void {
    const maxLabelLen = Math.max(...rows.map(r => r.label.length));
    for (const row of rows) {
      log.info(`  ${row.label.padEnd(maxLabelLen)}  ${row.value}`);
    }
  }
}

/**
 * Gate a state-changing action behind explicit `--yes` (workplan 0009 T2,
 * arch doc §11.2, hard rule 2 — nothing irreversible without approval).
 *
 * Returns true when the caller may proceed. When approval is missing it prints
 * exactly what would have happened and returns false; the caller must abort.
 * Exported for unit testing.
 */
export function confirmed(
  deps: Pick<CutoverCliDeps, 'assumeYes'>,
  action: string,
  consequences: string[],
): boolean {
  if (deps.assumeYes) return true;

  CutoverCliOutput.warning(`Refusing to ${action} without explicit approval.`);
  CutoverCliOutput.info('This would:');
  for (const line of consequences) {
    log.info(`    - ${line}`);
  }
  CutoverCliOutput.info('Re-run the same command with --yes to proceed.');
  return false;
}

/**
 * The mapping half of a cutover step, as consequence lines for `confirmed()`
 * — true for THIS mapping rather than generic (ADR-0048). The step reads the
 * mapping again and decides for itself; this is for the person approving.
 */
export function mappingHalfLines(
  mappingId: MappingId,
  decision: Exclude<CutoverTransition, { refuse: string }>,
): string[] {
  if (decision.stop) {
    return [
      `Stop the shadow sync: mapping ${mappingId} '${decision.from}' -> '${decision.to}' — no pass ` +
        'runs after this, and the source is no longer the authority on what exists.',
    ];
  }
  return [
    `Leave mapping ${mappingId} '${decision.from}': ${decision.reason}.`,
    ...(decision.warning ? [decision.warning] : []),
  ];
}

/**
 * Generate the guided DNS migration runbook for this domain — the §14.2 "guide"
 * DNS story: the exact records to change, before/after, matching what `verify`
 * then checks. Pure/local (no DB, no credentials) — returns raw Markdown; the
 * caller decides whether to print it, write it to a file, or both.
 */
export function generateRunbook(
  params: Pick<CutoverCliDeps, 'dnsDomain' | 'targetMailServer' | 'targetIp' | 'dkimSelector'>,
): string {
  return generateDnsRunbook(params.dnsDomain, params.targetMailServer, params.targetIp, params.dkimSelector);
}

/** The subcommand that moves a ledger on from each non-terminal state — for "already exists" messages. */
const NEXT_STEP: Record<string, string> = {
  PREPARING: 'run verification checks with "verify"',
  READY_FOR_CUTOVER: 'approve it with "approve --yes"',
  APPROVED: 'execute it with "execute --yes"',
  CUTOVER_IN_PROGRESS: 'wait for propagation, or "rollback --yes"',
  GRACE_PERIOD: 'close it out with "complete --yes", or "rollback --yes"',
};

/**
 * Start a cutover — or say, truthfully, what already exists.
 *
 * There is ONE cutover ledger per mapping (`cutover_state` is unique on
 * tenant + mapping) and `initializeCutover` returns the existing row rather
 * than resetting it. This used to print "Cutover initialized: ROLLED_BACK"
 * for a row it had merely read back, after which `verify` — which only
 * advances PREPARING — silently did nothing, and the runbook's "a FAILED
 * cutover transitions back to PREPARING — re-run" named a transition no
 * command performed.
 *
 * Now: no ledger → initialise it. FAILED → retry, the FAILED → PREPARING edge
 * the state machine has always had, recorded with who and which attempt; the
 * trail keeps the failed attempt (append-only). COMPLETED and ROLLED_BACK →
 * refuse out loud: the machine admits nothing out of either, and a second
 * attempt after a rollback — the outcome ADR-0047 made recoverable — is the
 * owner's call (workplan 0009 T8), not something to bury under "initialized".
 * Anything else → it already exists, and here is the next step.
 */
export async function startCutover(deps: CutoverCliDeps): Promise<void> {
  CutoverCliOutput.section('Starting Cutover');
  CutoverCliOutput.info(`Tenant: ${deps.tenantId}`);
  CutoverCliOutput.info(`Mapping: ${deps.mappingId}`);
  CutoverCliOutput.info(`Domain: ${deps.dnsDomain}`);

  try {
    const existing = await deps.cutoverPersistence.loadCutoverState(deps.tenantId, deps.mappingId);

    if (!existing) {
      const state = await deps.cutoverPersistence.initializeCutover({
        tenantId: deps.tenantId,
        mappingId: deps.mappingId,
        targetMailServer: deps.targetMailServer,
        startedBy: 'cli',
      });
      CutoverCliOutput.success(`Cutover initialized: ${state.currentState}`);
      CutoverCliOutput.info('Next step: Run verification checks with "verify" command');
      return;
    }

    const current = existing.currentState || existing.state;

    if (current === 'FAILED') {
      // Which attempt this is, counted from the trail rather than guessed.
      const events = await deps.cutoverPersistence.getEventHistory(deps.tenantId, deps.mappingId);
      const attempt = events.filter((e) => e.toState === 'PREPARING').length + 1;
      await deps.cutoverPersistence.transitionState(deps.tenantId, deps.mappingId, 'PREPARING', {
        retriedBy: 'cli',
        retriedAt: new Date().toISOString(),
        attempt,
      });
      CutoverCliOutput.success(`Cutover retried: FAILED -> PREPARING (attempt ${attempt}).`);
      CutoverCliOutput.info('The failed attempt stays in the event trail. Next step: "verify".');
      return;
    }

    if (current === 'COMPLETED' || current === 'ROLLED_BACK') {
      CutoverCliOutput.error(`A cutover ledger already exists for this mapping, and it is ${current} — terminal.`);
      CutoverCliOutput.info(
        'The state machine admits no transition out of it, and there is one cutover ledger per ' +
          'mapping, so a second attempt is not possible today. Nothing was changed.',
      );
      if (current === 'ROLLED_BACK') {
        CutoverCliOutput.info(
          'A cutover attempted again after a rollback is workplan 0009 T8 — the owner\'s call. ' +
            'Until then: "status" shows the trail; the mapping itself is syncing again if the ' +
            'rollback resumed it.',
        );
      }
      process.exit(1);
    }

    CutoverCliOutput.warning(`A cutover ledger already exists for this mapping: ${current}. Nothing was changed.`);
    CutoverCliOutput.info(`Next step: ${NEXT_STEP[current] ?? 'see "status"'}.`);
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`Failed to start cutover: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Run verification checks
 */
export async function verifyCutover(deps: CutoverCliDeps): Promise<boolean> {
  CutoverCliOutput.section('Running Verification Checks');

  const results: Array<{ check: string; status: 'PASS' | 'FAIL'; message: string }> = [];
  let allPassed = true;

  // Check 1: DNS records
  CutoverCliOutput.info('Checking DNS records...');
  try {
    const dnsStatus = await verifyAllDns(deps.dnsDomain, deps.dkimSelector);

    if (dnsStatus.mxVerified) {
      CutoverCliOutput.success('MX records verified');
      results.push({ check: 'MX Records', status: 'PASS', message: 'Verified' });
    } else {
      CutoverCliOutput.error('MX records not verified');
      results.push({ check: 'MX Records', status: 'FAIL', message: dnsStatus.errors[0] || 'Not found' });
      allPassed = false;
    }

    if (dnsStatus.spfVerified) {
      CutoverCliOutput.success('SPF record verified');
      results.push({ check: 'SPF Record', status: 'PASS', message: 'Verified' });
    } else {
      CutoverCliOutput.warning('SPF record not verified');
      results.push({ check: 'SPF Record', status: 'FAIL', message: dnsStatus.errors[0] || 'Not found' });
      // Not blocking - just a warning
    }

    if (dnsStatus.dkimVerified) {
      CutoverCliOutput.success('DKIM record verified');
      results.push({ check: 'DKIM Record', status: 'PASS', message: 'Verified' });
    } else {
      CutoverCliOutput.warning('DKIM record not configured');
      results.push({ check: 'DKIM Record', status: 'FAIL', message: 'Not configured' });
      // Not blocking - just a warning
    }

    if (dnsStatus.dmarcVerified) {
      CutoverCliOutput.success('DMARC record verified');
      results.push({ check: 'DMARC Record', status: 'PASS', message: 'Verified' });
    } else {
      CutoverCliOutput.warning('DMARC record not configured');
      results.push({ check: 'DMARC Record', status: 'FAIL', message: 'Not configured' });
      // Not blocking - just a warning
    }

    if (dnsStatus.autodiscoverVerified) {
      CutoverCliOutput.success('Autodiscover verified');
      results.push({ check: 'Autodiscover', status: 'PASS', message: 'Verified' });
    } else {
      CutoverCliOutput.warning('Autodiscover not configured');
      results.push({ check: 'Autodiscover', status: 'FAIL', message: 'Not configured' });
      // Not blocking - just a warning
    }
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`DNS verification failed: ${err.message}`);
    allPassed = false;
  }

  // Check 2: Data completeness — the §20 gate. This is the check the whole
  // cutover exists to make: does the target actually hold what the ledger says
  // was copied? It must never report a verdict it did not measure.
  CutoverCliOutput.info('Checking data completeness...');
  if (!deps.runDataVerification) {
    // No ledger wiring supplied. That is a broken invocation, not a pass.
    CutoverCliOutput.error('Data verification is not wired up for this invocation.');
    results.push({
      check: 'Data Completeness',
      status: 'FAIL',
      message: 'NOT VERIFIED (no ledger access)',
    });
    allPassed = false;
  } else {
    try {
      const verification = await deps.runDataVerification();
      const summary =
        `${verification.totalItemsSource} source / ${verification.totalItemsTarget} target, ` +
        `${verification.totalDiscrepancies} discrepancies, score ${verification.score.toFixed(3)}`;

      if (verification.overallStatus === 'FAIL' || !verification.canProceedToCutover) {
        CutoverCliOutput.error(`Data verification FAILED — ${summary}`);
        for (const r of verification.recommendations) {
          CutoverCliOutput.info(`  ${r}`);
        }
        results.push({ check: 'Data Completeness', status: 'FAIL', message: summary });
        allPassed = false;
      } else {
        if (verification.overallStatus === 'WARN') {
          CutoverCliOutput.warning(`Data verification passed with warnings — ${summary}`);
          for (const r of verification.recommendations) {
            CutoverCliOutput.info(`  ${r}`);
          }
        } else {
          CutoverCliOutput.success(`Data verification passed — ${summary}`);
        }
        results.push({
          check: 'Data Completeness',
          status: 'PASS',
          message: `${verification.overallStatus} (${summary})`,
        });
      }
    } catch (error) {
      // A gate that could not run has NOT passed (hard rule 9).
      const err = error as Error;
      CutoverCliOutput.error(`Data verification could not run: ${err.message}`);
      results.push({ check: 'Data Completeness', status: 'FAIL', message: `Error: ${err.message}` });
      allPassed = false;
    }
  }

  // Check 3: Cutover state
  CutoverCliOutput.info('Checking cutover state...');
  try {
    const state = await deps.cutoverPersistence.loadCutoverState(deps.tenantId, deps.mappingId);
    if (state) {
      const stateStr = state.currentState || state.state;
      CutoverCliOutput.info(`Current state: ${stateStr}`);
      results.push({ check: 'Cutover State', status: 'PASS', message: stateStr });
    } else {
      CutoverCliOutput.warning('No cutover state found');
      results.push({ check: 'Cutover State', status: 'FAIL', message: 'Not initialized' });
      allPassed = false;
    }
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`Failed to load cutover state: ${err.message}`);
    allPassed = false;
  }

  // Print summary
  CutoverCliOutput.section('Verification Summary');
  CutoverCliOutput.table(results.map(r => ({ label: r.check, value: r.message })));

  if (!allPassed) {
    CutoverCliOutput.warning('Some checks failed. Review errors before proceeding.');
    return false;
  }

  // Everything passed, so record it: move PREPARING → READY_FOR_CUTOVER.
  //
  // Without this the CLI flow dead-ends. `approve` refuses unless the state is
  // READY_FOR_CUTOVER, `verify` never wrote a state at all, and nothing else in
  // the CLI sets it — so `approve` was unreachable no matter what the operator
  // did. This is not one of the `--yes`-gated actions: reaching "ready for
  // approval" is the verification's own outcome and changes nothing
  // irreversible. Approving and executing still require --yes.
  try {
    const state = await deps.cutoverPersistence.loadCutoverState(deps.tenantId, deps.mappingId);
    const current = state?.currentState ?? state?.state;
    if (current === 'PREPARING') {
      const ready = await deps.cutoverPersistence.transitionState(
        deps.tenantId,
        deps.mappingId,
        'READY_FOR_CUTOVER',
        { readyAt: new Date().toISOString(), verifiedBy: 'cli' },
      );
      CutoverCliOutput.success(`All checks passed. State: ${ready.currentState ?? ready.state}`);
    } else {
      CutoverCliOutput.success(`All checks passed. State unchanged: ${current}`);
    }
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`Checks passed but the state could not be advanced: ${err.message}`);
    return false;
  }

  CutoverCliOutput.info('Next step: approve the cutover with "approve --yes".');
  return true;
}

/**
 * Approve cutover for execution
 */
export async function approveCutover(deps: CutoverCliDeps): Promise<void> {
  CutoverCliOutput.section('Approving Cutover');

  try {
    const state = await deps.cutoverPersistence.loadCutoverState(deps.tenantId, deps.mappingId);
    
    if (!state) {
      CutoverCliOutput.error('No cutover state found. Start cutover first.');
      process.exit(1);
    }

    if (state.currentState !== 'READY_FOR_CUTOVER') {
      CutoverCliOutput.error(`Invalid state for approval: ${state.currentState}`);
      CutoverCliOutput.info('Cutover must be in READY_FOR_CUTOVER state');
      process.exit(1);
    }

    if (
      !confirmed(deps, 'approve this cutover', [
        `Mark mapping ${deps.mappingId} APPROVED, clearing it for execution.`,
        'The next "execute" run may then switch traffic to the target.',
      ])
    ) {
      process.exit(1);
    }

    const newState = await deps.cutoverPersistence.transitionState(
      deps.tenantId,
      deps.mappingId,
      'APPROVED',
      { approvedBy: 'cli', timestamp: new Date().toISOString() }
    );

    CutoverCliOutput.success(`Cutover approved: ${newState.currentState}`);
    CutoverCliOutput.info('Next step: Execute cutover with "execute" command');
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`Failed to approve cutover: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Execute the cutover: the mapping stops, the ledger enters CUTOVER_IN_PROGRESS,
 * the operator moves the MX record, and the ledger lands in GRACE_PERIOD.
 *
 * The first two are `enterCutover` (ADR-0048). This command used to move only
 * the ledger, so a CLI-driven cutover ran with the mapping still `active` —
 * passes scheduled, deletion detectors present, a source that had just
 * stopped being the authority still mirrored (0117 D4) — and the rollback's
 * "resume the sync" half found nothing to resume.
 */
export async function executeCutover(deps: CutoverCliDeps): Promise<void> {
  CutoverCliOutput.section('Executing Cutover');

  try {
    const state = await deps.cutoverPersistence.loadCutoverState(deps.tenantId, deps.mappingId);
    
    if (!state) {
      CutoverCliOutput.error('No cutover state found. Start cutover first.');
      process.exit(1);
    }

    if (state.currentState !== 'APPROVED') {
      CutoverCliOutput.error(`Invalid state for execution: ${state.currentState}`);
      CutoverCliOutput.info('Cutover must be in APPROVED state');
      process.exit(1);
    }

    const decision = cutoverTransition(await deps.mappingLifecycle.readStatus());
    if ('refuse' in decision) {
      CutoverCliOutput.error(decision.refuse);
      CutoverCliOutput.info(decision.hint);
      process.exit(1);
    }

    if (
      !confirmed(deps, 'execute this cutover', [
        `Move the cutover ledger for mapping ${deps.mappingId} to CUTOVER_IN_PROGRESS (from APPROVED).`,
        ...mappingHalfLines(deps.mappingId, decision),
        `Wait for YOU to point the ${deps.dnsDomain} MX record at ${deps.targetMailServer} — this command does not change DNS — then enter the GRACE_PERIOD.`,
        'Mail delivery follows DNS — this is the point users notice.',
      ])
    ) {
      process.exit(1);
    }

    const entered = await enterCutover({
      tenantId: deps.tenantId,
      mappingId: deps.mappingId,
      cutoverStore: deps.cutoverPersistence,
      mapping: deps.mappingLifecycle,
      by: 'cli',
      log: (message) => CutoverCliOutput.info(message),
    });
    if (entered.mapping.changed) {
      CutoverCliOutput.success(
        `Mapping ${entered.mapping.from} -> ${entered.mapping.to}: the shadow sync has stopped.`,
      );
    } else {
      CutoverCliOutput.warning(`Mapping left '${entered.mapping.from}': ${entered.mapping.note ?? ''}`);
      if (entered.mapping.warning) CutoverCliOutput.warning(entered.mapping.warning);
    }

    // Nothing here switches DNS, and no worker job does either — DNS provider
    // writes are deferred (verify-only DNS, owner decision 2026-07-16). This
    // used to print "DNS switch triggered (see worker logs)", pointing the
    // operator at logs that would never mention it while the command sat
    // waiting for a record change nobody had made.
    CutoverCliOutput.warning(
      `MANUAL STEP REQUIRED: point the ${deps.dnsDomain} MX record at ${deps.targetMailServer} now.`,
    );
    CutoverCliOutput.info('The exact records are in the runbook: "runbook --domain ' + deps.dnsDomain + '"');

    CutoverCliOutput.info('Waiting for that change to propagate...');
    const propagated = await checkPropagation(
      deps.dnsDomain,
      [
        { type: 'MX', value: deps.targetMailServer },
      ],
      10,
      30000
    );

    if (propagated) {
      CutoverCliOutput.success('DNS propagation confirmed');

      // GRACE_PERIOD, not COMPLETED: the state machine (cutover-state.ts) has
      // no CUTOVER_IN_PROGRESS -> COMPLETED edge. This used to attempt it, so
      // the happy path threw "Invalid transition" AFTER the operator had
      // already switched DNS, stranding the ledger in CUTOVER_IN_PROGRESS.
      // The grace window is also §11's actual next phase: both systems live,
      // the operator watching mail flow, rollback still possible.
      await deps.cutoverPersistence.transitionState(
        deps.tenantId,
        deps.mappingId,
        'GRACE_PERIOD',
        { gracePeriodStartedAt: new Date().toISOString() }
      );

      CutoverCliOutput.success('Cutover executed — grace period active.');
      CutoverCliOutput.info(
        'Monitor mail flow, then close it out with "complete --yes" (or "rollback --yes" to revert).',
      );
    } else {
      CutoverCliOutput.error('DNS propagation failed');
      
      await deps.cutoverPersistence.transitionState(
        deps.tenantId,
        deps.mappingId,
        'FAILED',
        { failedAt: new Date().toISOString(), failureReason: 'DNS propagation timeout' }
      );

      // The mapping is NOT put back here: whether the MX record moved is
      // exactly what is unknown, and no pass should run while it is. The
      // rollback is the explicit undo, and it resumes the sync.
      CutoverCliOutput.warning(
        `The mapping stays '${entered.mapping.to}' — no pass runs while the cutover is unresolved. ` +
          '"rollback --yes" puts it back to syncing and marks the cutover ROLLED_BACK.',
      );
      CutoverCliOutput.error('Cutover failed. Consider rollback.');
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof CutoverRefused) {
      // Nothing was written. Said so, because "failed" would read as half done.
      CutoverCliOutput.error(`Cutover refused: ${error.message}`);
      if (error.hint) CutoverCliOutput.info(error.hint);
      CutoverCliOutput.info('Nothing was changed.');
      process.exit(1);
    }
    const err = error as Error;
    CutoverCliOutput.error(`Cutover execution failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Close out the grace period: GRACE_PERIOD -> COMPLETED.
 *
 * COMPLETED is only reachable from GRACE_PERIOD, and before this subcommand
 * existed nothing in the CLI could get there — `execute` jumped straight at
 * COMPLETED and the state machine threw. COMPLETED is terminal (`rollback`
 * is no longer accepted from it), so this is a state-changing action and
 * `--yes`-gated like the others.
 *
 * `closeCutover` (ADR-0048) also stops a mapping that is still running — a
 * cutover executed before `execute` wrote the mapping — rather than closing
 * a terminal ledger over a sync that keeps mirroring a source that stopped
 * being the authority. It does NOT finish the migration: `done` has its own
 * rule about unresolved failures, and it stays where that rule lives.
 */
export async function completeCutover(deps: CutoverCliDeps): Promise<void> {
  CutoverCliOutput.section('Completing Cutover');

  try {
    const state = await deps.cutoverPersistence.loadCutoverState(deps.tenantId, deps.mappingId);

    if (!state) {
      CutoverCliOutput.error('No cutover state found.');
      process.exit(1);
    }

    if (state.currentState !== 'GRACE_PERIOD') {
      CutoverCliOutput.error(`Invalid state for completion: ${state.currentState}`);
      CutoverCliOutput.info('Cutover must be in GRACE_PERIOD state');
      process.exit(1);
    }

    const decision = cutoverTransition(await deps.mappingLifecycle.readStatus());
    if ('refuse' in decision) {
      CutoverCliOutput.error(decision.refuse);
      CutoverCliOutput.info(decision.hint);
      process.exit(1);
    }

    if (
      !confirmed(deps, 'complete this cutover', [
        `Mark the cutover ledger for mapping ${deps.mappingId} COMPLETED (from GRACE_PERIOD) — a terminal state.`,
        ...mappingHalfLines(deps.mappingId, decision),
        'After this, "rollback" is no longer accepted; reverting means a manual MX change.',
        "Leave the migration's own ending to you: finishing it ('done', which checks unresolved " +
          "failures) or keeping it copying ('continuous') is decided on the Finish page, not here.",
      ])
    ) {
      process.exit(1);
    }

    const closed = await closeCutover({
      tenantId: deps.tenantId,
      mappingId: deps.mappingId,
      cutoverStore: deps.cutoverPersistence,
      mapping: deps.mappingLifecycle,
      by: 'cli',
      log: (message) => CutoverCliOutput.info(message),
    });

    CutoverCliOutput.success('Cutover completed.');
    if (closed.mapping.changed) {
      CutoverCliOutput.success(
        `Mapping ${closed.mapping.from} -> ${closed.mapping.to}: the shadow sync has stopped.`,
      );
    } else {
      CutoverCliOutput.info(`Mapping left '${closed.mapping.from}': ${closed.mapping.note ?? ''}`);
      if (closed.mapping.warning) CutoverCliOutput.warning(closed.mapping.warning);
    }
    CutoverCliOutput.info(
      `The mapping is '${closed.mapping.to}'. This command closes the cutover ledger, not the migration: ` +
        "finish it ('done') or keep it copying ('continuous') from the Finish page.",
    );
    CutoverCliOutput.info('Restore DNS TTLs to their normal values and archive the source per the runbook.');
  } catch (error) {
    if (error instanceof CutoverRefused) {
      CutoverCliOutput.error(`Completion refused: ${error.message}`);
      if (error.hint) CutoverCliOutput.info(error.hint);
      CutoverCliOutput.info('Nothing was changed.');
      process.exit(1);
    }
    const err = error as Error;
    CutoverCliOutput.error(`Failed to complete cutover: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Rollback cutover — the setback, performed by `performRollback` (ADR-0047).
 *
 * This command gates and prints; it decides nothing. It used to write the
 * cutover ledger and stop there, leaving `mailbox_mapping` where it was — the
 * label without the thing — while the job that did resume the sync was one
 * nothing called. Both now call the same function, in the same order: the
 * mapping first, then the ledger, and a refusal before either.
 */
export async function rollbackCutover(deps: CutoverCliDeps): Promise<void> {
  CutoverCliOutput.section('Rolling Back Cutover');

  try {
    const state = await deps.cutoverPersistence.loadCutoverState(deps.tenantId, deps.mappingId);

    if (!state) {
      CutoverCliOutput.error('No cutover state found.');
      process.exit(1);
    }

    CutoverCliOutput.warning(`Current state: ${state.currentState}`);

    // Read the mapping so the consequence list is TRUE for this mapping rather
    // than generic. `performRollback` reads it again and decides for itself;
    // this read is for the person being asked to approve.
    const mappingStatus = await deps.mappingLifecycle.readStatus();
    const decision = rollbackTransition(mappingStatus);
    if ('refuse' in decision) {
      CutoverCliOutput.error(decision.refuse);
      CutoverCliOutput.info(decision.hint);
      process.exit(1);
    }
    const mappingLine = decision.reactivate
      ? `Set mapping ${deps.mappingId} back to '${decision.to}' (from '${decision.from}') — ` +
        'the sync resumes with the source authoritative.'
      : `Leave mapping ${deps.mappingId} '${decision.from}': ${decision.reason}`;

    if (
      !confirmed(deps, 'roll this cutover back', [
        `Mark the cutover ROLLED_BACK in the ledger (from ${state.currentState}).`,
        mappingLine,
        'Leave DNS untouched — reverting the MX record is a MANUAL step (verify-only DNS).',
        'Leave mail delivered to the TARGET where it is — a rollback never salvages from the target.',
        // The channel exists (0030 T4); this command does not use it. Said as
        // a property of THIS command, so nobody expects mail from here.
        'Send no notification from here — the run-rollback job with notifyUsers does that.',
      ])
    ) {
      process.exit(1);
    }

    const outcome = await performRollback({
      tenantId: deps.tenantId,
      mappingId: deps.mappingId,
      cutoverStore: deps.cutoverPersistence,
      mapping: deps.mappingLifecycle,
      rolledBackBy: 'cli',
      reason: deps.rollbackReason ?? 'Rolled back from the operator CLI',
      log: (message) => CutoverCliOutput.info(message),
    });

    CutoverCliOutput.success(`Cutover rolled back (from ${outcome.from}).`);
    if (outcome.mapping.changed) {
      CutoverCliOutput.success(
        `Mapping ${outcome.mapping.from} -> ${outcome.mapping.to}: the sync resumes with the source authoritative.`,
      );
    } else {
      CutoverCliOutput.warning(`Mapping left '${outcome.mapping.from}': ${outcome.mapping.note ?? ''}`);
    }
    // Said after the action, on the path that runs: `confirmed()` returns
    // early on `--yes` and never prints its consequence bullets.
    CutoverCliOutput.warning(TARGET_MAIL_STAYS);
    // Do not imply DNS was restored — it was not. Verify-only DNS (owner
    // decision 2026-07-16); the operator reverts the MX record by hand.
    CutoverCliOutput.warning(
      `MANUAL STEP REQUIRED: revert the ${deps.dnsDomain} MX record to the original mail server.`,
    );
    CutoverCliOutput.info('Then re-check it with: verify (or regenerate the runbook with: runbook)');
  } catch (error) {
    if (error instanceof RollbackRefused) {
      // Nothing was written. Said so, because "failed" would read as half done.
      CutoverCliOutput.error(`Rollback refused: ${error.message}`);
      if (error.hint) CutoverCliOutput.info(error.hint);
      CutoverCliOutput.info('Nothing was changed.');
      process.exit(1);
    }
    const err = error as Error;
    CutoverCliOutput.error(`Rollback failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * What the lifecycle word means for the passes, in one line — derived from the
 * same two predicates the schedulers and the passes read, so this sentence
 * cannot say something the rules do not (ADR-0048).
 */
export function lifecycleLine(status: string): string {
  if (runsPasses(status)) {
    return isAfterCutover(status)
      ? `${status} — passes run after the cutover; deletions at the source are not mirrored (the continuous lane)`
      : `${status} — passes run; the source is the authority on what exists`;
  }
  if (status === 'done') return `${status} — finished; the shadow sync has ended and nothing runs`;
  if (isAfterCutover(status)) {
    return `${status} — stopped for the cutover; no pass runs, and the source is no longer the authority on what exists`;
  }
  return `${status} — stopped by an operator, before any cutover; Start resumes it`;
}

/** Who did a thing, from the event's own metadata when the door recorded it, else the ledger's coarse actor. */
function who(event: { triggeredBy: string; metadata?: Record<string, unknown> }): string {
  const m = event.metadata ?? {};
  for (const key of ['rolledBackBy', 'completedBy', 'approvedBy', 'startedBy']) {
    const v = m[key];
    if (typeof v === 'string' && v) return v;
  }
  return event.triggeredBy;
}

/**
 * Show cutover status — both halves, from the records that actually hold them.
 *
 * This printed rows the read path never fills: `mapRowToStatus` maps no
 * `startedBy`, `rolledBackAt`, `failedAt` or `failureReason`, and `complete`
 * writes `completedAt` metadata the row does not persist as
 * `gracePeriodCompletedAt`. So "Started By" was always N/A and Rolled Back,
 * Failed and Completed never printed — while the append-only trail beside
 * them had every one of those facts. And "Recent Events" asked for the first
 * five in ascending order, so on any cutover past its fifth event the newest —
 * the rollback, the failure — was exactly the one left out.
 *
 * Now: the ledger state with the event that entered it (when, by whom, why),
 * whether a rollback is admitted from there (derived from the machine since
 * ADR-0047), and the MAPPING's lifecycle — the other half an operator needs
 * since ADR-0048, which this never showed at all — with what it means for the
 * passes. The trail is listed newest first.
 */
export async function showStatus(deps: CutoverCliDeps): Promise<void> {
  CutoverCliOutput.section('Cutover Status');

  try {
    const state = await deps.cutoverPersistence.loadCutoverState(deps.tenantId, deps.mappingId);

    // The mapping half is read regardless of the ledger: a migration with no
    // cutover row still has a lifecycle, and it is the one thing the
    // schedulers act on. A row that cannot be read is said so (hard rule 9),
    // never presented as a value.
    let lifecycle: string;
    try {
      lifecycle = lifecycleLine(await deps.mappingLifecycle.readStatus());
    } catch (error) {
      lifecycle = `could not be read: ${(error as Error).message}`;
    }

    if (!state) {
      CutoverCliOutput.info('No cutover found for this tenant/mapping');
      CutoverCliOutput.table([{ label: 'Mapping lifecycle', value: lifecycle }]);
      return;
    }

    const current = state.currentState || state.state;
    const events = await deps.cutoverPersistence.getEventHistory(deps.tenantId, deps.mappingId);
    const newestFirst = [...events].reverse();
    const entered = newestFirst.find((e) => e.toState === current);
    const init = events.find((e) => e.eventType === 'CUTOVER_INITIALIZED');

    const rows: Array<{ label: string; value: string }> = [
      {
        label: 'State',
        value: entered
          ? `${current} — since ${entered.timestamp} by ${who(entered)}${entered.reason ? `: ${entered.reason}` : ''}`
          : current,
      },
      {
        label: 'Rollback',
        value: state.rollbackAvailable
          ? `available — the state machine admits ROLLED_BACK from ${current}`
          : `not available from ${current}`,
      },
      { label: 'Mapping lifecycle', value: lifecycle },
      { label: 'Started', value: `${state.startedAt}${init ? ` by ${who(init)}` : ''}` },
      { label: 'Target Server', value: state.targetMailServer || 'not recorded' },
    ];
    if (state.gracePeriodStartedAt) {
      rows.push({ label: 'Grace period since', value: state.gracePeriodStartedAt });
    }
    CutoverCliOutput.table(rows);

    if (newestFirst.length > 0) {
      CutoverCliOutput.section('Events (newest first)');
      for (const event of newestFirst.slice(0, 10)) {
        log.info(
          `  ${event.timestamp}  ${event.fromState ?? '—'} -> ${event.toState}  by ${who(event)}` +
            (event.reason ? `: ${event.reason}` : ''),
        );
      }
      if (newestFirst.length > 10) {
        log.info(`  … ${newestFirst.length - 10} earlier event(s) not shown`);
      }
    }
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`Failed to load status: ${err.message}`);
    process.exit(1);
  }
}
