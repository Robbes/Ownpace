# Cutover Runbook

Step-by-step operator procedure for executing and managing a migration
cutover with the cutover CLI.

> **Read this first — what the tool does and does not do.** The stack's DNS
> stance is **verify-only** (owner decision 2026-07-16): the CLI reads and
> checks DNS but **never writes it**. Switching the MX record — and reverting
> it on a rollback — is **your manual step**, guided by the generated DNS
> runbook (`runbook` subcommand) and confirmed by the CLI's checks. Any older
> copy of this document claiming `execute` "updates DNS records" or rollback
> "restores previous DNS records" was wrong; see
> [`rollback-mechanisms.md`](./rollback-mechanisms.md) for the full list of
> deliberate gaps.

## Overview

A cutover is the final phase of a migration:

1. All data has been synchronized (shadow passes complete).
2. The verification gate (§20) has passed: DNS **and** data completeness.
3. **You** switch the MX/DNS records to the new system.
4. A grace period is monitored for issues; then the cutover is completed.

## Prerequisites

Before starting a cutover, ensure:

- ✅ Shadow migration has completed and is current
- ✅ Verification checks pass (`verify` — DNS and data completeness)
- ✅ DNS TTLs have been lowered (300 seconds recommended, 24h before)
- ✅ Stakeholders have been notified of the maintenance window
- ✅ The rollback procedure — including its manual DNS step — is understood

## Cutover states

The persisted state machine (`packages/core/src/cutover-state.ts`, enforced
by `CutoverStore` — an invalid transition throws):

```
PREPARING → READY_FOR_CUTOVER → APPROVED → CUTOVER_IN_PROGRESS → GRACE_PERIOD → COMPLETED
    ↑                                            │                    │
    ├─(retry from FAILED)                        ├──→ FAILED ←────────┤
    └─(attempt again after ROLLED_BACK)          └──→ ROLLED_BACK ←───┘
```

- **PREPARING** — initial state, pre-cutover checks in progress
- **READY_FOR_CUTOVER** — all `verify` checks passed (the CLI advances this
  itself on a green run)
- **APPROVED** — explicitly approved for execution (`approve --yes`)
- **CUTOVER_IN_PROGRESS** — waiting for **your** DNS change to propagate
- **GRACE_PERIOD** — DNS switched and confirmed; both systems live, operator
  monitoring; rollback still accepted
- **COMPLETED** — terminal. Closed out with `complete --yes`; `rollback` is
  no longer accepted from here
- **ROLLED_BACK** — a setback (ADR-0047), not the end; reached from
  `CUTOVER_IN_PROGRESS` or `GRACE_PERIOD` (and from `APPROVED`/`FAILED`). The
  mapping is syncing again with the source live. **A second attempt is
  `start-cutover`** (`ROLLED_BACK → PREPARING`, decided 2026-09-20, 0009 T8):
  prepare, `verify`, `approve --yes`, `execute --yes` as the first time. Mail
  that reached the target during the cutover window stays on the target
- **FAILED** — e.g. DNS propagation timeout; retry (back to PREPARING) or
  roll back

## Commands

All commands run from the repo root with `pnpm exec tsx` (the repo uses
`tsx`, not `ts-node`). Every command needs `DATABASE_URL` set **except**
`runbook`, which is a pure local computation. State-changing commands
(`approve`, `execute`, `complete`, `rollback`) **require `--yes`** — without
it they print exactly what they would do and exit non-zero, and the ledger
is not touched.

### Generate the DNS runbook (start here)

The exact records to change — before/after, MX/SPF/DKIM/DMARC/autodiscover —
matching what `verify` then checks. No database needed:

```bash
pnpm exec tsx apps/worker/src/cli/index.ts runbook \
  --domain example.com --target mail.example.com > dns-runbook.md
```

### Start cutover

```bash
pnpm exec tsx apps/worker/src/cli/index.ts start-cutover \
  --tenant <tenant-id> \
  --mapping <mapping-id> \
  --domain example.com \
  --target mail.example.com
```

Idempotent, and it says what it found: on a ledger that already exists it
names the state and the next step and changes nothing; on `FAILED` it retries
and on `ROLLED_BACK` it attempts again (either `→ PREPARING`, recorded with
the attempt number; the earlier attempt stays in the trail — 0009 T8); on
`COMPLETED` it refuses out loud — terminal, one ledger per mapping.

### Run verification

```bash
pnpm exec tsx apps/worker/src/cli/index.ts verify \
  --tenant <tenant-id> \
  --mapping <mapping-id> \
  --domain example.com
```

Two legs, both real:

- **DNS** — MX (blocking), SPF/DKIM/DMARC/autodiscover (warnings).
- **Data completeness — the §20 gate** (blocking): ledger counts vs a target
  reindex with checksum sampling, across all four domains. A domain that
  cannot be read reports `NOT_VERIFIABLE` and **blocks** — a gate that could
  not run has not passed.

On a fully green run the CLI advances `PREPARING → READY_FOR_CUTOVER` itself
(that is the verification's own outcome, not a `--yes` action). Exit code 0
only when everything passed.

### Approve cutover

```bash
pnpm exec tsx apps/worker/src/cli/index.ts approve \
  --tenant <tenant-id> \
  --mapping <mapping-id> \
  --domain example.com \
  --yes
```

Requires state `READY_FOR_CUTOVER`.

### Execute cutover

```bash
pnpm exec tsx apps/worker/src/cli/index.ts execute \
  --tenant <tenant-id> \
  --mapping <mapping-id> \
  --domain example.com \
  --target mail.example.com \
  --yes
```

Requires state `APPROVED`. This will:

1. **Stop the shadow sync**: the mapping goes `active` (or `paused`) → `cutover`,
   recorded in `audit_log` — no pass runs after this, and the source is no
   longer the authority on what exists ([ADR-0048](./adr/0048-the-mapping-hears-the-cutover.md)).
   A `continuous` mapping keeps copying, by design; a `done` one is left alone
   with a warning that a rollback will be refused for it. Without `--yes` the
   command prints what it would do to *this* mapping and exits.
2. Transition to `CUTOVER_IN_PROGRESS` — after the mapping, so a failure between
   the two leaves a state a re-run finishes.
3. Print **`MANUAL STEP REQUIRED`** — the command does **not** change DNS.
   Point the domain's MX record at the target now (records in the generated
   DNS runbook).
4. Poll for propagation of your change (up to 10 attempts, 30s intervals).
5. On confirmation, transition to **`GRACE_PERIOD`** — not COMPLETED; the
   grace window is a real state and rollback is still possible from it.
6. On propagation timeout, transition to `FAILED`. The mapping stays `cutover`
   — whether the MX record moved is exactly what is unknown, so no pass runs;
   `rollback --yes` puts it back to syncing.

### Complete cutover (after the grace period)

```bash
pnpm exec tsx apps/worker/src/cli/index.ts complete \
  --tenant <tenant-id> \
  --mapping <mapping-id> \
  --domain example.com \
  --yes
```

Requires state `GRACE_PERIOD`. Marks the cutover `COMPLETED` — terminal;
`rollback` is no longer accepted afterwards, so run this only when the grace
window is genuinely over. A mapping still `active` (a cutover executed before
ADR-0048) is stopped on the way, so nothing keeps syncing behind a closed
ledger. **This closes the cutover ledger, not the migration**: the mapping
stays `cutover`, and finishing it (`done`, which checks unresolved failures)
or keeping it copying (`continuous`) is the Finish page's decision.

### Rollback cutover

```bash
pnpm exec tsx apps/worker/src/cli/index.ts rollback \
  --tenant <tenant-id> \
  --mapping <mapping-id> \
  --domain example.com \
  --yes
```

A rollback is a **setback** ([ADR-0047](./adr/0047-a-rollback-is-a-setback.md)):
the cutover goes to `ROLLED_BACK` in the ledger, and a mapping that was
`cutover` (or `continuous`) goes back to `active` so the shadow sync resumes
with the source authoritative again. Without `--yes` it prints what it would
do to *this* mapping and exits; add `--reason "…"` to record why. What it does
to DNS is **nothing** — reverting the MX record is your manual step — and mail
already delivered to the target stays there. No notification is sent from the
CLI. The full honest list of what rollback does and does not do is in
[`rollback-mechanisms.md`](./rollback-mechanisms.md).

### Check status

```bash
pnpm exec tsx apps/worker/src/cli/index.ts status \
  --tenant <tenant-id> \
  --mapping <mapping-id> \
  --domain example.com
```

Read-only. Both halves, from the records that hold them: the ledger state with
the event that entered it (when, by whom, why), whether a rollback is admitted
from there, the **mapping's lifecycle** with what it means for the passes
(`cutover — stopped for the cutover; no pass runs …`, ADR-0048), when it
started and by whom, and the append-only event trail newest first.

## Pre-cutover checklist (24 hours before)

- [ ] Generate the DNS runbook and stage the record changes with your DNS
      provider (do not apply yet)
- [ ] Lower DNS TTL to 300 seconds for all relevant records
- [ ] Verify shadow migration is complete and up-to-date
- [ ] Run `verify` and confirm **all** checks pass (including the data gate)
- [ ] Notify end users of the upcoming maintenance window
- [ ] Confirm the rollback procedure — including the manual MX revert — is
      understood

## Cutover execution (during the maintenance window)

1. **Final verification:** `verify` — expect MX/SPF/DKIM/DMARC/autodiscover
   verified and `Data verification passed`. Fix and re-run on any FAIL; do
   not proceed.
2. **Approve:** `approve --yes`.
3. **Execute:** `execute --yes` — when it prints `MANUAL STEP REQUIRED`,
   apply the staged MX change at your DNS provider. The command waits for
   propagation and lands in `GRACE_PERIOD`.
4. **Confirm propagation independently:**
   ```bash
   dig MX example.com
   dig TXT example.com
   dig TXT _dmarc.example.com
   ```
5. **Verify mail flow:** send a test mail TO the domain (arrives in the new
   system) and FROM the new system (delivers externally, passes SPF/DKIM).

## Post-cutover (grace period)

During the grace period (typically 24–48 hours):

- Monitor mail flow and delivery failures
- Watch for user complaints or support tickets
- Keep the rollback procedure ready — `rollback --yes` is still accepted in
  this state

### Grace period end

1. Run `complete --yes` — the ledger records `COMPLETED`.
2. Restore DNS TTLs to normal values (e.g. 86400 seconds).
3. Archive/decommission the source per your plan (nothing was deleted there
   — rollback-before-completion was possible precisely because the source
   stayed intact).
4. Document any issues; notify stakeholders.

## Rollback procedure

If issues are detected during cutover or the grace period:

1. **Assess:** `status` — rollback is accepted from `CUTOVER_IN_PROGRESS`
   and `GRACE_PERIOD` (not from `COMPLETED`).
2. **Roll back the ledger:** `rollback --yes`.
3. **Revert DNS manually:** point the MX record back at the original mail
   server — the CLI prints this reminder and does not do it for you.
4. **Verify:** `dig MX example.com`; confirm mail flow on the original
   server.
5. Document the root cause; plan remediation. A `FAILED` or `ROLLED_BACK`
   cutover can be attempted again with `start-cutover` (`→ PREPARING`,
   recorded as the next attempt; the trail keeps the first). Until 2026-09-20
   a rolled-back cutover could not be attempted again without SQL (0009 T8).

## Troubleshooting

### DNS propagation failed

**Symptoms**: `execute` ends with "DNS propagation failed" and the state is
`FAILED`.

**Resolution**:
1. Did you actually apply the MX change? `execute` does not do it for you.
2. Check the record manually: `dig MX example.com` (against your provider's
   nameserver too: `dig MX example.com @ns1.provider.example`).
3. TTL still high? Wait it out or lower it and re-apply.
4. Retry: `start-cutover` moves a `FAILED` cutover back to `PREPARING`
   (until 2026-09-20 nothing did — `verify` only advances from `PREPARING`),
   then `verify`, `approve --yes`, `execute --yes`.

   The managed preparation job (`POST /api/migrations/{id}/cutover`, the
   Trigger.dev task `run-cutover`) converges on its own: on `FAILED`,
   `ROLLED_BACK` or `READY_FOR_CUTOVER` it records the way back to `PREPARING`
   (`retriedBy`, attempt number) and runs the final sync and the gate again;
   on a cutover under way or a completed ledger it refuses and writes nothing.
   The API door asks the same rule before it enqueues: a press that the job
   would refuse is answered 409 `cutover_refused` on the spot, and a 202
   says what the job will do (`preparation.from`, `resetsToPreparing`,
   `revokesApproval`). A gate FAIL is
   recorded once and not retried. Until 2026-09-20 a second run on a ready
   cutover marked it `FAILED`, and from `FAILED` the job could not run at all.

   The job's final sync is the ordinary pass, `run-delta-sync`, over every
   data type the migration has. It is queued behind any pass already running
   on the migration, and the job waits for it and logs a count per data type.
   When the pass did not finish a data type (it stopped at its deadline or at
   the day's download budget, or the migration was paused before it got
   there), the job names that data type and does not mark the cutover ready:
   the target is behind the source. That is recorded once and not retried;
   prepare again once the passes have caught up. Until 2026-09-24 the final
   sync copied mail only, and a migration without mail could not be prepared
   at all (workplan 0128 T1).

### Verification failed

**Symptoms**: `verify` reports FAIL and exits non-zero.

**Resolution**:
1. Review the specific failed check — DNS legs name the record; the data
   gate prints per-domain discrepancies and recommendations. The data gate
   checks the data types the migration has; one it does not have reads
   `SKIPPED` ("disabled in the config"), never as a failure.
2. Fix the underlying issue (missing DNS record, re-sync missing items).
3. Re-run `verify`. Do not proceed until it exits 0.

### Mail delivery issues post-cutover

**Symptoms**: users report not receiving/sending mail.

**Resolution**:
1. Check MX records point at the correct server.
2. Verify SPF/DKIM records (the DNS runbook has the expected values).
3. Check the target mail server's logs.
4. If critical and still inside the grace period: `rollback --yes` + revert
   the MX record manually.

## Related documentation

- [Rollback mechanisms](./rollback-mechanisms.md) — what rollback does and
  deliberately does not do
- [DNS management](./dns-management.md) — the manual DNS steps and the
  verify-only decision
- [Cutover communication templates](./cutover-communication-templates.md) —
  EN/NL user comms (sending them is manual)
- [Solution Architecture](./architecture/solution-architecture.md) §11
- [Workplan 0009](./workplans/0009-cutover-integration.md) — cutover
  integration, incl. the verify-only DNS owner decision
