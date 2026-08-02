# Workplan 0026 — promise reconciliation, round two

## Status — 2026-08-02 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Verified defects (build, no decision needed) | ⬜ Not started | — |
| T2 Dead-surface decisions (needs the owner) | ✅ **Decided + built 2026-08-02** | Owner: ditch OperatorDashboard and Settings, keep Tenants and build it. Deleted: `OperatorDashboard.tsx` (393 lines, five `/admin/*` calls with no server), the `Settings.tsx` stub, both nav entries + routes + the Dashboard tile, `useMappingStore`, `NotImplementedError` (+ `shared/src/errors.ts`), and `tenantApi.list/create/delete` (create was a 501 by design). Built: `Tenants.tsx` — members list / invite / role change / two-step remove against the existing tenants+members API, server guards rendered verbatim, admin offered no owner option, own row not removable, member/viewer read-only; invite says out loud that no email is sent (notifications are T3 row 5). Client schemas re-verified against the routes (the old ones had drifted: no `invited` status, PATCH parsed as a full member). Bilingual per 0024 (+40 keys EN/NL). 9 new unit tests; typecheck + lint clean, 1282/1282 unit. |
| T3 Product-promise decisions (needs the owner, per row) | ⬜ Needs the owner | — |
| T4 Mechanical truth sweep (stale prose, dangling refs) | ⬜ Not started | — |

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
| 1 | **Ledger reindex/adopt runs on startup + on demand** | ADR-0020 decision 3 | `reindexFromTarget` exists, tested, **called by nothing in production** — the recovery story cannot be invoked |
| 2 | **Pattern D: shared-mailbox/group migration** — **KEPT 2026-08-02 → [workplan 0027](./0027-shared-addresses.md)** | SAD §14.1; **shown to owners in the pre-start scope manifest** | `group_def` table: zero code refs; no Graph groups discovery; `pattern` settable, read by nothing |
| 3 | **Rich Graph extractor** (SharePoint versions/permissions/lists/pages) | SAD §13.1, ADR-0007; manifest says "Partial" | Zero code (no `/versions`, `/permissions`, sites, lists) |
| 4 | **Permission inventory & guidance module** | SAD §14.2, §3 decision 6 | Zero code (no SendAs/FullAccess/sharing-link handling) |
| 5 | **Notifications** (in-app/email on decisions/milestones) | SAD §11.2 #4, §5 | Only honest "not implemented" stubs; 0024 transferred a day-one-bilingual requirement to whoever builds this |
| 6 | **Policy presets + the §11.1 drift decision queue** | SAD §11.2 #3, ADR-0016; 0013 named it "its own workplan" | `decision` and `policy_preset` tables shipped, **zero readers/writers** — the largest unowned feature |
| 7 | **Bidirectional + asymmetric sync modes** (conflict policy) | SAD §11, §3 decision 3 | Enum values only; nothing branches on mode |
| 8 | **Post-cutover reverse sync** (sovereign→O365) | SAD §20 | No reverse direction, no source-side writer exists |
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
is demand — it was only ever blocked on priority. 23 rows remain open.

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
