// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// The backup/restore drill — §22.1's last unbuilt CI gate (workplan 0025 T5).
//
// §22.1 promises a backup/restore drill executed in CI, and the quickstart
// documents a procedure for each backend. Until this file, both were prose:
// nothing had ever restored an appliance from its own documented backup, and
// the first person to try it would have been an operator whose disk had just
// died. That is the worst possible moment to discover a procedure does not
// work.
//
// WHAT THIS DRILL IS. Not "pg_dump exits 0" — that proves nothing. It runs the
// documented procedure end to end against the real, populated appliance:
//
//   1. Read the state the appliance reports NOW (per-domain itemsSynced, and
//      on the Postgres path a direct ledger row count).
//   2. Back it up exactly as the runbook says.
//   3. DESTROY the database — volume removed on Postgres, state directory
//      deleted on PGlite. Not a truncate: the shape an operator actually
//      meets is a wiped volume or a restored disk.
//   4. Restore exactly as the runbook says.
//   5. Assert the appliance comes back with the SAME state, and — the
//      assertion that matters — that a further sync pass creates NOTHING.
//
// Step 5's second half is the whole point. A restore that reproduces rows but
// leaves the ledger unusable would pass a row count and still cost the
// operator a full re-copy on the next pass. "The ledger works again" is the
// claim; "the rows came back" is only its evidence.
//
// WHY IT RUNS BOTH BACKENDS. The two procedures share nothing: Postgres dumps
// SQL through a server, PGlite tars a directory with the app stopped, because
// there is no server to dump through. e2e.yml now runs a nightly per backend,
// so each documented procedure gets drilled by the schedule that uses it.
//
// TWO DOCUMENTED-PROCEDURE BUGS THIS FILE FOUND BEFORE IT EVER RAN, both fixed
// in docs/selfhost-quickstart.md in the same commit:
//
//   - `pg_dump` omits ROLES (they are cluster-global). Our schema GRANTs to
//     `app_user` and every RLS policy names it, so restoring a dump into a
//     genuinely fresh volume died on the first GRANT. The baseline migration
//     creates that role; a bare-volume restore has to as well, BEFORE the
//     dump. The quickstart now says so, and step 4 below does it.
//   - the PGlite tar said `-C /data state/pglite`, but `appdata` mounts at
//     `/data/state`, so the volume's root already IS `state` — the path
//     inside is `pglite`. The documented command could not have worked.
//
// PREREQUISITES: the same running stack as the other selfhost gates, already
// synced (this drill asserts on real ledger content, and an empty ledger would
// let a broken restore pass vacuously — see the guard in the first test).
//
// ORDERING: after the apply-deletion gates, before Finish. The ledger is at
// its richest there (synced items + applied deletions + resolved failures),
// and the mapping is still active, which is what makes the "a further pass
// creates nothing" assertion available. A drill placed after Finish could
// only count rows.

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMPOSE_FILES = [
  'deploy/selfhost/compose.yml',
  ...(process.env.SELFHOST_COMPOSE_OVERRIDE ? [process.env.SELFHOST_COMPOSE_OVERRIDE] : []),
]
  .map((f) => `-f ${f}`)
  .join(' ');

/** PGlite has no `postgres` service, so the procedure branches on this. */
const IS_PGLITE = (process.env.SELFHOST_COMPOSE_OVERRIDE ?? '').includes('pglite');

const SELFHOST_PORT = process.env.SELFHOST_PORT || '8081';
const SELFHOST_BIND = process.env.SELFHOST_BIND || '127.0.0.1';
const BASE_URL = `http://${SELFHOST_BIND}:${SELFHOST_PORT}`;

const PG_USER = process.env.POSTGRES_USER || 'openmigrate';
const PG_DB = process.env.POSTGRES_DB || 'openmigrate';

/**
 * Compose's project name (`name:` in compose.yml) prefixes volume names. The
 * drill removes a volume by its REAL name, so getting this wrong would either
 * fail loudly (good) or remove somebody else's volume (not good) — hence the
 * existence check before the destroy step.
 */
const PROJECT = 'open-migrate-selfhost';
const PG_VOLUME = `${PROJECT}_pgdata`;
const APP_VOLUME = `${PROJECT}_appdata`;

const BACKUP_DIR = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'openmig-drill-'));
const SQL_DUMP = join(BACKUP_DIR, 'openmigrate.sql');
const TAR_DUMP = 'openmigrate-pglite.tar.gz'; // inside the mounted /backup

function sh(command: string, opts: { quiet?: boolean } = {}): string {
  return execSync(command, {
    encoding: 'utf8',
    stdio: opts.quiet ? 'pipe' : ['pipe', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

interface DomainStatus {
  domain: string;
  itemsSynced?: number;
}
interface StatusPayload {
  status: string;
  mappings: Array<{ mappingId: string; domains: DomainStatus[] }>;
}

function getStatus(): StatusPayload {
  return JSON.parse(sh(`curl -sf ${BASE_URL}/status`, { quiet: true })) as StatusPayload;
}

/** Per-domain itemsSynced for every mapping, as a stable comparable shape. */
function syncedByDomain(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of getStatus().mappings) {
    for (const d of m.domains) {
      out[`${m.mappingId}:${d.domain}`] = d.itemsSynced ?? 0;
    }
  }
  return out;
}

async function waitForHealth(maxAttempts = 60, delayMs = 2000): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      if (sh(`curl -sf ${BASE_URL}/healthz`, { quiet: true }).includes('ok')) return;
    } catch {
      // not up yet
    }
    await setTimeout(delayMs);
  }
  // Rule 9: say what was actually observed, not just that we gave up.
  let logs = '(no logs)';
  try {
    logs = sh(`docker compose ${COMPOSE_FILES} logs app --no-color --tail 80`, { quiet: true });
  } catch {
    // best effort
  }
  throw new Error(`Appliance never became healthy after restore at ${BASE_URL}.\n${logs}`);
}

/** Direct ledger row count — Postgres path only (PGlite has no psql). */
function ledgerItemCount(): number {
  const out = sh(
    `docker compose ${COMPOSE_FILES} exec -T postgres ` +
      `psql -U ${PG_USER} -d ${PG_DB} -tAc "SELECT count(*) FROM item"`,
    { quiet: true },
  );
  return Number.parseInt(out.trim(), 10);
}

let before: Record<string, number>;
let beforeRows: number | undefined;

beforeAll(() => {
  before = syncedByDomain();
  if (!IS_PGLITE) beforeRows = ledgerItemCount();
});

describe('the backup/restore drill (§22.1)', () => {
  it('starts from a populated appliance — an empty ledger would pass vacuously', () => {
    const total = Object.values(before).reduce((a, b) => a + b, 0);
    expect(
      total,
      'nothing has synced, so a restore that produced an empty database would "pass" — ' +
        'run this after the sync gates',
    ).toBeGreaterThan(0);
    if (!IS_PGLITE) expect(beforeRows).toBeGreaterThan(0);
  });

  it(
    'backs up, destroys the database, restores per the runbook, and the appliance comes back whole',
    { timeout: 600_000 },
    async () => {
      // ---- 1. BACK UP, exactly as docs/selfhost-quickstart.md says --------
      if (IS_PGLITE) {
        // No server to dump through: stop the app so the directory is not
        // being written mid-copy, then tar it out of the state volume.
        sh(`docker compose ${COMPOSE_FILES} stop app`);
        sh(
          `docker run --rm -v ${APP_VOLUME}:/data -v ${BACKUP_DIR}:/backup alpine ` +
            `tar czf /backup/${TAR_DUMP} -C /data pglite`,
        );
      } else {
        sh(
          `docker compose ${COMPOSE_FILES} exec -T postgres ` +
            `pg_dump -U ${PG_USER} -d ${PG_DB} > ${SQL_DUMP}`,
        );
        // A dump that exists but is empty is the classic silent backup
        // failure: it "succeeds" every night until the day it is needed.
        const size = Number(sh(`stat -c %s ${SQL_DUMP}`, { quiet: true }).trim());
        expect(size, 'the dump is suspiciously small — is pg_dump actually reaching the DB?').
          toBeGreaterThan(10_000);
        sh(`docker compose ${COMPOSE_FILES} stop app`);
      }

      // ---- 2. DESTROY -----------------------------------------------------
      // The real shape of the disaster: the volume is gone, not truncated.
      if (IS_PGLITE) {
        sh(
          `docker run --rm -v ${APP_VOLUME}:/data alpine sh -c 'rm -rf /data/pglite'`,
        );
        // Prove the destruction actually happened, so a no-op `rm` cannot let
        // the rest of this test "restore" a database that never left.
        const listing = sh(
          `docker run --rm -v ${APP_VOLUME}:/data alpine sh -c 'ls /data'`,
          { quiet: true },
        );
        expect(listing).not.toContain('pglite');
      } else {
        sh(`docker compose ${COMPOSE_FILES} rm -sf postgres`);
        const volumes = sh(`docker volume ls -q`, { quiet: true });
        expect(volumes, `expected volume ${PG_VOLUME} to exist before removing it`).toContain(
          PG_VOLUME,
        );
        sh(`docker volume rm ${PG_VOLUME}`);
        expect(sh(`docker volume ls -q`, { quiet: true })).not.toContain(PG_VOLUME);
      }

      // ---- 3. RESTORE, exactly as the runbook says ------------------------
      if (IS_PGLITE) {
        sh(
          `docker run --rm -v ${APP_VOLUME}:/data -v ${BACKUP_DIR}:/backup alpine ` +
            `tar xzf /backup/${TAR_DUMP} -C /data`,
        );
        sh(`docker compose ${COMPOSE_FILES} start app`);
      } else {
        // Postgres alone first. The app must NOT be running: it would migrate
        // the empty database out from under the restore and collide with it.
        sh(`docker compose ${COMPOSE_FILES} up -d postgres`);
        for (let i = 0; i < 60; i++) {
          try {
            sh(
              `docker compose ${COMPOSE_FILES} exec -T postgres pg_isready -U ${PG_USER} -d ${PG_DB}`,
              { quiet: true },
            );
            break;
          } catch {
            await setTimeout(2000);
          }
        }

        // The role pg_dump left behind. Cluster-global, so it is NOT in the
        // dump, while every GRANT and every RLS policy in the dump names it.
        // Same definition the baseline migration uses.
        sh(
          `docker compose ${COMPOSE_FILES} exec -T postgres ` +
            `psql -U ${PG_USER} -d ${PG_DB} -v ON_ERROR_STOP=1 -c ` +
            `"DO \\$\\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') ` +
            `THEN CREATE ROLE app_user LOGIN PASSWORD 'app_password'; END IF; END \\$\\$;"`,
        );

        // ON_ERROR_STOP=1: a restore that reports success while half its
        // statements failed is the exact failure this drill exists to catch.
        sh(
          `docker compose ${COMPOSE_FILES} exec -T postgres ` +
            `psql -U ${PG_USER} -d ${PG_DB} -v ON_ERROR_STOP=1 < ${SQL_DUMP}`,
        );

        sh(`docker compose ${COMPOSE_FILES} up -d app`);
      }

      // ---- 4. THE APPLIANCE COMES BACK ------------------------------------
      await waitForHealth();

      // Same rows. On Postgres this is a direct count, which cannot be
      // satisfied by a status endpoint that merely remembers something.
      if (!IS_PGLITE) {
        expect(ledgerItemCount()).toBe(beforeRows);
      }

      const after = syncedByDomain();
      expect(after).toEqual(before);
    },
  );

  it(
    'and the restored ledger WORKS: a further pass creates nothing',
    { timeout: 600_000 },
    async () => {
      // The assertion the row counts exist to support. A ledger that came back
      // as data but not as working state would re-copy the entire mailbox on
      // the next pass — every duplicate the ledger exists to prevent, on the
      // first night after a restore.
      const mappingId = getStatus().mappings[0]?.mappingId;
      expect(mappingId, 'no mapping to run a pass against').toBeTruthy();

      const beforePass = syncedByDomain();
      sh(`curl -sf --max-time 600 -X POST ${BASE_URL}/mappings/${mappingId}/run`, {
        quiet: true,
      });
      const afterPass = syncedByDomain();

      // Not "roughly the same": a pass over an intact ledger creates exactly
      // zero. Any growth here is a duplicate that a real operator would be
      // left to find themselves.
      expect(afterPass).toEqual(beforePass);
    },
  );
});
