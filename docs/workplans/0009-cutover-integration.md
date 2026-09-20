# Workplan 0009 — Cutover made real: verification gate, DNS, rollback — integrated & tested

## Status — 2026-09-20 (update this block at the end of every session)

> **Done.** T1/T2/T3/T5/T6 all done and tested. A doc audit on 2026-07-27 found T2's `--yes`
> approval gate had been marked done while absent; it is now genuinely implemented and unit-tested
> (see the T2 row). **Owner decision 2026-07-16: verify-only DNS** — T4 (automated provider writes)
> stays deferred; verify-only is the permanent cutover DNS story.
>
> **Nothing open in this plan.** T8 was decided by the owner on 2026-09-20 (a cutover may be
> attempted again after a rollback: `ROLLED_BACK → PREPARING`) and is done; see the T8 section.
> T12 (2026-09-20) put the door, the converging job and the row security on the nightly managed
> gate — the first time anything pressed the cutover on a running stack.

| Task | Status | Evidence |
|---|---|---|
| T1 verification engine on real ledger/targets | ✅ Done | PR #31 merged (56f4a50); commits: 7d15237 (verification logic + RLS), 60a9337 (force RLS + verification fix), 321b2f0 (verification + state machine), 04ba8ab (LedgerVerificationReader interface), eopba8ab (discrepancy detection), c340a65 (ledger queries), 6d9ecd4 (persistence to ledger); integration test: `packages/core/src/verification.integration.test.ts` |
| T2 cutover state machine persisted + driven by worker | ✅ Done | PR #31 merged (56f4a50); commits: ffde0c9, 8672893, 37f500c (state machine fixes), 96c6249 (state-machine tests), 34dbb0a (complete cutover), 765abc7 (foundation), 35956b0 (integration tests Steps 8-10); persistence via `packages/ledger/src/cutover-store.ts`; CLI via `apps/worker/src/cli/cutover-commands.ts`. **`--yes` gate added 2026-07-27:** an audit found this row had claimed the "behind explicit `--yes` confirmation" requirement while `rollbackCutover()` printed `Confirm rollback? …` and then proceeded unconditionally (`// For now, we'll proceed`), with `approve`/`execute` ungated entirely. `approve`, `execute` and `rollback` now refuse without `--yes`, printing the consequences and exiting non-zero; `rollback` no longer claims DNS was restored (verify-only DNS) and names the manual MX revert instead. Covered by `apps/worker/src/cli/cutover-commands.unit.test.ts` (7 tests), which asserts the ledger is **not** mutated when the flag is absent. |
| T3 DNS: verify-only resolver checks + guided runbook | ✅ Done (2026-07-27) | `packages/core/src/dns-verify-only.ts` already used public DoH resolvers (Cloudflare/Google/Quad9, 2-of-3 consensus) as of commit 7b1228b (2026-07-12) — the previous Status block's "still uses the system resolver" note was stale by the time it was written; corrected here. What was genuinely missing, now fixed: (a) `verifyAllDns` hardcoded `dkimVerified: false` and never called `verifyDKIM` — real DKIM selector checking is now wired in (defaults to `default`, overridable); (b) `generateDnsRunbook` was dead code, never called from the CLI — added a `runbook` CLI subcommand (`cutover-commands.ts` `generateRunbook`, no DB/credentials required) and a DKIM section to the generated Markdown so it matches what `verify` actually checks; (c) zero test coverage — added `packages/core/src/dns-verify-only.unit.test.ts` (25 tests, stubbed `fetch`/DoH) covering per-resolver consensus, all five checks, propagation backoff (proves no hot-loop via fake timers), and a runbook-vs-verify cross-check. `pnpm typecheck`/`pnpm lint` clean. |
| T4 DNS provider adapter (one real provider) | ⏸️ **Deferred by owner (2026-07-16)** | Owner decided: **keep verify-only, defer automated DNS writes**. `packages/core/src/dns-provider-desec.ts` (deSEC adapter) **stays as an unwired template only** — leave it commented out in `run-cutover.ts`/`run-rollback.ts`; do **not** wire any provider write-path. Cutover DNS remains guided/manual via the runbook (T6) + verify checks (T3). Revisit provider automation in a later slice if demanded. |
| T5 rollback path integration test | ✅ Done | PR #31 merged (56f4a50); commit 35956b0 "Add cutover integration tests (Steps 8-10)"; `packages/core/src/rollback.integration.test.ts` tests gate-fail and grace-window rollback paths |
| T6 cutover runbook + user comms templates | ✅ Done | PR #31 merged (56f4a50); commit c96ae51 "Add cutover runbook and communication templates (Steps 11-12)"; `docs/cutover-runbook.md` (283 lines) + `docs/cutover-communication-templates.md` (368 lines) contain runbook + comms templates |
| T7 `status` tells the truth | ✅ **Done 2026-09-20** | Found after ADR-0047/0048 changed what the ledger and the mapping mean: `status` printed rows the read path never fills — `mapRowToStatus` maps no `startedBy`, `rolledBackAt`, `failedAt` or `failureReason`, and `complete` writes `completedAt` metadata the row does not persist — so "Started By" was always N/A and Rolled Back / Failed / Completed never printed, while its "Recent Events" were the OLDEST five (`getEventHistory` orders ascending and limits), which on any cutover past its fifth event dropped the rollback or the failure. And it never showed the mapping's lifecycle, the half that says whether anything still runs. Now the state row carries the event that entered it (when, by whom from the door's own metadata, why); rollback availability is printed as the machine decides it; the mapping lifecycle is one row with what it means for the passes (`lifecycleLine`, derived from `runsPasses`/`isAfterCutover`); a mapping row that cannot be read is said so; the trail is listed newest first. Seven unit tests in `cutover-commands.unit.test.ts`, proved by mutation. |
| T8 A second attempt after a rollback | ✅ **Decided and done 2026-09-20** — owner: "T8: ok, what you adviced" (allow `ROLLED_BACK → PREPARING`). `VALID_TRANSITIONS` admits the edge as it always admitted `FAILED → PREPARING`; `isTerminalState` is derived from the table and names `COMPLETED` alone; `start-cutover` attempts again from `ROLLED_BACK` the way it retries from `FAILED`, and the managed prepare job follows `prepareTransition`, which derives the same answer; the snapshot test carries the sign-off; runbook diagram and passages, ADR-0047 operative rule amended in place and a consequences bullet appended. Before the decision, the half that needed none: | `cutover_state` is one row per mapping, `initializeCutover` returns the existing row, and the machine admits nothing out of `ROLLED_BACK`. So `start-cutover` printed "Cutover initialized: ROLLED_BACK" for a row it merely read back, `verify` advanced nothing, and the runbook's retry from `FAILED` named a transition no command performed. **Done:** `start-cutover` reads the ledger first — none: initialise; `FAILED`: retry (`FAILED → PREPARING`, the edge the machine always had, recorded with `retriedBy` and the attempt number, the failed attempt kept in the trail); `COMPLETED`/`ROLLED_BACK`: refuse out loud; anything else: name the state and the next step. **The decision** is recorded in the section below. |
| T9 A second press that failed a ready cutover | ✅ **Done 2026-09-20** | The managed prepare job (`run-cutover`, enqueued by `POST /api/migrations/{id}/cutover`) called `initializeCutover` — which returns the existing row — and then wrote `READY_FOR_CUTOVER` unconditionally, an edge the machine does not have out of `READY_FOR_CUTOVER`. So a second press on a ready cutover threw, the task's catch marked it `FAILED` (that edge exists), and every one of Trigger.dev's default three attempts then found `FAILED`, where the same write is invalid too: a ready cutover, prepared twice, was a failed one that nothing could retry. Now `prepareTransition` (`packages/core/src/cutover-state.ts`, a view of `VALID_TRANSITIONS` the way `canRollback` is) decides before anything is written: no ledger → initialise; `PREPARING`/`APPROVED` → prepare (the approval is revoked at the end, as the recorded `APPROVED → READY_FOR_CUTOVER` it always was); `READY_FOR_CUTOVER`/`FAILED` → record the way back to `PREPARING` first (`retriedBy`, attempt number, reason), then prepare; a cutover under way or a closed ledger → refuse (`CutoverRefused`), nothing written, and the task neither marks `FAILED` nor retries. A gate FAIL is a `CutoverGateFailed`: recorded once, not retried (`AbortTaskRunError`); anything else is recorded and retried, and the retry converges. `status` names the job on its events. Seven unit tests on the decision, twelve integration cases against a real ledger, proved by mutation. **Same day, after T8's decision:** `ROLLED_BACK` is no longer a closed ledger to the job; it attempts again from it, recorded as the next attempt. |
| T10 The press that answered 202 to a closed ledger | ✅ **Done 2026-09-20** (owner: "ok, build the 409") | `POST /api/migrations/{id}/cutover` enqueued the preparation without reading `cutover_state`: a press on a cutover under way or a finished ledger was answered 202 with a promise the job broke minutes later in a run nobody watched, and a press on an `APPROVED` cutover revoked the approval behind a 202 that said nothing. Now the door asks `prepareTransition` — the job's own rule, one level up, the way ADR-0049 made the update door ask — after the mapping check and before anything is enqueued: 409 `cutover_refused` with the reason, the hint, the stable `code` (`under_way`, `closed`) and the `state`; 202 otherwise, carrying `preparation` (the ledger state found, whether it resets to `PREPARING`, whether an approval is revoked). The read is through the tenant-scoped database; the job re-reads and stays the authority. Source guard (six tests) and an integration test through the real Express app on Postgres with the Trigger.dev client mocked; OpenAPI carries the 409 and the 202's fields. **Found on the way:** `cutover_state` and `cutover_event` carry no row-level-security policy, unlike every other tenant table — fixed in T11. |
| T11 The two tables the policies missed | ✅ **Done 2026-09-20** (owner: "Do build the row-level-security policy") | Migration `0055_the_two_tables_the_policies_missed.sql`: `ENABLE` + `FORCE ROW LEVEL SECURITY` and the four NULL-safe tenant policies on `cutover_state` and `cutover_event`, in the form `0004` established and `0035` last used. Why it was invisible: every reader — the cutover job, the rollback job, the operator CLI — went through `DATABASE_URL`, a superuser on the bundled deployments, and the guard in `force-rls.unit.test.ts` asked "which RLS tables are not FORCEd", a question a table with no RLS never appears in; it now also asks "which tables with a `tenant_id` have no row security" (would have returned exactly these two). `tenantCutoverStore(source, tenantId)` in the ledger runs every store call inside `withTenant`, bound to one tenant and refusing another before any query; the three callers use it, so on hard rule 5's shape (an ordinary owner on the operator's own Postgres) the cutover ledger keeps answering, and a `transitionState` now lands in one transaction. Proof on a real Postgres as `app_user`: catalogs (RLS on, FORCEd, eight policies), fail-closed with no context, own tenant only with it, a write that lands, a foreign-tenant write refused by the store and by `WITH CHECK`. |
| T12 A cutover the gate never pressed | ✅ **Done 2026-09-20** (owner: "start with what was unblocked for you") | No gate had ever pressed the cutover: the appliance has no door for it (ADR-0026 — the Finish page is a checklist), so the managed smoke is the one place the chain runs for real. A section on the demo MAIL mapping (the VERIFY half finds it fit to cut over; the DAV mapping verifies FAIL on the long-lived stack and would land FAILED by the job's own rule): the door answers 202 with `preparation.from: null` and the run-cutover task lands `READY_FOR_CUTOVER` (one entry into PREPARING, one READY verified by the job); a second press answers 202 with `resetsToPreparing: true` and the job converges — `READY_FOR_CUTOVER → PREPARING` recorded as attempt 2 by the job, `READY_FOR_CUTOVER` again, the first attempt kept on the trail (T9); `CUTOVER_IN_PROGRESS` and `COMPLETED`, set as fixtures (the transitions into them are the CLI's), are refused 409 `cutover_refused` with `under_way` / `closed`, no run, the ledger untouched (T10); on the real Postgres `SET ROLE app_user` sees nothing in either table without a tenant context and the tenant's row with it, the owner sees it regardless (T11). Net zero: the ledger is taken back at the end and a leftover from an aborted run is cleared first, because one ledger per mapping on a stack that lives from night to night is otherwise tomorrow's failure. Guard: `scripts/a-cutover-the-gate-never-pressed.unit.test.ts` reads the section from the real script. Stage 7 of `docs/owner-test-runbook.md` names the one thing only real data can answer: whether the §20 gate passes over the owner's own mapping (start-cutover + verify, no DNS touched, nothing stopped). |

> Read `AGENTS.md`, the arch doc (§11 shadow & cutover, §20 verification & rollback) and
> workplan 0004 first. **Depends on:** 0007 (verification should count all domains, but a
> mail-only first pass is acceptable — see T1). **Supersedes** workplan 0004's open end: 0004
> built the state machine (`packages/core/src/cutover-state.ts`), verification scaffolding
> (`verification.ts`), DNS types (`dns-manager.ts`) and a rollback orchestrator — all
> **unit-tested against fakes only** (its "Phase 4: Integration & Testing" was never started,
> and its Status header contradicts its body; see 0006-C). Nothing persists state, nothing is
> reachable from the worker/API, and no DNS record is ever actually read or written.

## T8: a second attempt after a rollback — the owner's call

ADR-0047 made a rollback the *recoverable* outcome of a cutover: a setback, the migration back to
syncing, the source live again. The state machine, written before that decision, makes it the one
outcome with no way forward: `FAILED` may go back to `PREPARING` (and `start-cutover` now does
that), but `ROLLED_BACK` admits nothing, and there is one cutover ledger per mapping. So the
operator who rolled back because the MX change went wrong, fixed it, and wants to try again has
exactly one option today: delete the `cutover_state` row by hand. That is the asymmetry: the
outcome the product makes safe to reach is the one it cannot leave.

Two ways to close it, and neither is a programmer's to pick:

1. **Allow `ROLLED_BACK → PREPARING`** in `VALID_TRANSITIONS`, as `FAILED → PREPARING` already is,
   and let `start-cutover` retry from it the way it now retries from `FAILED`. The trail keeps the
   first attempt (events are append-only); `isTerminalState` and the runbook's diagram change;
   four pinned tests move. Cheapest, and consistent with what a rollback now IS.
2. **A new attempt is a new ledger row** — drop the `(tenant_id, mapping_id)` uniqueness, add an
   attempt number, make every reader pick the latest. Keeps `ROLLED_BACK` terminal per attempt,
   costs a migration and a pass over every `cutover_state` reader.

Until decided, `start-cutover` on a `ROLLED_BACK` ledger says so and names this row.

**Decided 2026-09-20 — option 1.** The owner's reasoning, recorded because it is the definition at
work: a rollback after a cutover is not a reverse migration, it is the migration back at the
regular sync with the source live again (ADR-0047), minus the mail that reached the target during
the window; so a second attempt is simply the cutover tried again once the cause is fixed, and a
ledger that forbids it makes a rollback mean "abandon the cutover", which it never meant. What
moved: `ROLLED_BACK: ['PREPARING']` in `VALID_TRANSITIONS`; `isTerminalState` derived from the
table (`COMPLETED` only); `start-cutover` attempts again from `ROLLED_BACK` with the attempt number
and says where the window's mail is; the managed prepare job derives the same answer through
`prepareTransition`; the runbook diagram; ADR-0047's operative rule on write order (the reason
there was never "terminal", it was "admits no second rollback") and a consequences bullet. Option 2
(a ledger row per attempt) was not taken: the same outcome for a migration and a pass over every
reader.

## Definition of Done (the gate)
A complete cutover lifecycle runs against the dev stack, driven through the worker: shadow →
**verification gate computed from the real ledger + target counts** (per-folder parity + checksum
sampling per §20) → approval → cutover with DNS steps (verify-only in dev) → grace window →
done; plus the rollback branch (gate-fail → back to shadow; post-cutover → rollback runbook
executed). Every state transition is persisted and event-logged; a deliberately broken target
(one message deleted) **blocks** the gate. All gates green incl. new integration tests.

## In scope
- Wiring `verification.ts` to real data sources (ledger counts vs `TargetReindexer.listEntries`
  counts + sampled content-hash comparison).
- Persisting `CutoverStateMachine` state + events to the ledger DB (it currently lives in
  memory only — a worker restart loses the cutover).
- Driving cutover/rollback from the worker CLI (self-host path) — the Trigger.dev job wrappers
  (`apps/worker/src/jobs/run-cutover.ts`, `run-rollback.ts`) get wired to the same core in 0011.
- DNS in two honest layers: (a) **verify-only**: resolver checks (MX/SPF/DKIM/DMARC/autodiscover
  presence + propagation polling) requiring no credentials; (b) **one real provider adapter**
  behind the existing `DnsProvider` interface.
- The §11 asymmetric-send prerequisites surfaced as checks (SPF includes both senders, DMARC
  `p=none` during transition) — verification warnings, not writes.

## Out of scope (later)
- UI wizard & decision queue (§11.2) — a web workplan after the 0006-G framework decision.
- Autodiscover/MTA-STS/DANE record *management*, mail-flow warm-up choreography — the runbook
  documents them; automation later.
- Reverse **sync** implementation for post-cutover rollback (§20 "reverse read") beyond a smoke
  test — full reverse-mirror is its own slice when demanded.
- Multi-provider DNS coverage (one adapter proves the seam).

## Tasks

### T1 — Verification engine on real ledger/targets
Replace the fake-fed paths in `packages/core/src/verification.ts`: per mapping, compare (a)
ledger row counts per folder/collection vs target enumeration via the existing
`TargetReindexer.listEntries` (JMAP + IMAP flavors shipped in 0001/0002), (b) a configurable
random sample of content hashes source-vs-target, (c) totals within tolerance. Missing domains
(no 0007 yet) are reported as `SKIPPED`, never silently passed — the gate result lists every
domain with counted/sampled/skipped status.
**Acceptance:** integration test on Stalwart — full sync then verify passes; delete one message
directly on the target → verify **fails** naming the folder and delta; tolerance edges
unit-tested.

### T2 — Persist + drive the state machine
New ledger tables (Drizzle migration, both dialects) `cutover_state` + `cutover_event`
(append-only audit per 0004's design); rehydrate the machine from DB on start; expose
`start-cutover`, `approve`, `rollback` as worker CLI subcommands behind explicit `--yes`
confirmation (§11.2 control actions; nothing irreversible without approval — hard rule 2 spirit).
**Acceptance:** integration test walks Shadow→Verify→(approve)→Cutover→Grace→Done with a worker
restart mid-flow (state survives); illegal transitions rejected (reuse 0004's 24 unit tests
against the persisted impl); events queryable in order.

### T3 — DNS verify-only checks + guided runbook generator
Implement resolver-based checks (Node `dns/promises` over the configured resolver, plus a
public-resolver cross-check for propagation): current MX target, SPF contains the target sender,
DKIM selector present, DMARC policy value, autodiscover host. Generate a per-tenant **manual DNS
runbook** (Markdown: exact records before/after, TTL-lowering step, §11 asymmetric-send SPF
guidance) — this is the §14.2 "guide" philosophy applied to DNS.
**Acceptance:** unit tests with a stubbed resolver; integration: runbook generated for the dev
domain enumerates exactly the records the verify step then checks; propagation poller honors
TTL-based backoff (no hot loops).

### T4 — One real DNS provider adapter
Pick one EU-friendly API-capable provider and implement `DnsProvider` (get/update/verify) for it
— **recommendation: deSEC** (EU, free, clean REST, token-scoped) with the choice recorded as an
ADR; secrets via env/vault refs. Guard every mutation behind the state machine's approval gate +
a dry-run mode that prints the diff it would apply.
**Acceptance:** recorded-fixture unit tests for the adapter; a manual secret-gated smoke test
against a throwaway zone applies + verifies + rolls back an MX change; dry-run output matches
what apply then does.

### T5 — Rollback integration test
Wire 0004's `rollback-orchestrator.ts` to the persisted machine and the T3/T4 DNS layers:
gate-fail path (Verify→Shadow, nothing external touched) and grace-window path (MX restore via
provider-or-runbook + reverse-read smoke: one message written to the target after cutover is
detected and surfaced — not auto-copied — per §11.1 deletions/decisions principle).
**Acceptance:** integration test for both paths; audit trail shows every step; a step failure
mid-rollback continues remaining steps and reports (0004's design, now proven against real deps).

### T6 — Cutover runbook + comms templates
`docs/cutover-runbook.md`: end-to-end operator/self-host procedure (final delta, read-only
source option, DNS switch, client reconfiguration, grace window, archive). Add the §23
plain-language EN/NL end-user templates ("we're moving your email", "cutover date, what to
expect") as `docs/templates/cutover-comms.{en,nl}.md`.
**Acceptance:** docs-hygiene green; runbook steps cross-reference the CLI subcommands from T2
and match their actual names/flags (spot-check by running `--help`).

## Conventions & gotchas
- **The verification gate is the product promise** (§1 "fear of data loss") — never weaken a
  failing gate to pass a test; unmask and fix (hard rule 9).
- DNS mutations are the one genuinely destructive-adjacent action in the stack: approval gate +
  dry-run are mandatory paths through the code, not optional flags.
- Grace-window default stays 72 h (0004); make it config, keep the safe default.
- Stalwart rules per `docs/stalwart-integration-fix.md`; new tests use the 0006-A naming.

## Related: DAV Integration Status (Issue #32)

CalDAV/CardDAV/WebDAV integration tests are **failing** against Stalwart v0.16.10 due to missing
DAV service configuration. See `docs/dav-integration-status.md` for full assessment.

**Current state**:
- CalDAV/CardDAV: 10 tests FAIL (Stalwart returns 403/HTML instead of DAV responses)
- WebDAV: 7 tests SKIP (Nextcloud not configured — expected)
- Unified-Sync: 4 tests FAIL (depends on CalDAV/CardDAV)

**Root cause**: Stalwart's DAV services require explicit HTTP listener configuration not present
in the minimal test setup.

**Action required**: Owner decision on whether to:
1. Configure Stalwart DAV services
2. Accept DAV as unsupported for now (re-skip with explicit reason)
3. Use alternative DAV target for tests
