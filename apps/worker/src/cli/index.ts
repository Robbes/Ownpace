#!/usr/bin/env node
/**
 * Cutover CLI - manages cutover lifecycle
 *
 * Usage:
 *   pnpm exec tsx apps/worker/src/cli/index.ts <command> [options]
 *
 * Commands:
 *   start-cutover  Initialize a new cutover
 *   verify         Run verification checks
 *   approve        Approve cutover for execution
 *   execute        Execute the cutover (lands in GRACE_PERIOD)
 *   complete       Close out the grace period (GRACE_PERIOD -> COMPLETED)
 *   rollback       Rollback cutover
 *   status         Show cutover status
 *   runbook        Generate the guided DNS migration runbook (Markdown)
 */

import { CutoverStore, createLedgerVerificationReader } from '@openmig/ledger';
import { asTenantId, asMappingId, type TenantId, type MappingId } from '@openmig/shared';
import { runVerification, createRealVerificationDeps } from '@openmig/core';
import { buildDepsFromMapping } from '../build-deps-from-mapping';
import { buildTargetReindexers } from '../build-reindexers';
import * as cutoverCli from './cutover-commands';
import { log } from '@openmig/shared';

/** Parse cutover CLI arguments */
function parseArgs(): {
  command: string;
  tenantId: string;
  mappingId: string;
  domain: string;
  targetMailServer?: string;
  dkimSelector?: string;
  targetIp?: string;
  assumeYes: boolean;
} {
  const args = process.argv.slice(2);
  let command: string | undefined;
  let tenantId: string | undefined;
  let mappingId: string | undefined;
  let domain: string | undefined;
  let targetMailServer: string | undefined;
  let dkimSelector: string | undefined;
  let targetIp: string | undefined;
  let assumeYes = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg && !arg.startsWith('-') && !command) {
      command = arg;
    } else if (arg === '--tenant' || arg === '-t') {
      tenantId = args[++i];
    } else if (arg === '--mapping' || arg === '-m') {
      mappingId = args[++i];
    } else if (arg === '--domain' || arg === '-d') {
      domain = args[++i];
    } else if (arg === '--target' || arg === '-T') {
      targetMailServer = args[++i];
    } else if (arg === '--dkim-selector' || arg === '-k') {
      dkimSelector = args[++i];
    } else if (arg === '--target-ip' || arg === '-i') {
      targetIp = args[++i];
    } else if (arg === '--yes' || arg === '-y') {
      assumeYes = true;
    } else if (arg === '--help' || arg === '-h') {
      log.info(`
Cutover CLI - Manage migration cutover lifecycle

Usage:
  pnpm exec tsx apps/worker/src/cli/index.ts <command> [options]

Commands:
  start-cutover    Initialize a new cutover
  verify           Run verification checks (DNS, data completeness)
  approve          Approve cutover for execution
  execute          Execute the cutover (DNS switch is YOUR manual step; lands in GRACE_PERIOD)
  complete         Close out the grace period (GRACE_PERIOD -> COMPLETED, terminal)
  rollback         Rollback cutover to previous state
  status           Show current cutover status
  runbook          Generate the guided DNS migration runbook (Markdown, no DB required)

Options:
  --tenant, -t <id>         Tenant ID (required, except for "runbook")
  --mapping, -m <id>        Mapping ID (required, except for "runbook")
  --domain, -d <name>       Domain name for DNS (required)
  --target, -T <host>       Target mail server (default: mail.<domain>)
  --dkim-selector, -k <s>   DKIM selector to check/document (default: "default")
  --target-ip, -i <ip>      IP for the autodiscover record (default: target mail server)
  --yes, -y                 Confirm a state-changing command. REQUIRED by
                            approve, execute, complete and rollback — without
                            it they print what they would do and exit non-zero.
  --help, -h                Show this help message

Examples:
  # Start a new cutover
  pnpm exec tsx apps/worker/src/cli/index.ts start-cutover \\
    --tenant tenant123 --mapping mapping456 --domain example.com

  # Run verification checks
  pnpm exec tsx apps/worker/src/cli/index.ts verify \\
    --tenant tenant123 --mapping mapping456 --domain example.com

  # Approve cutover (state-changing -> needs --yes)
  pnpm exec tsx apps/worker/src/cli/index.ts approve \\
    --tenant tenant123 --mapping mapping456 --domain example.com --yes

  # Execute cutover (state-changing -> needs --yes)
  pnpm exec tsx apps/worker/src/cli/index.ts execute \\
    --tenant tenant123 --mapping mapping456 --domain example.com --yes

  # Complete the cutover after the grace period (state-changing -> needs --yes)
  pnpm exec tsx apps/worker/src/cli/index.ts complete \\
    --tenant tenant123 --mapping mapping456 --domain example.com --yes

  # Rollback cutover (state-changing -> needs --yes)
  pnpm exec tsx apps/worker/src/cli/index.ts rollback \\
    --tenant tenant123 --mapping mapping456 --domain example.com --yes

  # Show status
  pnpm exec tsx apps/worker/src/cli/index.ts status \\
    --tenant tenant123 --mapping mapping456 --domain example.com

  # Generate the DNS runbook (no DB connection needed)
  pnpm exec tsx apps/worker/src/cli/index.ts runbook \\
    --domain example.com --target mail.example.com > dns-runbook.md

Environment Variables:
  DATABASE_URL  PostgreSQL connection string (required for all commands except "runbook")
`);
      process.exit(0);
    }
  }

  if (!command) {
    log.error('Error: command required (start-cutover, verify, approve, execute, complete, rollback, status, runbook)');
    process.exit(1);
  }

  if (!domain) {
    log.error('Error: --domain <name> is required');
    process.exit(1);
  }

  // "runbook" is a pure local computation — no tenant/mapping/DB needed.
  if (command !== 'runbook') {
    if (!tenantId) {
      log.error('Error: --tenant <id> is required');
      process.exit(1);
    }

    if (!mappingId) {
      log.error('Error: --mapping <id> is required');
      process.exit(1);
    }
  }

  return { command, tenantId: tenantId ?? '', mappingId: mappingId ?? '', domain, targetMailServer, dkimSelector, targetIp, assumeYes };
}

/** Main entry point. */
async function main() {
  const { command, tenantId, mappingId, domain, targetMailServer, dkimSelector, targetIp, assumeYes } = parseArgs();

  // "runbook" is a pure local computation — generate and print without touching the DB.
  if (command === 'runbook') {
    log.info(
      cutoverCli.generateRunbook({
        dnsDomain: domain,
        targetMailServer: targetMailServer || `mail.${domain}`,
        targetIp,
        dkimSelector,
      }),
    );
    return;
  }

  // Initialize database connection
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    log.error('Error: DATABASE_URL environment variable required');
    process.exit(1);
  }

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: dbUrl });

  // Import all schema tables individually and create schema object
  const schemaPg = await import('@openmig/ledger/schema-pg');
  const db = drizzle(pool, { schema: schemaPg });

  const cutoverPersistence = new CutoverStore(db);

  const deps: cutoverCli.CutoverCliDeps = {
    tenantId: tenantId as TenantId,
    mappingId: mappingId as MappingId,
    cutoverPersistence,
    dnsDomain: domain,
    targetMailServer: targetMailServer || `mail.${domain}`,
    dkimSelector,
    targetIp,
    assumeYes,
    // The real §20 gate. A closure so nothing connects to the source/target
    // unless `verify` actually asks for it.
    runDataVerification: async () => {
      const runDeps = await buildDepsFromMapping(pool, tenantId, mappingId);
      const targets = await buildTargetReindexers(pool, tenantId, mappingId);
      // Owns its own pool; closed in the finally below.
      const verificationReader = createLedgerVerificationReader({ connectionString: dbUrl });
      try {
        return await runVerification(
          createRealVerificationDeps({
            tenantId: asTenantId(tenantId),
            mappingId: asMappingId(mappingId),
            config: {
              checksumSamplePercentage: 5,
              minSampleSize: 10,
              maxSampleSize: 1000,
              requiredMatchPercentage: 0.99,
              maxDiscrepancyPercentage: 0.01,
              // All four are enabled: a domain that cannot be read comes back
              // NOT_VERIFIABLE and blocks, rather than being quietly switched
              // off here so the gate looks green.
              verifyMail: true,
              verifyCalendar: true,
              verifyContacts: true,
              verifyFiles: true,
            },
            verificationReader,
            // One reindexer per domain, each reading its own target.
            targetReindexers: targets.reindexers,
          }),
        );
      } finally {
        await targets.close();
        await verificationReader.close();
        await runDeps.close();
      }
    },
  };

  switch (command) {
    case 'start-cutover': {
      await cutoverCli.startCutover(deps);
      break;
    }
    case 'verify': {
      const verified = await cutoverCli.verifyCutover(deps);
      process.exit(verified ? 0 : 1);
      break;
    }
    case 'approve': {
      await cutoverCli.approveCutover(deps);
      break;
    }
    case 'execute': {
      await cutoverCli.executeCutover(deps);
      break;
    }
    case 'complete': {
      await cutoverCli.completeCutover(deps);
      break;
    }
    case 'rollback': {
      await cutoverCli.rollbackCutover(deps);
      break;
    }
    case 'status': {
      await cutoverCli.showStatus(deps);
      break;
    }
    default:
      log.error(`Unknown cutover command: ${command}`);
      log.error('Use: start-cutover, verify, approve, execute, complete, rollback, status, runbook');
      process.exit(1);
  }
}

main().catch((err) => {
  log.error('[Cutover CLI] Fatal error:', err);
  process.exit(1);
});
