// Copyright 2026 OpenHands Agent (Apache-2.0); assertions corrected 2026-07-20;
// generalized to multi-domain 2026-07-22 (issue #114 follow-up).
//
// E2E test for restart-resume idempotency (workplan 0010 T5, extended to
// calendar/contacts by issue #114's follow-up, and to WebDAV files 2026-07-27 —
// all four domains are now proven by this gate).
//
// Black-box test against an ALREADY-RUNNING self-host compose stack: for each
// ENABLED domain in the mapping, run a pass, restart the app, run again, and assert
// the ledger item count did NOT grow (zero duplicates) — the §5 "intermittently-on
// host resumes cleanly" property. Originally proved email/JMAP only; then calendar
// (CalDAV) and contacts (CardDAV) too, against a real cross-account Nextcloud pair
// (e2e-source -> e2e-target); now also files (WebDAV) against the same pair, closing
// the gap #114 explicitly left out of scope ("Restart-resume for the DAV domains...
// mail-scoped for now") for good.
//
// PREREQUISITES (this test does NOT bring the stack up, seed the source, or activate):
//   1. Seed the sources with KNOWN, NON-ZERO sets of items — the assertion is only
//      meaningful when the first pass actually creates items:
//        - Stalwart (mail): test/e2e/seed-imap-source.mjs
//        - Nextcloud e2e-source account (calendar + contacts + files): test/e2e/seed-dav-source.mjs
//   2. Place a mapping in the (git-ignored) config dir and bring the stack up:
//        cp test/e2e/fixtures/selfhost-restart-resume.mapping.json \
//           deploy/selfhost/config/mapping.json
//        docker compose -f deploy/selfhost/compose.yml up -d
//   3. GREEN-LIGHT the mapping. Since workplan 0013 T7 the appliance loads every
//      mapping PAUSED and only schedules it after an explicit start, so it never
//      syncs on its own:
//        curl -X POST http://127.0.0.1:${SELFHOST_PORT}/mappings/<mappingId>/start
//   4. Run this test (manual e2e; NOT part of automated CI). The e2e.yml workflow
//      does steps 1–3 for you before invoking this.
//
// Idempotency signal: `/status` exposes `itemsSynced` per domain (DERIVED from the
// item ledger). After the first pass it is N; after the restart + second pass it
// must still be N — a second pass that created duplicates would grow it.

import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const COMPOSE_FILE = 'deploy/selfhost/compose.yml';
const SELFHOST_PORT = process.env.SELFHOST_PORT || '8081';
const SELFHOST_BIND = process.env.SELFHOST_BIND || '127.0.0.1';

const HEALTH_URL = `http://${SELFHOST_BIND}:${SELFHOST_PORT}/healthz`;
const STATUS_URL = `http://${SELFHOST_BIND}:${SELFHOST_PORT}/status`;

// Domains this gate proves restart-resume for — all four as of 2026-07-27. Comma-
// separated override via E2E_DOMAINS lets a partial dispatch (e.g. while only
// Stalwart is up) still exercise a subset.
const DOMAINS: string[] = (process.env.E2E_DOMAINS || 'email,calendar,contact,file')
  .split(',')
  .map((d) => d.trim())
  .filter((d) => d.length > 0);

interface DomainStatus {
  domain: string;
  state: string;
  itemsSynced: number;
  itemsFailed: number;
  lastSyncedAt?: string;
}
interface StatusPayload {
  status: 'ok';
  mappings: Array<{ mappingId: string; domains: DomainStatus[] }>;
}

async function waitForHealth(maxAttempts = 30, delayMs = 2000): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = execSync(`curl -sf ${HEALTH_URL}`, { encoding: 'utf8', stdio: 'pipe' });
      if (result.includes('ok')) return;
    } catch {
      // not ready yet
    }
    await setTimeout(delayMs);
  }
  throw new Error(`App did not become healthy at ${HEALTH_URL}`);
}

function getStatus(): StatusPayload {
  return JSON.parse(execSync(`curl -sf ${STATUS_URL}`, { encoding: 'utf8' })) as StatusPayload;
}

/** The first mapping's status for a given domain, or null. */
/**
 * How long to wait for a domain pass to complete.
 *
 * Was a fixed 60 x 2s = 120s. That is nowhere near enough once the seeded
 * corpus grows: at SEED_COUNT=110 the file domain has ~394 items and tens of
 * megabytes to move, and had transferred 35 MB and was still going when the
 * gate gave up on it. Scaled off the seeded count so a bigger run gets a bigger
 * budget, and overridable outright.
 */
const WAIT_MS = Number(
  process.env.E2E_WAIT_MS ?? Math.max(300000, Number(process.env.SEED_COUNT ?? 5) * 6000),
);

/**
 * How many items the sources were seeded with before the stack came up.
 *
 * Mirrors the seed scripts' own default, and is the OFFSET the drip numbers
 * from: their natural keys are stable, so `SEED_OFFSET=SEEDED_COUNT` is what
 * makes the dripped fixtures genuinely new rather than a no-op re-PUT.
 */
const SEEDED_COUNT = Number(process.env.SEED_COUNT ?? 5);

/**
 * How many fixtures to drip in mid-run.
 *
 * Small on purpose. The property under test is "new items keep arriving", which
 * one item would prove; a handful guards against an off-by-one that a single
 * item would satisfy by accident, without adding minutes to a gate that already
 * waits on four domains.
 */
const DRIP_COUNT = Number(process.env.E2E_DRIP_COUNT ?? 3);

/**
 * Items a drip of DRIP_COUNT adds to a given domain's ledger.
 *
 * Not uniform: `seed-dav-source.mjs` writes THREE files per index — a text, a
 * binary and a non-ASCII one — because the file domain needs fixtures that do
 * not survive a UTF-8 round trip. Calendar, contacts and mail write one each.
 */
function expectedDrip(domain: string): number {
  return domain === 'file' ? DRIP_COUNT * 3 : DRIP_COUNT;
}

/**
 * Poll until `predicate` holds, and SAY whether it ever did.
 *
 * The previous loops returned only the last status read, and the caller asserted
 * `expect(status).toBeTruthy()` — which a status object satisfies whatever state
 * it is in. So a timeout was indistinguishable from success: in the run that
 * exposed this, the file domain never reached `completed` even once (`/status`
 * showed `in_progress` with no `lastSyncedAt` at the end), yet the first-pass
 * test PASSED and recorded a mid-flight count as if it were a finished pass.
 * The failure then surfaced as a bogus "duplicates" mismatch two tests later.
 */
async function waitForDomain(
  domain: string,
  predicate: (s: DomainStatus) => boolean,
): Promise<{ met: boolean; status: DomainStatus | null }> {
  const deadline = Date.now() + WAIT_MS;
  let status: DomainStatus | null = null;
  while (Date.now() < deadline) {
    status = getDomainStatus(domain);
    if (status && predicate(status)) return { met: true, status };
    await setTimeout(2000);
  }
  return { met: false, status };
}

/** A timeout message that says what we were waiting for and what we last saw. */
function describeTimeout(domain: string, wanted: string, status: DomainStatus | null): string {
  if (!status) return `${domain}: no status at all after ${WAIT_MS}ms (waiting for ${wanted})`;
  return (
    `${domain}: timed out after ${WAIT_MS}ms waiting for ${wanted}. ` +
    `Last seen: state=${status.state}, itemsSynced=${status.itemsSynced}, ` +
    `itemsFailed=${status.itemsFailed}, lastSyncedAt=${status.lastSyncedAt ?? 'never'}. ` +
    `A domain still 'in_progress' with no lastSyncedAt has not finished a single pass — ` +
    `raise E2E_WAIT_MS rather than reading the item count as a result.`
  );
}

function getDomainStatus(domain: string): DomainStatus | null {
  const status = getStatus();
  const domains = status.mappings?.[0]?.domains;
  return domains?.find((d) => d.domain === domain) ?? null;
}

describe('Restart-Resume Idempotency Gate (T5)', () => {
  beforeAll(async () => {
    await waitForHealth();
  }, 60000);

  // NOTE: this test does NOT tear the stack down (it never brought it up — see the
  // PREREQUISITES header). Whoever owns the stack owns teardown: the e2e.yml workflow's
  // Cleanup step, or a by-hand runner. A previous `afterAll` here ran `docker compose down`,
  // which removed the app container before failure diagnostics (its logs) could be captured.

  // Cross-test state per domain (a `this`-based approach does NOT work — the `it`
  // callbacks are arrow functions, so `this` is not the test context).
  const firstPassSynced: Record<string, number> = {};
  const firstPassLastSyncedAt: Record<string, string | undefined> = {};

  for (const domain of DOMAINS) {
    it(`${domain}: first pass syncs the seeded items`, async () => {
      // Wait for a completed pass that actually synced something.
      const { met, status } = await waitForDomain(
        domain,
        (s) => s.state === 'completed' && s.itemsSynced > 0,
      );

      expect(met, describeTimeout(domain, 'a completed first pass with items', status)).toBe(true);
      expect(status!.itemsSynced).toBeGreaterThan(0);

      firstPassSynced[domain] = status!.itemsSynced;
      firstPassLastSyncedAt[domain] = status!.lastSyncedAt;
      console.log(`[e2e] ${domain} first pass: itemsSynced=${status!.itemsSynced}`);
    }, WAIT_MS + 60000);
  }

  /**
   * Every domain must actually run items in parallel.
   *
   * The e2e fixture pinned `concurrency: 1` on the three DAV domains, so they
   * migrated strictly one item at a time while mail ran four. That survived
   * FOUR consecutive green runs and three wrong diagnoses from me — count
   * parity, checksums and byte totals were all perfect, because serial is
   * slow, not incorrect. Nothing in the gate could see it.
   *
   * The phase-timing report exposes `overlap` = (sum of per-phase wall time) /
   * (domain wall time). At `concurrency: 4` a healthy pass reads ~4; the
   * regression read 1.0. So assert on it, and the same mistake cannot cost
   * four runs again.
   *
   * Threshold 2.5, not 4: leaves room for scheduling noise and for a domain
   * whose last few items drain below full width, while still being nowhere
   * near the 1.0 that means "serial".
   */
  it('every domain actually runs items concurrently', () => {
    const logs = execSync(`docker compose -f ${COMPOSE_FILE} logs app --no-color --tail 4000`, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    // Select, per domain, the pass that actually MIGRATED — the one with the
    // most time spent writing to the target.
    //
    // The log holds several passes per domain by the time this runs: trivial
    // zero-item ones from before the source was ready, and steady-state ones
    // where every item hits the ledger fast-path and no writing happens at all.
    // Both are real and both report a meaningless overlap, because there is
    // nothing to overlap. Selecting on item count does not separate them — a
    // skip-only pass scans exactly as many items as the pass that copied them.
    const seen = new Map<string, { items: number; overlap: number; writeSecs: number }>();
    for (const line of logs.split('\n')) {
      if (!line.includes('[timing]')) continue;
      const head = /\[timing\] (\w+): (\d+) items in/.exec(line);
      const write = /target-write ([\d.]+)s/.exec(line);
      const over = /overlap ([\d.]+)x/.exec(line);
      if (!head || !write || !over) continue;
      const domain = head[1]!;
      const parsed = {
        items: Number(head[2]),
        writeSecs: Number(write[1]),
        overlap: Number(over[1]),
      };
      const prev = seen.get(domain);
      if (!prev || parsed.writeSecs > prev.writeSecs) seen.set(domain, parsed);
    }

    // A missing report is a FAILED assertion, never a skipped one. Every
    // false-green in this project's history came from a check that quietly
    // measured nothing — if LOG_LEVEL=debug ever stops reaching the appliance,
    // this test must say so rather than pass vacuously.
    expect(
      seen.size,
      'no [timing] lines in the appliance log — is LOG_LEVEL=debug still in deploy/selfhost/.env?',
    ).toBeGreaterThan(0);

    for (const domain of DOMAINS) {
      const report = seen.get(domain);
      expect(report, `no [timing] report for the ${domain} domain`).toBeDefined();
      // Only meaningful once there are more items than the pool is wide.
      if (report!.items < 20) continue;
      // And only meaningful for a pass that actually wrote something. If the
      // best pass we found did no writing, we never observed a migrating pass
      // — which is a broken measurement, not a passing one.
      expect(
        report!.writeSecs,
        `no migrating pass observed for ${domain}: the best [timing] line reports ` +
          `${report!.writeSecs}s of target writes, so overlap says nothing about concurrency`,
      ).toBeGreaterThan(1);
      expect(
        report!.overlap,
        `${domain} ran with overlap ${report!.overlap}x over ${report!.items} items — ` +
          `at concurrency 4 that is effectively SERIAL. Check for a "concurrency" ` +
          `override in the mapping fixture, which is exactly what caused this before.`,
      ).toBeGreaterThan(2.5);
    }
  }, 60000);

  /**
   * The product is a SHADOW SYNC, not a one-shot copy.
   *
   * The intent is that a customer keeps using the old system for weeks while
   * the new one is kept current, and cuts over when THEY choose. That means
   * items created on the source after the initial copy must keep arriving.
   *
   * Nothing tested that. This gate asserts `itemsSynced` did not GROW after a
   * restart — the opposite property — so it would pass unchanged if the product
   * stopped picking up new items entirely: a `listSince` that always returned
   * nothing, or a cursor stuck at "done", satisfies "no duplicates" perfectly.
   * Mail had one delta test at the integration level; calendar, contacts and
   * files had none at any level.
   *
   * So: drip genuinely new items into every source mid-flight and assert they
   * arrive. `SEED_OFFSET` is what makes them new — the seed scripts use stable
   * natural keys, so re-running them without it adds nothing at all (correctly,
   * and uselessly for this).
   *
   * Runs BEFORE the restart test on purpose: the restart assertions capture
   * their own baseline, so the counts they compare are the post-drip ones.
   */
  it('keeps picking up items created on the source after the initial copy', async () => {
    for (const domain of DOMAINS) {
      expect(
        firstPassSynced[domain],
        `${domain} first-pass test must run first and observe items`,
      ).toBeGreaterThan(0);
    }

    const before: Record<string, number> = { ...firstPassSynced };
    const beforeSyncedAt: Record<string, string | undefined> = { ...firstPassLastSyncedAt };

    execSync(`node test/e2e/seed-imap-source.mjs`, {
      stdio: 'inherit',
      env: { ...process.env, SEED_COUNT: String(DRIP_COUNT), SEED_OFFSET: String(SEEDED_COUNT) },
    });
    execSync(`node test/e2e/seed-dav-source.mjs`, {
      stdio: 'inherit',
      env: { ...process.env, SEED_COUNT: String(DRIP_COUNT), SEED_OFFSET: String(SEEDED_COUNT) },
    });

    for (const domain of DOMAINS) {
      // Wait for a pass that COMPLETED after the drip carrying the WHOLE drip.
      //
      // Waiting on `lastSyncedAt` alone would settle on the first pass to finish
      // after seeding, which may have started before the new items landed and
      // legitimately found nothing. Waiting on "grew at all" is not enough
      // either: the scheduler fires every minute, so a pass can be mid-flight
      // while the seeds are still being PUT and finish having seen two of three
      // — real, correct, and not yet the thing being asserted. So the predicate
      // waits for the full expected total and the assertion below pins it to
      // EXACTLY that, which is what catches an overshoot (duplicates).
      const want = before[domain]! + expectedDrip(domain);
      const { met, status } = await waitForDomain(
        domain,
        (s) =>
          s.state === 'completed' &&
          !!s.lastSyncedAt &&
          s.lastSyncedAt !== beforeSyncedAt[domain] &&
          s.itemsSynced >= want,
      );

      expect(
        met,
        describeTimeout(
          domain,
          `a completed pass having picked up the ${expectedDrip(domain)} newly seeded items ` +
            `(was ${before[domain]})`,
          status,
        ),
      ).toBe(true);

      // Exactly the new items — not a re-copy of the whole corpus, and not a
      // partial pick-up. Both would be silent today.
      expect(
        status!.itemsSynced,
        `${domain}: expected the drip to add exactly ${expectedDrip(domain)} items`,
      ).toBe(want);
      expect(status!.itemsFailed, `${domain}: drip pass had failures`).toBe(0);

      // Later tests compare against the corpus as it now stands.
      firstPassSynced[domain] = status!.itemsSynced;
      firstPassLastSyncedAt[domain] = status!.lastSyncedAt;
      console.log(
        `[e2e] ${domain} drip: ${before[domain]} -> ${status!.itemsSynced} ` +
          `(+${expectedDrip(domain)})`,
      );
    }
  }, WAIT_MS + 120000);

  it('restarts the app and every domain resumes with zero duplicates', async () => {
    for (const domain of DOMAINS) {
      expect(firstPassSynced[domain], `${domain} first-pass test must run first and observe items`).toBeGreaterThan(0);
    }

    execSync(`docker compose -f ${COMPOSE_FILE} restart app`, { stdio: 'inherit' });
    await setTimeout(5000);
    await waitForHealth();

    for (const domain of DOMAINS) {
      // Wait for a NEW pass after the restart (lastSyncedAt advances past the first).
      const { met, status } = await waitForDomain(
        domain,
        (s) =>
          s.state === 'completed' &&
          !!s.lastSyncedAt &&
          s.lastSyncedAt !== firstPassLastSyncedAt[domain],
      );

      expect(met, describeTimeout(domain, 'a NEW completed pass after the restart', status)).toBe(
        true,
      );

      // The property: the ledger item count did NOT grow — the second pass created
      // zero duplicates (it re-read the source but every item was already present).
      console.log(`[e2e] ${domain} second pass: itemsSynced=${status!.itemsSynced} (first was ${firstPassSynced[domain]})`);
      expect(status!.itemsSynced).toBe(firstPassSynced[domain]);
      expect(status!.itemsFailed).toBe(0);
    }
  }, WAIT_MS * 2 + 120000);
});
