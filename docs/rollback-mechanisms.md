# Rollback Mechanisms

How a cutover is reverted, and — just as importantly — **what rollback does not do for you**.

> **Read this before relying on rollback.** DNS restore is **not automated**. Rollback reactivates
> the mapping so shadow sync resumes; reverting the MX record is a **manual operator step**. Email
> notification IS available as of 2026-08-03 (workplan 0030 T4) but is **off unless you ask for
> it** and goes to the configured notification recipients, not to end users. See "What rollback
> does not do" below.

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
5. **Notification — only if asked for.** `notifyUsers: true` sends the rollback notice through the
   product's notification channel (workplan 0030). It defaults to **false**: a rollback is an
   emergency action, and mail to every configured recipient is not something to do because nobody
   said not to. If the flag is set and **no SMTP is configured**, the job refuses *before* any
   rollback action, naming the missing settings — so nothing has happened yet and you can resubmit
   without the flag. If the send fails *after* the rollback, the failure is logged loudly and the
   rollback still reports success: it did succeed, and a mail server being down must not tell you
   otherwise. Tell people by hand when you see that line.
6. **Cancel the pending grace-period task** — best-effort. Steps 3–4 are already committed, so a
   failed cancel must not flip a successful rollback to `FAILED`.

## What rollback does **not** do

These are deliberate gaps, not bugs. Do not plan a cutover assuming otherwise.

- **DNS records are not restored.** The owner decision of 2026-07-16 is **verify-only DNS**: the
  stack reads and verifies DNS but never writes it. This bullet said the deSEC adapter in
  `packages/core/src/dns-provider-desec.ts` "stays an unwired template"; that file was **deleted**
  on 2026-08-05 (commit `4f05136`, workplan 0026 T3 row 20), along with the ~950-line write path.
  The conclusion is unchanged — DNS is not restored — but the reason is now *the code does not
  exist* rather than *it exists and is unwired*, which matters to anyone who would otherwise go
  looking for it to switch it on. **Revert the MX record manually**, then confirm with the
  verify-only checks — see
  [`dns-management.md`](./dns-management.md) and the `runbook` CLI subcommand.
- **End users are not notified.** The `notifyUsers` flag emails the addresses the notification
  channel is configured with — the operator/owner recipients — **not** the people whose mailboxes
  moved. Nothing in this product mails your customers' users. Notify them through your own channel;
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
`restoreDns` / `dnsDomain` / `notifyUsers`. `restoreDns: true` logs the manual-step reminder — it
does not perform a restore. `notifyUsers: true` sends the rollback notice (EN or NL, per
`NOTIFY_LOCALE`) and refuses up front if the channel is unconfigured, as described in step 5.

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
