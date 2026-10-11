#!/usr/bin/env node
// Copyright 2026 The Ownpace authors (Apache-2.0)
/**
 * Worker CLI - runs shadow migration for a single mapping with multi-domain support.
 *
 * Usage:
 *   pnpm exec tsx apps/worker/src/index.ts --config <mapping.json> [--once]
 *
 * Secrets are loaded from environment variables only (never from the config file).
 * 
 * Multi-domain orchestration:
 * - Runs all enabled domains (mail, calendar, contacts, files) independently
 * - A failed domain does NOT block other domains
 * - Tracks status via MigrationStatusStore for each domain
 */

import {
  parseMappingConfig,
  type MappingConfig,
} from '@openmig/shared';
import { InProcessScheduler } from '@openmig/scheduler';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { runAllDomains } from '@openmig/orchestration';
import {
  PgLedger as _PgLedger,
  PgMigrationStatusStore,
  readPathPhases,
  tenantScopedDb,
  withTenant,
} from '@openmig/ledger';
import { log, pathRunsNow, stepFrom, stopReasonOf } from '@openmig/shared';
import { openTaskPools } from './jobs/task-pools.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Parse command line arguments. */
function parseArgs(): { configPath: string; once: boolean } {
  const args = process.argv.slice(2);
  let configPath: string | undefined;
  let once = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' || args[i] === '-c') {
      configPath = args[++i];
    } else if (args[i] === '--once') {
      once = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      log.info(`
Worker CLI - Run shadow migration for a mapping with multi-domain support

Usage:
  pnpm exec tsx apps/worker/src/index.ts --config <mapping.json> [--once]

Options:
  --config, -c <path>  Path to mapping config JSON file (required)
  --once               Run once immediately and exit (default: run in scheduled mode)
  --help, -h           Show this help message

Examples:
  # Run once immediately
  pnpm exec tsx apps/worker/src/index.ts --config mapping.json --once

  # Run in scheduled mode (respects cron from config)
  pnpm exec tsx apps/worker/src/index.ts --config mapping.json

Environment Variables:
  APP_DATABASE_URL     PostgreSQL connection string as app_user (required): the
                       ledger, under row security, as the tasks use it
  SYSTEM_DATABASE_URL  the system role's, ownpace_system (required), for the
                       audit key alone; never the database owner's
  OAUTH2_ACCESS_TOKEN  OAuth2 access token for O365 (if using XOAUTH2)
`);
      process.exit(0);
    }
  }

  if (!configPath) {
    log.error('Error: --config <path> is required');
    process.exit(1);
  }

  return { configPath, once };
}

/** Load mapping config from file. */
function loadConfig(configPath: string): MappingConfig {
  // Resolve config path relative to current working directory, not __dirname
  // This allows --config ./mapping.json to work from any directory
  const absolutePath = resolve(process.cwd(), configPath);
  const text = readFileSync(absolutePath, 'utf-8');
  return parseMappingConfig(text);
}

/** Main entry point. */
async function main() {
  const { configPath, once } = parseArgs();
  log.info(`[Worker] Loading config from ${configPath}`);

  const config = loadConfig(configPath);
  log.info(`[Worker] Mapping ${config.mappingId} for tenant ${config.tenantId}`);

  // Its pools the way the per-tenant tasks take theirs (0138 T1 step 2): the
  // ledger on APP_DATABASE_URL, app_user, under row security, and the audit
  // key's pool of one on the system role's URL (SYSTEM_DATABASE_URL, 0138 T3
  // step 2). `openTaskPools` refuses without either, and never takes the
  // owner's DATABASE_URL in their place, and points the sinks: a failed domain on the operator's log page
  // (0129 T1), the audit lines (0129 T4) on the key's pool.
  const pools = openTaskPools();
  // Every statement of the ledger, the cursors and the status store in this
  // organisation's scope (`tenantScopedDb`): as app_user, a statement with no
  // tenant set reads nothing.
  const db = tenantScopedDb(pools.tenant, config.tenantId);
  const statusStore = new PgMigrationStatusStore(db);
  // Every pass is handed its ledger and opens none of its own (0138 T1 part 2).
  const ledgerOptions = { ledgerDb: db };

  // The reader every gate asks (0128 T5), handed to the pass so that each
  // data type reads its phase when it starts and asks again before it
  // concludes anything (2026-10-05).
  const phasesNow = () =>
    withTenant(pools.tenant, config.tenantId, (tx) => readPathPhases(tx, config.tenantId, config.mappingId));

  /**
   * ONE FIRING, which reads its migration's phases for itself (2026-10-05).
   *
   * This CLI read `mailbox_mapping.status` once, when the process started,
   * and assumed `active` when it could not. A process left running in
   * scheduled mode therefore never heard a cutover, a Pause, or a data type
   * cut over on its own, and kept its deletion detectors after cutover: the
   * owner, 2026-10-05, *"after cross over the bin reading and deleting on
   * target should stop, because perhaps source-leavers clean up ALL after
   * the cross over."* So every firing, `--once` and each cron tick, reads the
   * phases the appliance reads before its pass, schedules by them, and hands
   * the pass the reader and the question it stops by, decided as the
   * appliance decides it (`stepFrom`).
   *
   * A phase it cannot read is a firing refused, never a guess (hard rule 9):
   * a database that does not answer throws, and a migration with no row in
   * it is not one this tool may assume is before its cutover.
   */
  const fire = async () => {
    const phases = await phasesNow();
    if (phases === null) {
      throw new Error(
        `mapping ${config.mappingId} has no row in this database, so its phase cannot be read: ` +
          'refusing to run a pass that would not know whether its cutover is behind it',
      );
    }
    return runAllDomains(
      config,
      statusStore,
      phases.phaseOf,
      phasesNow,
      ledgerOptions,
      (domain) => pathRunsNow(phases.phaseOf(domain)),
      (domain) => phasesNow().then((current) => stopReasonOf(stepFrom(current, domain))),
    );
  };

  if (once) {
    // Run once mode
    log.info('[Worker] Running all enabled domains...');
    const results = await fire();
    
    const totalScanned = results.reduce((sum, r) => sum + r.scanned, 0);
    const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
    
    log.info(`[Worker] Complete: scanned=${totalScanned}, created=${totalCreated}, failed=${totalFailed}`);
    process.exit(totalFailed > 0 ? 1 : 0);
  } else {
    // Scheduled mode
    if (!config.schedule) {
      log.error('[Worker] Error: --once required or schedule.cron must be set in config');
      process.exit(1);
    }

    log.info(`[Worker] Starting scheduled mode with cron: ${config.schedule.cron}`);
    const scheduler = new InProcessScheduler();

    scheduler.schedule(config.mappingId, config.schedule.cron, async () => {
      log.info('[Worker] Running scheduled sync...');
      try {
        const results = await fire();
        
        const totalScanned = results.reduce((sum, r) => sum + r.scanned, 0);
        const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
        const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
        
        log.info(`[Worker] Schedule complete: scanned=${totalScanned}, created=${totalCreated}, failed=${totalFailed}`);
      } catch (err) {
        const error = err as Error;
        log.error(`[Worker] Schedule failed: ${error.message}`);
        // Don't exit - keep the scheduler running
      }
    });

    log.info('[Worker] Scheduler started. Press Ctrl+C to stop.');
    // Keep the process alive
    process.on('SIGINT', () => {
      log.info('\n[Worker] Shutting down...');
      process.exit(0);
    });
  }
}

main().catch((err) => {
  log.error('[Worker] Fatal error:', err);
  process.exit(1);
});

