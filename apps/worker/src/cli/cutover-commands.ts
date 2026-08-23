// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Cutover CLI Commands
 * 
 * Provides CLI subcommands for cutover management:
 * - start-cutover: Begin cutover process
 * - verify: Run verification checks
 * - approve: Approve cutover after verification
 * - execute: Execute the actual cutover (lands in GRACE_PERIOD)
 * - complete: Close out the grace period (GRACE_PERIOD -> COMPLETED)
 * - rollback: Rollback cutover if needed
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
  type VerificationResult,
} from '@openmig/core';
import { log } from '@openmig/shared';

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

/**
 * Start a new cutover
 */
export async function startCutover(deps: CutoverCliDeps): Promise<void> {
  CutoverCliOutput.section('Starting Cutover');
  CutoverCliOutput.info(`Tenant: ${deps.tenantId}`);
  CutoverCliOutput.info(`Mapping: ${deps.mappingId}`);
  CutoverCliOutput.info(`Domain: ${deps.dnsDomain}`);

  try {
    const state = await deps.cutoverPersistence.initializeCutover({
      tenantId: deps.tenantId,
      mappingId: deps.mappingId,
      targetMailServer: deps.targetMailServer,
      startedBy: 'cli',
    });

    CutoverCliOutput.success(`Cutover initialized: ${state.currentState}`);
    CutoverCliOutput.info('Next step: Run verification checks with "verify" command');
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
 * Execute the cutover
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

    if (
      !confirmed(deps, 'execute this cutover', [
        `Move mapping ${deps.mappingId} to CUTOVER_IN_PROGRESS.`,
        `Wait for YOU to point the ${deps.dnsDomain} MX record at ${deps.targetMailServer} — this command does not change DNS — then enter the GRACE_PERIOD.`,
        'Mail delivery follows DNS — this is the point users notice.',
      ])
    ) {
      process.exit(1);
    }

    CutoverCliOutput.info('Transitioning to CUTOVER_IN_PROGRESS...');
    await deps.cutoverPersistence.transitionState(
      deps.tenantId,
      deps.mappingId,
      'CUTOVER_IN_PROGRESS',
      { startedAt: new Date().toISOString() }
    );

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

      CutoverCliOutput.error('Cutover failed. Consider rollback.');
      process.exit(1);
    }
  } catch (error) {
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

    if (
      !confirmed(deps, 'complete this cutover', [
        `Mark mapping ${deps.mappingId} COMPLETED — a terminal state.`,
        'After this, "rollback" is no longer accepted; reverting means a manual MX change.',
      ])
    ) {
      process.exit(1);
    }

    await deps.cutoverPersistence.transitionState(
      deps.tenantId,
      deps.mappingId,
      'COMPLETED',
      { completedAt: new Date().toISOString(), completedBy: 'cli' }
    );

    CutoverCliOutput.success('Cutover completed.');
    CutoverCliOutput.info('Restore DNS TTLs to their normal values and archive the source per the runbook.');
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`Failed to complete cutover: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Rollback cutover
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

    if (
      !confirmed(deps, 'roll this cutover back', [
        `Mark mapping ${deps.mappingId} ROLLED_BACK in the cutover ledger.`,
        'Leave DNS untouched — reverting the MX record is a MANUAL step (verify-only DNS).',
        // THE DIFFERENCE BETWEEN THIS COMMAND AND THE JOB, and it is the whole
        // point of a rollback. A rollback exists to set the migration BACK to
        // syncing (owner, 2026-08-23). This command does not do that half: it
        // writes the ledger and never touches `mailbox_mapping`, so the
        // migration stays stopped. An operator who runs this and walks away
        // believes their sync is running again when it is not.
        'Leave the mapping STOPPED — the sync does NOT resume. Run the run-rollback job for that.',
        // The channel exists (0030 T4) — this command does not use it. Said
        // as a property of THIS command, not of the product, so nobody reads
        // it as "notifications do not work" and nobody expects mail from here.
        'Send no user notification — run the rollback job with notifyUsers for that.',
      ])
    ) {
      process.exit(1);
    }

    await deps.cutoverPersistence.transitionState(
      deps.tenantId,
      deps.mappingId,
      'ROLLED_BACK',
      { rolledBackAt: new Date().toISOString(), rolledBackBy: 'cli' }
    );

    CutoverCliOutput.success('Cutover marked as rolled back');
    // AFTER THE ACTION, not in the consequence list, and the difference
    // matters: `confirmed()` returns early on `--yes` and never prints those
    // bullets, so anything said only there is invisible to every operator who
    // actually performs a rollback. This prints on the path that runs.
    //
    // A rollback exists to set the migration BACK to syncing (owner,
    // 2026-08-23). This command does not do that half — it writes the ledger
    // and never touches `mailbox_mapping` — so an operator who runs it and
    // walks away believes their sync is running again when it is not.
    CutoverCliOutput.warning(
      'The mapping is UNCHANGED: the sync does NOT resume from here. ' +
        'Run the run-rollback job to reactivate it.',
    );
    // Do not imply DNS was restored — it was not. Verify-only DNS (owner
    // decision 2026-07-16); the operator reverts the MX record by hand.
    CutoverCliOutput.warning(
      `MANUAL STEP REQUIRED: revert the ${deps.dnsDomain} MX record to the original mail server.`,
    );
    CutoverCliOutput.info('Then re-check it with: verify (or regenerate the runbook with: runbook)');
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`Rollback failed: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Show cutover status
 */
export async function showStatus(deps: CutoverCliDeps): Promise<void> {
  CutoverCliOutput.section('Cutover Status');

  try {
    const state = await deps.cutoverPersistence.loadCutoverState(deps.tenantId, deps.mappingId);
    
    if (!state) {
      CutoverCliOutput.info('No cutover found for this tenant/mapping');
      return;
    }

    const rows: Array<{ label: string; value: string }> = [
      { label: 'State', value: state.currentState || state.state },
      { label: 'Started', value: state.startedAt || 'N/A' },
      { label: 'Target Server', value: state.targetMailServer || 'N/A' },
      { label: 'Started By', value: state.startedBy || 'N/A' },
    ];

    if (state.completedAt) {
      rows.push({ label: 'Completed', value: state.completedAt });
    }

    if (state.rolledBackAt) {
      rows.push({ label: 'Rolled Back', value: state.rolledBackAt });
    }

    if (state.failedAt) {
      rows.push({ label: 'Failed', value: state.failedAt });
    }

    if (state.failureReason) {
      rows.push({ label: 'Failure Reason', value: state.failureReason });
    }

    CutoverCliOutput.table(rows);

    // Show recent events
    const events = await deps.cutoverPersistence.getEventHistory(deps.tenantId, deps.mappingId, 5);
    
    if (events.length > 0) {
      CutoverCliOutput.section('Recent Events');
      for (const event of events) {
        log.info(`  ${event.timestamp} - ${event.eventType}: ${event.description || 'No description'}`);
      }
    }
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`Failed to load status: ${err.message}`);
    process.exit(1);
  }
}
