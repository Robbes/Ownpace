# ADR-0047: A rollback is a setback

- **Status:** **Accepted 2026-08-23** — the owner's definition, given that day and recorded in
  [workplan 0101 §T5](../workplans/0101-the-paths-no-gate-had-opened.md); **built 2026-09-19** as
  one implementation with both callers over it, gated against a real ledger. Written up as an ADR
  only now: a decision this heavy was living in a workplan section and a code comment, and for a
  month the code held two answers to it.
- **Date:** 2026-08-23 (decided); 2026-09-19 (recorded here, and built)
- **Deciders:** owner
- **Relates to:** [ADR-0005](./0005-idempotency-ledger-nondestructive.md) (non-destructive by
  default — the source is never written, which is exactly why the source IS the fallback),
  [ADR-0024](./0024-explicit-owner-deletion-apply.md) (nothing on the target is removed by a
  rollback either), [ADR-0026](./0026-one-operating-ui-one-contract.md) (lifecycle decisions live
  in `@openmig/shared` so both editions answer them identically), workplan 0117 D4 (after cutover
  the source is not the authority — the reason `continuous` comes back to `active`).
- **Relates to workplan:** [0101 T5](../workplans/0101-the-paths-no-gate-had-opened.md) — the
  finding; [0009](../workplans/0009-cutover-integration.md) — the cutover this sets back;
  [0026 T3](../workplans/0026-promise-reconciliation.md) — reverse sync retracted, which this
  decision keeps retracted.

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- A rollback is a **setback**: the cutover ledger goes to `ROLLED_BACK`, and the mapping goes back
  to `active` when it was `cutover` or `continuous`. That is the whole of it. It never swaps
  source and target, never writes to the source, never removes or copies anything on the target,
  and never writes DNS (verify-only, owner 2026-07-16 — reverting the MX record is the operator's
  hand).
- **One implementation**: `performRollback` in `@openmig/core` (`cutover-rollback.ts`). The
  operator CLI (`rollback --yes`) and the `run-rollback` Trigger.dev job are callers that gate,
  print and notify; neither decides anything. Guards: `cutover-rollback.unit.test.ts`,
  `cutover-commands.unit.test.ts`, `run-rollback.integration.test.ts`.
- **Mapping first, ledger second, and every refusal before either write.** `ROLLED_BACK` is
  terminal, so the write that can be retried goes first. Half a rollback is the defect this ADR
  ends.
- The mapping half is decided by `rollbackTransition` in `@openmig/shared` (`lifecycle.ts`):
  `cutover` and `continuous` → `active`; `active` and `paused` are left alone and the outcome says
  why; `done` is **refused** — finishing is not undone by a rollback, for the same reason
  `startTransition` refuses `done`. Guard: `a-rollback-is-a-setback.unit.test.ts`.
- Which cutover states may roll back is the state machine's `isValidTransition(state,
  'ROLLED_BACK')` — APPROVED, CUTOVER_IN_PROGRESS, GRACE_PERIOD and FAILED. `canRollback` derives
  from it, and `rollbackAvailable` on a read is that predicate, never a constant. Guard:
  `cutover-state.unit.test.ts`.
- Every mapping status change a rollback makes is recorded in `audit_log` as `mapping.status`
  with `via: 'rollback'`, in the same transaction as the row (`mappingLifecyclePort` in
  `@openmig/ledger`) — the record every other lifecycle write has left since workplan 0109.

## Context

Workplan 0101 set out to find which product paths no gate had ever opened, and found rollback in
a state worse than untested: **implemented twice, differently, with the reachable one not doing
it.** An operator CLI drove the whole cutover state machine and had a `rollback` subcommand that
marked the ledger `ROLLED_BACK` and stopped. A Trigger.dev job, `run-rollback`, reactivated the
mapping so the shadow sync resumed *and* marked the ledger — and nothing in the repository called
it. So an operator who rolled back from a terminal had a migration labelled rolled back and a sync
that was not running. Two further inconsistencies sat beside that one: `rollbackAvailable` was
hardcoded `false` on every read of a cutover, and `canRollback` named two states while the state
machine admitted `ROLLED_BACK` from four — including `FAILED`, which is where `execute` lands a
propagation timeout while printing *"Consider rollback."*

The design question underneath — what a rollback *is* — the owner settled on 2026-08-23:

> A rollback is a **setback**. It puts the migration back to syncing, with the original source
> live again, and that is all of it. It never swaps source and target. It never salvages from the
> target.

That definition rests on ADR-0005: the source is never written, so at the moment of cutover the old
system is still whole and still current. There is nothing to restore. The genuine loss is mail that
arrived on the *new* system after cutover — it stays there and is not pushed back, because pushing
it back means writing to a source this product only ever reads, and a migration tool that writes to
somebody's live source on an emergency path is not one to trust with the emergency.

The definition was recorded in the workplan and in the job's header comment. It was not an ADR,
and the code did not implement it once. Both are corrected here.

## Decision

1. **A rollback is a setback**, exactly as the owner defined it, and the definition is the
   operative rule above.
2. **It exists once.** `performRollback` in `@openmig/core` performs the whole of it. The CLI and
   the job call it. Removing either caller was considered and rejected (below); removing the
   *logic* from both is what mattered.
3. **The mapping half is a lifecycle decision in `@openmig/shared`**, `rollbackTransition`, beside
   the two lifecycle decisions that already live there under ADR-0026. `continuous` goes back to
   `active` because after a rollback the source is the authority again (0117 D4), and `active` is
   the only running state that says so. `done` is refused rather than reversed: leaving `done` is
   a lifecycle decision this ADR does not take, and a rollback that took it silently would be a
   second rule for the same transition.
4. **The order is fixed**: mapping, then ledger; refusals before either. A `RollbackRefused` is a
   typed outcome the callers tell apart from a failure mid-write — a refused rollback changed
   nothing and is not recorded as a `FAILED` cutover.
5. **The predicates are one rule.** `canRollback` is the state machine's answer; the store's read
   path computes `rollbackAvailable` from it.
6. **It is audited.** The mapping-status audit helper moved from the API into the ledger so the
   worker leaves the same `mapping.status` record the API does, in the same transaction as the
   row.

## Consequences

- The reachable rollback now performs one. `rollback --yes` on the CLI and the `run-rollback` job
  do the same thing in the same order, and an operator can see in `audit_log` who set the mapping
  back and from what.
- A cutover that `FAILED` on a propagation timeout can be rolled back, as the CLI's own message
  already invited.
- **A `done` mapping cannot be rolled back.** An operator who finished a migration and then needs
  the source live again reverts the MX record by hand; resuming the copy into that target would
  need the lifecycle to allow leaving `done`, which it does not today. If that is wanted, it is a
  lifecycle decision, not a rollback one.
- **No API route was added, on purpose.** The API is prepare-only for cutovers — `POST
  …/cutover` enqueues verification and stops at `READY_FOR_CUTOVER`, and nothing in the API or the
  UI executes a cutover either. A rollback route without an execute route would be asymmetric,
  and the parity guard would require the appliance to answer it too, which has no cutover state
  machine at all. Reachability is the operator terminal and the Trigger.dev dashboard, both of
  which now do the same thing.
- **The gate is the integration test, not the E2E smoke.** Reaching `GRACE_PERIOD` for real needs
  DNS propagation to a real MX record; the smoke cannot do that without manufacturing the ledger
  row, which 0101 already declined to do for other routes. `run-rollback.integration.test.ts`
  drives the real state machine and the real ledger port against Postgres instead.
- Recorded rather than fixed here: **the cutover flow itself never changes `mailbox_mapping.status`.**
  Neither the CLI's `execute` nor the `run-cutover` job writes `cutover` onto the mapping; only
  the lifecycle `PATCH` and the appliance's config do. So in a CLI-driven cutover the mapping is
  still `active` throughout, and the rollback's mapping half is a no-op that says so. That is a
  finding about the cutover, not the rollback, and belongs to whichever plan next touches
  execution.

## Alternatives considered

- **Delete the job, keep the CLI.** Loses the managed edition's only entry point and the
  notification path (workplan 0030 T4). The job was never the problem; the duplication was.
- **Make the CLI enqueue the job.** Couples an operator's terminal — which may be the appliance's
  — to Trigger.dev. The CLI is the self-host path precisely because it needs nothing managed.
- **Narrow the state machine to match `canRollback`.** Would remove `FAILED → ROLLED_BACK` and
  strand every propagation-timeout cutover with no rollback, contradicting the message `execute`
  prints. The predicate was wrong, not the machine.
- **Un-finish `done` on rollback.** Rejected as above: a second rule for leaving `done`, made
  silently, on an emergency path.
- **A `POST …/cutover/rollback` route.** Rejected as above; revisit together with an execute
  route, if the API ever grows one.
