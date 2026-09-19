# Rollback Mechanisms

How a cutover is reverted, and — just as importantly — **what rollback does not do for you**.

> **Read this before relying on rollback.** A rollback is a **setback** ([ADR-0047](./adr/0047-a-rollback-is-a-setback.md)):
> the cutover ledger goes to `ROLLED_BACK` and the mapping goes back to syncing with the original
> source authoritative again. DNS restore is **not automated** — reverting the MX record is a
> **manual operator step**. Mail already delivered to the target **stays on the target**. Email
> notification IS available (workplan 0030 T4) but is **off unless you ask for it** and goes to the
> configured notification recipients, not to end users. See "What rollback does not do" below.

## The one rollback, and its two doors

There is **one** implementation — `performRollback` in `@openmig/core`
(`packages/core/src/cutover-rollback.ts`) — and two ways to reach it. Both do exactly the same
thing in exactly the same order. (Until 2026-09-19 there were two implementations, and the one an
operator could reach did not resume the sync; workplan 0101 T5 has the finding.)

| Entry point | Where | Who uses it |
|---|---|---|
| `rollback` CLI subcommand | `apps/worker/src/cli/cutover-commands.ts` | an operator at a terminal — self-host, or managed |
| `run-rollback` Trigger.dev task | `apps/worker/src/jobs/run-rollback.ts` | managed, from the Trigger.dev dashboard; it is the door that can also notify |

Neither is reachable from the API or the web UI, on purpose: the API is prepare-only for cutovers
(`POST …/cutover` verifies and stops at `READY_FOR_CUTOVER`), and nothing there executes one either.

### What `performRollback` does, in order

1. **Loads the cutover state** — refuses if there is none (`No cutover state found — nothing to
   roll back`), and refuses if the state machine does not admit `ROLLED_BACK` from the current
   state (see "Valid states" below). Nothing is written on a refusal.
2. **Decides the mapping half** (`rollbackTransition` in `@openmig/shared`) — and refuses, before
   any write, if the mapping is `done`: finishing is the end of the shadow sync and a rollback does
   not undo it.
3. **Sets the mapping back to `active`** when it was `cutover` or `continuous`, so shadow sync
   resumes with the original source authoritative again. *This is the real, in-scope rollback
   action.* A mapping that is already `active` (the common case after a CLI-driven cutover, which
   never changes the mapping) or `paused` is left alone, and the output says so. The change is
   recorded in `audit_log` as `mapping.status` with `via: 'rollback'`, in the same transaction as
   the row.
4. **Transitions the cutover to `ROLLED_BACK`**, recording `rolledBackAt`, `rolledBackBy`, the
   reason, and whether the sync resumed, in the append-only event log. This is deliberately *after*
   step 3: `ROLLED_BACK` is terminal, so the write that can be retried comes first.
5. **Says out loud that mail on the target stays there.**
6. **Notification — only if asked for**, and only the job offers it. `notifyUsers: true` sends the
   rollback notice through the product's notification channel (workplan 0030). It defaults to
   **false**: a rollback is an emergency action, and mail to every configured recipient is not
   something to do because nobody said not to. If the flag is set and **no SMTP is configured**,
   the job refuses *before* any rollback action, naming the missing settings. If the send fails
   *after* the rollback, the failure is logged loudly and the rollback still reports success: it
   did succeed, and a mail server being down must not tell you otherwise. Tell people by hand when
   you see that line.

DNS is **not** in that list. The job logs a reminder if `restoreDns`/`dnsDomain` are passed; it
performs no restore.

## What rollback does **not** do

These are deliberate gaps, not bugs. Do not plan a cutover assuming otherwise.

- **DNS records are not restored.** The owner decision of 2026-07-16 is **verify-only DNS**: the
  stack reads and verifies DNS but never writes it. The deSEC adapter and its ~950-line write path
  were **deleted** on 2026-08-05 (commit `4f05136`, workplan 0026 T3 row 20), so the reason is
  *the code does not exist* rather than *it exists and is unwired*. **Revert the MX record
  manually**, then confirm with the verify-only checks — see [`dns-management.md`](./dns-management.md)
  and the `runbook` CLI subcommand.
- **Mail delivered to the target is not brought back.** While MX pointed at the target, mail was
  delivered there. The resumed sync runs source → target and will never carry those messages back,
  and by the owner's definition it is not going to try — that would mean writing to a source this
  product only ever reads. Recover it from the target by hand if you need it.
- **A finished migration is not un-finished.** A mapping in `done` is refused (nothing is written,
  not the ledger either). If the source must be live again, revert MX by hand; resuming the copy
  into that target would need the lifecycle to allow leaving `done`, which it does not today.
- **End users are not notified.** The `notifyUsers` flag emails the addresses the notification
  channel is configured with — the operator/owner recipients — **not** the people whose mailboxes
  moved. Notify them through your own channel; templates are in
  [`cutover-communication-templates.md`](./cutover-communication-templates.md).
- **Data is not restored from a backup.** Rollback is *non-destructive by design* — nothing was
  deleted on the source during cutover, so there is nothing to restore. The source mailbox is still
  intact and becomes authoritative again at step 3. Anything written to the **target** after
  cutover is surfaced as a decision, never auto-copied back (arch doc §11.1).

## Valid states for rollback

The state machine (`packages/core/src/cutover-state.ts`) is the authority, and `canRollback` is
derived from it. Rollback is accepted from:

- `APPROVED` — approved but not yet executed (revoking the approval with a re-prepare is usually
  the better move; this is allowed and ends in the terminal `ROLLED_BACK`)
- `CUTOVER_IN_PROGRESS` — during active cutover
- `GRACE_PERIOD` — during grace-period monitoring
- `FAILED` — where `execute` lands a propagation timeout, printing *"Consider rollback."*

and rejected from `PREPARING`, `READY_FOR_CUTOVER`, `COMPLETED` and `ROLLED_BACK`. A cutover's
`rollbackAvailable` field, on every read, is this same answer.

## Usage

### CLI (self-host / operator)

```sh
pnpm exec tsx apps/worker/src/cli/index.ts rollback \
  --yes \
  --tenant <tenantId> --mapping <mappingId> --domain example.com \
  --reason "mail bouncing at the new server"
```

Without `--yes` it prints what it would do to *this* mapping — including whether the sync will
resume or why it will be left alone — and exits non-zero. `--reason` is optional and lands in the
cutover's event trail (the `audit_log` row records the transition and the actor, not the reason).
Then check the resulting state and event trail:

```sh
pnpm exec tsx apps/worker/src/cli/index.ts status \
  --tenant <tenantId> --mapping <mappingId> --domain example.com
```

### Managed (Trigger.dev)

The `run-rollback` task takes `{ tenantId, mappingId, reason, options }`, where `options` carries
`restoreDns` / `dnsDomain` / `notifyUsers`. `restoreDns: true` logs the manual-step reminder — it
does not perform a restore. `notifyUsers: true` sends the rollback notice (EN or NL, per
`NOTIFY_LOCALE`) and refuses up front if the channel is unconfigured, as described in step 6.

## Audit trail

Every rollback writes to the append-only `cutover_event` log — state transitions, the reason, who,
and whether the sync resumed — and, when it changed the mapping, one `mapping.status` row in
`audit_log` naming the actor, the transition and `via: 'rollback'`. Read the cutover trail back with
the `status` subcommand or `CutoverStore.getEventHistory(tenantId, mappingId, limit)`. Errors are
surfaced verbatim (hard rule 9), never swallowed into an empty result.

## Related documentation

- [ADR-0047 — a rollback is a setback](./adr/0047-a-rollback-is-a-setback.md) — the decision
- [Cutover runbook](./cutover-runbook.md) — the end-to-end operator procedure
- [Cutover communication templates](./cutover-communication-templates.md) — EN/NL user comms
- [DNS management](./dns-management.md) — the manual DNS steps rollback depends on
- [Workplan 0101 T5](./workplans/0101-the-paths-no-gate-had-opened.md) — the finding that there
  were two
