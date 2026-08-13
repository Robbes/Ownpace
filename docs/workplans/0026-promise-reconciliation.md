# Workplan 0026 — promise reconciliation, round two

## Status — 2026-08-03 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Verified defects (build, no decision needed) | ✅ **All five built 2026-08-03** | Item 1: the drive delta is folder-scoped — `/me/drive/root:{path}:/delta`, server-side scoping, URL pinned by test (+ deltaLink-wins test). Item 2: mail joined the reported-removals channel end to end — `removed?` on the mail port, `GraphMailSource` reports `@removed` ids (omitted-not-empty pinned), the mail adapter records `sourceRef` at copy, three reconcile-level tests (report→`evidence: 'reported'`, moved-item refusal, never-copied refusal). Item 3: `notifyUsers` defaults `false` and an explicit `true` is REFUSED before any rollback action, naming 0030. Item 4 taken via the honest-config route the item allowed: `DomainConfig.throttleConfig` + `createThrottleLimiterFromMapping` now say precisely what happens (one shared limiter, most-restrictive merge — safe per rule 4 — wired to the mail source only); true per-domain limiters need domain-routed connector wiring first. Item 5: the reindex doorway — `reindexFromTarget` takes a `domain` (tested), the worker CLI gained `reindex` (per-domain over `buildTargetReindexers`, `--yes`-gated, no `--domain`, rule-9 exit when no target can enumerate), and the appliance warns loudly at startup on an active mapping with a zero-row ledger (`lostLedgerWarning`, wording pinned incl. the innocent cause). Gates: typecheck + lint clean, 1291/1291 unit. |
| T2 Dead-surface decisions (needs the owner) | ✅ **Decided + built 2026-08-02** | Owner: ditch OperatorDashboard and Settings, keep Tenants and build it. Deleted: `OperatorDashboard.tsx` (393 lines, five `/admin/*` calls with no server), the `Settings.tsx` stub, both nav entries + routes + the Dashboard tile, `useMappingStore`, `NotImplementedError` (+ `shared/src/errors.ts`), and `tenantApi.list/create/delete` (create was a 501 by design). Built: `Tenants.tsx` — members list / invite / role change / two-step remove against the existing tenants+members API, server guards rendered verbatim, admin offered no owner option, own row not removable, member/viewer read-only; invite says out loud that no email is sent (notifications are T3 row 5). Client schemas re-verified against the routes (the old ones had drifted: no `invited` status, PATCH parsed as a full member). Bilingual per 0024 (+40 keys EN/NL). 9 new unit tests; typecheck + lint clean, 1282/1282 unit. |
| T3 Product-promise decisions (needs the owner, per row) | ✅ **ALL 25 ROWS DECIDED — the last six on 2026-08-09.** (This cell said rows 7–8 and 10–25 still needed the owner long after 7–8 were retracted and 10–21 decided; corrected the same day the table closed.) Row 23's runs panel — the one build this cell still called open — was BUILT the same day (#353; see row 23), so nothing here waits on anyone (corrected 2026-08-10) | Decided, each recorded as a dated update note beside its own row rather than only here: **row 1 reindex — KEPT** (built as 0026 T1's doorway: a `reindex` CLI command, `--yes`-gated, non-zero exit when no target can enumerate); **row 2 shared addresses — KEPT and build** (workplan 0027); **row 3 rich extractor — RETRACTED for now** (ADR-0007 + SAD §13.1 carry dated notes; SharePoint versions/permissions/metadata/lists moved to *does not migrate* in the manifest); **row 4 permission inventory — KEPT, SCOPED**, the owner's words *"perhaps the writes later"* (workplan 0029, discover/map/guide only); **row 5 notifications — KEPT, SCOPED** to email with ad hoc events plus daily and weekly attention summaries (workplan 0030, now built for both editions); **row 6 drift decision queue — KEPT, SCOPED** to two categories, not ten (workplan 0028, plumbing and screen built, detectors blocked on 0027 T0); **row 9 Proton — RETRACTED for now** (ADR-0025 and SAD §15.1 carry the notes). **Rows 7–8 were decided the next day: RETRACTED 2026-08-03**, as their own cells and the dated notes in SAD §11 and §20 record — this line said they were still parked until 2026-08-05, and cost the owner a question it had already answered. **Rows 10–25 remain parked**, at the owner's word on 2026-08-02: *"park all remaining decisions for tomorrow."* **2026-08-09: the last six open rows (14, 15, 22, 23, 24, 25) were decided in one sitting — every row of this table now carries a decision.** Rows 14/15/22/25 closed, row 24 re-affirmed parked with its trigger, row 23 decided as a build (the runs panel). |
| T4 Mechanical truth sweep (stale prose, dangling refs) | ✅ **Done 2026-08-03** | SAD v1.3: bilingual-UI marked BUILT (header, Languages line, §23 banner — with the morning note kept as history), §11.2 #1's drift-queue tail points at 0028. ADR-0026's tail records 0019 T1 closed; ADR-0018 gained the update note retiring the never-used "one-shot JMAP utility" credit. SECURITY.md: threat-model pointer §26→§17.1 (with the row-11 honesty) and Renovate→Dependabot. 0010 T5 + index: the stale "WebDAV files restart-resume deferred" corrected (the e2e's own header records the 2026-07-27 extension); 0017's index row: apply/flag screens + navigation closed by 0019. 0020's trigger-webhook bullet marked resolved-deleted. README clone URL real. `run-full-sync.ts` stale comment removed; the `tenant_id` snake-case dup field dropped (no consumer read it — verified against web + tests). |

## Why this exists

The 2026-08-02 full sweep (architecture + all 28 ADRs + code, three
independent passes) — run after 0021 closed — found the remaining distance
between what the documents promise and what the code does. 0021 fixed the
docs that *misled*; this plan settles the promises that are *unbacked*. As
in 0021 T5, **recording each decision is the deliverable**; anything the
owner keeps becomes its own workplan (the 0023/0024 pattern).

## T1 — verified defects (no decision needed; fix and test)

1. **Graph drive folder-scoped delta is not scoped.**
   `packages/connectors/src/graph-drive-source.ts:118-125`: both branches
   request `/me/drive/root/delta`; the "filter by path" the comment promises
   does not exist, and the files sync calls `listSince(folder, cursor)` once
   **per folder** — so every folder's poll returns the whole drive's delta.
   The ledger's natural key makes it converge, but every item is processed
   once per folder per pass. Fix: resolve the folder id and use its delta,
   or filter by `parentReference.path` — plus a test that a non-root folder
   only yields its own items.
2. **Mail deletions over Graph — the recorded 0023 follow-up, now cheap.**
   The whole reported-removals pipeline exists end to end for the other
   three domains; mail's port just never joined it. Minimal change set
   (verified): add `removed?` to `SourceConnector.listSince`'s return
   (`packages/shared/src/ports.ts`), push `m.id` instead of `continue` at
   `graph-mail-source.ts:187`, and supply a `sourceRef` extractor in
   `packages/core/src/reconcile.ts` (mail is the only domain that never
   records one — `findBySourceRef` needs it). IMAP keeps returning nothing,
   which the port already documents as legitimate.
3. **`run-rollback`'s `notifyUsers` defaults `true` and does nothing**
   (`apps/worker/src/jobs/run-rollback.ts:30,108`). An API shape promising
   an unimplemented capability: default it `false` and reject `true` with
   the honest error until notifications exist.
4. **Per-domain throttling silently collapses to one merged limiter**
   (`packages/shared/src/throttling.ts:394`, wired in both build-deps).
   Either build per-domain limiters or make the config type say what
   actually happens.
5. **Wire `reindexFromTarget` to an invokable surface** (added 2026-08-02 —
   T3 row 1 decided KEEP, and the build is small enough to live here: the
   reindexer is built and tested, only the doorway is missing). An explicit
   operator command in both editions (appliance route/CLI step, managed
   job) plus ADR-0020's own on-startup half: detect "ledger empty, target
   populated" and at minimum say it loudly, offering the reindex. A
   recovery path that cannot be invoked during a disaster is a rule-9
   promise.

## T2 — the dead web surface (needs the owner)

- **`OperatorDashboard` is broken-by-construction**: 393 lines calling five
  `/admin/*` endpoints that exist on **no server**, nav-visible in **both**
  editions. Delete, or specify and build the admin API it imagines.
- **`Settings.tsx` and `Tenants.tsx` are 14-line static stubs**, nav-linked
  (Settings in both editions plus a Dashboard quick-action tile) — while
  the API behind Tenants has a complete tenants+members CRUD surface.
- Dead client code that follows the same fate: `tenantApi`/`memberApi`
  (zero importers), `useMappingStore` (52-line zustand store, zero
  importers), `NotImplementedError` (zero usages).
- Related earlier candidate (0024): Dashboard/Mappings body prose is
  EN-only — localize as 0024-T5 **if these screens live**; moot for any
  screen deleted here.

**Update 2026-08-02 — decided and executed.** The owner's call: *"ditch
OperatorDashboard and settings. keep tenants and build."* OperatorDashboard
and Settings are gone (files, routes, nav entries, the Dashboard tile, their
dictionary keys), and with them `useMappingStore` and `NotImplementedError`.
`tenantApi`/`memberApi` stayed and gained their caller: `Tenants.tsx` is now
the real team-management screen (see the Status row for what it does). The
0024-T5 question narrows to Dashboard/Mappings only — the two screens that
live are the two whose body prose is still EN-only; the new Tenants screen
is bilingual from birth. A future operator surface, if ever wanted, starts
from a spec and a privileged non-tenant-scoped API, not from the deleted
mockup (cross-tenant reads cannot run through the RLS-scoped tenant API —
the same reason `POST /tenants` is an honest 501).

## T3 — product-promise decisions (one row = one owner decision)

Keep → it becomes a numbered workplan; retract → a dated update note in the
promising document (ADR/SAD/scope-manifest), exactly as 0021 T5 did.

| # | Promise | Where it lives | What the code says |
|---|---|---|---|
| 1 | **Ledger reindex/adopt runs on startup + on demand** — **KEPT 2026-08-02 → T1 item 5** (wire the doorway; the reindexer is built) | ADR-0020 decision 3 | `reindexFromTarget` exists, tested, **called by nothing in production** — the recovery story cannot be invoked |
| 2 | **Pattern D: shared-mailbox/group migration** — **KEPT 2026-08-02 → [workplan 0027](./0027-shared-addresses.md)** | SAD §14.1; **shown to owners in the pre-start scope manifest** | `group_def` table: zero code refs; no Graph groups discovery; `pattern` settable, read by nothing |
| 3 | **Rich Graph extractor** (SharePoint versions/permissions/lists/pages) — **RETRACTED 2026-08-02** (ADR-0007 update; manifest row moved to *does not migrate*) | SAD §13.1, ADR-0007; manifest says "Partial" | Zero code (no `/versions`, `/permissions`, sites, lists) |
| 4 | **Permission inventory & guidance module** — **KEPT SCOPED 2026-08-02 → [workplan 0029](./0029-permission-inventory.md)** (discover+map+guide as a read-only report; the apply-where-safe writes deferred, not retracted) | SAD §14.2, §3 decision 6 | Zero code (no SendAs/FullAccess/sharing-link handling) |
| 5 | **Notifications** (in-app/email on decisions/milestones) — **KEPT SCOPED 2026-08-02 → [workplan 0030](./0030-email-notifications.md)** (email only: ad hoc + daily/weekly attention digests; no in-app center) | SAD §11.2 #4, §5 | Only honest "not implemented" stubs; 0024 transferred a day-one-bilingual requirement to whoever builds this |
| 6 | **Policy presets + the §11.1 drift decision queue** — **KEPT SCOPED 2026-08-02 → [workplan 0028](./0028-drift-decision-queue.md)** (two categories, not ten) | SAD §11.2 #3, ADR-0016; 0013 named it "its own workplan" | `decision` and `policy_preset` tables shipped, **zero readers/writers** — the largest unowned feature |
| 7 | **Bidirectional + asymmetric sync modes** (conflict policy) | SAD §11, §3 decision 3 | ✅ **RETRACTED 2026-08-03; enforcement pinned 2026-08-05** — see the note below. The retraction lives in exactly ONE place in the code, the mode enum on the managed API's create/update schema, and nothing tested it until now: one careless widening and the API would accept `bidirectional` again, store the word, change no behaviour, and tell the operator two-way sync was configured — the exact promise shape 0026 exists to end. 8 tests pin the refusal, its REASON (a bare *invalid enum value* reads as a typo to fix), that update is refused as well as create, and that the values deliberately STAY in the database enum (hard rule 2: a pre-retraction row must stay readable). |
| 8 | **Post-cutover reverse sync** (sovereign→O365) | SAD §20 | ✅ **RETRACTED 2026-08-03** — see the note below |
| 9 | **Proton Bridge + ICS/vCard snapshots** — **RETRACTED 2026-08-02** (ADR-0025 update covers the whole Proton destination; manifest row removed) | SAD §15.1; **in the user-facing scope manifest** | Zero Proton code (ADR-0025 defers only Drive — this half is uncovered) |
| 10 | **Secrets vault (OpenBao/Infisical) + self-host keychain** | SAD §7.3, SECURITY.md, deployment.md | ✅ **DECIDED 2026-08-05: correct the DOCS, do not build the vault (owner).** Three documents promised a component that does not exist — SECURITY.md said credentials "go in a vault", the SAD's table and diagram named OpenBao/Infisical and an OS keychain, deployment.md listed a vault in the managed stack. All four claims now describe what is real: **AES-encrypted in the ledger under `SECRET_ENCRYPTION_KEY`**. The gap is stated rather than glossed — encryption at rest and nothing in git, but **no rotation, no per-secret policy, no audit trail of reads**, and the master key in the environment of the process that uses it. Not a hole so much as an un-taken hardening step, and nothing in the current deployment has a second operator to isolate. Revisit trigger, and it is a real one: a deployment with more than one operator, or a compliance review that requires a vault — which is also when it will be clear WHICH vault, a question nobody can answer usefully today. |
| 11 | **A full threat model** | SECURITY.md now points correctly at §17.1 | ✅ **DECIDED 2026-08-05: DEFER with a trigger (owner).** Nothing is dishonest today — §17.1 carries a lightweight table of seven threats with mitigations, and SECURITY.md already says plainly that no formal artifact exists. So this was never a truth defect, only an open question about effort. Deferred rather than declared sufficient, and the distinction matters: a threat model written now would largely restate §17.1 at greater length, because its value comes from **adversarial review by somebody who did not build the thing** and no such reviewer exists yet. **Trigger:** a customer's security review asks, or the first non-rc release — whichever comes first. Declaring §17.1 sufficient outright was the alternative and was rejected for one reason: any move toward organisations with procurement makes a threat model table stakes, and closing the row would mean reopening it. |
| 12 | **NOTICE file + Apache source headers** | ADR-0001 | ✅ **Done 2026-08-03** — `NOTICE` written (license, the third-party components that ship *inside* the appliance, trademark note; the authoritative per-release list stays the SBOM rather than a hand-list that misstates itself within a week); the Apache header added to the **143 source files** that lacked it, 368 of 368 now. No decision was needed — ADR-0001 decided it. |
| 13 | **"Self-hosted targets are user-operated" marked in docs/UI** | ADR-0011's own consequence | ✅ **Done 2026-08-03** — said where the choice is actually made: a notice under the target picker in `CreateMapping`, EN/NL, stating that the destination server is the owner's to run and carries no service level from us. That screen had NO i18n at all, so it got `useT` rather than a new EN-only string — a new user-facing sentence does not get to add to 0024 T5's debt. `docs/target-providers.md` gained a section naming the three places it bites: availability during a migration, backups after it, and who answers support questions. No decision needed — ADR-0011's own consequence line required it. |
| 14 | **API terms / Microsoft publisher verification** | SAD §25 row 1, ADR-0006 | ✅ **DECIDED 2026-08-09: per-customer app registration is the model (owner), and that makes publisher verification MOOT.** Each customer registers their own Entra app in their own tenant and consents to it there — a first-party consent, which Microsoft never gates on publisher verification; the wall this row guarded only exists when a foreign tenant is asked to consent to OUR app, and under this model no tenant ever is. The code already works this way: the appliance takes the customer's `OAUTH2_*` values by env, and the managed edition reads `clientId`/`clientSecret`/`refreshToken`/`tenantId` from the per-connection encrypted credential store (`build-deps-from-mapping.ts`) — nothing global to verify. What the decision creates instead of paperwork is a DOCUMENTATION duty: `docs/o365-application-access.md` starts from "you almost certainly already have one" and a cold-start customer does not, so it gains a guide-from-zero section (create the registration, both credential flows, the delegated `IMAP.AccessAsUser.All` scope, where each value lands per edition). The owner validates that section against their own tenant/domain. "Whitelisting the instance" is stated precisely there: an app registration authorizes whoever HOLDS the secret, and instance-scoping comes from secret custody plus the Application Access Policy narrowing the app to named mailboxes — not from network identity. |
| 15 | **MTA-STS, DANE/TLSA, IP warming** | SAD §25 row 2 residue | ✅ **DECIDED 2026-08-09: guidance is the answer; the "automate" half is RETRACTED (owner).** SAD §25 row 2 promised "automate or guide" deliverability; the automate half joins row 20's DNS write-path in retirement — the product's DNS posture is verify-only by that earlier decision, and `docs/dns-management.md` (records to create, an example TLSA entry, the MTA-STS recommendation) is the deliverability story. MX cutover stays a manual operator step; IP warming stays prose advice because it is a process, not a record. **One extension is parked with a named trigger rather than retracted:** teaching the existing read-only DNS verifier to CONFIRM what the guide told the operator to configure (MTA-STS policy reachable and valid, TLSA present where promised) — small, honest code in the shape the product already has, to be built at the first real cutover where deliverability bites, not before. SAD §25 row 2 carries the dated note. |
| 16 | **OKF knowledge add-in** | ADR-0021 ("after the file slices" — **that precondition is now met**) | ✅ **RETRACTED 2026-08-05 (owner decision).** The precondition expired and in all the time since, not one line was written — no `KnowledgeSink`, no OKF writer, no vocabulary. Retracted rather than deferred a second time on the ADR's own reasoning about itself: it is a **different concern from migration** and **privacy-sensitive**, deriving relationships and topics from personal mailboxes. A product whose first-run story is unfinished should not carry a standing promise to mine its customers' mail. ADR-0021 keeps the analysis (OKF v0.1 against OWL/RDF, and the opt-in-sink shape) behind a dated retraction note, with a real revisit trigger: somebody asks for a knowledge side-output and has a use for it. |
| 17 | **Home Assistant add-on + hybrid agent** | SAD §7.1/§18; 0010 deferred "until the compose path is proven" — **it now is** | ✅ **RETRACTED 2026-08-05 (owner decision).** Two different things retracted for two different reasons. The **add-on is a distribution channel, not a capability** — the appliance already runs on any Docker host including a Home Assistant box, so it buys convenience for one audience while the product's own first-run story is unfinished (nobody has yet run the appliance on Windows). The **hybrid agent is a second architecture**: an agent registered to the managed control plane and executing locally is a third deployment topology with its own credential flow, failure modes and security boundary — a product decision nobody has asked for, not packaging. SAD §7.1 carries the note and §18's packaging line now says Docker Compose alone. Revisit trigger: somebody running Home Assistant asks. |
| 18 | **JMAP calendars/contacts/files as target** | ADR-0018 "mail leads"; 0007's revisit condition ("once DAV is proven") — **met** | ✅ **DECIDED 2026-08-05: BUILD → [workplan 0031](./0031-jmap-full-target.md).** The standing recommendation was to RETRACT — DAV already serves these domains against Stalwart, so a second path buys tidiness rather than capability — and the owner overruled it on a reason worth recording: **JMAP is judged more future-proof and is therefore the preferred protocol.** That makes this an investment in a surface, not a gap being filled, and it changes what *done* means: DAV is not replaced (Nextcloud, openDesk and Soverin do not speak JMAP), so JMAP becomes an ADDITIONAL target for the one server that does. **0031 T0 is a spike that can end the plan** and gates everything under it: whether our natural keys survive a DAV↔JMAP switch. They must, or a switched mapping silently duplicates — and calendars carry the `RECURRENCE-ID` fix from 2026-08-04, files the path normalisation that has caused four silent-mismatch bugs. |
| 19 | **Observability: per-tenant dashboards, alerts, SLOs** | SAD §19 | 🟢 **DECIDED 2026-08-05: option A — the endpoint now, the rest deferred (owner).** `apps/api` serves `/metrics` through the SAME `renderMetrics()` the appliance uses, not a second renderer: two would drift, and a dashboard built against one edition's series names would show nothing for the other. The asymmetry it closes ran backwards from expectation — the single-tenant box an operator can SSH into was observable, the multi-tenant service they cannot reach was not. Unauthenticated like `/health`, deliberately: the body carries counts and durations only, and a test pins that no address-shaped or folder-shaped label ever appears there, because §17 counts that metadata as personal data and the route has no auth in front of it. **Dashboards, alert rules and SLOs stay unbuilt**, and that is the same decision rather than an omission: thresholds chosen before there is traffic to measure are guesses wearing the costume of a service level. 3 tests. |
| 20 | **DNS write-path code** (`DnsManager`, `DesecProvider`) | Kept when writes were deferred (2026-07-16) | ✅ **DELETED 2026-08-05 (owner decision).** 951 lines — `dns-manager.ts` (367), `dns-provider-desec.ts` (300) and their test (284) — exported from `@openmig/core` and imported by NOTHING outside that test since the July deferral. The row estimated ~350 lines; it was nearer a thousand. Deleted rather than commented, because the strongest argument for keeping it was *we might want it*, which is the argument that produced `OperatorDashboard`'s 393 lines calling five routes no server had (0026 T2) and the engine wrappers ADR-0019 removed. Git preserves it, `dns-verify-only.ts` — the code that actually runs — carries the note, and the CHANGELOG already told users the MX switch is a manual operator step. The code now says the same thing. |
| 21 | **imapflow migration** | ADR-0022 "not urgent" | 🟢 **DECIDED 2026-08-05: MIGRATE → [workplan 0032](./0032-imapflow-migration.md) (owner).** Scoped rather than started, because the row understated it: **1430 lines** of production code across `imap-source.ts` (557) and `imap-dav-target.ts` (873), plus six test files, and `imapflow`'s API is not similar — async iterators, different mailbox handling, different `append` and flag semantics. This is also **the path proven in the nightly e2e**, the one thing in this product with end-to-end evidence behind it, and a rewrite landing in one commit would trade that evidence for a hope. 0032 therefore starts with a parity harness that runs BOTH clients against the same fixtures, before either connector is touched — the specific risk being `internetMessageId`, which `naturalKeyForItem()` hashes and which a differently-normalising client would silently change, re-copying every message while every write succeeds. **One suspicion checked and dismissed:** `packages/ledger` declaring `imap-simple` looked like a stray production dependency; it is a **devDependency** used only by `shadow-pass.integration.test.ts`, which is correct placement. |
| 22 | **TypeScript 7 major bump** | Dependabot PR #125 (closed unmerged 2026-08-04) | ✅ **DECIDED 2026-08-09: declined for now, and the reason this row asked for is finally recorded (owner).** The facts: #125 began as 5.9→6.0, Dependabot retargeted it to 7.0.2, and it was closed UNMERGED on 2026-08-04 — the same day the repo reached 6.0.3 by its own route. The close was the right call and the record was the missing half. The reason: TypeScript 7 is the natively-compiled rewrite, and a compiler major that lands before its ecosystem does costs days of plugin-chasing for zero product value — `typescript-eslint`, vitest's transform and drizzle-kit's loader each need their own explicit TS-7 support first. **Revisit trigger, externally observable:** that toolchain declaring support. Nothing needs watching meanwhile — Dependabot re-offers newer 7.x versions on its own. **SHARPENED 2026-08-11 (LCM sweep), because the trigger as written points at the wrong event.** Checked empirically, not recalled: `tsc --noEmit` on 7.0.2 compiles this workspace CLEAN, so the code is not the obstacle. `eslint` then refuses to start at all — `typescript-eslint` hard-throws "does not support TS 7.0" at module load and points at [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940), which tracks support for **TS >= 7.1**. That is the load-bearing detail: **7.0.x can never be taken**, so every 7.0.x Dependabot offers is noise by construction, not a candidate. The other two gates this row named are already clear — vitest 4.1.10 declares no `typescript` peer (it transforms via esbuild) and drizzle-kit 0.31.10 declares none either — so `typescript-eslint` is the sole blocker, and #10940 is itself blocked on ESLint not supporting asynchronous parsers, which `tsgo` needs via native bindings or WASM. The real chain is ESLint → typescript-eslint → us, and the maintainers describe it as many months out. **Trigger, restated:** TypeScript **7.1** shipping (latest is still 7.0.2) AND #10940 closing, in that order. Dependabot now has an `ignore` for the `typescript` major so the unusable offers stop; remove it when 7.1 exists. |
| 23 | **ClickHouse run-replication** | 0020 accepted-absent with a revisit condition | 🟢 **DECIDED 2026-08-05: option C now, B if it stays empty (owner).** Re-accepted rather than built — full replication is real work for a page nobody has yet needed — but **the page must stop looking broken**. An empty table with no explanation is indistinguishable from a failure, which is the same *silence reads as a finding* problem this codebase has spent a week closing; it should say that run history lives in Trigger.dev and link there. If it is still empty at the next review, the decision is already made: **remove the page** (option B) rather than keep a permanent placeholder. **CORRECTION 2026-08-05, before anything was built to it: this row describes the wrong page.** The empty Runs page is **Trigger.dev's own dashboard**, a third-party UI we do not ship and cannot add an empty state to — `docs/operator-runbook.md` says so outright ("the runs LIST is served from ClickHouse; without run-replication it renders empty"), as does `apps/worker/README.md`. So option C as worded — *"it should say that run history lives in Trigger.dev and link there"* — is backwards: it is Trigger.dev's page that is blank, and **our** ledger that holds the truth. There is no page of ours to fix, and option B ("remove the page") is already true of our UI, which never had one.

**What actually exists**, checked rather than assumed: the `run` / `run_event` tables are populated and are ground truth; `GET /migrations/:id/runs` is built and has an integration test; and `apps/web/src/services/mapping-service.ts` carries `listRuns`/`getRun` that **no component calls** — dead client code in front of a working endpoint.

**So the real choice is a different one and belongs to the owner**: (i) build a small runs view from the ledger data we already have, which makes Trigger.dev's blank page irrelevant rather than merely explained, and turns the dead service functions into the thing they were written for; or (ii) delete `listRuns`/`getRun` and leave the runbook entry as the whole answer, since it already tells an operator the page is cosmetic and the DB rows are the truth. **Not built either way** — inventing a UI feature was not what was decided, and the decision that WAS recorded cannot be executed as written. **DECIDED 2026-08-09: option (i) — BUILD the runs panel (owner).** On `MappingDetail` (the 0019 T4 hub), both editions through the one UI (ADR-0026), bilingual per 0024: last runs with outcome and per-domain events, errors verbatim. Scoped as the standing recommendation had it — `listRuns` kept and finally wired, `getRun` DELETED (events render inline, so a separate run-detail route is surface without a reader). **BUILT the same day (#353, merged CI-green).** One shared reader (`RunStore.listRunsWithEvents`) serves both editions; the panel opens a failed run's log by default, error text verbatim. **Its first test run found a real bug**: disabled domains' placeholder zero-results were counted in the pass-outcome denominator, so "every domain failed" was unreachable for any mapping with a disabled domain — a total failure recorded as a green run in history, and the 0030 outage email unable to fire in practice. Fixed with a `disabled` marker and one shared `ran` variable, mutation-verified. What tipped it: since 2026-08-05 both editions write real run rows every pass, and the 2026-08-09 Windows session demonstrated the operator need live — a pass whose email domain failed logged `pass complete (0 created)` while the run rows held the truth and no screen showed them. |
| 24 | **Demo-secret rotation** | Standing note since the Spark bring-up | 🟡 **RE-AFFIRMED 2026-08-09: still a demo (owner), so the row stays parked with its trigger intact.** Asked rather than assumed, because the Spark stack served as the migration target for the 2026-08-07..09 Windows sessions — dev use, confirmed as such. Scope when the trigger fires, so nobody has to rediscover it: `JWT_SECRET`, the five Trigger.dev secrets and `SECRET_ENCRYPTION_KEY`, rotated by re-running `ensure-env-secrets.sh` and restarting the stack. The dev Stalwart's fixture passwords are deliberately OUT of scope — they are test fixtures baked into scripts and seeds, and rotating them only breaks the harnesses. |
| 25 | **Private vulnerability reporting toggle** | 0021 T6's outside-the-repo action | ✅ **CLOSED 2026-08-09: enabled by the owner.** The toggle (repo → Settings → Advanced Security → Private vulnerability reporting) is on, so the only reporting channel SECURITY.md names now actually exists — until this moment the file promised a mailbox GitHub ships switched off by default. Not verifiable from inside the repo, which is why the closure is recorded here on the owner's word and dated. |
| 26 | **Four deprecated subdependencies, warned on every install** | `pnpm install` output, standing noise since at least 2026-08 | ✅ **AUDITED 2026-08-11 (LCM sweep): all four are upstream-held. Nothing to do, and that is the point of writing it down** — the warnings are load-bearing-looking and are not, so the next person reading an install log does not re-investigate. Traced through the lockfile rather than guessed: **`@esbuild-kit/core-utils` + `@esbuild-kit/esm-loader`** ← `drizzle-kit@0.31.10`, which is the LATEST drizzle-kit — upstream has not migrated to `tsx`, so there is no version of ours that drops it. **`glob@10`** ← `archiver-utils@5.0.2` and `cacache@19.0.1`, both deep transitive. **`prebuild-install`** ← `better-sqlite3@12.11.1` (via `drizzle-orm`) and `libxmljs2@0.37.0` (via `@cyclonedx/cyclonedx-npm`, the SBOM generator the security scan runs). Worth knowing beyond the deprecation: **those last two are NATIVE modules and they are in our tree**, which contradicts a claim made in ci.yml the same day that the workspace has no native dependency. Corrected there. They install and run on arm64 — the arm64 integration leg passes — but the claim was about declared manifests and was generalised to the tree. **Revisit trigger:** drizzle-kit dropping `@esbuild-kit/*` (watch its release notes when a drizzle bump lands); the other three need nothing. |
| 27 | **`@trigger.dev/*` version is an OPERATIONAL coupling, not a dependency bump** | `deploy/compose/deploy-tasks.sh`, root + `apps/worker` exact pins | 🟡 **HELD at 4.5.9 in the 2026-08-11 LCM sweep, deliberately, and one latent drift fixed.** 4.5.10 is available and was NOT taken. The reason is in the deploy script: `CLI_VERSION="$(node -p "require('.../apps/worker/package.json').dependencies['@trigger.dev/sdk']")"` — the manifest entry *is* the version of the `trigger.dev` CLI that deploys the tasks, so bumping it silently changes how the Spark's tasks get built and requires a redeploy to take effect. The script's own comment records what that costs (`4.5.7 -> 4.5.9 bump: 30+ minutes at the banner, twice`). A routine sweep must not start that. **The drift fixed:** root and `apps/worker` pin `4.5.9` exactly, but `packages/scheduler` declared `^4.5.9` — a caret on the one number that has to match what is deployed. A lockfile refresh could float it to 4.5.10 while the deploy CLI stayed 4.5.9, and nothing would say so. Pinned to `4.5.9` to match. **Revisit trigger:** a deliberate, scheduled Trigger.dev upgrade with a task redeploy and a smoke — never as part of a dependency sweep. |

**Update 2026-08-02 — row 2 decided: KEPT, and the build is
[workplan 0027](./0027-shared-addresses.md)** (both §14.1 patterns, since
the manifest promises S and D together and D's classification rule — "a
group with a store is S" — needs S to route to).

**Update 2026-08-02 — row 9 decided: RETRACTED for now.** ADR-0025 gained
a dated update extending its deferral to the whole Proton destination
(Bridge mail, ICS/vCard snapshots, Drive — one consistent posture instead
of half-deferred, half-promised); the scope manifest's Proton row is
removed (version bumped to `2026-08-02`); SAD §15.1 and the §11.2 manifest
listing carry the dated notes. The Bridge/snapshot half's revisit trigger
is demand — it was only ever blocked on priority.

**Update 2026-08-02 — row 6 decided: KEPT, SCOPED.** The build is
[workplan 0028](./0028-drift-decision-queue.md): the queue end to end for
the two categories discovery can already see (`new_mailbox`,
`shared_address_pattern` — the latter wired to 0027 T1), presets as `auto`
answers for those two only, and the other eight detectors left unbuilt and
said to be unbuilt.

**Update 2026-08-02 — row 1 decided: KEPT.** No new workplan — the
reindexer exists and is tested, so wiring its doorway is T1-sized build
work: it joins T1 as item 5 (operator command in both editions + the
on-startup detection ADR-0020 promised).

**Update 2026-08-02 — row 3 decided: RETRACTED for now.** ADR-0007's dated
update records both halves' fate (the shell-out engines were already gone
via ADR-0019; the rich extractor was never built); the manifest's
"SharePoint extras" row moved from *Partial* ("best-effort" with zero code
was a promise, not a hedge) to *does not migrate* with honest wording;
SAD §13.1 + the §11.2 listing carry the dated notes and keep the design
sketch for if SMB demand reopens it.

**Update 2026-08-02 — row 4 decided: KEPT, SCOPED ("perhaps the writes
later").** The build is
[workplan 0029](./0029-permission-inventory.md): discover + map + guide as
a read-only report riding 0027 T0's application-permission surface; the
**apply-where-safe** half is deferred with a named revisit trigger (the
report proving useful in a real migration), and 0029 T4 makes the manifest
say so.

**Update 2026-08-03 — rows 7 and 8 decided: BOTH RETRACTED.** The owner's
call after the trade-offs were laid out. Neither is a matter of effort.

**Row 7 (bidirectional / asymmetric modes).** Writing changes back to the
SOURCE means this tool modifies the system the customer is leaving — the one
place hard rule 2 promises never to touch. Beyond that it needs conflict
resolution, loop suppression (our own write must not read back as a user
change) and a per-item causality record the ledger does not carry: a different
product, not a larger version of this one. **One-way mirror is now the only
sync mode.** Changes made on the target during shadow are surfaced as
decisions in the queues, never copied back. SAD §11, §3 decision 3 and the §6
functional line carry dated notes (SAD v1.5), and the API no longer accepts a
mode it does not implement — `bidirectional` and `asymmetric` are refused with
the reason, rather than stored as a word that changes nothing. The DATABASE
enum keeps all four values: existing rows may carry them, and hard rule 2 does
not delete a customer's data to tidy a type.

**Row 8 (post-cutover reverse sync).** It needs the same write-to-source
machinery row 7 just retracted. What makes it a withdrawal rather than a gap:
**the source IS the fallback.** Nothing is ever deleted on the source, so the
old system is still whole and still current at cutover; rollback reactivates
the mapping with the source authoritative and shadow sync resumes. That path
exists and is tested. The honest loss, stated in SAD §20 rather than glossed:
mail that arrived in the NEW system after cutover stays there and is not
pushed back — a retreat means "the old system is authoritative from now on",
not "as if the cutover never happened".

**Update 2026-08-02 — row 5 decided: KEPT, SCOPED.** The build is
[workplan 0030](./0030-email-notifications.md): email only — ad hoc events
(decision raised, runs failing, verify done, finished) plus daily/weekly
"what needs attention" digests computed from the same envelopes the
screens read; bilingual templates from day one (0024's transfer
discharged); no in-app notification center by this decision. Sequenced
after 0028's plumbing. 18 rows remained open when this was written; as of 2026-08-09 every row is decided.

## T4 — mechanical truth sweep (no decisions; small PRs)

- SAD still declares the bilingual UI unbuilt in three places (lines 6, 44,
  §23 banner) after 0024 shipped it; §11.2 #1 still calls the shipped drift
  queues "a later slice"; ADR-0026's tail says "closing it is workplan 0019
  T1" (merged); ADR-0018 still credits an external "one-shot JMAP utility"
  the SAD itself corrected.
- SECURITY.md's threat-model pointer names §26 (the glossary) — point at
  §17.1 or at whatever T3 row 11 decides; Renovate→Dependabot naming (also
  a 0025 T3 item — whichever lands first fixes it).
- 0010/0017 rows + index still carry "WebDAV files restart-resume deferred"
  and "apply/flag screens still open" — both closed elsewhere; 0020's text
  references a deleted `trigger-webhook.ts`; root README's
  `git clone …your-org…` placeholder; stale comment in `run-full-sync.ts:75`;
  the `tenant_id` snake-case back-compat TODO
  (`apps/api/src/routes/migrations/index.ts:443`).

## Hard rules that bite here

- **Rule 9 applies to prose** (0021's rule): a scope manifest offering
  Pattern D and Proton to an owner whose tool has neither is a swallowed
  error in document form. Every T3 "keep" must name its workplan; every
  "retract" must amend the *user-facing* surface too, not just the ADR.
- **Rule 7:** decisions land as dated update notes, append-only.
