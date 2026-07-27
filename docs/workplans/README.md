# Workplans — index & sequencing

Ground rules (AGENTS.md): read `docs/architecture/solution-architecture.md` first; a workplan's
**Status block is ground truth** and must be updated with evidence at session end. This index
adds the cross-plan view: what is verifiably done, what each plan depends on, and in which order
to execute.

**Policy: workplans are never deleted.** Like ADRs they are append-only history — a replaced
plan gets a ⚠️ SUPERSEDED banner pointing to its successor (0003→0007, 0004→0009, 0005→0011)
and stays put, preserving the evidence trail and inbound links.

## State of the stack (verified against code, 2026-07-27, `main` post-#120)

Since the last index refresh (post-#73), PRs #74–#120 merged: closed out **0011 T7** (managed
compose DoD, live-verified with real evidence) and its file/WebDAV domain follow-up (#119), and
**closed 0010 T5** (the restart-resume idempotency gate, all three proven domains) — both were
the last open acceptance items blocking their plans. **0013 was already fully done** (T1–T8) but
this index hadn't reflected that until now. Verified state:

| Plan | Subject | Verified state |
|---|---|---|
| [0001](./0001-first-slice-jmap-mail.md) | O365 → JMAP mail slice | ✅ Done. |
| [0002](./0002-imap-dav-target.md) | IMAP/DAV mail target family | ✅ Done. |
| [0003](./0003-caldav-carddav-webdav.md) | Calendar/contacts/files | ⚠️ Superseded by **0007** (done there). |
| [0004](./0004-cutover-dns.md) | Cutover & DNS | ⚠️ Superseded by **0009**. |
| [0005](./0005-implementation-summary.md) | Managed edition | ⚠️ Superseded by **0011**. |
| [0006](./0006-intermediate-remediation.md) | Intermediate remediation | ✅ **Done** — tests renamed so they run, `mollie-api-node` removed, CI uses `ubuntu-latest` for PRs (Spark only on push), root compose removed → `deploy/compose/managed.yml`, deployment case-collision resolved, caveman skill moved to `.agents/`. |
| [0007](./0007-multi-domain-sync-completion.md) | Multi-domain sync (cal/contacts/files) | ✅ **Done** — worker `runAllDomains` orchestrates all domains independently with status tracking; native DAV sources integration-tested. **Approach changed:** the `GenericSyncEngine`/`runUnifiedSync` were removed (PR #38); real impl is `packages/core/src/domain-sync.ts` (see `docs/design/domain-sync.md`). |
| [0008](./0008-o365-graph-source.md) | Production O365 source | ✅ **Reported done** — `MsalTokenProvider`, Graph calendar/contacts/drive sources, `ThrottleLimiter`, secret-gated e2e harness all present. The 24 h real-tenant soak is manual/secret-gated (not verifiable from the repo). |
| [0009](./0009-cutover-integration.md) | Cutover made real | ✅ **Done** — T1/T2/T3/T5/T6 done & integration-tested (**T3 closed 2026-07-27**, PR #131: DKIM wired into `verifyAllDns`, the runbook generator made reachable as a `runbook` CLI subcommand, 25 unit tests added). **Owner decision (2026-07-16): verify-only DNS** → T4 (deSEC provider writes) deferred. **T2's `--yes` approval gate closed 2026-07-27** — a doc audit found it had been marked done while absent (`rollbackCutover()` printed a confirmation prompt and proceeded regardless); `approve`/`execute`/`rollback` now refuse without `--yes`, covered by 7 unit tests asserting the ledger is not mutated without it. **Nothing open in this plan.** |
| [0010](./0010-selfhost-edition.md) | Self-host edition | ✅ **T1–T6 all done — fully closed 2026-07-27.** (PRs #62/#63 packaging+docs, #64 pool-leak, #65/#70/#73 review+T5, #120 T5 seed-date fix). `apps/selfhost/src/index.ts` is a **real entrypoint** (migrate → load config dir → `InProcessScheduler` → `/healthz`+`/status` → graceful shutdown, all four domains, zero managed leakage); startup migration runner (`packages/ledger/src/migrate.ts`), bundled-Postgres compose + Dockerfile, env-file secrets all present. **T5 (the §5 acceptance centerpiece) closed 2026-07-27** with a real seeded run on the Spark box: `docker compose restart app` between two passes, and the job log shows zero item-count growth for all three domains — `email second pass: itemsSynced=25 (first was 25)`, `calendar: 26 (first was 26)`, `contact: 26 (first was 26)`, `itemsFailed == 0`. WebDAV-files restart-resume specifically remains deferred (the file-domain sync itself is proven separately, see 0011). **Postgres-only (ADR-0023).** |
| [0011](./0011-managed-edition-hardening.md) | Managed edition hardening | ✅ **T1–T7 all done.** T1 runtime RLS, T2 real API persistence, T3 Trigger.dev wiring, T4 usage metering, T5 billing + Mollie webhook e2e, T6 web on the real API. The T3 remainder closed (PR #67): cal/contact/file domains wired via `buildDomainDepsFromMapping`, and `run-cutover.ts`/`run-rollback.ts` are real (final pass + verification gate that aborts on FAIL; honest rollback). Post-#56 review PRs hardened it further — tenant-authz RLS gate (#71), auth JWKS precedence (#69), members-rollback (#68), billing-webhook (#66). **T7 closed 2026-07-26** (PR #118/`pr-57-draft`): live `compose up` DoD verified with real, externally-confirmed evidence — cross-domain shadow syncs (mail + calendar + contact) landing real data in the actual target backend, RLS isolation, billing/usage, and an honest ledger-derived status endpoint; 13 real bugs found and fixed along the way (see the workplan's Status block). **The file/WebDAV domain gap flagged at T7 close was itself closed the same day** (PR #119): no schema change needed — `fileEndpointFromCreds()` derives the file path from the shared `connection.config` via Nextcloud's own convention, plus three further real bugs fixed (target path-doubling + swallowed PUT failures, a `rootPath` handling gap, a root-folder trailing-slash mismatch), verified with a real `GET` against the target Nextcloud account returning the seeded file's actual content. **All four domains now have real, externally-verified evidence.** Only DNS provider **writes** stay deferred (2026-07-16 verify-only decision). |
| [0012](./0012-cutover-completion-summary.md) | Cutover completion summary | 📄 History doc for the 0009 cutover work (not a forward plan). |
| [0013](./0013-discovery-preview-confirm.md) | Pre-sync discovery, preview & confirm | ✅ **T1–T8 all done** (this index previously and incorrectly said "drafted, not started" — corrected 2026-07-27 after confirming every cited file/test actually exists in the tree). Read-only per-domain counts (mail/cal/contacts/files, body-free `discoverSource()`) land in a new RLS-scoped `migration_discovery` table via a shared `discoverDomains()` job (managed Trigger.dev task + self-host in-process reuse). Mappings now create as `paused`; `POST .../start` (managed API, self-host `apps/selfhost/src/lifecycle.ts`) flips to `active` and the existing scheduler takes over. **Both editions have a real confirm screen**: managed's `ConfirmMigration.tsx` React wizard step (polls discovery, renders counts + the §11.2 scope manifest + "Start migration"), self-host's dependency-light `apps/selfhost/src/confirm-page.ts` (hard rule 5 — no bundler/framework). Decisions locked with the owner 2026-07-21. |

## What landed this cycle
**0011 T7 closed for real, its file/WebDAV follow-up closed the same day, and 0010's last open
item (T5) closed too (PRs #118–#120).** 0011 T7's live `compose up` DoD was verified against a
genuinely fresh managed stack on the Spark box, with 13 real bugs found and fixed along the way
(see the 0011 row/Status block) — cross-domain shadow syncs (mail + calendar + contact) landing
real data in the actual target backend, RLS isolation, billing/usage, and an honest status
endpoint. The file/WebDAV domain gap that closure flagged turned out not to need a schema change
after all (#119) — `fileEndpointFromCreds()` derives it from the same shared `connection.config`,
plus three more real bugs fixed (target path-doubling, a `rootPath` gap, a root-folder
trailing-slash mismatch) — verified with a real `GET` against the target account returning the
seeded file's content. Separately, **0010 T5** (the restart-resume idempotency gate, self-host's
acceptance centerpiece) closed with a real seeded run (#120 fixed an invalid-date bug in the DAV
seed script first) showing zero item-count growth across a restart for mail, calendar, **and**
contact. Both 0010 and 0011 are now **fully done**, and 0013 (discovery/preview/confirm) turned
out to already be fully done too — this index just hadn't caught up.
**ADR-0023 (Postgres-only)** still stands — **do not reintroduce SQLite / a second dialect** in
open-migrate's own schema (the managed edition's *demo* Nextcloud backend is a third-party app
with its own SQLite default — unrelated, and already worked around with a write-retry rather than
migrated, see 0011's Status block).

## Recommended order (from here)

**2026-07-27: 0010 and 0013 are both fully done; 0009 T3 closed the same day** (PR #131). What's
actually left:

1. **Audit follow-ups outside the plan numbering** (2026-07-27 doc/code audit; no workplan owns
   these yet):
   - ✅ **Done** — `run` / `run_event` were **never written** by production code, so the
     run-history API and the web UI's run list were permanently empty
     (`runs.integration.test.ts` passed only because it seeded its own rows). `RunStore`
     (`packages/ledger/src/run-store.ts`) is the writer, wired into **all three execution
     paths**: the managed scheduler (`managed-scheduler.ts`, the path that actually runs today),
     the self-host appliance (`apps/selfhost/src/index.ts`), and the Trigger.dev
     delta/full-sync jobs. Covered by `run-store.integration.test.ts`.
   - ✅ **Done** — dead code removed: `packages/core/src/cutover.ts` (`CutoverManagerImpl`),
     `packages/core/src/rollback-orchestrator.ts` (reported success for DNS/notification work it
     did not do), `packages/scheduler/src/trigger-scheduler.ts` (silent no-op, unexported),
     `packages/ledger/src/schema.ts` (empty stub) — −1,721 lines.
   - ✅ **Done** — five swallowed-error sites that broke idempotency. A failed
     `findByNaturalKey` (both `jmap-target.ts` and `imap-dav-target.ts`) returned `undefined`,
     which `upsertEmail` reads as "not present" and APPENDs → **duplicate**. In the ADR-0020
     reindex path, `listEntries` skipped a whole mailbox on error, fell back to INBOX-only when
     mailbox enumeration failed, and yielded the **UID** as a natural key when a header read
     failed — each producing a ledger that looks complete while missing or mis-keying messages,
     so the next sync re-creates them. All five now fail loudly; failing is safe and resumable
     (the folder keeps its cursor and is re-scanned next pass). Covered by
     `packages/connectors/src/lookup-failure.unit.test.ts` (8 tests), verified to fail against
     the pre-fix code.
   - ✅ **Done** — the verification gate reported **fabricated byte parity**.
     `getTotalBytesFromTarget()` returned the *source* total, so every report showed
     `totalBytesTarget === totalBytesSource` — reading as "byte-level parity verified" when the
     target had never been asked. Unmeasured target bytes are now `null` ("not measured"), the
     summary's `totalBytesTransferred` derives from source bytes (what was actually copied), and
     the fabricating helper is gone. Measuring it for real needs a size on `TargetEntry`; the
     path to do so is documented in `verification-implementations.ts`. Covered by
     `packages/core/src/verification-bytes.unit.test.ts` (6 tests). Byte reporting never gated
     the pass/fail verdict, so no verdict changes.
   - ✅ **Done — highest-severity finding of the audit.** The **verification gate compared
     ledger hashes against raw target keys**, so the sets could never intersect: every item was
     reported missing on target, every target entry reported extra, and the mandatory
     pre-cutover gate would have **FAILed every real cutover**. `item.natural_key_hash` is
     `sha256('mid:'|'cal:'|'card:'|'file:' + key)`; the reindexers yield the raw Message-ID/UID/
     path. `verification-implementations.ts` now hashes the target key per domain before
     comparing (`hashTargetNaturalKey`). It survived because
     `verification.integration.test.ts` seeded `naturalKeyHash: 'hash1'` into the ledger **and**
     `naturalKey: 'hash1'` into the fake reindexer — the same literal on both sides, matching by
     construction; that test now derives both sides the way production does. Proven by
     `verification-natural-key.unit.test.ts` (5 tests, all 5 fail against the pre-fix code).
   - ✅ **Done — a SECOND gate bug, found by actually running it.** Checksum sampling compared
     the ledger's real content hash against `TargetEntry.contentHash`, which **both** real mail
     reindexers omit (JMAP can't get it from a headers-only fetch; IMAP-DAV doesn't compute it).
     An absent hash scored as a *mismatch*, so checksum sampling reported 100% failure on a
     healthy migration — enough on its own to FAIL the gate even with the natural-key fix in
     place. Unmeasurable samples are now counted as `checksumUnavailable`, excluded from the
     match ratio, and surfaced as a WARNING issue rather than silently passing or failing.
   - **Both proven against a real Postgres**, not by reading:
     `verification-real-sync.integration.test.ts` runs `runShadowPass` into a real ledger and
     verifies the result. Reverting each fix independently: natural-key only → **4/4 fail**;
     checksum only → **2/4 fail**; both → **4/4 pass**. `runVerification`'s only production
     caller is `run-cutover.ts` and no live cutover appears to have been run, which is why
     neither bug was ever observed.
   - ✅ **Done — the cutover path itself had never been executed.** Following the verification
     work upstream into its only caller turned up five more defects, each measured against a
     real Postgres before being fixed:
     1. **`ctx.logger` does not exist.** Trigger.dev v4's `TaskRunContext` carries run metadata
        only. `run-cutover.ts` and `run-rollback.ts` called `await ctx.logger.log(...)` as their
        first statement, so both jobs died with `Cannot read properties of undefined (reading
        'log')` — including inside the catch block, which replaced the real error and skipped
        the FAILED transition. Both now use the SDK's `logger`.
     2. **The cutover job bypassed the approval gate.** It went READY_FOR_CUTOVER →
        CUTOVER_IN_PROGRESS → COMPLETED under a comment reading "in real implementation, this
        would be a manual step" (hard rule 2). The state machine rejects the first step of that:
        `Invalid transition from READY_FOR_CUTOVER to CUTOVER_IN_PROGRESS`. The job now stops at
        READY_FOR_CUTOVER; approval and execution stay with the `--yes`-gated CLI.
     3. **A tenant could hold exactly one cutover, ever.** `saveCutoverState` inserted
        `id: status.tenantId` while `cutover_state.id` is the PRIMARY KEY and the upsert arbiter
        is `(tenant_id, mapping_id)`, so a second mapping hit `duplicate key value violates
        unique constraint "cutover_state_pkey"`.
     4. **`initializeCutover` silently revoked approvals.** It unconditionally upserted
        `PREPARING`, bypassing `transitionState`'s validation — measured: "state before re-init:
        APPROVED / state after re-init: PREPARING", logged only as "cutover initialized". It is
        now idempotent: an existing cutover is returned unchanged.
     5. **Phantom scheduling.** The job scheduled `run-grace-period-end`, a task that exists
        nowhere in this repo, and the rollback job called `ctx.cancel` (also not a thing) to
        cancel it. Grace-period monitoring is not implemented; both are gone, and the API no
        longer returns a `gracePeriodEnd` for a cutover that never ran.
     Also removed: three `console.log('[transitionState] ...')` debug lines that dumped the full
     cutover status JSON on every transition (they are visible in the CI integration log). And
     the vitest aliases now pin every `@openmig/*` subpath export, so
     `transitionState`'s dynamic import of `@openmig/core/cutover-state` resolves the same way
     on every Node version — it works under CI's Node 24 but throws "Cannot find package" under
     Node 22. Covered by `packages/ledger/src/cutover-store.integration.test.ts` (6 tests) and
     `apps/worker/src/jobs/cutover-preparation.integration.test.ts` (6 tests). The pre-existing
     `packages/core/src/cutover.integration.test.ts` (6) and `rollback.integration.test.ts` (5)
     still pass — they exercise the state machine's happy paths, which is why the defects above
     (second mapping, re-init over APPROVED, the job's own illegal transition) went unnoticed.
2. Later: rich Graph extractor (SharePoint), the §11.1 drift **decision queue** + policy presets
   (the schema `decision` table already exists, 0013 built its foundation), Proton path.

No plan is blocked or mid-flight.

Numbering note: `0001-start-prompt.md` is a historical bootstrap prompt, not a plan. The
`migration/nextjs-15` branch was **not** adopted (Vite stays; tag `archive/nextjs-15` preserves
it), so its `0006-status-report.md` is dead — ignore it.
