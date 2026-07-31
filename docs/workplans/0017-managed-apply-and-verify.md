# Workplan 0017 — `apply` and `verify` in the managed edition

## Status — 2026-07-31 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 Decide the shape (sync, poll, or stream) | ✅ **Decided: start + poll, one contract, both editions** | Below. The alternatives and why they lose are recorded rather than re-litigated. |
| T1 Contract: `VerificationRunReport` + `VerifyStartResponse` in `@openmig/shared` | ✅ **Done** (verify half) | `operating-contract.ts`: the four-state run report and the idempotent-start response. `ApplyReceipt` waits for T4, where its real shape will be dictated by the job. |
| T2 Self-host serves the new pair (keeping today's behaviour working) | ✅ **Done** | `POST /verify/start` (202 new run / 200 joined — the `activated: false` shape) + `GET /verify/report`; one run at a time, report swapped whole so a poller never sees a hybrid; `failed` carries the reason (hard rule 9). Synchronous `GET /verify` kept for one release — the e2e verification gate still uses it. 7 lifecycle tests against a real appliance on PGlite, with a silent-TCP-server target so "a second start joins the run" is deterministic rather than raced. |
| T3 `run-verification` Trigger.dev job + managed routes | ✅ **Done** | `apps/worker/src/jobs/run-verification.ts` runs the SAME gate as the cutover job (per-domain reindexers, ledger reader, read-only) and lands the outcome on the `verification_run` row — done with the wire-shaped report as jsonb, failed with the reason, never left 'running' forever (an enqueue failure lands the row failed from the route, so a poller never waits on a job that was never queued). Routes: `POST /:mappingId/verify/start` (202 / 200-joined, the short-circuit answers before any enqueue) + `GET /:mappingId/verify/report`, same wire shapes as the appliance. 5 registration tests (verify now asserted PRESENT as the pair and absent as a sync endpoint), 7 integration tests over every row shape incl. latest-wins and tenant scoping. Live enqueue follows the discovery suite's precedent — needs a Trigger.dev backend CI does not run. |
| T4 `run-apply-deletion` job + managed routes | ✅ **Done — its own change, as ordered** | The route answers every LEDGER-side gate synchronously via `evaluateApplyDeletion` — the same 403/404 + code + reason the appliance sends — and only a permitted removal gets a receipt and a job. The evaluator deliberately duplicates the destructive path's gates rather than reordering them, and `apply-deletion-evaluate.unit.test.ts` is the drift-lock: both functions run against the same ledger for every ledger-side case, same code required, target-spy asserted untouched on every refusal (9 tests). `0004_managed_apply.sql` gives the flag a home (`mailbox_mapping.allow_apply_deletions`, DEFAULT FALSE — the safety property, tested end to end: a confirmed item is still 403 while the column is unset) and the receipt a table (self-lying rows refused by CHECK). The job re-runs ALL gates freshly and lands applied/refused/failed on the receipt — never left queued, incl. the enqueue-death branch, which the integration suite reaches by fault-injecting the ONE seam (a Trigger.dev client whose enqueue throws) and asserting real route code: 502, receipt landed `failed` with the reason, mapper serving it. 9 integration tests; the live (successful) enqueue stays untested per the discovery/verify precedent. Self-review caught the first push's suite failing in CI — the seeds invented `item_type`/`target_id` columns, so all 8 tests skipped; seeds now match the real schema (`domain` doubles as the type, the handle lives in `target_ref` jsonb) and are validated against the migrated schema on PGlite before push. Racing double-POSTs can still double-enqueue (the joined short-circuit is read-then-insert): accepted — both jobs re-run every gate and gate 7's conditional UPDATE lets exactly one record, the same convergence the appliance relies on for concurrent requests. |
| T5 The Verify screen starts and polls instead of blocking | ✅ **Done** | `Verify.tsx` POSTs `/verify/start` and polls `/verify/report` every 3 s; the 15-minute single-request GET is gone from the client. The loop stops on every terminal state (mutation-verified), `failed` renders as not-a-result with the reason, a mid-run appliance restart (`never-run` while polling) is said out loud instead of spun against forever, and a missed poll keeps polling — the run's state is authoritative, not the network. 5 jsdom tests. |
| T6 `verification.status` cannot hold two of the five statuses | ✅ **Done — and the run table with it** | `0003_verification_fits_the_contract.sql`: the CHECK now admits all five statuses (`skipped`, `not_verifiable` were unstorable — exactly the two the UI refuses to soften), and `verification_run` exists for the run-level truth managed must persist (state/started/finished/error/report jsonb), with a CHECK that refuses rows that lie about themselves (running-with-finish, terminal-without). RLS + FORCE + grants match every other table; the `force-rls` catalog audit covers it by name (mutation-verified — dropping FORCE fails naming `verification_run`). 6 schema tests. |

## Follow-ups this plan now owns

- **The managed Verify screen.** T3 gives managed the endpoints and T5 gives
  the screen the start + poll loop — but the screen calls the appliance's flat
  paths (`/verify/start`), and managed's are per-mapping
  (`/api/migrations/:id/verify/start`). Wiring the managed screen means the
  same `*PathFor(edition, mappingId)` treatment the queue screens already have
  (`services/edition.ts`), plus a route in App.tsx. Until then the managed
  endpoints are curl-able and job-backed but have no screen — an honest gap,
  same shape ADR-0026 used to record for the endpoints themselves.
- **Retiring the appliance's synchronous `GET /verify`** once the e2e
  verification gate moves to the pair — T2 kept it for exactly one release.
- **Deploying the Trigger.dev v4 tasks.** T3/T4 give managed its jobs
  (`run-verification`, `run-apply-deletion`) and the routes enqueue them — but
  the repo still has no `trigger.config.ts` and no `trigger deploy` step
  (recorded since 0011 T7 in `managed-scheduler.ts`'s header), so on a live
  stack every enqueue takes the designed failure branch: the run/receipt lands
  `failed` with "Could not enqueue …" and the caller gets a 502. Syncs have the
  polling `managed-scheduler` as an interim; verify and apply have no interim —
  they are the first operator-visible features whose happy path NEEDS the
  deployment step (a `trigger.config.ts`, a deploy registry the compose stack
  references but does not run, and `trigger deploy` against `trigger-api`).
  Until that lands, the live stack proves the routes, migrations, state
  machines, and the never-left-running/queued property — not the job loop.

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
