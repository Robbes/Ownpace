# Workplan 0017 — `apply` and `verify` in the managed edition

## Status — 2026-07-31 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Decide the shape (sync, poll, or stream) | ✅ **Decided: start + poll, one contract, both editions** | Below. The alternatives and why they lose are recorded rather than re-litigated. |
| T1 Contract: `VerificationRunReport` + `VerifyStartResponse` in `@openmig/shared` | ✅ **Done** (verify half) | `operating-contract.ts`: the four-state run report and the idempotent-start response. `ApplyReceipt` waits for T4, where its real shape will be dictated by the job. |
| T2 Self-host serves the new pair (keeping today's behaviour working) | ✅ **Done** | `POST /verify/start` (202 new run / 200 joined — the `activated: false` shape) + `GET /verify/report`; one run at a time, report swapped whole so a poller never sees a hybrid; `failed` carries the reason (hard rule 9). Synchronous `GET /verify` kept for one release — the e2e verification gate still uses it. 7 lifecycle tests against a real appliance on PGlite, with a silent-TCP-server target so "a second start joins the run" is deterministic rather than raced. |
| T3 `run-verification` Trigger.dev job + managed routes | ⬜ Not started | Needs T1. |
| T4 `run-apply-deletion` job + managed routes | ⬜ Not started | Needs T1. The destructive one — do it last and on its own. |
| T5 The Verify screen starts and polls instead of blocking | ✅ **Done** | `Verify.tsx` POSTs `/verify/start` and polls `/verify/report` every 3 s; the 15-minute single-request GET is gone from the client. The loop stops on every terminal state (mutation-verified), `failed` renders as not-a-result with the reason, a mid-run appliance restart (`never-run` while polling) is said out loud instead of spun against forever, and a missed poll keeps polling — the run's state is authoritative, not the network. 5 jsdom tests. |
| T6 `verification.status` cannot hold two of the five statuses | ⬜ Not started | A migration. See "The schema does not fit the contract". |

## Why this exists

[ADR-0026](../adr/0026-one-operating-ui-one-contract.md) closed the gap between
the two editions' operating surfaces — one React UI, one contract, served by
both — and left exactly two holes, on purpose:

> **`apply` and `verify` are deliberately not in the managed API.** Both touch
> the target … They need a job and an async result shape, which is a deliberate
> piece of work rather than a line in a route file; until then the managed
> edition has no `apply` and no `verify` screen, which is an honest gap rather
> than a broken button.

An honest gap is still a gap, and it is the *last* one. Concretely, today:

- `apps/web/src/pages/Verify.tsx` calls `GET /verify` with a **15-minute HTTP
  timeout**. That works on the appliance, where verification runs in the same
  process. On managed there is no such route, so the screen cannot be shown at
  all.
- `/mappings/{id}/deletions/{hash}/apply` — the one destructive route in the
  product (ADR-0024) — exists only on the appliance. A managed customer who
  confirms a deletion has no way to act on it.

This workplan is what turns "deliberately not there" into "there", and it is
written down so the decision does not get re-taken from scratch every time
somebody notices the missing screen.

## T0 — the shape, decided

**Start + poll. `POST` begins the work, `GET` reports on it, both editions
implement both verbs, and the response says which of the three states it is in.**

```ts
type VerificationReport =
  | { readonly state: 'never-run' }
  | { readonly state: 'running'; readonly startedAt: string }
  | {
      readonly state: 'done';
      readonly startedAt: string;
      readonly finishedAt: string;
      readonly report: ByMapping<VerificationResult>;
    }
  | { readonly state: 'failed'; readonly startedAt: string; readonly error: string };
```

### Why not keep the synchronous `GET /verify`

It is the smallest change and it is wrong on managed for three separate reasons,
any one of which is sufficient:

1. **Connector credentials in the API process.** Managed's API holds none today;
   target I/O lives in the worker behind Trigger.dev (ADR-0004). Verification
   opens every enabled domain's target. Doing it in a request thread moves
   secrets into a process that has deliberately never had them.
2. **A 15-minute request is not a request.** Verification counts and samples
   every domain of a real mailbox. Any load balancer, ingress, or browser in the
   path will cut it, and the failure mode is a blank screen with no way to know
   whether the work is still running.
3. **The two editions would differ in the operation that decides cutover.** §20
   is the gate somebody points at when asked "did everything arrive?". A gate
   that behaves differently per edition is worse than a gate that is absent.

### Why not stream (SSE/WebSocket)

It reads better and buys nothing here. The result is one report at the end, not
a progress feed anybody acts on mid-flight, and it would add a long-lived
connection to an appliance whose whole design story is "no moving parts". Poll
every few seconds; the work takes minutes.

### Why `POST` starts it, and `GET` never does

The Verify screen already encodes this and the reasoning is in its header:
opening the page must not start a target-wide scan. Keeping the verbs honest —
`GET` is safe and idempotent, `POST` is the thing with a cost — is what lets the
screen be a normal page instead of a trapdoor.

### What self-host does with it

Runs it in the background in-process and holds the last report. Self-host has no
job queue, and does not need one: it is single-tenant and the appliance is the
only thing running. **Today's synchronous `GET /verify` stays** for one release,
returning the same body, so the e2e gates and any operator script that curls it
keep working (hard rule 5) — with the new pair alongside. Remove it only once
nothing calls it.

The report survives a restart on managed (it is a row) and does **not** on
self-host (it is a field). That asymmetry is fine and should be stated in the
contract: `never-run` after a restart is truthful, and re-running is cheap
relative to a migration.

## T4 — `apply`, which is not just "verify but destructive"

`applyMappingDeletion` refuses for eight distinct reasons, and **most of them
are decided against the ledger, not the target**: not confirmed, evidence merely
inferred, already applied, the mapping did not opt in
(`allowApplyDeletions`), the item is not ours, the target owner has since
edited it, the mass-deletion breaker is open. Only the removal itself is target
I/O.

That matters for the UX. A refusal is an *answer to the operator's question* and
must come back on the request they made — `403` with the reason, exactly as the
appliance does today. Deferring a refusal into a job result would turn "you may
not do that, here is why" into "check back later", for the one operation where
being told immediately is the point.

So: **the managed route evaluates every ledger-side gate synchronously and only
enqueues once it has decided the removal is permitted.** The job's job is the
target call. The receipt is polled the same way as verification, per item.

Do this after T3, in its own change, with its own review. It is the only route
in the product that destroys data.

## The schema does not fit the contract (T6)

`verification` already exists in `0001_baseline.sql` — per-domain rows with
counts, bytes, sample counts and a status. Two problems:

```sql
CONSTRAINT verification_status_check CHECK ((status = ANY (ARRAY['pass','warn','fail'])))
```

- `DataTypeVerificationStatus` has **five** members. `SKIPPED` (the domain is
  turned off) and `NOT_VERIFIABLE` (the domain is on and the target cannot be
  read) do not fit, and they are the two the Verify screen is most careful
  about — the page explicitly refuses to render `NOT_VERIFIABLE` as a warning,
  because nobody checked.
- There is no room for the run-level state (`running`, `failed`, `startedAt`),
  only per-domain results.

Widening the CHECK is a migration and it touches the managed edition, so it is
its own task rather than a line inside T3. Persisting a `NOT_VERIFIABLE` domain
as `fail` to fit the existing constraint would be the exact softening the UI was
written to avoid — do not do it as a shortcut.

## Hard rules that bite here

- **Rule 5 — self-host must keep working.** No `@trigger.dev` import may reach
  `apps/selfhost` or `packages/*`. `no-managed-leakage.unit.test.ts` enforces
  this; the background runner for T2 belongs in `apps/selfhost`, not in a shared
  package that then imports a scheduler.
- **Rule 9 — never mask errors.** `state: 'failed'` carries the reason. A
  verification that could not run must not read as a verification that found
  nothing wrong.
- **Rule 2 / ADR-0024 — non-destructive by default.** T4 changes nothing about
  what `applyMappingDeletion` permits. It gives the managed edition a way to
  reach the same gates, not a second set of them.
