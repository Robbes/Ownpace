# Workplan 0006 — Intermediate remediation: repo integrity & findings outside the plan

> **In one line:** Repo-integrity fixes outside the feature plans: vitest test-file suffixes and a guard, the `DEPLOYMENT.md` case collision, workplan 0003-0005 status blocks, root deps, CI runner and action pinning, compose consolidation, `no-unused-vars`, worker `--config`, swallowed errors, blocking calls.

## Status — 2026-11-24: A to N done, and R (rows corrected 2026-08-01, the work having landed long before)

| Item | Status | Owner decision |
|---|---|---|
| A — Test-selection gap (17 test files never run) | ✅ Done — files renamed to `*.unit.test.ts` so every vitest project picks them up | approved |
| B — Docs case collision `DEPLOYMENT.md` vs `deployment.md` | ✅ Done — single `deployment.md` remains | approved |
| C — Workplan & docs integrity (0003/0004/0005 status, broken links, stale README) | ✅ Done — index rows carry supersession notes | approved |
| D — Root dependency & shim cleanup (`mollie-api-node`, stale `.d.ts`) | ✅ Done — dependency and shim removed | approved |
| E — CI hardening (self-hosted runner on `pull_request`, unpinned actions) | ✅ Done — PRs run on `ubuntu-latest`, the self-hosted runner only on push | approved |
| G — Compose duplication & Postgres version drift (root vs `deploy/compose`) | ✅ Done — root compose removed; `deploy/compose/managed.yml` is the one source | approved |
| H — Re-enable `no-unused-vars` lint rule | ✅ Done — `eslint.config.js` enables `@typescript-eslint/no-unused-vars` | approved |
| I — Worker CLI config-path bug | ✅ Done — `--config` resolves against `process.cwd()` (`apps/worker/src/index.ts`) | approved |
| J — Errors caught and dropped: 25 sites a read-only check for swallowed errors (ERR-1) named on `646b9de2` | ✅ Done 2026-11-19, merged in #1944 (`cd1ff1bc`): 23 sites changed, 2 left as they were (nothing swallowed). See §J | asked for, 2026-11-19 |
| K — Errors caught and dropped, again: the 12 spots the same check (ERR-1) named on `75d7949d`, 2026-11-21 | ✅ Done 2026-11-21, merged in #2022 (`a01edafe`) from branch `claude/ownpace-public-readiness-y7orc6-err1-nov21`: no real bug; 7 spots narrowed or made to say their failure, all in tests and their set-up; 5 swallow nothing, of which 3 are left as they were, one gains a test (the Cirrux connector) and one a single parse; nothing in the product changes. See §K | asked for, 2026-11-21 |
| L — Blocking calls in async code: 25 spots a read-only check (PERF-1) named on `75d7949d` | ✅ Done 2026-11-21, merged in #2023 (`5ba9688a`) from branch `claude/ownpace-public-readiness-y7orc6-perf1-nov21`; read again 2026-11-24, unchanged (§L): none of the 25 sits on a request or a pass; one the check did not name did (`buildIdentity`, `GET /version`), and its file is now read once per process. One more on a pass is left as it is, and so are the 24 test spots: the owner's D1 and D2. See §L | asked for, 2026-11-21; D1 and D2 decided 2026-11-21: leave as is |
| M — A comparison that is not a secret: the line a read-only check (JS-07) named in `caldav-source.ts`, 2026-11-24 | ✅ Read 2026-11-24: a false positive, a CalDAV sync token compared with the client's own (§M); nothing changed | the owner was given a reason to paste |
| N — The web image's base: the line a read-only check (IMG-4) named, `apps/web/Dockerfile:94`, `nginx:1.31.9-alpine-slim`, 2026-11-24 | ✅ Fixed in alpha.20's image pins (#2127, §N): `nginx:1.31.10-alpine-slim` in `apps/web/Dockerfile` and `deploy/compose/www.yml` | the owner, for alpha.20: *"yes on all"* |
| R — An import cycle (CQ-06), a swallowed test error (ERR-1) and the assistant's start-up hook (AIR-2b): three findings of an outside, read-only check on `20038a66`, 2026-11-24 | ✅ Done 2026-11-24 on branch `claude/ownpace-public-readiness-y7orc6-outside-n`: the cycle broken by moving the re-measuring family to `qualify-and-remember.ts`, with a guard; the test's catch, which let go nothing, replaced by an assertion; the hook judged false and kept, with a guard that pins it. Nothing in the product changes. See §N | asked for, 2026-11-24 |

> This workplan was produced by an assessment session on 2026-07-09 (clean clone of `main`,
> `f1acd4a`). It collects **verified findings that fall outside the architecture/feature plans**.
> Per the owner's instruction it must be **validated by the owner item-by-item before an agent
> executes it**. Every finding below quotes its evidence; re-verify paths before editing
> (AGENTS.md: don't trust paths blindly).

## Why this plan exists
The feature workplans (0007+) assume the test suite tells the truth and the docs don't mislead
agents. Several findings undermine that assumption — most critically, **the core idempotency
property tests are currently not executed by any test command**. Fixing these first makes every
subsequent workplan trustworthy.

---

## A — CRITICAL: test-selection gap — 17 test files match no vitest project

**Evidence.** `vitest.config.ts` defines exactly three projects with includes
`**/*.unit.test.ts`, `**/*.integration.test.ts`, `**/*.e2e.test.ts`. Root scripts run
`vitest run --project unit --passWithNoTests` (and `--project integration`). Files named plain
`*.test.ts`/`*.test.tsx` match **none** of the three patterns, so they are silently skipped —
locally and in CI (`ci.yml` unit job runs `pnpm test -- --coverage`). Affected files:

- `packages/core/src/reconcile.test.ts` — **the idempotency/delta/lost-ledger property tests** (hard rule 1 calls these sacred)
- `packages/core/src/reindex.test.ts`, `packages/core/src/unified-sync.idempotency.test.ts`
- `packages/shared/src/hash.test.ts`, `config.test.ts`, `cursor.test.ts`, `keywords.test.ts`, `specialUse.test.ts`, `concurrency.test.ts`, `index.test.ts`
- `packages/ledger/src/ledger.test.ts`, `index.test.ts`, `rls.test.ts` (also: its header says `pnpm test:rls`, a script that does not exist in the root `package.json`)
- `packages/connectors/src/imap-source.test.ts`, `packages/scheduler/src/single-flight.test.ts`
- `apps/api/src/__tests__/billing-service.test.ts`, `apps/web/src/__tests__/Dashboard.test.tsx`

**Consequence.** Workplan status blocks cite "unit tests green" for suites that no longer run.
`--passWithNoTests` masks the hole (AGENTS.md hard rule 9: never mask).

**Fix (proposed).**
1. Rename each file to the correct suffix: pure-logic tests → `*.unit.test.ts`;
   DB-backed tests (`rls.test.ts`) → `*.integration.test.ts`. Prefer renaming over widening the
   globs so the unit/integration split stays explicit.
2. Run `pnpm test` and `pnpm test:integration`; **fix whatever surfaces** (these files have not
   gated changes for some time — assume drift; quote failures verbatim before fixing).
3. Add a guard so this cannot recur: a tiny unit test or CI step that fails when a file matching
   `*.test.ts?(x)` exists that matches no project include.
4. Remove `--passWithNoTests` from `test` and `test:integration` (keep it only for `test:e2e`
   while `test/e2e` is empty).

**Acceptance.** All listed files execute in `pnpm test`/`pnpm test:integration`; gates green;
guard in place; CI run linked in this status block.

---

## B — Docs case collision: `docs/DEPLOYMENT.md` and `docs/deployment.md` both tracked

**Evidence.** `git ls-files | grep -i deployment` returns both. On case-insensitive filesystems
(Windows, macOS — the owner develops on Windows 11) `git clone` warns and materializes only one
file. Contents differ: lowercase is the canonical short doc; uppercase is a longer guide added
with the 0005 work. CI docs-hygiene requires `docs/deployment.md` to exist. Symptom on affected
checkouts: `git status` permanently shows a phantom `M docs/DEPLOYMENT.md` that cannot be
discarded — agents must not commit or "fix" it; resolve via this item only.

**Fix (proposed).** Merge any still-valuable content from `DEPLOYMENT.md` into `deployment.md`
(canonical, per its own header), then `git rm --cached "docs/DEPLOYMENT.md"` (use `--cached` on a
case-insensitive checkout), commit from one machine. Add a CI docs-hygiene step that fails when
two tracked paths differ only by case (`git ls-files | sort -f | uniq -di`).

**Acceptance.** One tracked deployment doc; fresh clone on Windows shows no collision warning;
CI guard rejects future case collisions.

---

## C — Workplan & docs integrity (agents are being misled)

**Evidence.**
1. `docs/workplans/0003-caldav-carddav-webdav.md` lists engines/writers under "Completed Tasks",
   but `packages/core/src/unified-sync.ts` says in its header *"NOTE: This is a stub
   implementation"* and all four `sync*` functions return zeros; the ledger has **no item-type
   support** (`packages/ledger/migrations/` contains only `0001_init.sql` and
   `0002_multi_tenant_rls.sql`); the worker CLI wires **mail only** (`apps/worker/src/build-deps.ts`).
2. `docs/workplans/0004-cutover-dns.md` contradicts itself: the header says *"Phase 3 -
   IN_PROGRESS"*, the body says *"Phase 3 ✅ COMPLETED"*, and Success Criteria still show
   Phases 2–3 as pending. Phase 4 (integration) is genuinely open.
3. The actual **workplan 0005 document was deleted** (commit `f1acd4a` removed
   `.agents_tmp/PLAN.md`); only `0005-implementation-summary.md` survives and it links to the
   deleted file and to ADR filenames that don't exist (`0004-orchestration-strategy.md`,
   `0010-persistence.md` — actual names differ).
4. Root `README.md` is stale: the worker note says dependency wiring is pending (it exists:
   `apps/worker/src/build-deps.ts`), and the README's mapping-config JSON example does not match
   the actual schema in `packages/shared/src/config.ts` / `mapping.example.json`
   (`type: "imap"`+inline token vs `type: "imap-oauth2"`+`tokenFromEnv`).
5. AGENTS.md instructs agents to **trust workplan status blocks** — so these inaccuracies
   propagate into future sessions.

**Fix (proposed).**
- Correct the Status blocks of 0003 and 0004 to verified reality (0003: models/hash/interfaces/
  writers exist, orchestration+sources+ledger-extension open → superseded by workplan 0007;
  0004: Phases 1–3 unit-level done, Phase 4 open → superseded by workplan 0009).
- Restore the 0005 plan from git history (`git show f1acd4a^:.agents_tmp/PLAN.md`) as
  `docs/workplans/0005-managed-edition.md`; fix links in the summary; mark honest status
  (schema/RLS SQL done; API routes are TODO shells — see 0011).
- Refresh README quickstart to the real config schema and current worker state.

**Acceptance.** Every workplan Status block matches code (spot-checked with the evidence above);
no dead links in `docs/workplans/`; README example parses with `parseMappingConfig`.

---

## D — Root dependency & shim cleanup

**Evidence.** Root `package.json` declares `mollie-api-node: ^1.4.0` (ancient major; current is
v4 under a different name) while the API app correctly uses `@mollie/api-client: ^4.6.0`.
`apps/api/src/types/mollie-api-node.d.ts` hand-declares types for the module nobody imports.
Root also carries `imap-simple`/`@types/imap-simple` (ADR-0022 already records the imapflow
migration path — no action beyond placement).

**Fix (proposed).** Verify with `grep -r "from 'mollie-api-node'"` that nothing imports it;
remove the root dep and the stale `.d.ts`. Move `imap-simple` (and its types) from the root
manifest into `packages/connectors` where it is actually consumed, honoring workspace hygiene.
Regenerate the lockfile; `--frozen-lockfile` green.

**Acceptance.** `pnpm install --frozen-lockfile`, lint, typecheck, tests green with the root
manifest free of unused deps.

---

## E — CI hardening (supply chain)

**Evidence.** `ci.yml` runs **all** jobs (`lint`, `unit`, `integration`) on `runs-on: self-hosted`
and triggers on `pull_request`. AGENTS.md safety notes: the self-hosted runner has docker socket +
root, *trusted workflows only*. ADR-0009 targets a **public** monorepo — once public, an external
fork PR would execute on that runner. Several actions are unpinned (`pnpm/action-setup@v4`,
`actions/setup-node@v4` carry `TODO: pin` comments). The architecture (§22) prescribes
GitHub-hosted runners for lint/unit and the machine only for integration/e2e.

**Fix (proposed).** Move lint+unit jobs to `ubuntu-latest`; keep integration/e2e on the machine but
gate them (run on `push` to `main` and on PRs from branch authors with write access, e.g.
`github.event.pull_request.head.repo.full_name == github.repository`). Pin the two actions to
commit SHAs. Document the policy in `docs/testing.md`.

**Acceptance.** A PR from a fork cannot reach the self-hosted runner; all actions SHA-pinned;
pipeline still green end-to-end.

---

## G — Compose duplication & Postgres drift

**Evidence.** Root `docker-compose.yml` (added with 0005) runs `postgres:15-alpine` and a
Trigger.dev stack; `deploy/compose/dev.yml` is the canonical dev stack (CHANGELOG records
PostgreSQL 18 there; AGENTS.md and e2e.yml reference only `deploy/compose/dev.yml`). Two compose
entry points with different Postgres majors will diverge silently. The root file also mounts
`packages/ledger/migrations` as initdb scripts — a second, unmanaged migration path alongside the
Drizzle flow (§22.1).

**Fix (proposed).** Move the managed/Trigger stack to `deploy/compose/managed.yml`, align the
Postgres major with the dev stack, drop the initdb mount in favor of the migration runner, and
keep the repo root compose-free (docs updated).

**Acceptance.** One compose directory; both stacks boot; documented in `docs/deployment.md`.

---

## H — Re-enable `no-unused-vars`

**Evidence.** Commit `04fcf33` ("fix: disable no-unused-vars lint rule and clean up test")
switched the rule off repo-wide in `eslint.config.js` to get CI green — a masking fix.

**Fix (proposed).** Re-enable as `@typescript-eslint/no-unused-vars` with
`argsIgnorePattern: '^_'`, `varsIgnorePattern: '^_'`; fix the fallout (expect it concentrated in
the 0005-era API/web code).

**Acceptance.** Rule active; `pnpm lint` green without blanket disables (file-local
`eslint-disable-next-line` with a reason is acceptable where genuinely needed).

---

## I — Worker CLI config-path bug

**Evidence.** `apps/worker/src/index.ts` `loadConfig()` does `join(__dirname, configPath)` — the
config is resolved relative to the **compiled module's directory**, not the invoker's cwd, and an
absolute `--config C:\...\mapping.json` gets mangled. The README's documented invocation
(`--config ./mapping.example.json` from the repo root) therefore cannot work.

**Fix (proposed).** `resolve(process.cwd(), configPath)`; add a unit test
(`index.unit.test.ts` already exists as a home for it); verify the README quickstart command runs
against the dev stack.

**Acceptance.** `--config` works with relative-to-cwd and absolute paths; quickstart verified.

---

## J — Errors caught and dropped (a check for swallowed errors, 2026-11-19)

**Evidence.** The owner ran a read-only check for errors that are silently swallowed (ERR-1: an
empty `catch`, a broad catch that neither logs nor passes the error on, an async call nobody
awaits, a promise without error handling) on `main` at `646b9de2`. Its findings were handed on
as 26, and the list names 25: seven in product code, five in `scripts/jmap-target-spike.ts` and
thirteen in tests. Each was read again on `81558fd5`, whose one change since (#1940) touches none
of those files, and judged a real bug, an error that is expected, or nothing swallowed. A comment
beside an empty catch was not taken as a fix, and nothing was suppressed.

**Done (2026-11-19).** By site, with the line on `646b9de2`:

| Site | What it was | What changed | Shown by |
|---|---|---|---|
| `apps/web/src/pages/Confirmed.tsx:674` | A real bug. A failed read of the runs before *Read everything back* read as "no pass before this one", the pass started, and the watch could take the last pass for it | The failure reaches the press's own catch: the screen's error, and nothing started | `Confirmed.unit.test.tsx`, *says a read of the runs that failed* |
| `packages/core/src/domain-sync.ts:143` | A real bug. A window the ledger could not read was dropped without a word: the pass slowed to a round trip per item with nothing saying why | The same fallback, and a `[sync] <domain>:` warning with the error | `copied-items-asked-a-window-at-a-time.unit.test.ts`, *says in the log why* |
| `apps/selfhost/src/index.ts:2931`, `:3589` | Expected: a body that is not JSON (`SyntaxError`), answered by the door's own 400. But a body the client cut short was answered 400 too, to nobody, and logged nowhere | `readJsonOrNone`: only the `SyntaxError` reads as no body; anything else reaches the handler's catch, which logs it | `a-body-cut-short-on-the-appliance.unit.test.ts` |
| `apps/web/src/pages/MappingDetail.tsx:172` | Expected: a visit that was not recorded, which 0157 T7 does not show | Only a failed request (`axios.isAxiosError`) is let go; anything else is thrown | `MappingDetail.unit.test.tsx`, *throws a failure that is not the request's* |
| `apps/web/src/pages/StartMigration.tsx:1587` | Expected: a removal the server did not make, which leaves the row in the list read again | The same, for a failed request only; anything else is thrown | `StartMigration.unit.test.tsx`, *when the account a failed check left is not removed* |
| `apps/web/src/services/unreadable-answer.ts:67` | Expected: a report the network did not carry (`TypeError`), which is not kept | Only that; anything else is thrown | `an-answer-the-page-could-not-read.unit.test.tsx`, *throws a failure to send* |
| `scripts/jmap-target-spike.ts:364`, `:459`, `:947`, `:1124`, `:1135` | Expected: a clean-up that never reached the server (`TypeError`) | `cleanUpNotReached`: said on an `ERROR` line, since the account may keep what the step made; anything else is thrown | Run against a stand-in server that drops every destroy: five clean-ups said, where none were |
| `apps/web/src/pages/an-acceptance-before-the-first-connection.unit.test.tsx:164` | Expected: the door's 409 the test makes | Only `isConditionsNotAccepted`; anything else fails the test | its two door tests; a 500 from the door now fails them |
| `packages/connectors/src/imapflow-source.unit.test.ts:487`, `:519` | Expected: the failed fetch each test sets up | `expect(...).rejects.toThrow(...)`, by the message the tests beside them match | the two tests |
| `packages/managed/src/claim-invitation-under-rls.unit.test.ts:205`, `:391` | Expected: the policy refusing. Both UPDATEs resolve with 0 rows, and a statement that never ran passed as well: with a misspelt table all 21 tests passed | Only `violates row-level security policy`; anything else fails the test | the two tests; the misspelt table now fails |
| `packages/core/src/apply-relocation.unit.test.ts:571` | Expected: nothing, as the in-memory ledger only resolves | The catch goes | the test |
| `packages/connectors/src/jmap-contact-target.integration.test.ts:122`, `jmap-file-target.integration.test.ts:107`, `:108` | Expected: nothing that can be thrown, as an id already gone comes back inside the server's 200 | The catch goes: a clean-up that did not happen fails the hook | CI's integration job |
| `packages/connectors/src/jmap-mailbox-creation.integration.test.ts:125`, `:126` | Expected: a DELETE the server refuses (`imapRefusalDetail`) | Only that, per mailbox; the outer catch goes | CI's integration job |
| `apps/api/src/routes/connection-delete-revokes.integration.test.ts:332`, `apps/api/src/routes/tenants/members.integration.test.ts:563` | Nothing swallowed: the requests are awaited by `Promise.all` a few lines on, which rejects with their error | Nothing | — |

Each product-code test failed with its fix undone and passed with it. Where a catch was narrowed,
throwing everything instead fails the test of the expected path too. Gates: the unit and web test
projects, both type checks, eslint on every changed file, and the index and history checks.

**Not done.** The same shapes stand where the check did not name them, and are left as they
were: 24 more one-line `.catch(() => undefined)`, `null` or `{}` (most drain a response body or
close a handle, as best effort), the five `readJson(req).catch(() => ({}))` and the catch of
`POST /unreadable-answers` in `apps/selfhost/src/index.ts`, the spike's CardDAV `DELETE`
clean-up (its `.catch(` and `() => undefined` stand on two lines), the poll's catch in
`Confirmed.tsx`, and the two comment-only catches in `unreadable-answer.ts`. And
`destroyJmapFixtures` reads only the HTTP status, so a destroy the server refuses inside its 200
(`notDestroyed`) still passes unsaid.

---

## K — Errors caught and dropped, again (the same check, 2026-11-21)

**Evidence.** The same read-only check (ERR-1) ran again on `main` at `75d7949d` (2026-11-21
08:40) and named 12 spots: one in product code (the Cirrux Drive connector), one in its test
fake, and ten in tests and the integration tier's set-up. Each was read at `75d7949d` and on
`main` at `f5c013e`. Only two files changed in between: `cirrux-fake.ts` (a tag length named, 50
lines below its spot) and `a-binary-the-stack-never-runs.unit.test.ts`, whose spot moved from
line 755 to 701. Two of the spots are ones §J judged "nothing swallowed", and are again.

**Done (2026-11-21).** By site, with the line on `75d7949d`:

| Site | What it is | Kind | What changed | Shown by |
|---|---|---|---|---|
| `packages/connectors/src/cirrux-drive-api.ts:377` | `.then(...)` with no `.catch` in `partUrls` | Nothing swallowed. The promise is returned; `askUrls` in `cirrux-drive-target.ts` awaits it inside the upload's `try`, which aborts the staged upload and throws on. A person would see the file fail in the pass with "Cirrux answered …/part_urls without part_urls", no file in Cirrux, and the next pass try it again | The code: nothing. A test, as none covered the path | `cirrux-drive-target.unit.test.ts`, *part URLs Cirrux answers without part_urls fail the file*; with `.catch(() => [])` added to `partUrls` it fails |
| `packages/connectors/src/__testing__/cirrux-fake.ts:83` | `this.tail = run.catch(() => undefined)` | Nothing swallowed. The caller gets `run`, with its error; the catch only keeps the lock usable for the next rotation, as the database's store is | Nothing | With `this.tail = run`, three tests fail: the 5xx that keeps the token, the answer that never arrived, and connecting again |
| `apps/api/src/routes/connection-delete-revokes.integration.test.ts:332` | `.then((res) => res)`, the request started and not awaited at once | Nothing swallowed, as §J found: both are awaited by `Promise.all` a few lines on | Nothing | — |
| `apps/api/src/routes/tenants/members.integration.test.ts:563` | `answer.catch(() => undefined)` | Nothing swallowed, as §J found: `Promise.all(answers)` awaits the same promises and rejects with their error; the catch only keeps one from being unhandled while the test waits | Nothing | — |
| `packages/orchestration/src/imap-dav-target.integration.test.ts:197` | `client.logout().catch(() => undefined)` in a `finally` | Expected: a clean-up that must not throw, as a throw from a `finally` replaces the error that brought it there | The failure is said with `console.warn` | CI's integration job; a log line only |
| `packages/testing/src/testcontainers-setup.ts:73`, `:124` | An empty catch around the log file's last line; the four `data` and `err` handlers beside them the same | Expected: a stream's event handler must not throw, or the run ends. But a log that stopped short said nothing | `appendToTestLog` (`container-chores.ts`), for all six: a failed write said once per file | `container-chores.unit.test.ts`; with the old silent catch, and with it said every time, a test fails |
| `packages/testing/src/testcontainers-setup.ts:735` | `docker rm -f <id>` with `.catch(() => {})` | Expected: a container already gone. But any other failure was taken as removed, and the next Stalwart started on the same data volume | `removeContainerOrGone`: only `No such container` is let go, anything else thrown | `container-chores.unit.test.ts`; letting everything go, or nothing, a test fails |
| `scripts/a-binary-the-stack-never-runs.unit.test.ts:755` | An empty catch round a second `dockerfileBase` call | Nothing swallowed: the same call's error is said a few lines above | The FROM is parsed once and its tag kept, so the second call and its catch go | The guard's 94 tests pass |
| `scripts/a-duty-the-gate-used-to-do.unit.test.ts:642` | An empty catch round `process.kill(-pid, 'SIGKILL')` | Expected: a group gone meanwhile (`ESRCH`) | Only `ESRCH` is let go quietly; anything else, a group left running, is said (a throw from the `finally` would replace the test's own failure, and `no-unsafe-finally` refuses one) | `node`: a reaped child's group answers `ESRCH`; the test passes |
| `test/e2e/selfhost-backup-restore.e2e.test.ts:213` | An empty catch round reading the app's logs for the failure message | Expected: a diagnostic that must not throw over the real failure. But a read that failed said "(no logs)" | The message says the logs could not be read, and why | E2E (self-hosted); a message only |
| `test/e2e/selfhost-ui.e2e.test.ts:216` | `waitForFunction(...).catch(() => {})` | Expected: the wait running out, after which the checks say what the screen shows. A page gone was taken for that too | Only Playwright's `TimeoutError` is let go; anything else thrown | Real Chromium: a wait that runs out is a `TimeoutError`, a closed page a `TargetClosedError`, which is not |

Nothing was suppressed, and no comment or marker was added for the check's sake. Gates: the
changed tests and the guards that read the changed files, both type checks, eslint on the
changed files, and the docs checks. The integration and E2E files changed are CI's to prove:
there is no container runtime where this was built.

**Not done.** In `startStalwart`, the `docker ps` loop's `catch { break; }` just above line 735
takes a failed `docker ps` for a container gone, the same shape the check did not name. The 24
one-line catches §J left, and its other follow-ups, stand.

---

## L — Blocking calls in async code (an outside, read-only check, 2026-11-21)

**Evidence.** An outside, read-only check (PERF-1, "Blocking calls in async code", status
"Needs attention") read the code on `75d7949d` for calls that make everything else wait inside
async code: in Node, a `*Sync` call inside an async function or a request handler. Fixed
patterns, nothing run. The owner's copy lists 25 calls in 19 files, line 135 of
`notifier-wiring.unit.test.ts` twice: that line holds two calls, a `writeFileSync` of a
`readFileSync`. Each was read on `75d7949d` and again on `main` at `f5c013e`.

**Sorted.** Three kinds: (a) product code on a path that serves requests or runs passes, where
the call holds up other work; (b) product code that runs once, before anything is served; (c)
test code and test set-up, where the call holds up only that test's own worker.

| Spot on `75d7949d` | On `f5c013e` | Call | Kind | Why |
|---|---|---|---|---|
| `packages/ledger/src/migrate.ts:225` | `:258`, unchanged | `readFileSync` of one migration file | (b) | `runMigrations` runs at start-up: the appliance's `start()` awaits it before it schedules anything and long before `server.listen`; the API calls `app.listen` only in the `.then` after both chains; `seed-managed` is a CLI. Nothing is served while it reads, and each read is one small file before a database round trip far longer than the read. `listMigrationVersions`' `readdirSync` (`:131` now) is the same case |
| `vitest.global-setup.ts:73`, `:78` | the same lines | `readdirSync`, `readFileSync` of the migrations | (c) | vitest's global set-up, once per run, before any test |
| `apps/api/src/a-body-that-would-not-parse.unit.test.ts:274` | same line | `gzipSync` of a small JSON body | (c) | the test's own request body |
| `apps/api/src/routes/migrations/a-failure-said-in-our-words.unit.test.ts:496`, `:508`, `:510` | same lines | `readFileSync`, `readdirSync` | (c) | the test reads the appliance's source to check its wording |
| `apps/api/src/routes/ready.unit.test.ts:59` | same line | `readFileSync` of `ready.ts` | (c) | the test reads the route's source |
| `apps/selfhost/src/a-body-cut-short-on-the-appliance.unit.test.ts:49` | same line | `writeFileSync` | (c) | the mapping file of the test's temporary config directory |
| `apps/selfhost/src/a-download-that-resumes.unit.test.ts:56` | same line | `writeFileSync` | (c) | the same |
| `apps/selfhost/src/a-log-the-appliance-serves.unit.test.ts:47` | same line | `writeFileSync` | (c) | the same |
| `apps/selfhost/src/a-name-it-answers-to.unit.test.ts:105` | same line | `writeFileSync` | (c) | the same |
| `apps/selfhost/src/a-page-on-another-site.unit.test.ts:46` | same line | `writeFileSync` | (c) | the same |
| `apps/selfhost/src/a-press-that-meets-the-share-limit-on-the-appliance.unit.test.ts:110` | same line | `writeFileSync` | (c) | the same |
| `apps/selfhost/src/an-apply-pressed-after-cutover.integration.test.ts:75` | same line | `writeFileSync` | (c) | the same |
| `apps/selfhost/src/apply-flag.unit.test.ts:80`, `:83` | same lines | `writeFileSync` | (c) | two mapping files of the test |
| `apps/selfhost/src/decisions-routes.unit.test.ts:50` | same line | `writeFileSync` | (c) | the test's mapping file |
| `apps/selfhost/src/first-pass-on-activation.unit.test.ts:62` | same line | `writeFileSync` | (c) | the same |
| `apps/selfhost/src/notifier-wiring.unit.test.ts:59`, `:135` (two calls) | same lines | `writeFileSync`; `writeFileSync` of a `readFileSync` | (c) | the test copies its mapping file into a second config directory |
| `apps/selfhost/src/one-person-on-the-appliance.unit.test.ts:47` | same line | `writeFileSync` | (c) | the test's mapping file |
| `apps/selfhost/src/runs-route.unit.test.ts:54` | same line | `writeFileSync` | (c) | the same |
| `apps/selfhost/src/selfhost-queues.integration.test.ts:179` | same line | `writeFileSync` | (c) | the same |

None of the 25 is of kind (a): one (b), counted with its `readdirSync`, and 24 (c).

**Searched for what the check did not name.** Product code in `apps/api`, `apps/selfhost`,
`apps/worker` and `packages/*`, for `readFileSync`, `writeFileSync`, `existsSync`, `statSync`,
`mkdirSync`, `readdirSync`, `execSync`, `execFileSync`, `spawnSync`, `Atomics.wait`, the
synchronous `node:zlib` calls and `pbkdf2Sync`/`scryptSync`, on `f5c013e`:

| Spot on `f5c013e` | Call | Kind | What is done |
|---|---|---|---|
| `packages/core/src/build-identity.ts:26` | `readFileSync` of the root `package.json`, on every call | (a) | **Fixed.** `buildIdentity()` answers `GET /version` on both editions, on every request, and is called for each problem report and each unreadable-answer line. The read was small and cached by the system, so the wait was short, but it was on a request path. The file is now read once per process; the env stamp is still read on every call and still wins. Shown by `build-identity.unit.test.ts`, *reads package.json once*: three more calls make no more reads; with the old file it saw four reads |
| `packages/shared/src/container-hash.ts:181` | `inflateRawSync` of each member of a zip | on a pass | **Left as it is (D2 below).** Reached only for a rendering this product asked Google Drive to export (ADR-0046), during the file pass and when a WebDAV target is read back. On the appliance, passes share the process with the web server, so an inflate holds up its requests while it runs. Measured here: 1.5 ms for 1 MB of inflated content, 16 ms for 10 MB, 52 ms for 50 MB; Drive refuses to export past a size of its own (`exportSizeLimitExceeded`), which bounds it. The sha256 that every file of every pass already gets is as long again, and is synchronous too, so moving the inflate alone off the event loop would halve the wait, not end it; ending it means making the reconcile core's `contentHash` hook async |
| `apps/selfhost/src/config-dir.ts:77`, `:87` | `readdirSync`, `readFileSync` of the mapping files | (b) | `loadConfigDir` runs once in `start()`, before anything is scheduled or served |
| `apps/worker/src/index.ts:93` | `readFileSync` of `--config` | (b) | the worker CLI's first step, before its first pass |
| `packages/testing/src/testcontainers-setup.ts`, `packages/connectors/src/zip-test-writer.ts`, the `__tests__/` helpers in `apps/api`, `packages/ledger` and `packages/managed` | many | (c) | test support, never imported by product code |

Nothing else turned up: no `existsSync`, `statSync`, `mkdirSync`, `execSync`, `spawnSync`,
`Atomics.wait` or synchronous key derivation in product code. `zip-archive.ts`, which reads
customers' archives, already inflates with the streaming `createInflateRaw`.

**Not done, on purpose.** No test was changed to quiet the check (D1), and nothing was added
whose only purpose is to make it quiet. Test code on `f5c013e` holds about 3,500 synchronous
file, process or zlib calls in some 470 files, most of them the guards in `scripts/` reading the
source they check.

**Decided (the owner, 2026-11-21).** Both as advised:

- **D1, the 24 test spots: leave them as they are.** Each blocks only its own test worker.
  Moving them, or the other test calls of the same shape, to the async variants gains nothing
  at run time.
- **D2, `inflateRawSync` in `container-hash.ts`: leave it as it is.** The stall is bounded by
  the size Drive will export, and the sha256 every file already gets is as long and as
  synchronous. Moving the inflate alone would halve the wait for renderings only; moving all
  hashing off the event loop would change the reconcile core's `contentHash` hook. Neither is
  planned.

**2026-11-24, a second reading (the same check, on `c482f8fd`).** The check came back with the
status "Needs attention" and 25 spots, line 135 of `notifier-wiring.unit.test.ts` again counted
twice. Read on `main` at `7dfe58d9`: twenty-four are spots of the table above, on the lines it
gives. One is new: `apps/selfhost/src/a-fault-the-appliance-answers-with-a-reference.unit.test.ts:45`,
a `writeFileSync` of the test's own temporary mapping file, in a test added on 2026-11-23, kind
(c). `selfhost-queues.integration.test.ts:179` is not on the new list, though its call is still
there. Nothing changed: D1 and D2 stand, and the owner was given the same reason to paste.

## M — A comparison that is not a secret (an outside, read-only check, 2026-11-24)

**Evidence.** An outside, read-only check (JS-07) flagged `packages/connectors/src/caldav-source.ts:744`,
unchanged on `main` since `c482f8fd`, as a comparison of a secret that does not take constant
time. The line is `page.syncToken === next`.

**Read.** It compares the sync token a CalDAV server returned for a page of a `sync-collection`
report (RFC 6578) with the token the client sent for that page, so that a server that keeps
handing back the same token cannot make the sync loop for ever. A sync token is an opaque bookmark:
it travels in plain responses and marks where the next sync starts, and it is not a password, a
key or a code. Both values are the client's own, so a difference in timing reveals nothing. The
check most likely matched the word *token*.

**Decided.** A false positive, read on 2026-11-24; nothing changed. The owner was given a reason
to paste.

## N — The web image's base (an outside, read-only check, 2026-11-24)

**Evidence.** An outside, read-only check (IMG-4) named `apps/web/Dockerfile:94`, the web image's
base: `nginx:1.31.9-alpine-slim`.

**Read.** `nginx:1.31.10-alpine-slim`, pushed on 2026-11-24, moves nginx 1.31.9-r1 to 1.31.10-r1,
and libssl3 and libcrypto3 3.5.9-r0 to 3.5.9-r1, on the same Alpine 3.24 root filesystem (0119's
Status, 2026-11-24, read from Docker Hub's registry).

**Decided.** Fixed by alpha.20's image pins (#2127): `apps/web/Dockerfile` and
`deploy/compose/www.yml` move to `1.31.10-alpine-slim`, on the owner's *"yes on all"* for alpha.20.

## R — An import cycle, a swallowed test error and the start-up hook (an outside, read-only check, 2026-11-24)

**Evidence.** The same outside, read-only check named three findings on `main` at `20038a66`,
each read there and still present on that commit.

**CQ-06, an import cycle: true, fixed.** `apps/api/src/routes/connections.ts:106` (the import
statement that ends at `:113`) imports `./migrations/index.ts` for the shape builders, and
`migrations/index.ts:133` mounts `./cirrux-oauth-routes.ts`. The Cirrux Drive consent there
reached back into the connection routes with `await import('../connections.ts')`
(`cirrux-oauth-routes.ts:251`) for `requalifyStoredConnection`, and its comment said it was lazy
only because of the cycle. Done:

- The family that measures a stored account again moved, word for word, to
  `apps/api/src/routes/qualify-and-remember.ts`: `requalifyStoredConnection`,
  `qualifyAndRemember`, `qualifyAndRememberNow`, `cirruxQualifyDeps`, the door budget and the
  qualification floor. It imports neither `connections.ts` nor `migrations/index.ts`, directly or
  through anything it imports. The database pool moved with it and `connections.ts` uses the same
  one, so the process still opens one pool for both, as before.
- `connections.ts` and `cirrux-oauth-routes.ts` import it statically. The dynamic import and its
  comment are gone; the try/catch and the warn log around the call stay.
- Nothing else changes: the same functions, logs, budgets and audit events.
- `an-organisation-closed-at-every-door.unit.test.ts` counts the three uses of the stored access
  that moved (the decrypt, `qualifyAccount` and the inner `qualifyAndRemember`) in the new file,
  14 rather than 17 in `connections.ts`, and says why the new file asks no close of its own: it
  opens no door, and each caller (the create, the Test and the rotation in `connections.ts`, and
  the Cirrux Drive consent) asks before it.
- `a-qualifier-wired-to-a-guard-that-never-lets-it-run.unit.test.ts`, which reads the qualifying
  guard and dispatch as text, reads them in the new file, and
  `scripts/a-client-the-worker-never-got.unit.test.ts` looks there for the API's
  `cirruxDeploymentClient(` call.
- Guard: `apps/api/src/routes/no-way-back-to-the-connection-routes.unit.test.ts` walks the
  relative static and dynamic imports reachable from `connections.ts` within `apps/api/src` and
  fails on any path back to it. With the old lazy import put back it fails, naming the path
  through `migrations/index.ts` and `cirrux-oauth-routes.ts`. It claims that and no more; it is
  not a survey of other cycles.

**ERR-1, a swallowed test error: true, fixed.**
`packages/orchestration/src/a-dav-source-through-the-managed-door.unit.test.ts:143` ended a
CalDAV and a CardDAV `listFolders()` against the test's fake server with
`.catch(() => undefined)`, and asserted only on the requests that arrived, so any failure at all
was let go. Run, the fake server causes none: it answers every request with an empty
multistatus, and both listings resolve to `[]`. So there was no expected failure to let go, and
the catch is replaced by asserting that outcome, `toEqual([])`. A listing that throws now fails
the test. Nothing else in the test changed. As with the test catches of §K, the catch was made to
let go nothing it cannot name.

**AIR-2b, the assistant's start-up hook: judged false, kept, and guarded.** `.claude/settings.json:3`
registers a `SessionStart` hook that runs `.claude/hooks/session-start.sh`. It stays, because:

- it is the repository's own script;
- its first action is to exit unless `CLAUDE_CODE_REMOTE` is `true`, so on anyone's own computer
  it does nothing;
- in a Claude Code on the web container it runs `pnpm install --frozen-lockfile`, which installs
  exactly the lockfile's versions; without it a fresh web session starts with an incomplete
  workspace, as the script's header explains;
- no setting redirects the model's address, and no MCP server is configured.

Guard: `scripts/a-start-up-hook-read-as-a-risk.unit.test.ts` pins all of that, so a later change
cannot quietly add one. `.claude/settings.json` holds only `hooks.SessionStart` with that one
command; no `env` sets a `*_BASE_URL`, an `ANTHROPIC_*` variable or a proxy; there is no
`apiKeyHelper`, `mcpServers`, `enableAllProjectMcpServers` or `enabledMcpjsonServers`; there is
no `.mcp.json` at the root; the hook's first action is the `CLAUDE_CODE_REMOTE` exit, and every
install it runs uses `--frozen-lockfile`. The hook and the settings file are unchanged.

**Not done, on purpose.** No other import cycle was looked for, and nothing was added for the
check's sake alone. No CHANGELOG entry: nothing a person running Ownpace sees changes.

---

## Out of scope (tracked in feature workplans)
- Runtime RLS enforcement (`SET app.current_tenant` is set nowhere in app code) → **0011 T1**,
  because the fix belongs with the managed-edition API work.
- Replacing the `unified-sync` stub → **0007**; Trigger job payload-cast cleanup → **0011**.
