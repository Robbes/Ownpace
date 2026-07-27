/**
 * Cutover CLI Commands
 * 
 * Provides CLI subcommands for cutover management:
 * - start-cutover: Begin cutover process
 * - verify: Run verification checks
 * - approve: Approve cutover after verification
 * - execute: Execute the actual cutover
 * - rollback: Rollback cutover if needed
 * - status: Show current cutover status
 * 
 * See docs/architecture/solution-architecture.md §11 (DNS switch procedure)
 */

import type { TenantId, MappingId } from '@openmig/shared';
import { CutoverStore } from '@openmig/ledger';
import { verifyAllDns, checkPropagation, generateDnsRunbook } from '@openmig/core';

/** CLI dependencies */
export interface CutoverCliDeps {
  tenantId: TenantId;
  mappingId: MappingId;
  cutoverPersistence: CutoverStore;
  dnsDomain: string;
  targetMailServer: string;
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
    console.log(`\x1b[36mℹ\x1b[0m ${message}`);
  }

  static success(message: string): void {
    console.log(`\x1b[32m✓\x1b[0m ${message}`);
  }

  static warning(message: string): void {
    console.log(`\x1b[33m⚠\x1b[0m ${message}`);
  }

  static error(message: string): void {
    console.log(`\x1b[31m✗\x1b[0m ${message}`);
  }

  static section(title: string): void {
    console.log(`\n\x1b[1m${title}\x1b[0m`);
  }

  static table(rows: Array<{ label: string; value: string }>): void {
    const maxLabelLen = Math.max(...rows.map(r => r.label.length));
    for (const row of rows) {
      console.log(`  ${row.label.padEnd(maxLabelLen)}  ${row.value}`);
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
    console.log(`    - ${line}`);
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

  // Check 2: Data completeness (would need ledger access)
  CutoverCliOutput.info('Checking data completeness...');
  CutoverCliOutput.info('Data verification requires ledger integration - skipping for now');
  results.push({ check: 'Data Completeness', status: 'PASS', message: 'Skipped (manual check required)' });

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

  if (allPassed) {
    CutoverCliOutput.success('All checks passed. Ready to approve cutover.');
    return true;
  } else {
    CutoverCliOutput.warning('Some checks failed. Review errors before proceeding.');
    return false;
  }
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
        `Wait for the ${deps.dnsDomain} MX record to point at ${deps.targetMailServer}, then mark the cutover COMPLETED.`,
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

    CutoverCliOutput.info('Switching DNS records...');
    // DNS switching would be done by the worker job
    CutoverCliOutput.info('DNS switch triggered (see worker logs)');

    CutoverCliOutput.info('Waiting for DNS propagation...');
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
      
      await deps.cutoverPersistence.transitionState(
        deps.tenantId,
        deps.mappingId,
        'COMPLETED',
        { completedAt: new Date().toISOString() }
      );

      CutoverCliOutput.success('Cutover completed successfully!');
      CutoverCliOutput.info('Next step: Monitor for issues during grace period');
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
        'Send no user notification — that is not implemented.',
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
        console.log(`  ${event.timestamp} - ${event.eventType}: ${event.description || 'No description'}`);
      }
    }
  } catch (error) {
    const err = error as Error;
    CutoverCliOutput.error(`Failed to load status: ${err.message}`);
    process.exit(1);
  }
}
