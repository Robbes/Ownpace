# Workplan 0021 — the documentation truth pass

## Status — 2026-08-01 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 solution-architecture.md v1.2 | 🟡 **Built, PR open** | Version bumped to 1.2 with a dated change note. The engine-name sweep executed: every imapsync/vdirsyncer/rclone row in §7.3/§8 (mermaid)/§9/§10/§11/§12/§13/§14/§21 now names our own TypeScript connectors, and the §6 banner reads as history instead of a decoder ring (the two remaining mentions are the banner itself and §9.4's *rejected* rclone Proton backend). §3.2/§18 corrected to ADR-0011's real position (self-hosted targets permitted, user-operated). §11.1's apply paragraph corrected — the IMAP/DAV mail target DOES implement `TargetRemover` (verified: `ImapDavMailTarget implements … TargetRemover`, `removeItem` reports `deleted`). PGlite named in §7.3 State row + §22.1 (ADR-0028). §23 got an honest update note: bilingual UI is an unbuilt promise pending the T5 owner decision (header + §3.8 marked too). §24 ADR index extended 0024–0028. §25's Windows row rewritten per ADR-0027/workplan 0015. Bonus truth fix: §13.2's "reuse an external one-shot JMAP import utility" plan replaced with the built reality (our own JMAP writer does bulk + incremental). |
| T2 The runbooks tell the truth | 🟡 **Built, PR open** | `cutover-runbook.md` REWRITTEN against the code: `tsx` invocations (ts-node is not installed), `--yes` on every state-changing command, the verify-only DNS truth ("execute does not change DNS; the MX switch is YOUR manual step"), the real `verify` legs (MX blocking, SPF/DKIM/DMARC/autodiscover warnings, §20 data gate blocking, auto-advance to READY_FOR_CUTOVER), GRACE_PERIOD in the state diagram, the `runbook` subcommand documented. **Grounding it found a real bug**: `execute` transitioned CUTOVER_IN_PROGRESS→COMPLETED, an edge VALID_TRANSITIONS does not have — the happy path threw "Invalid transition" AFTER the operator switched DNS. Fixed: `execute` lands in GRACE_PERIOD, new `--yes`-gated `complete` subcommand closes GRACE_PERIOD→COMPLETED; 6 new unit tests (21/21 in the suite); CLI help texts moved to `tsx` too. `rollback-mechanisms.md`: tsx + `--yes` in the examples. `operator-runbook.md` appliance half: scope banner declaring the ledger-semantics sections both-edition (managed = per-mapping API/screens), all appliance URLs unified on the compose port 8081 (source-run default 8080 stated once), stale worker-container references fixed (logs/recreate/dev-from-source/two-DB-roles), quickstart link de-futured. `selfhost-quickstart.md`: PGlite variant documented (compose.pglite.yml, SELFHOST_PERSISTENCE=pglite, one container, no pg_dump — stop-and-copy backup recipe), footprint note un-lied (ADR-0028), port truth (compose default 8081, all examples unified), `GET /` → `/ui/confirm` redirect noted. |
| T3 Reference docs catch up with the code | ⬜ Not started | — |
| T4 READMEs stop lying about env and ports | ⬜ Not started | — |
| T5 Owner decisions on the broken promises | ⬜ Not started — **needs the owner** | — |
| T6 Index, changelog, security contact | ⬜ Not started (contact needs the owner) | — |

## Why this exists

The 2026-08-01 whole-repo review audited every markdown file against the
tree. The code is in materially better shape than its documentation: the
worst findings were docs that actively mislead — a runbook instructing a
mount that now crashes the API, a testing guide teaching patterns against a
deleted engine, a changelog asserting the absence of features that shipped.
Each item below carries its evidence in the review; this plan is the fix
list, grouped so each task is one honest PR.

## T1 — solution-architecture.md v1.2

The SAD is at "v1.1 (review baseline)", last revised around ADR-0017; eleven
ADRs have landed since, four of them patching the document via inline update
notes while the surrounding tables kept the old world. One revision pass:
sweep the imapsync/vdirsyncer/rclone rows out of §7.3/§8/§9/§10/§13/§14/§21
(the `:60` banner acknowledges the change; the tables never followed), fix
"No self-hosted mail" (§3.2, §18 — contradicts ADR-0011 and the doc's own
§3.1), fix §11.1's "IMAP/DAV target does not implement TargetRemover" (it
does; ADR-0024 already corrects it), name PGlite in §7.3/§22.1 (ADR-0028),
mark §23's bilingual claim per the T5 decision, extend the §24 ADR index to
0028, and update the §25 backlog rows superseded by ADR-0027. Bump to v1.2
with a change note so the next drift is measurable against a date.

## T2 — the runbooks tell the truth

- `operator-runbook.md`: the managed half is rewritten by 0020 T4. The
  appliance half fixed here: the 8080/8081 port confusion, the deprecated
  synchronous `GET /verify` examples (the pair, or gone entirely after
  0019 T6), unscoped appliance URLs presented under a "Managed Edition"
  title.
- `cutover-runbook.md`: says `execute` updates DNS and rollback restores it;
  the CLI states the opposite verbatim ("verify-only DNS", manual MX steps —
  the 2026-07-16 owner decision). Align with `rollback-mechanisms.md`, which
  is correct. Add `GRACE_PERIOD` to the state diagram; document the
  `runbook` subcommand; fix the `ts-node` invocations (repo uses `tsx`).
- `selfhost-quickstart.md`: PGlite does not exist in it — add the
  `SELFHOST_PERSISTENCE=pglite` shape (and the backup story difference: no
  `pg_dump`, copy the data dir); fix the verify section to the pair; fix the
  8080/8081 drift; note `GET /` now lands on `/ui/confirm`.

## T3 — reference docs catch up with the code

- `rls-guide.md`: predates the entire enforcement model. It must teach
  FORCE ROW LEVEL SECURITY (24 tables + stragglers migration), the
  `app_user`/`LedgerDriver.role` split ("without it, RLS does nothing"),
  `withTenant`'s `SET LOCAL ROLE` + transaction-local `set_config`, the
  force-rls catalog audit test, and the real table list; `pnpm test:rls`
  does not exist — name the real suites.
- `testing.md`: the property-test section is written against
  `GenericSyncEngine`, which is deleted; "WebDAV files remains deferred" is
  false (in the gate since 2026-07-27); the CI job list misses
  `fixture-uuid-check`; the e2e dispatch inputs (`seed_count`,
  `persistence: postgres|pglite`) are undocumented.
- `docs/testing.md` appendix (new): the untested-seams list from the review
  (the trigger jobs, `build-deps-from-mapping`,
  `enabled-domains`, the untested web pages/services/stores, Mollie webhook
  handler; `managed-scheduler` left the list by being DELETED — 0022 T4) — so "what has no tests" is a fact in the repo, not a rediscovery.
- `performance.md`: add the `bench:pglite` numbers already in CHANGELOG.
- `test-fixture-uuid-collision-audit.md`: one line noting its remediation
  shipped (`fixture-uuid-check` CI job) — it currently reads as open.

## T4 — READMEs stop lying about env and ports

- `apps/api/README.md`: env names are wrong (`TRIGGER_DEV_API_KEY` → the
  real `TRIGGER_API_URL`+`TRIGGER_SECRET_KEY`), and it omits the two vars
  the API cannot boot without (`APP_DATABASE_URL`, `SECRET_ENCRYPTION_KEY`);
  `pnpm migrate` does not exist.
- `apps/worker/README.md`: lists a `src/trigger-client.ts` that lives in
  `packages/scheduler`, omits several of the jobs (now eight, incl.
  `managed-sync-tick` — the poller it used to omit is deleted, 0022 T4, and
  the Docker section was corrected in that change), points at a nonexistent
  `deploy/compose/trigger.yml`, and shows the v2/v3 SDK call shape.
- `apps/web/README.md`: port 3000 → 3123; `react-router` v8 not
  `react-router-dom`; document `build:selfhost` (`--base=/ui/`).
- `deploy/selfhost/README.md`: list `compose.pglite.yml`/`compose.dev.yml`
  and the single-container PGlite shape.
- `packages/ledger/README.md`: name migrations 0002–0004 and the
  driver seam / `pglite-driver.ts`.
- Root `README.md`: unit tests need no Docker (container-free projects);
  `dev.yml` has no Stalwart; `ts-node` → `tsx`.

## T5 — owner decisions on the broken promises (needs the owner)

Five ADR promises have no code behind them. Each needs a decision — keep it
(then it becomes a workplan) or retract it (then the ADR gets a dated update
note). Recording the decision is the deliverable; building is explicitly not
in this plan:

1. **ADR-0006 Graph-mail fallback** — no Graph mail source exists; the mail
   path is IMAP+OAuth2 only (the 0018 T5 error text is the living proof).
2. **ADR-0008 `TargetProvisioner`** — `packages/provisioner` is a one-line
   stub with zero consumers.
3. **ADR-0013 bilingual EN+NL UI** — zero i18n in `apps/web`; NL exists only
   in the cutover comms templates.
4. **ADR-0015 opt-in backup** — `backup_target` table exists, nothing writes
   or reads it.
5. **ADR-0017 Atlas migration lint in CI** — no Atlas anywhere.

Also for an owner call, from the same review: `ADR-0021`'s OKF add-in is
self-labelled not-MVP (fine to leave); `apps/worker/src/index.ts` (the
`--config` CLI entrypoint) has no live caller — keep as a dev tool or delete.

## T6 — index, changelog, security contact

- `docs/README.md` index: six root docs unlisted, including both runbooks.
- `CHANGELOG.md`: a first catch-up entry landed with the review PR; keep it
  honest going forward, and decide when the first tagged release is cut
  (everything to date is `[Unreleased]`).
- `SECURITY.md`: "(add contact)" placeholder — needs a real address or a
  GitHub Security Advisories pointer from the owner.
- ADR update notes (one line each): 0002 (shell-out half dead), 0004 (bytes
  now flow through the worker; 0018 pointer), 0005→0024 forward link, 0016
  (squashed file path), 0019 (SQLite consequence line).

## Hard rules that bite here

- **Rule 9 applies to prose.** A runbook that instructs a crash, or a
  changelog that denies a shipped feature, masks errors as effectively as a
  swallowed exception. Docs follow the same truth standard as status blocks.
