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
   - ✅ **Done — the gate now runs from the CLI, and measures only what it can see.** Three
     related defects:
     1. **The CLI's `verify` never verified data.** It printed "Data verification requires
        ledger integration - skipping for now" and pushed `{ check: 'Data Completeness',
        status: 'PASS' }` into its results table — the mandatory §20 check reporting a pass it
        had never performed (hard rule 9). It now calls `runVerification`; a gate that FAILs, or
        that cannot run at all, fails the command.
     2. **`approve` was unreachable.** It refuses unless the state is READY_FOR_CUTOVER, `verify`
        wrote no state, and nothing else in the CLI set it. `verify` now advances PREPARING →
        READY_FOR_CUTOVER on a pass (not a `--yes` action — reaching "ready for approval" is the
        verification's own outcome; approving and executing still require `--yes`).
     3. **`VerificationConfig.verifyMail`/`verifyCalendar`/`verifyContacts`/`verifyFiles` were
        ignored.** `runVerification` destructured the config as `_config` and measured all four
        domains regardless. Combined with a single `targetReindexer` being applied to every
        domain — callers pass the MAIL target — the ledger's calendar/contact/file rows were
        compared against a listing of mailboxes, so every one came back missing and **any
        multi-domain migration FAILed the gate no matter how complete it was**. Reindexers are
        now per-domain; a disabled domain reports `SKIPPED` (warns, does not block) and an
        enabled domain with no reindexer reports `NOT_VERIFIABLE` (blocks), replacing a fallback
        that returned the LEDGER count as the target count — fabricated parity — while
        `findMissingOnTarget` simultaneously declared every item missing. Since no DAV reindexer
        exists yet, calendar/contacts/files are NOT_VERIFIABLE today and block a multi-domain
        cutover with a clear reason; building those reindexers is the next piece.
     Covered by `packages/core/src/verification-domain-scope.unit.test.ts` (8 tests) and 8 new
     `verifyCutover()` tests in `apps/worker/src/cli/cutover-commands.unit.test.ts`.
   - ✅ **Done — the non-mail domains are verifiable at all.** Only the two mail targets
     implemented `TargetReindexer`, so calendar/contacts/files came back NOT_VERIFIABLE and
     blocked any multi-domain cutover. `CalDAVTargetWriter`, `CardDAVTargetWriter` and
     `WebDAVTargetWriter` now implement `listEntries`, keyed exactly as their own `upsert*`
     methods key the ledger (VEVENT UID / vCard UID / root-relative path), and
     `buildTargetReindexers()` assembles the per-domain map for both the cutover job and the
     CLI. Enumeration is metadata-only: CalDAV/CardDAV use RFC 4791 §9.6 / RFC 6352 §10.4
     partial retrieval to fetch just the UID, and WebDAV walks with repeated `Depth: 1`
     PROPFINDs rather than `Depth: infinity` (optional in RFC 4918 §9.1 and disabled by default
     on Nextcloud, where it answers 403). Every failure throws: an unreadable collection that
     returned an empty list would be indistinguishable from an empty target, which the gate
     reports as total data loss. A shared, namespace-prefix-agnostic 207 reader
     (`dav-multistatus.ts`) replaces per-writer regexes that only matched the literal `D:href`
     — Nextcloud/SabreDAV emit `d:href`, so those found nothing and called it "not present".
     Two bugs found while building it: `hrefRelativeTo` had to percent-decode (a target file
     named "Meeting notes.txt" hashes differently from "Meeting%20notes.txt" and would read as
     missing), and the WebDAV walk must ignore `config.rootPath` — the writer reads it nowhere
     else, and starting there would prefix every key out of alignment with the ledger. Covered
     by `dav-multistatus.unit.test.ts` (17), `dav-reindexers.unit.test.ts` (17) and
     `dav-factories.unit.test.ts` (3).
   - ✅ **Done — both halves of §20 now measure something.** `TargetEntry` gained `sizeBytes`
     (JMAP `size`, IMAP `RFC822.SIZE`, DAV `getcontentlength`), so `totalBytesTarget` is a real
     sum instead of always `null`. It stays `null` unless EVERY matched item carried a size — a
     partial sum reads as a shortfall against the source total, i.e. as data loss rather than as
     a gap in measurement. `TargetReindexer` gained an optional `contentHashFor(entry)`, called
     for sampled items only, which finally makes "checksum sampling" sample something:
     implemented for **mail** (a JMAP blob / IMAP `BODY[]` is the message as submitted) and
     **files** (WebDAV serves back the bytes that were PUT), and deliberately **not** for
     CalDAV/CardDAV, because those servers re-serialize iCalendar and vCard (property order,
     re-folded lines, their own PRODID) so every item would hash differently and a healthy
     migration would report as 100% corrupt — those samples stay `checksumUnavailable`, which
     says "not measured". An unreadable item is likewise counted unavailable, never as a
     mismatch. Two bugs found while building it: the WebDAV HTTP client only exposed
     UTF-8-decoded text, so hashing a binary file would have differed from its source hash for
     every non-ASCII byte (`bodyBytes` added; absence returns undefined rather than hashing the
     lossy string), and `ImapDavMailTarget.listEntries` still fell back to `messageId ||
     String(uid)` on the SUCCESS path — the exact UID fallback its own catch block refuses to
     make, which would key a ledger row that can never match and duplicate the message on the
     next sync. Covered by `verification-bytes-and-checksums.unit.test.ts` (10) plus 7 more in
     the DAV reindexer suite.
   - ✅ **Done — mail we cannot migrate is now counted and shown, not silently dropped.**
     `ImapSource.listSince` skips messages with no Message-ID (correctly: the natural key IS the
     Message-ID, so copying an unkeyable message would duplicate it on every pass) — but it
     skipped them with a bare `continue`, counting nothing. That made them invisible in three
     mutually-reinforcing places: no ledger row, nothing for the target reindexer to list, and —
     because `discoverSource()` counts by calling that same method — **missing from the item
     total the customer approves at the confirm screen**. Both halves of the verification gate
     agreed on nothing and reported PASS, so a mailbox could leave messages behind and still be
     certified complete. `listSince` now returns an `unkeyable` count, `DomainDiscovery` carries
     `unmigratableItems` (persisted via migration `0015`, nullable so "did not look" stays
     distinct from "found none"), and both confirm screens show it as a separate column plus a
     plain-language note. `items` deliberately stays the MIGRATABLE total — folding them in
     would be the same lie in the other direction. The §11.2 scope manifest gains a matching
     "does not migrate" entry. Covered by `discovery-unmigratable.unit.test.ts` (6) and a
     persistence round-trip in `discovery-store.integration.test.ts`. **Owner decision
     (2026-07-27): report first, then default to writing a generated Message-ID with the count
     and the behaviour shown in discovery so the customer can opt out** — that second half is
     the next piece of work.
   - ✅ **Done — mail with no Message-ID now migrates, and stays verifiable.** Per the owner
     decision (report first, then default to writing the header). `ensureMessageId()` derives an
     id from a sha256 of the message's ORIGINAL bytes — stable across passes, unlike an IMAP UID
     which changes on move and resets with UIDVALIDITY — and writes it into the copy as a real
     `Message-ID` header, so the target reindexer reads back exactly the key the ledger stored.
     The source on the far side is never modified. `domain-sync` gained a post-fetch key
     derivation path (`naturalKeyFromRaw`): these items cannot use the pre-fetch ledger
     fast-path, because their key IS their content, so the ledger is checked a second time after
     the fetch — that check is the entire idempotency guarantee for them and is what the
     integration test exercises. `contentHash` is taken from the bytes we WROTE, so #143's
     checksum sampling compares like with like instead of flagging every generated-id message as
     corrupt. Discovery's `unmigratable_items` became `generated_id_items` (migration `0016`) —
     the count is now a SUBSET of `items` rather than excluded from it, because these messages
     are migrated; both confirm screens and the §11.2 manifest say so (the manifest entry moved
     from "does not migrate" to "partial", since we modify the copy). Two test doubles were
     found lying and fixed: `MemoryTarget` keyed off `raw.item.messageId` instead of the RFC822
     bytes the real writers parse, and `MemorySource` built `sourceRef` from the Message-ID, so
     two messages without one collided — the double would have "proven" a deduplication the real
     source never performs. Covered by `generated-message-id.unit.test.ts` (19) and
     `generated-message-id.integration.test.ts` (7, against a real Postgres).
   - ✅ **Done — the e2e workflow now actually exercises the gate.** It ran only
     `--grep "Restart-Resume"`, which drives the target WRITERS; it never called `listEntries`
     and never called `runVerification`. So every green e2e up to and including run #28 said
     nothing about the DAV reindexers (#142), checksum sampling or measured target bytes (#143)
     — all of which had only ever met test doubles. A new `GET /verify` on the self-host
     appliance runs the §20 gate over the data the sync just wrote (shared `verifyMapping()` in
     the worker orchestration, per hard rule "extract/share it, don't fork it" — and the only
     way a self-host operator can run the gate at all), and
     `test/e2e/selfhost-verification.e2e.test.ts` asserts on it as a second workflow step. It is
     deliberately loud about the two questions only a real server can settle: whether the DAV
     reindexers can read a real Nextcloud, and whether a JMAP blob round-trips byte-identically
     — a *systematic* 100% checksum mismatch would mean mail's `contentHashFor` must be
     withdrawn the way CalDAV/CardDAV's already is.
   - ✅ **Done — the e2e workflow's test filters never filtered anything.** Run #29 failed the
     gate above with a bare `GET /verify -> 500`, and the reason was the harness, not the
     product: `pnpm test:e2e -- --grep "..."` makes pnpm forward a *literal* `--`, and vitest's
     CLI discards everything after it (`--grep` is not a vitest option either — it is
     `-t/--testNamePattern`, and passed properly it is a hard CLI error). Both e2e steps
     therefore ran the **entire** e2e project. The restart-resume suite and the verification
     suite ran in one process in parallel, so `/verify` was called ~0.4s in — before a single
     item had synced, while `runAllDomains` was mid-flight against the same targets. Both
     workflows now select a suite by file path with no `--`. The same defect was silently
     disabling `pnpm test -- --coverage` in `ci.yml`, so the coverage artifact has always been
     empty.
   - ✅ **Done — three real defects found while chasing that 500.** (a) The JMAP client returned
     a method-level error object *as if it were a result* (RFC 8620 §3.6.2 returns
     `["error", …]` inside an HTTP 200), so a rejected `Email/query` produced `ids: undefined`,
     `listEntries` yielded nothing, and verification would report a healthy target as **total
     data loss** — the worst possible way to fail (hard rule 9). (b) That query sent a
     `properties` argument, which RFC 8621 §4.4 does not define for `Email/query` (it belongs to
     `Email/get`); a spec-following server must answer `invalidArguments`. (c) Both DAV sources
     built the RFC 6764 well-known URI by appending to the configured DAV path, producing
     `…/remote.php/dav/.well-known/caldav` — a guaranteed 404 on every calendar and contact pass,
     visible in the run diagnostics, before the fallback PROPFIND. §4 puts those at the origin
     root. Also removed `RealVerificationDeps.ledger`: a required field nothing read, which every
     call site silenced with `as never` — the cast that let `verifyMapping` ship unchecked.
   - ✅ **Done — the CalDAV/CardDAV reindexers doubled the DAV prefix.** Run #30, with the
     filters fixed, ran the gate as its own step and reported its own cause: `GET /verify -> 500`
     carrying `calendar-query REPORT on /remote.php/dav/calendars/e2e-target/personal/ failed
     with status 404 … Sabre\DAV\Exception\NotFound — File not found: remote.php in 'root'`, and
     the Nextcloud log showed the request verbatim:
     `REPORT /remote.php/dav/remote.php/dav/calendars/e2e-target/personal/ 404`. An href in a
     multistatus is *server-absolute*, while `buildUrl` appends to the configured base — so
     feeding hrefs back in doubled the prefix. The writes never hit it (they build their own
     relative paths); only the reindexer feeds server hrefs back, so it could not surface until
     verification first ran against a real server. `hrefRelativeTo` (#142) exists for exactly
     this and the WebDAV reindexer already used it; CalDAV and CardDAV now do too. The unit
     tests had asserted `expect(url).toContain('/calendars/alice/personal/')` — which the
     *doubled* URL also satisfies, and the canned route's regex matched it too, so the double
     agreed with a URL Nextcloud answers 404. Tightened to exact URLs plus a no-doubled-prefix
     check across every request; 3 tests fail on the old behaviour.
   - ✅ **The gate ran end to end (run #31) — and immediately found binary file corruption.**
     Count parity is perfect on all four domains (mail 25/25, calendar 26/26, contacts 26/26,
     files 89/89, `missingOnTarget` 0 everywhere), so every reindexer works. What it caught:
     **`WebdavFileSource.fetchFileContent` was `new TextEncoder().encode(await response.text())`**
     — a UTF-8 decode of the file followed by a UTF-8 re-encode. Lossless only for files that
     ARE valid UTF-8. Everything else was destroyed on read: each invalid byte sequence became
     U+FFFD, unrecoverably. Measured locally on a 476 KB JPEG: 476,387 bytes in, 863,389 out,
     none of them the original. Every JPEG, PDF, MP4, ODP and DOCX in a file migration went
     through it. The source client now reads bytes once and `fetchFileContent` returns them,
     throwing rather than falling back to the lossy path (hard rule 9). 5 tests, 4 fail on the
     old behaviour. **The defect and the fix rest on code inspection plus that local
     measurement, not on the run** — see below for what run #31 does and does not show.
   - **What run #31 actually proves about it, precisely.** The 10 target GETs in the diagnostics
     are exactly the 10 checksum samples, and they split by type: 6 × `dav-seed-file-N.txt`
     (the 6 matches) and 4 binaries — `Gorilla.jpg`, `Nextcloud intro.mp4`, `Gotong royong.odp`,
     `Pitch deck.odp` (the 4 mismatches). So the text/binary attribution holds. But the sizes
     rule out the copy being corrupt: a UTF-8-mangled `Gorilla.jpg` would be ~863 KB and the
     target's is 476,389 bytes, within 2 of the source. All four binaries are **standard
     Nextcloud skeleton files already present on the target user**, which `findFileByNaturalKey`
     adopted into the ledger — with the corrupted source hash — instead of uploading. So what
     the run demonstrates is a **wrong ledger hash**, not corrupt target content. The upload half
     of the defect is real in the code but was never exercised, because the only genuinely
     uploaded files are the seeded `.txt` ones.
   - ✅ **Closed that gap: the file e2e now seeds binary fixtures.** `itemsSynced=89` was mostly
     adoption of pre-existing skeleton files, and every genuinely-uploaded file was ASCII text —
     which survives a UTF-8 round trip unharmed. That is precisely why a lossy binary read
     survived this long. `seed-dav-source.mjs` now also PUTs, per seeded index, a
     `dav-seed-binary-N.bin` (deterministic LCG, no randomness: an ASCII header, a NUL, every
     byte 0x00-0xFF, lone continuation bytes, a truncated multi-byte start, an overlong
     encoding, a surrogate-range encoding, 0xF5-0xFF, then high-entropy filler) and a
     `dav-seed-utf8-N.txt` of valid non-ASCII UTF-8 — the latter guarding the opposite mistake,
     a "fix" that decodes as latin1 or re-encodes text. Verified locally: the binary fixture is
     byte-identical across builds, differs per index, and **inflates ×1.84 (4,391 → 8,067 bytes)
     under the old code path**, so it detects the defect by size alone.
   - ✅ **And a sampling-independent assertion to go with it.** §20 checksum sampling covers 10
     items of ~139 chosen by natural-key hash, so it cannot be relied on to include a binary, and
     "the sample happened to pass" is a weaker claim than "binary files migrate intact". The
     verification e2e now GETs `dav-seed-binary-1.bin` from both servers over plain DAV and
     asserts the bytes are identical, size first (the failure mode roughly doubles it). It guards
     against a vacuous pass by first asserting the fixture does *not* survive a UTF-8 round trip,
     and it lives in its own describe block, so it still runs when `GET /verify` fails.
   - ✅ **`totalBytesSource` was structurally 0 for every domain.** The run reported target bytes
     fine (7,398 / 7,176 / 275,505 / 64,935,162) against a source total of 0, so §20's total-size
     comparison has never been able to measure anything. Cause: the DAV target writers record the
     ledger row themselves, without a size, and `recordIfAbsent` means the sized record the sync
     loop makes immediately afterwards is a no-op. All three writers now record the size.
   - ⚠️ **Open, from the same run.** (a) Checksum sampling came back `unavailable` for 10/10 mail
     and 10/10 calendar samples, and 9/10 contacts — the mail and DAV `contentHashFor` paths do
     not produce a hash in practice, so content verification currently rests on files alone.
     (b) One contacts sample mismatched; with 9 of 10 unavailable that is one data point, not a
     pattern. (c) The e2e assertion that the target holds nothing outside the ledger was wrong
     about the environment — a fresh Nextcloud user ships a default calendar and address book
     with sample content — and now reports extras instead of failing on them, which matches the
     product's own WARNING severity. Whether the file fix clears the mismatches can only be
     settled by the next run.
2. Next: rich Graph extractor (SharePoint), the §11.1 drift **decision queue** + policy presets
   (the schema `decision` table already exists, 0013 built its foundation), Proton path.

No plan is blocked or mid-flight.

Numbering note: `0001-start-prompt.md` is a historical bootstrap prompt, not a plan. The
`migration/nextjs-15` branch was **not** adopted (Vite stays; tag `archive/nextjs-15` preserves
it), so its `0006-status-report.md` is dead — ignore it.
