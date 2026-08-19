import { startTestEnvironment, stopTestEnvironment } from './packages/testing/src/testcontainers-setup.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration(postgresUrl: string): Promise<void> {
  const { Pool } = await import('pg');
  const { readdirSync } = await import('node:fs');

  // Retry logic for connection stability
  const maxRetries = 5;
  const baseDelay = 200; // ms

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const pool = new Pool({ connectionString: postgresUrl });

    try {
      const client = await pool.connect();
      try {
        await client.query(`SELECT pg_advisory_lock(727001)`);
        try {
          // Is the full schema here? ONE table from EACH chain (ADR-0036).
          // `cutover_state` alone (the old check) is created by the shared
          // chain's 0004, so a container migrated before the managed chain
          // existed would report "full schema" and skip it — and every
          // integration test that touches an invoice or a seat would fail on a
          // missing table with nothing pointing at the cause.
          const result = await client.query<{ shared: boolean; managed: boolean }>(`SELECT
            EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'cutover_state') AS shared,
            EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'tenant_pricing') AS managed`);

          if (result.rows[0].shared && result.rows[0].managed) {
            console.log('[Migration] Full schema already exists, skipping.');
            return;
          }

          // Drop all tables if partial schema exists (for clean test runs)
          const tablesResult = await client.query<{ tablename: string }>(`
            SELECT tablename FROM pg_tables WHERE schemaname = 'public'
          `);
          
          if (tablesResult.rows.length > 0) {
            console.log('[Migration] Partial schema detected, dropping all tables for clean state...');
            const tableNames = tablesResult.rows.map((r: { tablename: string }) => r.tablename).join(', ');
            console.log(`[Migration] Dropping tables: ${tableNames}`);
            await client.query(`DROP TABLE IF EXISTS ${tablesResult.rows.map((r: { tablename: string }) => `"${r.tablename}"`).join(', ')} CASCADE`);
          }

          // BOTH chains, shared first (ADR-0036). The integration tier's
          // database stands in for a MANAGED deployment — it is where the
          // billing routes, the seats and the purge are exercised — so it gets
          // what a managed deployment gets. The order is load-bearing: every
          // table in the managed chain references `public.tenant`.
          const chains = [
            join(__dirname, 'packages/ledger/migrations'),
            join(__dirname, 'packages/managed/migrations'),
          ];

          console.log('[Migration] Running ledger schema migrations...');
          for (const migrationsDir of chains) {
            const migrationFiles = readdirSync(migrationsDir)
              .filter(f => f.endsWith('.sql'))
              .sort();
            for (const migrationFile of migrationFiles) {
              const migrationPath = join(migrationsDir, migrationFile);
              const migrationSql = readFileSync(migrationPath, 'utf-8');
              console.log(`[Migration] Running ${migrationFile}...`);
              await client.query(migrationSql);
            }
          }
          console.log('[Migration] All schema migrations complete.');
          return; // Success
        } finally {
          await client.query(`SELECT pg_advisory_unlock(727001)`);
          client.release();
        }
      } finally {
        await pool.end();
      }
    } catch (err) {
      const error = err as Error;
      console.warn(`[Migration] Attempt ${attempt}/${maxRetries} failed: ${error.message}`);

      if (attempt === maxRetries) {
        // Re-throw the original error to preserve the cause chain
        throw error;
      }

      // Exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`[Migration] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Projects that need no container at all.
 *
 * `unit` and `unit-browser` touch no database, no IMAP server and no DAV server —
 * that is what makes them unit tests. Nothing in either reads
 * `TEST_DATABASE_URL`.
 *
 * `e2e` is here for the opposite reason: it needs REAL servers, but not THESE
 * ones. Every `*.e2e.test.ts` is a black-box test of an already-running
 * appliance — it talks to it over HTTP and to Nextcloud/Stalwart directly, and
 * the appliance brings its own Postgres up in `deploy/selfhost/compose.yml`. The
 * Testcontainers Postgres was pure overhead: booted, migrated and never read
 * (verified — no file matching the project references `TEST_DATABASE_URL`,
 * `PgLedger` or `createPgDb`), three times per workflow run, and each boot put a
 * Docker Hub pull between the runner and the first assertion.
 */
const CONTAINER_FREE_PROJECTS = new Set(['unit', 'unit-browser', 'e2e', 'ui']);

// `ui` is here for the same reason as `e2e`: it brings its own world. The
// managed browser smoke serves the built bundle from an in-process http
// server and answers /api from fixtures, so a Testcontainers Postgres would be
// booted, migrated and never read — and would make a suite whose whole point
// is running cheaply on every PR depend on Docker Hub.

/**
 * Does this run actually need containers?
 *
 * A unit-only run was starting Postgres anyway, which meant every unit CI run
 * pulled `testcontainers/ryuk` and `postgres` from Docker Hub before it could
 * execute a single assertion — and failed outright when Docker Hub had a bad
 * minute. That has now happened twice on runs whose tests were all green, and the
 * symptom is deeply unhelpful: a global-setup failure makes Vitest report "No test
 * files found, exiting with code 1", so the log blames the test selection while the
 * real cause is a registry timeout further down.
 *
 * FAILS SAFE, deliberately. The `--project` filter accepts globs and negation
 * (`--project=!e2e`), and misreading one of those as "no containers needed" would
 * break integration tests in a way that looks like a product bug. So containers are
 * skipped only when EVERY selected project is known to be container-free; anything
 * unrecognised, negated or absent keeps the old behaviour of starting them.
 */
export function runNeedsContainers(ctx?: unknown): boolean {
  const selected = (ctx as { config?: { project?: unknown } } | undefined)?.config?.project;
  if (!Array.isArray(selected) || selected.length === 0) return true;
  return !selected.every((p) => typeof p === 'string' && CONTAINER_FREE_PROJECTS.has(p));
}

export default async function (ctx?: unknown) {
  if (!runNeedsContainers(ctx)) {
    console.log(
      '[Vitest Global Setup] Unit projects only — no containers started. ' +
        'Nothing in them reads TEST_DATABASE_URL, and starting Postgres anyway made ' +
        'every unit run depend on Docker Hub being reachable.',
    );
    return;
  }

  console.log('[Vitest Global Setup] Starting Testcontainers environment...');

  // Detect which test project is running via environment variable
  // CI workflows should set SKIP_STALWART=true for unit tests
  const skipStalwart = process.env.SKIP_STALWART === 'true';
  
  // Nextcloud starts by default for integration tests (DAV suites require it)
  // Use SKIP_NEXTCLOUD=true for targeted runs that don't need DAV
  const skipNextcloud = process.env.SKIP_NEXTCLOUD === 'true';
  
  if (skipStalwart) {
    console.log('[Vitest Global Setup] Skipping Stalwart (unit test mode via SKIP_STALWART).');
  }
  
  if (skipNextcloud) {
    console.log('[Vitest Global Setup] Skipping Nextcloud (via SKIP_NEXTCLOUD).');
  } else {
    console.log('[Vitest Global Setup] Starting Nextcloud for DAV integration tests...');
  }
  
  // Skip Stalwart for unit tests - they don't need it and it requires stalwart-cli
  const testEnv = await startTestEnvironment(skipStalwart, skipNextcloud);

  process.env.TEST_DATABASE_URL = testEnv.postgres.connectionString;

  await runMigration(testEnv.postgres.connectionString);

  if (testEnv.stalwart) {
    process.env.STALWART_IMAP_HOST = testEnv.stalwart.imapHost;
    process.env.STALWART_IMAP_PORT = String(testEnv.stalwart.imapPort);
    process.env.STALWART_SMTP_PORT = String(testEnv.stalwart.smtpPort);
    process.env.STALWART_JMAP_URL = testEnv.stalwart.jmapUrl;
    process.env.STALWART_JMAP_USERNAME = testEnv.stalwart.jmapUsername;
    process.env.STALWART_JMAP_PASSWORD = testEnv.stalwart.jmapPassword;
  }

  if (testEnv.nextcloud) {
    process.env.NEXTCLOUD_WEBDAV_URL = testEnv.nextcloud.webdavUrl;
    process.env.NEXTCLOUD_USERNAME = testEnv.nextcloud.username;
    process.env.NEXTCLOUD_PASSWORD = testEnv.nextcloud.password;
  }

  console.log('[Vitest Global Setup] Testcontainers environment ready.');
  console.log(`  - DATABASE_URL: ${testEnv.postgres.connectionString}`);

  if (testEnv.stalwart) {
    console.log(`  - STALWART_JMAP_URL: ${testEnv.stalwart.jmapUrl}`);
    console.log(`  - STALWART_IMAP: ${testEnv.stalwart.imapHost}:${testEnv.stalwart.imapPort}`);
  } else {
    console.log('  - Stalwart: Skipped');
  }

  if (testEnv.nextcloud) {
    console.log(`  - NEXTCLOUD_WEBDAV: ${testEnv.nextcloud.webdavUrl}`);
  } else {
    console.log('  - Nextcloud: Skipped');
  }

  return async (error?: Error) => {
    console.log('[Vitest Global Teardown] Cleaning up Testcontainers...');
    
    // Capture diagnostics if there was an error and stalwart exists
    if (error && testEnv.stalwart) {
      console.error('[Vitest Global Teardown] Test failed with error:', error.message);
      console.error('[Vitest Global Teardown] Capturing diagnostics...');
      try {
        // Capture Stalwart diagnostics
        const { captureContainerDiagnostics } = await import('./packages/testing/src/testcontainers-setup.js');
        await captureContainerDiagnostics(
          testEnv.stalwart.container,
          'stalwart-phase2-error',
          ['ps aux', 'df -h', 'cat /etc/stalwart/config.json 2>/dev/null || echo "no config"', 'ls -la /opt/stalwart/data/']
        );
      } catch (diagErr) {
        const msg = diagErr instanceof Error ? diagErr.message : String(diagErr);
        console.warn('[Vitest Global Teardown] Could not capture diagnostics:', msg);
      }
    }
    
    await stopTestEnvironment(testEnv);
    console.log('[Vitest Global Teardown] Cleanup complete.');
  };
}
