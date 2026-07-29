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
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

/**
 * The file domain's natural-key hash, duplicated from
 * `packages/shared/src/hash.ts` rather than imported.
 *
 * This file lives at the REPO ROOT, not inside a workspace package, and the
 * root has no dependency on `@openmig/shared` — so pnpm creates no
 * `node_modules/@openmig` link for it and the import dies on the runner with
 * `ERR_MODULE_NOT_FOUND`. Every other test that imports the package sits
 * inside a package that declares it and resolves through that symlink; the
 * root-level `resolve.alias` in vitest.config.ts did not cover this case.
 *
 * Four lines of sha256 is the right price for keeping this suite a black box:
 * everything else here talks to the appliance over curl and imports nothing
 * but vitest and node builtins, which is what makes it a test OF the deployed
 * artifact rather than of the source tree.
 *
 * If the real definition ever changes, this fails loudly rather than quietly —
 * the computed hash simply will not be in the failure queue, and the assertion
 * says exactly that.
 */
function fileNaturalKeyHash(path: string): string {
  return createHash('sha256').update(`file:${path}`).digest('hex');
}

const COMPOSE_FILE = 'deploy/selfhost/compose.yml';
const SELFHOST_PORT = process.env.SELFHOST_PORT || '8081';
const SELFHOST_BIND = process.env.SELFHOST_BIND || '127.0.0.1';

const BASE_URL = `http://${SELFHOST_BIND}:${SELFHOST_PORT}`;
const HEALTH_URL = `${BASE_URL}/healthz`;
const STATUS_URL = `${BASE_URL}/status`;
const FAILURES_URL = `${BASE_URL}/failures`;
const MOVES_URL = `${BASE_URL}/moves`;

/**
 * The fixture the workflow plants to prove one bad item does not stop a domain:
 * a FILE on the source at a path where the target already holds a DIRECTORY.
 * The WebDAV writer refuses that write outright — one option destroys a
 * collection the customer already had, the other adopts it and records an item
 * that was never copied — so this item fails every pass, for a reason no retry
 * can fix. (Nextcloud itself is happy to do it, which is how the first version
 * of this fixture passed straight through.)
 *
 * Its natural key is its root-relative path, so the hash is computable here —
 * which lets the assertions name the exact item rather than accepting whatever
 * happens to have failed.
 */
const POISON_PATH = 'openmig-e2e-poison.txt';
const POISON_HASH = fileNaturalKeyHash(POISON_PATH);
/** The domain the fixture lands in, and how many failures it should produce. */
const POISON_DOMAIN = 'file';
const EXPECTED_FAILURES = 1;

/**
 * The calendar natural key, inlined for the same reason as the file one above.
 *
 * `cal:<uid lowercased>` — iCalendar UIDs are case-insensitive per RFC 5545, and
 * the ledger normalises before hashing.
 */
function calendarNaturalKeyHash(uid: string): string {
  return createHash('sha256').update(`cal:${uid.toLowerCase()}`).digest('hex');
}

/**
 * The event the gate relocates on the SOURCE mid-run, and the calendar it goes to.
 *
 * A calendar EVENT rather than a file, and the reason matters. A moved file is
 * keyed by its path, so the pass copies it again under the new path and — nothing
 * ever being deleted from a target — the target ends up legitimately holding
 * both. The §20 verification gate that runs after this one asserts
 * `targetCount === sourceCount` and would rightly fail. An event keeps its UID
 * across a move, so the pass writes nothing at all: the divergence is reported
 * and the corpus the next gate verifies is exactly as it was.
 *
 * The file half of the same feature is covered by unit tests, which can assert
 * the duplicate honestly without a downstream gate to answer to.
 */
const MOVED_UID = 'dav-seed-event-1@dev.local';
const MOVED_DEST_CALENDAR = 'openmig-e2e-moved';
const MOVED_HASH = calendarNaturalKeyHash(MOVED_UID);

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

interface FailureEntry {
  domain: string;
  naturalKeyHash: string;
  attempts: number;
  lastError: string;
  needsDecision: boolean;
}

/** Every unresolved failure for the first mapping, both buckets flattened. */
function getFailures(): { mappingId: string; entries: FailureEntry[] } {
  const body = JSON.parse(execSync(`curl -sf ${FAILURES_URL}`, { encoding: 'utf8' })) as Record<
    string,
    { needsDecision: FailureEntry[]; retrying: FailureEntry[] }
  >;
  const mappingId = Object.keys(body)[0]!;
  const q = body[mappingId]!;
  return { mappingId, entries: [...q.needsDecision, ...q.retrying] };
}

/**
 * The move queue for the first mapping.
 *
 * Separate from `/failures` because it answers a different question: those
 * items could not be copied, these copied fine and the owner has since moved
 * them on the source.
 */
function getMoves(): {
  mappingId: string;
  open: Array<{ naturalKeyHash: string; from: string; to: string }>;
  acknowledged: Array<{ naturalKeyHash: string; from: string; to: string }>;
} {
  const body = JSON.parse(execSync(`curl -sf ${MOVES_URL}`, { encoding: 'utf8' })) as Record<
    string,
    {
      open: Array<{ naturalKeyHash: string; from: string; to: string }>;
      acknowledged: Array<{ naturalKeyHash: string; from: string; to: string }>;
    }
  >;
  const mappingId = Object.keys(body)[0]!;
  const q = body[mappingId]!;
  return { mappingId, open: q.open, acknowledged: q.acknowledged };
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
      // The floor exists to exclude a pass that WROTE NOTHING — a steady-state
      // pass where every item hits the ledger fast-path reports 0.0s, and its
      // overlap is meaningless. It is not a demand that the target be slow.
      //
      // It was 1s, sized for the 200-500 item corpora these runs used to have.
      // At seed_count 100 the mail domain's best pass wrote for 0.5s (JMAP is
      // fast and the corpus was small) and the gate failed for a reason that
      // had nothing to do with concurrency. 0.1s still separates "did real
      // work" from "did nothing" by an order of magnitude.
      expect(
        report!.writeSecs,
        `no migrating pass observed for ${domain}: the best [timing] line reports ` +
          `${report!.writeSecs}s of target writes, so overlap says nothing about ` +
          `concurrency. If this is a very small dispatch, raise seed_count — the ` +
          `overlap reading needs a corpus bigger than the concurrency width to mean much.`,
      ).toBeGreaterThan(0.1);
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

    /**
     * Items already failing per domain, which a later pass may legitimately
     * retry and land — adding to `itemsSynced` without being part of the drip.
     *
     * A real run proved this is not hypothetical: one contact hit a Nextcloud
     * 500 (its SQLite backend really does answer "database is locked" under
     * concurrent writes) on the first pass and succeeded on the next, so the
     * domain gained FOUR where three were dripped. That is per-item isolation
     * working exactly as designed, and an exact-delta assertion calls it a bug.
     */
    const retryingBefore: Record<string, number> = {};
    for (const f of getFailures().entries) {
      retryingBefore[f.domain] = (retryingBefore[f.domain] ?? 0) + 1;
    }

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

      // The drip arrived, and the corpus was not re-copied.
      //
      // A window rather than an exact number, because a previously-failed item
      // may legitimately succeed on this same pass and count too — see
      // `retryingBefore`. The window is still tight: the thing this guards
      // against is a re-copy of the WHOLE corpus, which is hundreds of items,
      // not one or two.
      const slack = retryingBefore[domain] ?? 0;
      expect(
        status!.itemsSynced,
        `${domain}: expected the drip to add ${expectedDrip(domain)} items ` +
          `(plus at most ${slack} already-failing item(s) that may have recovered)`,
      ).toBeGreaterThanOrEqual(want);
      expect(
        status!.itemsSynced,
        `${domain}: more items appeared than the drip plus the ${slack} pending ` +
          `failure(s) can account for — did the whole corpus get re-copied?`,
      ).toBeLessThanOrEqual(want + slack);

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
      // No GROWTH is the property — a second pass that created duplicates would
      // inflate this. `toBeLessThanOrEqual` rather than `toBe` for the same
      // reason the drip test uses a window: an item still in the failure queue
      // can legitimately succeed on this pass. Duplicates would show as a
      // number far above the baseline, not one item above it.
      expect(status!.itemsSynced).toBeGreaterThanOrEqual(firstPassSynced[domain]!);
      expect(
        status!.itemsSynced,
        `${domain}: itemsSynced grew well past the first pass — that is duplicates, ` +
          `not a recovered failure`,
      ).toBeLessThanOrEqual(firstPassSynced[domain]! + EXPECTED_FAILURES + 5);
      // Exactly the failures the workflow PLANTED, and no others. Asserting a
      // flat zero here would now be asserting that the poison fixture had not
      // been seeded — the opposite of what this run is meant to prove.
      expect(
        status!.itemsFailed,
        `${domain}: unexpected failures beyond the planted fixture`,
      ).toBe(domain === POISON_DOMAIN ? EXPECTED_FAILURES : 0);
    }
  }, WAIT_MS * 2 + 120000);

  /**
   * One item that cannot migrate must not stop its domain — and the owner must
   * be able to do something about it.
   *
   * This used to be impossible to observe here, because it did not happen: the
   * sync loop rethrew on any item error and `mapWithConcurrency` is fail-fast,
   * so a single unreadable item aborted the folder and therefore the whole
   * pass, with the cursor unpersisted. The next pass redid the work and stopped
   * in the same place. A corrupt file could hold a migration at zero
   * indefinitely.
   *
   * The workflow plants exactly one such item (see "Seed an item that cannot
   * migrate"): a file on the source at a path where the target already holds a
   * directory. No retry can fix that, which is the point — it is the shape of
   * failure that has to be survivable rather than merely retried.
   *
   * Runs LAST on purpose. It ends by ACCEPTING the item, which is what lets the
   * §20 verification gate in the next workflow step come back clean: an
   * accepted item is knowingly excluded rather than missing. That ordering is
   * the whole feature in one line — a migration that would otherwise be blocked
   * forever by one file becomes a cutover the owner consciously approved.
   */
  it('isolates an item that cannot migrate, and lets the owner resolve it', async () => {
    // 1. INSIGHT. The queue names the item, how often it has been tried, and
    //    what the server actually said.
    const { mappingId, entries } = getFailures();
    console.log(
      `[e2e] failure queue: ${entries
        .map((e) => `${e.domain}/${e.naturalKeyHash.slice(0, 12)} x${e.attempts} ` +
          `(${e.needsDecision ? 'needs decision' : 'retrying'}): ${e.lastError.slice(0, 120)}`)
        .join(' | ') || '(empty)'}`,
    );

    // Exactly the planted fixture — named by its own natural key, not "whatever
    // happened to fail". An empty queue here means the fixture was never seeded,
    // which would make everything below vacuous.
    expect(
      entries.map((e) => e.naturalKeyHash),
      'the planted unmigratable item is missing from the failure queue',
    ).toContain(POISON_HASH);
    expect(entries, 'no failures beyond the planted fixture were expected').toHaveLength(
      EXPECTED_FAILURES,
    );

    const poison = entries.find((e) => e.naturalKeyHash === POISON_HASH)!;
    expect(poison.domain).toBe(POISON_DOMAIN);
    expect(poison.attempts).toBeGreaterThanOrEqual(1);
    // Verbatim, not a placeholder — this is what the operator decides on.
    expect(poison.lastError.length, 'a failure with no reason is not actionable').toBeGreaterThan(0);

    // 2. ISOLATION. The rest of the domain migrated anyway. This is the
    //    assertion the old behaviour could never satisfy: before per-item
    //    isolation, one poisoned item meant itemsSynced stayed at 0.
    // Waited for, not sampled. `/status` is read at whatever instant this test
    // runs, and the scheduler fires every minute — a domain legitimately sits
    // in `in_progress` mid-pass, which says nothing about isolation. The
    // property is that the domain COMPLETES passes despite the bad item.
    const { met, status: fileStatus } = await waitForDomain(
      POISON_DOMAIN,
      (s) => s.state === 'completed',
    );
    expect(
      met,
      describeTimeout(POISON_DOMAIN, 'a completed pass alongside the unmigratable item', fileStatus),
    ).toBe(true);
    expect(
      fileStatus!.itemsSynced,
      'one unmigratable item must not stop the rest of its domain',
    ).toBeGreaterThan(SEEDED_COUNT);
    console.log(
      `[e2e] ${POISON_DOMAIN}: ${fileStatus.itemsSynced} items migrated alongside ` +
        `${fileStatus.itemsFailed} that could not`,
    );

    // 3. DECISION. The item cannot be fixed, so accept it and move on.
    const accept = `${BASE_URL}/mappings/${encodeURIComponent(mappingId)}/failures/${POISON_HASH}/accept`;
    const body = execSync(`curl -sf -X POST ${accept}`, { encoding: 'utf8' });
    console.log(`[e2e] accept -> ${body.trim()}`);
    expect(body).toContain('"action":"accept"');

    // The queue empties, and the domain stops reporting a failure — the item is
    // now knowingly left behind rather than outstanding.
    const after = getFailures();
    expect(after.entries.map((e) => e.naturalKeyHash)).not.toContain(POISON_HASH);
    expect(getDomainStatus(POISON_DOMAIN)!.itemsFailed).toBe(0);

    // And it stays decided: a second attempt on the same item has nothing to
    // act on, rather than silently reopening it.
    const repeat = execSync(
      `curl -s -o /dev/null -w '%{http_code}' -X POST ${accept}`,
      { encoding: 'utf8' },
    ).trim();
    expect(repeat, 'an already-resolved item must not be resolvable twice').toBe('404');
  }, 120000);

  /**
   * An item the owner MOVES on the source after it has been migrated.
   *
   * Everything above this adds items. This one relocates a file that is already
   * on the target, which §11.1 calls a topology change: the source is
   * authoritative for an item's content, the owner for where it lives. The
   * migration must notice, report it, and act on neither copy.
   *
   * Last on purpose. A move mints a new natural key, so the file domain gains an
   * item — harmless here, and quietly wrong for any earlier test that pins an
   * exact count.
   */
  it('reports an event the owner moved on the source, and lets them close it', async () => {
    const before = getDomainStatus('calendar');
    expect(before, 'the calendar domain must have run before this').not.toBeNull();
    const syncedBefore = before!.itemsSynced;

    execSync(`node test/e2e/move-dav-source.mjs`, {
      stdio: 'inherit',
      env: { ...process.env, MOVE_EVENT_UID: MOVED_UID, MOVE_DEST_CALENDAR: MOVED_DEST_CALENDAR },
    });

    // Polled rather than read once after a completed pass: the pass that
    // finishes first may have STARTED before the MOVE landed, in which case it
    // legitimately saw nothing. What is being waited for is the queue entry,
    // so wait for that.
    const deadline = Date.now() + WAIT_MS;
    let open: Array<{ naturalKeyHash: string; from: string; to: string }> = [];
    let mappingId = '';
    while (Date.now() < deadline) {
      const q = getMoves();
      mappingId = q.mappingId;
      open = q.open;
      if (open.some((m) => m.naturalKeyHash === MOVED_HASH)) break;
      await setTimeout(2000);
    }

    const entry = open.find((m) => m.naturalKeyHash === MOVED_HASH);
    expect(
      entry,
      `timed out after ${WAIT_MS}ms waiting for ${MOVED_UID} to be reported as moved. ` +
        `Open moves seen: ${JSON.stringify(open)}. A domain that reports none at all usually ` +
        `means the source collection was never recorded on the ledger row.`,
    ).toBeDefined();

    // Named, not merely counted. "12 items moved" that cannot say where is not
    // something an operator can act on.
    expect(entry!.from).toContain('personal');
    expect(entry!.to).toContain(MOVED_DEST_CALENDAR);
    console.log(`[e2e] move reported: ${MOVED_UID} ${entry!.from} -> ${entry!.to}`);

    // NOTHING WAS WRITTEN. Copying it into the new collection would duplicate
    // it; removing the old copy is the delete half of a move, which hard rule 2
    // forbids outright. So the target keeps exactly the events it had — which is
    // also what lets the §20 gate after this one still see count parity.
    const afterStatus = getDomainStatus('calendar')!;
    expect(
      afterStatus.itemsSynced,
      'a move must not add an item to the target',
    ).toBe(syncedBefore);

    // And it is not a failure: a move must not enter that queue or stop anything.
    expect(getFailures().entries.map((f) => f.naturalKeyHash)).not.toContain(MOVED_HASH);

    // DECISION. The owner is happy with the target as it stands.
    const keep = `${BASE_URL}/mappings/${encodeURIComponent(mappingId)}/moves/${MOVED_HASH}/keep`;
    const body = execSync(`curl -sf -X POST ${keep}`, { encoding: 'utf8' });
    console.log(`[e2e] keep -> ${body.trim()}`);
    expect(body).toContain('"action":"keep"');

    // Quiet, not forgotten: out of the open queue, still in the record. A queue
    // nobody can quiet is one people stop reading.
    const after = getMoves();
    expect(after.open.map((m) => m.naturalKeyHash)).not.toContain(MOVED_HASH);
    expect(after.acknowledged.map((m) => m.naturalKeyHash)).toContain(MOVED_HASH);

    // And it stays decided rather than silently reopening.
    const repeatKeep = execSync(`curl -s -o /dev/null -w '%{http_code}' -X POST ${keep}`, {
      encoding: 'utf8',
    }).trim();
    expect(repeatKeep, 'an already-acknowledged move must not be resolvable twice').toBe('404');
  }, WAIT_MS + 120000);
});
