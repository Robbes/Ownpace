# Rollback Mechanisms

How a cutover is reverted, and — just as importantly — **what rollback does not do for you**.

> **Read this before relying on rollback.** DNS restore and user notification are **not
> automated**. Rollback reactivates the mapping so shadow sync resumes; reverting the MX record
> is a **manual operator step**. See "What rollback does not do" below.

## The real rollback path

Two entry points, both driving the same persisted cutover state machine
(`cutover_state` / `cutover_event`, via `CutoverStore` in `packages/ledger/src/cutover-store.ts`):

| Entry point | Where | Used by |
|---|---|---|
| `run-rollback` Trigger.dev task | `apps/worker/src/jobs/run-rollback.ts` | managed edition (API `POST …/cutover` flow) |
| `rollback` CLI subcommand | `apps/worker/src/cli/cutover-commands.ts` | self-host / operator |

### What `run-rollback` actually does

1. **Load cutover state** — fails loudly if there is none (`No cutover state found - nothing to rollback`).
2. **DNS — skipped, and says so.** Logs that DNS restore is deferred and the operator must revert
   the MX record by hand. It does **not** claim a restore it did not perform.
3. **Reactivate the mapping** (`status → active`) so shadow sync resumes with the original source
   authoritative again. *This is the real, in-scope rollback action.*
4. **Transition cutover state to `ROLLED_BACK`**, recording `rolledBackAt`, `rolledBackBy` and the
   reason in the append-only event log.
5. **User notification — skipped, and says so.** Not implemented; logged as such rather than faked.
6. **Cancel the pending grace-period task** — best-effort. Steps 3–4 are already committed, so a
   failed cancel must not flip a successful rollback to `FAILED`.

## What rollback does **not** do

These are deliberate gaps, not bugs. Do not plan a cutover assuming otherwise.

- **DNS records are not restored.** The owner decision of 2026-07-16 is **verify-only DNS**: the
  stack reads and verifies DNS but never writes it (workplan 0009 T4 deferred; the deSEC adapter in
  `packages/core/src/dns-provider-desec.ts` stays an unwired template). **Revert the MX record
  manually**, then confirm with the verify-only checks — see
  [`dns-management.md`](./dns-management.md) and the `runbook` CLI subcommand.
- **Users are not notified.** No email is sent. Notify affected users through your own channel;
  templates are in [`cutover-communication-templates.md`](./cutover-communication-templates.md).
- **Data is not restored from a backup.** Rollback is *non-destructive by design* — nothing was
  deleted on the source during cutover, so there is nothing to restore. The source mailbox is still
  intact and becomes authoritative again at step 3. Anything written to the **target** after
  cutover is surfaced as a decision, never auto-copied back (arch doc §11.1).

## Valid states for rollback

Rollback is accepted from:

- `CUTOVER_IN_PROGRESS` — during active cutover
- `GRACE_PERIOD` — during grace-period monitoring

and rejected from `PREPARING`, `READY_FOR_CUTOVER`, `COMPLETED`, `ROLLED_BACK`, `FAILED`.

## Usage

### CLI (self-host / operator)

```sh
pnpm exec tsx apps/worker/src/cli/index.ts rollback \
  --yes \
  --tenant <tenantId> --mapping <mappingId> --domain example.com
```

Then check the resulting state and event trail:

```sh
pnpm exec tsx apps/worker/src/cli/index.ts status \
  --tenant <tenantId> --mapping <mappingId> --domain example.com
```

### Managed (Trigger.dev)

The `run-rollback` task takes `{ tenantId, mappingId, reason, options }`, where `options` carries
`restoreDns` / `dnsDomain` / `notifyUsers`. Those flags are honoured only as far as the gaps above
allow: setting `restoreDns: true` logs the manual-step reminder, it does not perform a restore.

## Audit trail

Every rollback writes to the append-only `cutover_event` log — state transitions, the reason, and
the timestamps. Read it back with the `status` subcommand or
`CutoverStore.getEventHistory(tenantId, mappingId, limit)`. Errors are surfaced verbatim
(hard rule 9), never swallowed into an empty result.

## Related documentation

- [Cutover runbook](./cutover-runbook.md) — the end-to-end operator procedure
- [Cutover communication templates](./cutover-communication-templates.md) — EN/NL user comms
- [DNS management](./dns-management.md) — the manual DNS steps rollback depends on
- [Workplan 0009](./workplans/0009-cutover-integration.md) — cutover integration, incl. the
  verify-only DNS decision
