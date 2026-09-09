// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * A verify that measured a race, and reported the race as a result.
 *
 * E2E (managed) #166 failed on `calendar: sourceCount=81, targetCount=0`. The
 * rule that produced that failure had landed nine days earlier and is right —
 * a target the reindexer could not see is not a verified target. What it read,
 * though, was not the reindexer. Bring-up seeds the demo DAV source; the
 * smoke's verify half ran thirty-eight seconds later; nothing in between asked
 * for a sync, and a mapping with no schedule of its own runs on the fifteen-
 * minute `DEFAULT_SYNC_SCHEDULE`. So the gate filled a source, waited half a
 * minute, and then held the target to account for not having caught up. Every
 * lane's pass in that run showed `itemsProcessed: 0-1`; `files` passed only
 * because its rows are `adopted`, which is content that predates the run.
 *
 * The apply half has had the remedy since run #20 and writes it out in full:
 * seed the source, then enqueue the sync directly, because the tick is far
 * longer than a gate should sit waiting. The verify half never got the second
 * clause. So it does now — enqueued through the product's own endpoint and
 * waited for, which is the difference between removing a wait and manufacturing
 * a fixture: nothing is seeded here, nothing is written to a target by the
 * script, and a pass that copies nothing still reports zero.
 *
 * ## What these tests hold, and why each one can rot
 *
 *  1. **The sync happens BEFORE the verify.** Asserted as two positions in one
 *     file, because that ordering is the entire fix. A sync moved below its
 *     verify would leave every other line here true and the gate measuring the
 *     same race.
 *  2. **Both mappings get one.** The mail lane races identically; it passes
 *     today only because the CI stack is never torn down and its target still
 *     holds what some earlier run copied. "Green because the box is old" is
 *     what this file exists to stop relying on.
 *  3. **It waits for the pass, rather than enqueuing and hoping.** An enqueue
 *     that returns 202 and is never waited for buys nothing at all: the verify
 *     would still run against whatever the target held at that instant.
 *  4. **It follows the pass it asked for, by the orchestrator's own id.** The
 *     ledger row carries `orchestrator_ref` (written by `run-delta-sync`), and
 *     the enqueue response hands back that same id. A `created_at >= now()`
 *     window would also match a scheduled tick starting in the same second,
 *     and would then report a stranger's pass as this one's. The worker side
 *     is read from its own source rather than retyped, so a rename there fails
 *     this guard instead of silently making the poll match nothing for ever.
 *  5. **It never fails the run on its own.** The verify below is the gate and
 *     is about to ask the real question; this phase only removes a wait. A
 *     refusal here (a paused mapping answers 409) has to read as itself and
 *     not as a reindexer that found nothing.
 *  6. **Every FIXED fixture the seeder writes is one the apply half refuses to
 *     spend.** This is the guard whose absence cost two task fixtures their
 *     future. `FIXTURE_RE` was written on 2026-08-20 naming event, contact and
 *     file; the task domain seeded its first fixture on 2026-09-03 and nobody
 *     widened the alternation, so `openmig-demo-task-1.ics` was a fixed demo
 *     fixture the picker considered disposable — and the apply half tombstones
 *     what it picks, permanently. Derived from the seeder rather than restated,
 *     so the next domain to arrive cannot repeat it.
 *
 * Read as text: this is a shell script driving a real stack, and what is
 * asserted is that certain commands are present, in a certain order, and that
 * two files agree about a set of names.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERIFICATION_DOMAINS } from '@openmig/shared';
import { DISCOVERY_DOMAINS } from '@openmig/shared';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');

const SMOKE_PATH = 'deploy/compose/smoke-managed.sh';
const SEEDER_PATH = 'deploy/compose/seed-demo-dav-content.sh';
const WORKER_PATH = 'apps/worker/src/jobs/run-delta-sync.ts';
const ROUTE_PATH = 'apps/api/src/routes/migrations/index.ts';

const smoke = read(SMOKE_PATH);
const seeder = read(SEEDER_PATH);
const worker = read(WORKER_PATH);

/** The `startRun({ … })` call that opens the ledger row for a sync pass. */
const startRunCall = (() => {
  const start = worker.indexOf('startRun({');
  expect(start, `${WORKER_PATH} no longer opens a run row with startRun`).toBeGreaterThan(-1);
  return worker.slice(start, worker.indexOf('}),', start));
})();

/** The `POST /:mappingId/sync` handler, up to the next route on the router. */
const syncRoute = (() => {
  const route = read(ROUTE_PATH);
  const start = route.indexOf("'/:mappingId/sync',");
  expect(start, `${ROUTE_PATH} no longer serves POST /:mappingId/sync`).toBeGreaterThan(-1);
  return route.slice(start, route.indexOf('router.post(', start));
})();

/** The body of `sync_and_wait`, from its opening line to the closing brace. */
const syncFn = (() => {
  const start = smoke.indexOf('sync_and_wait() {');
  expect(start, `${SMOKE_PATH} has no sync_and_wait function`).toBeGreaterThan(-1);
  const end = smoke.indexOf('\n}\n', start);
  expect(end, 'sync_and_wait is never closed').toBeGreaterThan(start);
  return smoke.slice(start, end);
})();

/**
 * The same body with its comment lines removed, which is what every assertion
 * below reads.
 *
 * Not tidiness. That function explains itself at length — it names `fail_at`
 * to say why it does not call one, and names a `created_at >= now()` window to
 * say why it does not poll on one — so a guard reading the whole text would
 * find both phrases and report the opposite of the truth in each case. A
 * guard satisfied by prose about the code is the same false pass this file was
 * written to catch, one level up.
 */
const syncCode = syncFn
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');

describe('the sync runs before the verify measures', () => {
  it.each([
    ['dav', '$APPLY_TENANT', '$APPLY_MAPPING'],
    ['mail', '$VERIFY_TENANT', '$VERIFY_MAPPING'],
  ])('%s: the pass is asked for above the verify that reads its result', (_label, tenant, mapping) => {
    const enqueue = smoke.indexOf(`sync_and_wait "${tenant}" "${mapping}"`);
    const verify = smoke.indexOf(`verify_mapping "${tenant}"`);
    expect(enqueue, `no sync_and_wait call for ${mapping}`).toBeGreaterThan(-1);
    expect(verify, `no verify_mapping call for ${mapping}`).toBeGreaterThan(-1);
    // The whole of #166, stated as a position. Everything else in this file
    // stays true with these two lines swapped, and the gate goes back to
    // holding a target to account for a sync nobody asked for.
    expect(enqueue).toBeLessThan(verify);
  });

  it('asks through the product, and does not write to a target itself', () => {
    // The line the prepare phase is careful not to cross. Removing a wait is
    // not the same as manufacturing a fixture, and the difference is that
    // nothing here seeds anything: it is one POST to the endpoint a customer
    // pressing "Sync now" would reach.
    expect(syncCode).toContain('/sync"');
    expect(syncCode).toMatch(/-d '\{"type":"delta"\}'/);
    expect(syncCode).not.toContain('seed-demo-dav-content.sh');
  });
});

describe('the fixtures are seeded before the verify, not after it', () => {
  const prepare = smoke.indexOf('if [ "${SMOKE_PREPARE_APPLY:-0}" = "1" ]; then');
  const eligibility = smoke.indexOf('ELIGIBLE="status IN');
  const verifyHalf = smoke.indexOf('# ---------- VERIFY half ----------');
  const applyHalf = smoke.indexOf('# ---------- APPLY half ----------');

  it('prepare, and the eligibility it needs, run above the VERIFY half', () => {
    // THE SECOND HALF OF #166/#167, and the half a sync alone does not reach.
    // On 2026-09-09 the demo stack answered task|tombstoned|2: BOTH fixed task
    // fixtures, spent by pick_disposable back when FIXTURE_RE named only
    // event, contact and file. classifyKnownItem never re-creates a tombstoned
    // natural key, so those two cannot copy however long the gate waits — a
    // verify with only the fixed set in front of it reports tasks 2/0 for
    // ever. `--fresh` mints keys the ledger has never seen, which is the one
    // kind no tombstone can own, so running prepare FIRST is what makes the
    // verify measure something this run seeded and this run copied.
    for (const [name, at] of [['prepare', prepare], ['eligibility', eligibility]] as const) {
      expect(at, `${name} not found`).toBeGreaterThan(-1);
      expect(at, `${name} must precede the VERIFY half`).toBeLessThan(verifyHalf);
    }
    expect(eligibility).toBeLessThan(prepare);
    // And the apply half still comes last: it spends what prepare created.
    expect(verifyHalf).toBeLessThan(applyHalf);
  });

  it('the tombstones are never retracted to make the gate green', () => {
    // The balance section keeps them on purpose and the apply half refuses to
    // retract an applied deletion, because a receipt pointing at an item
    // claiming no deletion was ever reported is a falsified record. A spent
    // fixture is REPLACED. Nothing in this script may un-tombstone one.
    expect(smoke).not.toMatch(/UPDATE item SET status\s*=\s*'(copied|updated|pending)'[^\n]*tombstoned/);
    expect(smoke).not.toMatch(/DELETE FROM item[^\n]*status\s*=\s*'tombstoned'/);
    expect(smoke).toContain('tombstone(s) kept deliberately');
  });
});

describe('a spent fixture set says so, instead of blaming the listing', () => {
  const branch = (() => {
    const at = smoke.indexOf("items at the SOURCE and 0 at the TARGET");
    expect(at, 'the targetCount=0 branch is gone').toBeGreaterThan(-1);
    return smoke.slice(at, smoke.indexOf('\n  else\n', at));
  })();

  it('asks the ledger whether those keys are tombstoned', () => {
    // #167 reported task 2/0 as "the target listing found nothing", which sent
    // the reader to a DAV query that was working perfectly; the real answer
    // took a hand-written database query. A refusal that names a symptom and
    // not a state is half a refusal.
    expect(branch).toContain("status='tombstoned'");
    expect(branch).toMatch(/if \[ "\$\{tombs:-0\}" -ge "\$d_src" \]/);
  });

  it('and says the two states differently', () => {
    expect(branch).toContain('this fixture set is SPENT');
    expect(branch).toContain('--fresh');
    expect(branch).toContain('the target listing found nothing');
  });

  it('translates EVERY report domain into the ledger spelling', () => {
    // Derived from both arrays, because the identity fallback is a silent
    // wrong answer: the report says `mail` and the ledger row says `email`, so
    // an unmapped `mail` asks for a domain no row has ever carried, gets 0,
    // and reports "not tombstones" for ever with nothing to show it is wrong.
    const arms = new Map(
      [...branch.matchAll(/^\s*(\w+)\)\s+led=(\w+) ;;$/gm)].map((m) => [m[1]!, m[2]!]),
    );
    for (const d of VERIFICATION_DOMAINS) {
      expect(arms.has(d), `no case arm for the report domain '${d}'`).toBe(true);
      expect(
        DISCOVERY_DOMAINS as readonly string[],
        `'${d}' maps to '${arms.get(d)}', which no ledger row can carry`,
      ).toContain(arms.get(d)!);
    }
  });
});

describe('it waits for the pass, rather than enqueuing and hoping', () => {
  it('polls the ledger until the run reaches a terminal status', () => {
    // A 202 says the orchestrator accepted the request, nothing more. Without
    // this loop the verify still reads whatever the target held at the instant
    // of the POST, which is the state #166 measured.
    expect(syncCode).toMatch(/while \[ \$i -lt "\$SYNC_POLLS" \]/);
    expect(syncCode).toMatch(/case "\$status" in succeeded\|failed\|cancelled\) break ;; esac/);
  });

  it('has a budget of its own, and it is a gate budget not a pass budget', () => {
    // Named beside the other two waits rather than borrowed from them: this
    // one waits on a pass over everything the source holds, where PREP_POLLS
    // waits on the first eligible row to appear.
    expect(smoke).toMatch(/^SYNC_POLLS="\$\{SMOKE_SYNC_POLLS:-\d+\}"$/m);
  });

  it('tells a pass that never started apart from one still running', () => {
    // Three states, three remedies: no ledger row at all means the enqueue
    // never became a runner (the failure the runner-proxy section exists to
    // explain), `running` means the budget was short, and `failed` means the
    // verify below is about to describe what a failed pass left behind.
    expect(syncCode).toContain('never became a runner');
    expect(syncCode).toMatch(/still '\$status' after/);
    expect(syncCode).toMatch(/the pass ended '\$status'/);
  });

  it('follows the pass it asked for, by the orchestrator id and not by a clock', () => {
    // `runId` in the response is `ctx.run.id`, which run-delta-sync stores on
    // the ledger row. Read from the worker rather than retyped: if that field
    // stops being written, this guard fails here instead of leaving a poll
    // that matches nothing until its budget runs out, every run, quietly.
    // Both ends of the identifier the poll joins on, read from the code that
    // produces them: the route answers with the orchestrator's run id, and the
    // worker writes THAT id onto the ledger row it opens. Either half going
    // quiet would leave a poll matching nothing until its budget ran out —
    // every run, silently, and reported as "still running".
    expect(syncRoute).toContain('tasks.trigger(');
    expect(syncRoute).toContain('runId: run.id');
    expect(startRunCall).toContain('orchestratorRef');
    expect(syncCode).toContain(".runId // empty");
    expect(syncCode).toMatch(/WHERE tenant_id='\$tenant' AND orchestrator_ref='\$ref'/);
    // A time window would accept a scheduled tick that started in the same
    // second and report it as this phase's pass.
    expect(syncCode).not.toMatch(/created_at\s*>=/);
  });

  it('never fails the run on its own — the verify below is the gate', () => {
    // A refusal here has to read as a refusal. `fail_at` in this function
    // would turn a paused mapping (409) into a verify failure about a target
    // listing, which is the class of misattribution #166 was.
    expect(syncCode).not.toContain('fail_at');
    expect(syncCode).toContain('the enqueue was REFUSED');
  });
});

describe('a domain nothing measured is not a domain that copied nothing', () => {
  const loop = (() => {
    const at = smoke.indexOf('for d in "${REQUIRED_DOMAINS[@]}"');
    expect(at, 'the per-domain presence loop is gone').toBeGreaterThan(-1);
    return smoke.slice(at, smoke.indexOf('\ndone\n', at));
  })();

  it('NOT_VERIFIABLE is its own refusal, beside absent and skipped', () => {
    // THREE WAYS A DOMAIN GOES UNCHECKED, and this loop had two of them. A
    // domain absent from the report is an engine that never knew it existed; a
    // SKIPPED domain is one the engine declined to check; a NOT_VERIFIABLE one
    // is present, unskipped, and still never measured — verification emits it
    // when `canVerifyTarget` says no, with sourceCount from the ledger and
    // targetCount 0.
    //
    // Which reads EXACTLY like a domain nothing copied. E2E (managed) #168
    // reported the task domain as "the target listing found nothing" while its
    // two VTODOs sat on the target, because buildTargetReindexers collected
    // four domains and not that one.
    expect(loop).toContain('NOT_VERIFIABLE_${d}');
    expect(loop).toMatch(/fail_at[^\n]*NOT_VERIFIABLE/);
  });

  it('and it is asked BEFORE the floor, which would misattribute it', () => {
    // Order is the assertion: the floor check reads the same two numbers and
    // has a different remedy (a listing query, not a missing reindexer), so
    // whichever runs first owns the message. The precise one has to win.
    const notVerifiable = smoke.indexOf('NOT_VERIFIABLE_${d}');
    const floor = smoke.indexOf('items at the SOURCE and 0 at the TARGET');
    expect(notVerifiable).toBeGreaterThan(-1);
    expect(floor).toBeGreaterThan(-1);
    expect(notVerifiable).toBeLessThan(floor);
  });

  it('names where the reindexers are built, because that is the usual cause', () => {
    // A refusal that names a symptom and not a state is half a refusal. The
    // reader needs the file, not the feeling.
    expect(loop).toContain('build-reindexers.ts');
  });
});

describe('every fixed fixture the seeder writes is one the apply half refuses to spend', () => {
  /**
   * The `openmig-demo-<type>-` names the seeder PUTs with the shared
   * `${SUFFIX}${n}` shape. In fixed mode SUFFIX is empty, so these are exactly
   * the keys that end in digits-then-extension — which is the shape FIXTURE_RE
   * matches on.
   */
  const seededTypes = [
    ...new Set(
      [...seeder.matchAll(/openmig-demo-([a-z]+)-\$\{SUFFIX\}/g)].map((m) => m[1]!),
    ),
  ].sort();

  /**
   * Names introduced only when a tag was given are FRESH-only, never fixed —
   * `openmig-demo-bigfile-` is the live example — so they are not fixtures this
   * exclusion is about, and excluding them would starve the apply half.
   */
  const freshOnly = new Set(
    seeder
      .split('\n')
      .filter((l) => l.includes('[ -n "$TAG" ]'))
      .flatMap((l) => [...l.matchAll(/openmig-demo-([a-z]+)-/g)].map((m) => m[1]!)),
  );

  const fixedTypes = seededTypes.filter((t) => !freshOnly.has(t));

  const alternation = smoke.match(/FIXTURE_RE="openmig-demo-\(([^)]*)\)/)?.[1]?.split('|') ?? [];

  it('the seeder is still readable by this guard', () => {
    // If the seeder stops writing these names in this shape the lists go empty
    // and every assertion below passes vacuously — the shape of pass this file
    // is against.
    expect(seededTypes.length).toBeGreaterThan(0);
    expect(fixedTypes.length).toBeGreaterThan(0);
    expect(alternation.length).toBeGreaterThan(0);
  });

  it.each(['event', 'contact', 'file', 'task'])('%s is excluded from the picker', (type) => {
    expect(alternation).toContain(type);
  });

  it('and so is every other type the seeder writes a fixed key for', () => {
    // THE GUARD THAT WAS MISSING. `task` joined the seeder on 2026-09-03 and
    // this alternation on 2026-09-09, and in between `openmig-demo-task-1.ics`
    // and `-2.ics` were fixed demo fixtures the picker was willing to spend.
    // The apply half tombstones what it picks and classifyKnownItem never
    // re-creates a tombstoned key, so they were two runs from gone for good
    // and unrecoverable by re-seeding — the run-#20 pathology, reopened by the
    // one domain added after the fix for it. Derived, so the next domain to
    // arrive cannot repeat it.
    expect(alternation.slice().sort()).toEqual(fixedTypes);
  });

  it('but a fresh-only name is NOT excluded, or the apply half starves', () => {
    // `--fresh` mints keys no tombstone can already own, and those are the
    // ones this gate is meant to spend. Excluding them would leave the apply
    // half nothing eligible and the run reporting a refusal every time.
    expect(freshOnly.size).toBeGreaterThan(0);
    for (const t of freshOnly) expect(alternation).not.toContain(t);
  });
});
