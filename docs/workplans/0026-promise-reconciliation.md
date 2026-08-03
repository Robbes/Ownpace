# Workplan 0026 — promise reconciliation, round two

## Status — 2026-08-03 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Verified defects (build, no decision needed) | ✅ **All five built 2026-08-03** | Item 1: the drive delta is folder-scoped — `/me/drive/root:{path}:/delta`, server-side scoping, URL pinned by test (+ deltaLink-wins test). Item 2: mail joined the reported-removals channel end to end — `removed?` on the mail port, `GraphMailSource` reports `@removed` ids (omitted-not-empty pinned), the mail adapter records `sourceRef` at copy, three reconcile-level tests (report→`evidence: 'reported'`, moved-item refusal, never-copied refusal). Item 3: `notifyUsers` defaults `false` and an explicit `true` is REFUSED before any rollback action, naming 0030. Item 4 taken via the honest-config route the item allowed: `DomainConfig.throttleConfig` + `createThrottleLimiterFromMapping` now say precisely what happens (one shared limiter, most-restrictive merge — safe per rule 4 — wired to the mail source only); true per-domain limiters need domain-routed connector wiring first. Item 5: the reindex doorway — `reindexFromTarget` takes a `domain` (tested), the worker CLI gained `reindex` (per-domain over `buildTargetReindexers`, `--yes`-gated, no `--domain`, rule-9 exit when no target can enumerate), and the appliance warns loudly at startup on an active mapping with a zero-row ledger (`lostLedgerWarning`, wording pinned incl. the innocent cause). Gates: typecheck + lint clean, 1291/1291 unit. |
| T2 Dead-surface decisions (needs the owner) | ✅ **Decided + built 2026-08-02** | Owner: ditch OperatorDashboard and Settings, keep Tenants and build it. Deleted: `OperatorDashboard.tsx` (393 lines, five `/admin/*` calls with no server), the `Settings.tsx` stub, both nav entries + routes + the Dashboard tile, `useMappingStore`, `NotImplementedError` (+ `shared/src/errors.ts`), and `tenantApi.list/create/delete` (create was a 501 by design). Built: `Tenants.tsx` — members list / invite / role change / two-step remove against the existing tenants+members API, server guards rendered verbatim, admin offered no owner option, own row not removable, member/viewer read-only; invite says out loud that no email is sent (notifications are T3 row 5). Client schemas re-verified against the routes (the old ones had drifted: no `invited` status, PATCH parsed as a full member). Bilingual per 0024 (+40 keys EN/NL). 9 new unit tests; typecheck + lint clean, 1282/1282 unit. |
| T3 Product-promise decisions (needs the owner, per row) | 🟡 **Six rows decided 2026-08-02 and every one of them built or retracted since; rows 7–8 and 10–25 still need the owner** | Decided, each recorded as a dated update note beside its own row rather than only here: **row 1 reindex — KEPT** (built as 0026 T1's doorway: a `reindex` CLI command, `--yes`-gated, non-zero exit when no target can enumerate); **row 2 shared addresses — KEPT and build** (workplan 0027); **row 3 rich extractor — RETRACTED for now** (ADR-0007 + SAD §13.1 carry dated notes; SharePoint versions/permissions/metadata/lists moved to *does not migrate* in the manifest); **row 4 permission inventory — KEPT, SCOPED**, the owner's words *"perhaps the writes later"* (workplan 0029, discover/map/guide only); **row 5 notifications — KEPT, SCOPED** to email with ad hoc events plus daily and weekly attention summaries (workplan 0030, now built for both editions); **row 6 drift decision queue — KEPT, SCOPED** to two categories, not ten (workplan 0028, plumbing and screen built, detectors blocked on 0027 T0); **row 9 Proton — RETRACTED for now** (ADR-0025 and SAD §15.1 carry the notes). **Rows 7–8 (sync directions) and 10–25 are parked**, at the owner's word on 2026-08-02: *"park all remaining decisions for tomorrow."* The standing recommendation on 7–8 is retract both. |
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
| 7 | **Bidirectional + asymmetric sync modes** (conflict policy) | SAD §11, §3 decision 3 | ✅ **RETRACTED 2026-08-03** — see the note below |
| 8 | **Post-cutover reverse sync** (sovereign→O365) | SAD §20 | ✅ **RETRACTED 2026-08-03** — see the note below |
| 9 | **Proton Bridge + ICS/vCard snapshots** — **RETRACTED 2026-08-02** (ADR-0025 update covers the whole Proton destination; manifest row removed) | SAD §15.1; **in the user-facing scope manifest** | Zero Proton code (ADR-0025 defers only Drive — this half is uncovered) |
| 10 | **Secrets vault (OpenBao/Infisical) + self-host keychain** | SAD §7.3, SECURITY.md, deployment.md | Reality: AES over a `SECRET_ENCRYPTION_KEY` env var |
| 11 | **A full threat model** | SECURITY.md points at "§26" — **which is the glossary**; §17.1 is a 6-row lightweight table | No threat-model artifact exists |
| 12 | **NOTICE file + Apache source headers** | ADR-0001 | Neither exists |
| 13 | **"Self-hosted targets are user-operated" marked in docs/UI** | ADR-0011's own consequence | One line in deployment.md; zero UI strings; target-providers.md silent |
| 14 | **API terms / Microsoft publisher verification** | SAD §25 row 1, ADR-0006 | External process; no workplan owns it |
| 15 | **MTA-STS, DANE/TLSA, IP warming** | SAD §25 row 2 residue | Docs prose only |
| 16 | **OKF knowledge add-in** | ADR-0021 ("after the file slices" — **that precondition is now met**) | Zero code, correctly deferred; needs a scheduled/parked decision |
| 17 | **Home Assistant add-on + hybrid agent** | SAD §7.1/§18; 0010 deferred "until the compose path is proven" — **it now is** | Zero code |
| 18 | **JMAP calendars/contacts/files as target** | ADR-0018 "mail leads"; 0007's revisit condition ("once DAV is proven") — **met** | Mail-only |
| 19 | **Observability: per-tenant dashboards, alerts, SLOs** | SAD §19 | `/metrics` exists on the appliance only; `apps/api` has none; no alert rules, no SLOs |
| 20 | **DNS write-path code** (`DnsManager`, `DesecProvider`, ~350 lines) | Kept when writes were deferred (2026-07-16) | Exported, imported by nothing — the exact pattern that got the engine wrappers deleted under ADR-0019. Delete (git preserves it) or state why it stays |
| 21 | **imapflow migration** | ADR-0022 "not urgent" | `imap-simple` still declared in 4 manifests; no owner decision recorded |
| 22 | **TypeScript 7 major bump** | Dependabot PR #125 (open since 2026-07-27) | A compiler major is deliberate work, not a casual merge: adopt as a task or close the PR with the reason |
| 23 | **ClickHouse run-replication** | 0020 accepted-absent with a revisit condition | Runs page renders empty; revisit or re-accept |
| 24 | **Demo-secret rotation** | Standing note since the Spark bring-up | Step zero when the stack stops being a demo |
| 25 | **Private vulnerability reporting toggle** | 0021 T6's outside-the-repo action | Not verifiable from the repo; SECURITY.md's only channel depends on it |

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
after 0028's plumbing. 18 rows remain open.

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
