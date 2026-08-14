#!/usr/bin/env node
// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
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
 *   reindex        Rebuild the ledger FROM the target (ADR-0020 recovery)
 *   check-access   Prove the O365 consent runbook actually worked
 */

import { CutoverStore, createLedgerVerificationReader } from '@openmig/ledger';
import { asTenantId, asMappingId, type TenantId, type MappingId } from '@openmig/shared';
import { runVerification, createRealVerificationDeps, reindexFromTarget } from '@openmig/core';
import { buildDepsFromMapping } from '@openmig/orchestration/build-deps-from-mapping';
import { buildTargetReindexers } from '@openmig/orchestration/build-reindexers';
import {
  checkGraphAccess,
  renderAccessCheck,
  createTokenProvider,
  directoryAvailability,
} from '@openmig/connectors';
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
  mailbox?: string;
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
  let mailbox: string | undefined;
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
    } else if (arg === '--mailbox') {
      mailbox = args[++i];
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
  reindex          Rebuild the ledger FROM the target (ADR-0020 lost-ledger
                   recovery). Adopts what the target already holds so the next
                   pass re-copies nothing; reads the target, writes only
                   ledger rows. State-changing -> needs --yes; no --domain.
  check-access     Ask Microsoft Graph, once per consented permission, whether
                   this deployment can actually read what
                   docs/o365-application-access.md set up. Read-only, one
                   record per capability, no database. Needs --tenant (the
                   O365 tenant id) and OAUTH2_CLIENT_ID/OAUTH2_CLIENT_SECRET;
                   pass --mailbox to also prove the two mailbox-scoped
                   permissions.

Options:
  --tenant, -t <id>         Tenant ID (required, except for "runbook")
  --mapping, -m <id>        Mapping ID (required, except for "runbook")
  --domain, -d <name>       Domain name for DNS (required)
  --target, -T <host>       Target mail server (default: mail.<domain>)
  --dkim-selector, -k <s>   DKIM selector to check/document (default: "default")
  --target-ip, -i <ip>      IP for the autodiscover record (default: target mail server)
  --mailbox <address>       For check-access: a mailbox INSIDE the Application
                            Access Policy's group. Without it the two
                            mailbox-scoped permissions are reported as NOT
                            tested, which is not the same as passing.
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

  # Rebuild a lost ledger from the target (state-changing -> needs --yes)
  pnpm exec tsx apps/worker/src/cli/index.ts reindex \\
    --tenant tenant123 --mapping mapping456 --yes

Environment Variables:
  DATABASE_URL  PostgreSQL connection string (required for all commands except "runbook")
`);
      process.exit(0);
    }
  }

  if (!command) {
    log.error('Error: command required (start-cutover, verify, approve, execute, complete, rollback, status, runbook, reindex, check-access)');
    process.exit(1);
  }

  // Neither reindex nor check-access has anything to do with DNS.
  if (!domain && command !== 'reindex' && command !== 'check-access') {
    log.error('Error: --domain <name> is required');
    process.exit(1);
  }

  // "runbook" is a pure local computation — no tenant/mapping/DB needed.
  // "check-access" needs the O365 tenant id and nothing else: it runs BEFORE
  // there is a migration to name, which is the whole point of running it.
  if (command !== 'runbook') {
    if (!tenantId) {
      log.error('Error: --tenant <id> is required');
      process.exit(1);
    }

    if (!mappingId && command !== 'check-access') {
      log.error('Error: --mapping <id> is required');
      process.exit(1);
    }
  }

  // domain is '' only for reindex, which never touches DNS.
  return { command, tenantId: tenantId ?? '', mappingId: mappingId ?? '', domain: domain ?? '', targetMailServer, dkimSelector, targetIp, mailbox, assumeYes };
}

/** Main entry point. */
async function main() {
  const { command, tenantId, mappingId, domain, targetMailServer, dkimSelector, targetIp, mailbox, assumeYes } = parseArgs();

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

  // "check-access" is the proof half of docs/o365-application-access.md, and it
  // deliberately runs BEFORE there is a database, a tenant row or a migration:
  // it is what somebody runs the moment they finish the runbook, to find out
  // whether it worked. Putting it after the DATABASE_URL check would make a
  // setup command require a stack that is not set up yet.
  //
  // Read-only and unauthenticated against our own ledger by construction —
  // it asks Graph four questions and prints the answers.
  if (command === 'check-access') {
    const available = directoryAvailability(process.env, tenantId);
    if (!available.ok) {
      // The credentials are wrong or delegated. Said in the same words the
      // detectors use, so the fix is the same fix.
      log.error(`Cannot check: ${available.reason}`);
      process.exit(1);
    }
    const provider = createTokenProvider({
      tokenEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      clientId: available.clientId,
      clientSecret: available.clientSecret,
      tenantId,
      scope: 'https://graph.microsoft.com/.default',
    });
    const result = await checkGraphAccess(
      async () => (await provider.getToken()).accessToken,
      {
        async request({ url, method, headers }) {
          const res = await fetch(url, { method, headers });
          return { status: res.status, body: await res.text(), headers: {} };
        },
      },
      mailbox ? { mailbox } : {},
    );
    log.info(renderAccessCheck(result));
    // Non-zero when anything did not answer, so it can gate a setup script
    // rather than only being read by a person.
    if (!result.allOk) process.exit(1);
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
    case 'reindex': {
      // ADR-0020's recovery doorway (0026 T1 item 5): rebuild idempotency
      // state FROM the target after a lost ledger. Reads the target, writes
      // only ledger rows — non-destructive and idempotent — but it is still a
      // state-changing command, so the house `--yes` gate applies.
      if (!assumeYes) {
        log.error('reindex writes ledger rows — confirm with --yes');
        process.exit(1);
      }
      const runDeps = await buildDepsFromMapping(pool, tenantId, mappingId);
      const targets = await buildTargetReindexers(pool, tenantId, mappingId);
      try {
        // Reindexer keys are the verification gate's; ledger rows use the
        // ledger's domain names.
        const domainOf = {
          mail: 'email',
          calendar: 'calendar',
          contacts: 'contact',
          files: 'file',
        } as const;
        const entries = Object.entries(targets.reindexers) as Array<
          [keyof typeof domainOf, (typeof targets.reindexers)[keyof typeof targets.reindexers]]
        >;
        if (entries.length === 0) {
          // Rule 9: "no target can enumerate itself" is a blind spot, not a
          // clean bill of health — exit non-zero so a recovery script notices.
          log.error(
            '[reindex] no domain target can enumerate itself — nothing was reindexed. ' +
              'This means "cannot read the target", not "nothing to adopt".',
          );
          process.exit(1);
        }
        for (const [key, reindexer] of entries) {
          if (!reindexer) continue;
          const result = await reindexFromTarget({
            tenantId: asTenantId(tenantId),
            mappingId: asMappingId(mappingId),
            reindexer,
            ledger: runDeps.ledger,
            domain: domainOf[key],
          });
          log.info(
            `[reindex] ${key}: scanned=${result.scanned} adopted=${result.adopted} ` +
              `alreadyKnown=${result.alreadyKnown}`,
          );
        }
      } finally {
        await targets.close();
        await runDeps.close();
      }
      break;
    }
    default:
      log.error(`Unknown cutover command: ${command}`);
      log.error('Use: start-cutover, verify, approve, execute, complete, rollback, status, runbook, reindex');
      process.exit(1);
  }
}

main().catch((err) => {
  log.error('[Cutover CLI] Fatal error:', err);
  process.exit(1);
});
