# Workplan 0178 — SAST and DAST: what reads the code, what tries the running app, and where each runs

> **In one line:** Whether this repository needs more static analysis (SAST) and a test of the running app (DAST): each class of fault against what catches it today, the tools weighed, and four guards, CodeQL and Schemathesis advised, each with its first step, its proof and what blocks.

## Status — 2026-11-27 (update this block at the end of every session)

**2026-11-27, later: the maintainer's decision on T6's rate-limit question, and the limit built
(alpha.22, on `claude/ownpace-public-readiness-y7orc6-a22-api-rate-limit`; not merged).** CodeQL's
largest group on `main`, *missing rate limiting*, counted about 185 results, roughly one per API
route: it recognises only the common libraries, so the doors' own limiters do not count, and the
signed-in routes had none. **The maintainer decided:** one request limit for the whole API, in the
API itself, with `express-rate-limit`, generous and per caller, the doors' stricter limits kept.
Asked how a stack without `TRUST_PROXY` is keyed, the maintainer answered the same day: by
`req.ip` under the configured `trust proxy` on every stack, as the doors are, so without
`TRUST_PROXY` it is one budget for every caller, sized never to bite there; live is per caller
(`stand-up-live.sh` refuses a `TRUST_PROXY` that is not 2 or 3). Not to make `TRUST_PROXY`
mandatory, not to switch the limit off without it, and not to key by anything but the address.

- **Built:** `apps/api/src/api-rate-limit.ts`, mounted once in `index.ts` with
  `app.use('/api', …)` before every `/api` route, `/api/problem-reports` included. 1,200 a minute
  per address, `API_MAX_REQUESTS_PER_MINUTE` to change it, 429 with `Retry-After` and `reason` and
  `reasonNl` as the gift door answers, `/api/ready` never limited, and one line at start saying
  whether this stack's budget is per caller or shared. The billing webhooks stay under it: Mollie
  retries until it gets a 200 and the handler is idempotent (`routes/billing/webhooks.ts`), so a
  429 there is applied later, once. The appliance is its own server and does not run this API.
- **Measured for the default:** `smoke-managed.sh` calls the API from 142 lines, in order, and
  polls every 2 s, so about 175 in its heaviest minute; the managed UI smoke has no API. The
  Schemathesis job sends about ten thousand a minute from one address, so it starts the API with
  the limit raised through the same variable (`SCAN_API_REQUESTS_PER_MINUTE`).
- **Held by** `apps/api/src/one-limit-for-the-whole-api.unit.test.ts` (the mount before every
  `/api` route, seen red with a router moved above it; the burst, `/api/ready`, two addresses,
  the variable on the real app), `scripts/a-limit-the-api-was-never-handed.unit.test.ts` (the
  variable reaches the api container and is documented beside `TRUST_PROXY`) and
  `scripts/a-scan-that-tried-the-running-api.unit.test.ts` (the scan's raised limit). Each was
  seen failing first.
- **Expected on the next scan of `main` after it merges:** that query's count falls to about
  zero. What may stay counted: the handful of routes the API serves outside `/api`, which the
  limiter does not cover.
- **The maintainer's dismissals, the same day:** 96 of CodeQL's alerts dismissed with the reasons
  reviewed under T6 (test-only code, false positives and won't-fix), and 5 reviewed groups had
  already closed on their own. Six more after a second read the same day: five of CodeQL's (four
  in test code, one a false positive, its pattern measured linear on large inputs) and one of
  Semgrep's (a false positive: a link the API issued, not an address a person typed).

**2026-11-27: alpha.21 carries T1 to T5, T7 and T10; T6's reading goes on.** alpha.21, tagged at
`c34b30f8` (0146), carries the four guards (T1 to T4, #2191), CodeQL report only (T5, #2194, and
#2202 after its first runs), Schemathesis against the running API (T7, #2192) and the second
identity at every door (T10, #2193), with three changes from T6's reading (#2203, #2205, #2207).
Schemathesis's first runs on a hosted runner, both dispatched on `main`, passed: run 45926079250 on
`18901d3f` (T7 alone) and run 45928370787 on `4372445e` (with T10). What they found is the
maintainer's, held privately. Its nightly run counts from here, and T8 waits for fourteen quiet
nights (D4). The rest of CodeQL's first list waits on the maintainer's word, alert by alert (T6),
and T9 after it.

**2026-11-26, T10 built (report only, in T7's job).** `scripts/another-organisations-ids.mjs`
asks every secured operation that takes an id for the first seeded organisation's ids with the
second organisation's owner's token, by the path and by the organisation header, and each must
refuse. It runs before Schemathesis, whose deletes (signed as the first owner) were measured to
take the first organisation's seeded mapping and connection away. Its proof is the fixture's
`another-organisation.yaml`: one door that serves whichever organisation it is asked for, read as
a leak, and one that refuses. The guard is red when the leak is taken out of what it flagged.
**Measured locally on this tree:** 213 asks and no leak; the rest of the reading is the
maintainer's, held privately. Every verdict is counted in the summary and no operation of the
API is named. Open: fill request bodies from the description's examples, so the 400s are asked too.

**2026-11-26, T7 built (report only, not yet run on a hosted runner).** `.github/workflows/schemathesis.yml`
runs `scripts/schemathesis-report.mjs` nightly on `main` and on dispatch, held by
`scripts/a-scan-that-tried-the-running-api.unit.test.ts`. What was found and decided while building it:

- **The API starts alone.** With Postgres and nothing else, in local sign-in mode, measured on
  this checkout: both chains applied, `/health` answering, a seeded owner's token accepted by
  `/api/me`. So §12's risk did not happen, and no fake is composed.
- **One network namespace, loopback only.** Postgres runs with `--network none` and the API, the
  fixture and Schemathesis join it, so the kernel gives nothing a route out, not even a host
  Schemathesis made up for a connection test. Postgres and Node are not pinned in the workflow:
  they are read from `deploy/compose/postgres/Dockerfile` and `apps/api/Dockerfile`'s `base`,
  which Dependabot moves. The API connects as `app_user`, whose password the run sets.
- **Schemathesis 4.34.0, not 4.34.2:** 4.34.2 was pushed on 2026-11-24, inside the three-day
  floor. The pin watch's new row `schemathesis/schemathesis` lists 4.34.2 as newer.
- **The proof:** `scripts/fixtures/schemathesis-known-bad/`, run first in every run. Measured
  locally with 4.34.0: both faults flagged. The guard is red when either is taken out of what
  Schemathesis flagged, and a run whose proof does not hold never scans the API.
- **What the public summary names.** Every check is counted, and no operation of the API is
  named under any of them (the maintainer's answer, the same day: counts, no names); the seed is
  given so that a run can be repeated on a stack of one's own (docs/testing.md).
- **The first list, measured locally** at 100 cases per operation (1 min 53 s, 200 operations),
  is the maintainer's, held privately, and goes to the owner as a question.
- **The jobs database (the maintainer's answer, the same day).** The stack gets one on its own
  Postgres: `deploy/compose/jobs-role.sql` as it is, a password of the run's own, and pg-boss's
  queues installed by the worker's own runner. A sync and a cutover then answer 202 with their jobs
  waiting, measured locally, where without one they answered 500.
- **D9 lifted on 2026-11-27:** alpha.21's builder pull requests are on `main`, and `origin/main`
  is merged in, with the routes they add in the description the scan reads.
- **Open:** the first run on a hosted runner (its minutes, and whether the container setup works
  there as composed), dispatched on `main` once this merges.

**2026-11-26, later still: step 1's four guards built, on
`claude/ownpace-public-readiness-y7orc6-a21-sast-guards`, from `main` at `3c61e83`. Not merged:
under D9 the pull request waits for alpha.21's builder pull requests.**

- **The guards.** Each is a `scripts/*.unit.test.ts`; all four parse with the TypeScript
  compiler through one shared reader, `scripts/sast-guard-source.ts`, so a comment or a string
  that only names a thing is never a spot. Each has a named list of places with a reason per
  place, and fails on one more, one fewer, or a file not listed.
  - **G1 (T1)**, `a-page-given-html-as-html`: none in shipped code; two test files, listed.
  - **G2 (T2)**, `sql-a-value-is-put-into`: 28 spots in ten files, each listed with the check
    or the constant that makes it safe.
  - **G3 (T3)**, `a-door-public-in-one-place-only`: 29 public routes, each with the
    description's operations it serves and its reason; the link routes are held to `linkAuth`.
  - **G4 (T4)**, `a-secret-handed-to-the-logger`: measured first. Four spots, all in two
    commands an operator runs by hand, each printing what that operator asked for. Listed, so
    it blocks (D2).
- **Each was seen failing on its fixture.** With the four detectors made to find nothing, 11 of
  the 17 cases failed, every fixture case among them; with the detectors, all 17 pass.
- **G3 found two faults in the API description on `main`,** both the description's, neither a
  hole: `POST /api/gifts/redeem` and `GET /api/scope-manifest` are public on purpose in the
  code, and the description said they need sign-in. Both now carry `security: []`, so the
  description has 33 opt-outs, not the 31 §5.1 counted.
- **Against the builders' branches,** read on 2026-11-26: #2188 and #2189 change nothing any
  guard reads. 0177 step A's back half adds `POST /api/gifts/check`, public, and gives the
  redeem `security: []` too. When it merges, G3's list gains the new door, and the two edits to
  the redeem's description become one. No branch read adds raw SQL or a secret-named log.
- **After 0177 step A (#2198) reached `main` at `f9f24bef`,** merged in: G3 named one new door,
  `POST /api/gifts/check`, public on purpose and described so, and it is in G3's list with its
  reason, so 30 public routes. The redeem's two `security: []` became one. G1, G2 and G4 named
  nothing new: the step's migration is SQL in a `.sql` file, which G2 does not read, and its log
  calls hand over no secret-named value. 0176 step B (#2196) is still to come.
- **After 0176 step B (#2196) reached `main` at `b0f1e140`,** merged in with #2199, #2200,
  #2202 to #2205: the API's routers register 192 routes, one more, and the new one signs a
  session in, so G3's list is unchanged at 30 public routes. G1 finds 2 (the two tests), G2 28
  and G4 4, as before. D9 is lifted.
- **T1 to T4 stay 📋 until the pull request merges.**

**2026-11-26, evening: T5's two runs on `main`, and T6 begun.** #2194 merged as `b31ccaaf`.

- **The first push run, 45886149663**, ran from 19:46:40 to 19:53:45 UTC and passed. CodeQL says it scanned all 2,500 TypeScript files, 66 of 66 JavaScript files, 19 of 19 GitHub Actions files and 1 of 1 HTML file. The report counted 2,689 files extracted. The strict file match held, and so did the floor of 1,000. So the two extraction IDs the report reads are the ones CodeQL writes, and §12's risk, files CodeQL's TypeScript cannot read, did not happen. It found **312 alerts under 17 queries**, uploaded to code scanning.
- **The proof, 45886205833**, was dispatched with `proof=true` on `main`. It ran from 19:53:48 to 20:00:31 UTC and passed. It read the fixture, both `js/sql-injection` and `js/reflected-xss` reported there, and it uploaded nothing. §10's proof is met.
- **Three things the runs showed, all fixed in this pull request, each with the guard's test first:**
  - **The CodeQL that ran was not the one pinned.** The log shows `/opt/hostedtoolcache/CodeQL/2.27.6`, while v4.39.4 ships 2.27.5. Left without `tools:`, the action takes the runner's tool cache when it holds a newer CodeQL. `tools: linked` makes it the bundle the pinned release names, which is what the workflow, the pin watch's row and `docs/testing.md` already said.
  - **One waiting run per concurrency group.** The group was `codeql-${{ github.ref }}`. So a dispatch waiting behind a push run on `main` would have been replaced by the next push, and the proof could only wait. The group is now `codeql-${{ github.event_name }}-${{ github.ref }}`: one queue per event, and still never cancelled.
  - **The summary says counts by query only.** This repository is public, and so is a run's summary, while code scanning's list is readable only with write access. Until now `scripts/codeql-report.mjs` also listed each alert in the summary, with its file and line. Now no alert's file, line or message is written anywhere but code scanning. The known-bad fixture is still named, with whether each of its two queries reported there.
- **Alert by alert: not read yet.** T6's reading of the list follows in a docs pull request of its own.

**2026-11-26, later still: H, the two hardening fixes, in #2190.** It is recorded here at the maintainer's request, though H is outside this plan's tasks. The consent endings' escape now also escapes `"` and `'`, so it is safe in a quoted attribute. The WebDAV archive store refuses a path with a `.` or `..` segment before any request. The tests were written first and failed on the old code. Neither change was reachable from outside. The maintainer merges it once its E2E is green.

**2026-11-26, later still: T5 built, report only; its proof and its first run are still to come.**
`.github/workflows/codeql.yml` runs CodeQL's default suite for JavaScript and TypeScript on a
push to `main`, on Wednesdays and on dispatch, never on a pull request, on `ubuntu-24.04`, with
`contents: read` and `security-events: write` alone. It blocks nothing: no alert fails it, and it
is in no ruleset (D1 (a), D8 (a)).

- **Pinned.** `github/codeql-action` v4.39.4 at the commit `semgrep.yml` and `security-scan.yml`
  already upload with, not the v4.39.5 §4.1 named. That release was tagged on 24 November, so on
  this day it was under the three days CONTRIBUTING.md asks of a release, and a second commit
  would have split the copies. v4.39.4 ships CodeQL 2.27.5, read from its `src/defaults.json`.
  The pin watch has a row `CodeQL`: every copy held to one commit, named with its bundle, against
  upstream's git tags. It lists v4.39.5 as newer, and Dependabot's `github-actions` entry
  proposes the move.
- **A scan that did not finish is red.** `scripts/codeql-report.mjs` reads the SARIF and writes
  every alert to the summary, by query. It fails on no SARIF, on a file CodeQL could not extract,
  and on a source file the checkout tracks that CodeQL does not say it extracted (§12's risk).
- **The proof (§8 step 2).** `scripts/fixtures/codeql-known-bad/handler.mjs` is an Express
  handler that puts `req.query` into a string-built SQL query and into `res.send`. The ordinary
  run leaves it out (`.github/codeql/codeql.yml`). A dispatch with `proof` reads it as well,
  uploads nothing, and is red unless `js/sql-injection` and `js/reflected-xss` are both reported
  there.
- **Held by** `scripts/a-flow-across-files-nothing-followed.unit.test.ts`: the triggers, the
  pins, the permissions, the two configurations differing by the fixture alone, nothing under
  `apps`, `packages`, `site`, `deploy` or `test` naming the fixture, and the report against
  stubbed SARIF. The guard's 22 tests and the pin watch's 143 pass, and zizmor 1.33.1 finds
  nothing under either persona.
- **Not yet proved, and the maintainer's to run.** The proof dispatch on the branch, and the
  first run on `main` with every file extracted (§10). Neither was run: this session dispatches
  no workflow. One part is read here, not seen: the IDs `…/diagnostics/successfully-extracted-files`
  and `…/diagnostics/extraction-errors` that the report reads extraction by. If CodeQL's SARIF
  names them otherwise, the first run is red with every file listed as not extracted. That is
  loud, never a false green, and the fix is one line. T6 reads the first list from `main`.

**2026-11-26, later: the owner's answers, D1 to D9 (T0).** In the owner's words:
*"D1–D9: as advised. H: yes. All in this alpha"*. D9 is the maintainer's addition, put to the
owner beside D1 to D8 (§9). *"H"* is about two fixes outside this plan, and this plan does not
record them.

**What the answers change.**

- **Every decision takes its advice:** CodeQL as a workflow of its own, report only (D1); the
  four guards, G1 to G3 blocking at once and G4 after it is measured (D2); DAST only on a stack
  the job composes on a GitHub-hosted runner (D3); Schemathesis nightly first, then per pull
  request blocking two checks (D4); ZAP parked (D5); no nuclei, header or TLS checks in CI
  (D6); the second identity (D7); CodeQL's ReDoS queries report only until T6's reading (D8);
  CodeQL now, and the guards and Schemathesis after alpha.21's builds are merged (D9).
- **All in this alpha:** step 1 (T1 to T4), step 2 (T5, T6), step 3 (T7) and T10 are built for
  alpha.21. **T8 and T9 keep their own rules,** so either may fall after the alpha's release:
  T8 waits for 14 quiet nights on `main` (D4), and T9 for T6's reading and the owner's word on
  each query (D8).
- **Who builds what:** T1 to T4 by this plan's analyst session, on a branch of their own, merged
  only after alpha.21's builder pull requests (D9), with each guard's list of named places
  brought up to date with what those add; T5 and T6 by a new session; T7 and then T10 by
  another new session.

**2026-11-26: planned. Nothing is built, nothing is changed, and no workflow was dispatched.**
The owner asked: *"reason if and where and how we need to add SAST and DAST."* This plan is
the reasoning, the options and the advice. The owner decided D1 to D9 later the same day (the entry above).

**The answer in short.**

- **SAST: today's set is close to enough, with four gaps.** Most classes of fault are held by
  this repository's own guards, which know the code better than a generic scanner can (§3).
  Four are held by nothing systematic: raw SQL built outside the tagged template, HTML put into
  a page as HTML, a route that opts out of sign-in in the API description without the code
  agreeing, and a secret or personal value handed to the logger by name. Each gets a guard of
  the house kind (§5.1). **CodeQL is the one scanner worth adding** (§4.1): it follows a value
  from a request across files, which Semgrep's free engine cannot, and it is free for a public
  repository. It reopens 0163's *"CodeQL not now"* (D1).
- **DAST: yes, one tool, in one place.** Schemathesis, from `apps/api/docs/openapi.yaml`,
  against the API composed on a GitHub-hosted runner by the job itself, with tokens the run
  mints for its own seeded test members (§6). Its main value is one question no static check
  answers: does an operation the description says needs sign-in really refuse a request
  without one. Nightly on `main` and report only first; per pull request, blocking two checks,
  once `main` is quiet (D4).
- **Not advised now:** ZAP (§6.4, D5), nuclei and TLS checks in CI (D6), Trivy's config scan,
  KICS and ESLint's security plugins (§4.3, §4.4).
- **Never** against the live service, the acceptance stack or any machine of the owner's. The
  managed E2E's stack is long-lived and runs on the shared machine, so this plan advises
  against it as a target too (§6.1, D3).

**What was measured.** One local run, on this checkout only: ESLint's security plugin, 4.2.1,
its recommended rules, over `apps`, `packages`, `site` and `scripts` (§4.4). Nothing else was
run. CodeQL's and Schemathesis's numbers on this tree are not known yet: T5 and T7 measure them
before anything blocks.

**Every claim about the code was read at `fc78f79`,** which is `main` on 2026-11-26.

**The order.** §8. Step 1 is the four guards, which need no new tool. Step 2 is CodeQL,
report only. Step 3 is Schemathesis, nightly and report only. Each later step waits for the
one before it to be quiet on `main`.

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The owner's decisions, D1 to D9 | owner | ✅ Answered 2026-11-26 | §9. *"D1–D9: as advised."* All built in alpha.21 but T8 and T9, which keep their own rules. |
| T1 Guard: no HTML put into a page as HTML, outside a named list | builder | ✅ Merged, alpha.21 (#2191, `11e1df10`) | §5.1 G1. Zero spots today, so it blocks at once. S. By the analyst session, after alpha.21's builds (D9). |
| T2 Guard: raw SQL only at named places, each with its check | builder | ✅ Merged, alpha.21 (#2191, `11e1df10`) | §5.1 G2. Today's places listed with their checks. Blocks. S. By the analyst session, after alpha.21's builds (D9). |
| T3 Guard: every door either signs in, or is public in the code and in the API description alike | builder | ✅ Merged, alpha.21 (#2191, `11e1df10`) | §5.1 G3. The static half of class 9. Blocks. M. By the analyst session, after alpha.21's builds (D9). |
| T4 Guard: a secret-named key handed to the logger | builder | ✅ Merged, alpha.21 (#2191, `11e1df10`) | §5.1 G4. Measured first; blocks only if quiet. S. By the analyst session, after alpha.21's builds (D9). |
| T5 CodeQL, report only: push to `main`, weekly, dispatch | builder | ✅ Merged, alpha.21 (#2194, `b31ccaaf`; #2202 after its first runs) | §4.1, §8 step 2. D1. Not on pull requests. `codeql.yml`, its report, its fixture and its guard; the Status entry of that day. |
| T6 CodeQL's first list, read alert by alert | builder | 🔄 Read in alpha.21; three changes merged (#2203, #2205, #2207); 102 alerts dismissed by the maintainer 2026-11-27 (96, then six more: five of CodeQL's, one of Semgrep's); the whole API's request limit built for alpha.22 (the maintainer's decision of 2026-11-27), not merged | §8 step 2. As 0166 read Trivy's and Semgrep's. 312 alerts under 17 queries on `b31ccaaf`; the Status entry of that evening. |
| T7 Schemathesis against the API on a GitHub-hosted runner, nightly, report only | builder | ✅ Merged, alpha.21 (#2192, `18901d3f`); first hosted run 45926079250, green | §6, §8 step 3. D3, D4. With a known-bad fixture it must flag. M. By a new session, after alpha.21's builds (D9). |
| T8 Schemathesis on every pull request, two checks blocking | builder | 📋 Planned | §8 step 4. After T7 is quiet on `main` for 14 nights (D4), so it may fall after alpha.21's release. S. |
| T9 CodeQL queries that may block, one at a time | builder | 📋 Planned | §8 step 5. After T6's reading and the owner's word per query (D8), so it may fall after alpha.21's release. S each. |
| T10 A second identity: another organisation's ids refused at every door | builder | ✅ Merged, alpha.21 (#2193, `4372445e`); first hosted run 45928370787, green | §6.3, §8 step 6. D7. M. By the T7 session, after T7. |
| T11 ZAP, baseline or API scan | — | 🅿️ Parked | §6.4. D5. Trigger: the app gains cookies, or pages the server renders beyond today's. |

## 1. Why, and the doctrine

The outside, read-only checks of November found faults after the merge (0006 §M to §V, 0163
§3). Each one had a class, and 0163 added a tool or a guard for most classes. This plan asks
the next question: which classes does nothing look for yet, and would a static scanner or a
test of the running app find them.

The doctrine is 0163's, and nothing here changes it:

- **Named rules, not whole packs.** A tool runs a list this repository chose, each rule for a
  class it can name.
- **Report first.** A new check lists what it finds and fails nothing, until its first list has
  been read spot by spot.
- **Block only what is proved.** A rule fails the build once it reports nothing on `main`, and
  once a known-bad case shows that it still sees the fault.
- **Pinned and kept current** by the pin watch (`scripts/idp-pin-watch.mjs`), and a scan that
  did not finish is never green (`security-scan.yml`'s rule).

## 2. What runs today

Read in the files at `fc78f79`. Each line was checked; none is taken from the brief.

| Kind | What | Where | Blocks |
|---|---|---|---|
| SAST | Semgrep, eight named rules fetched by id | `.github/workflows/semgrep.yml`, `scripts/semgrep-report.mjs` (`RULES`) | One rule, `run-shell-injection`; two ReDoS rules never (0163 D3); five report |
| SAST | The code scanning list | Trivy's repository and image scans and Semgrep upload SARIF; nothing else does (0166 §1.1) | No |
| SAST | ESLint, type-aware, no security plugin; `tsc` | `eslint.config.js`, `ci.yml` | Yes |
| SAST | The repository's own guards, about 300 `scripts/*.unit.test.ts` and others beside the code | `ci.yml`, indexed in `docs/LESSONS.md` | Yes |
| Dependencies | `pnpm audit`, read by `scripts/audit-advisories.mjs` | `security-scan.yml` | Yes, on high and critical |
| Dependencies | osv-scanner over `pnpm-lock.yaml` | `security-scan.yml` | Yes on a malicious package; vulnerabilities report (0163 D1) |
| Dependencies | Dependabot | `.github/dependabot.yml` | Opens pull requests |
| Secrets | gitleaks over a pull request's own commits | `ci.yml` job `gitleaks`, `.gitleaks.toml` | Yes |
| Workflows | zizmor | `zizmor.yml` | Yes |
| Images | Trivy image scans, weekly and on dispatch (`image_scans`); hadolint; the Images workflow; the SBOM | `security-scan.yml`, `hadolint.yml`, `images.yml` | Trivy and hadolint report |
| Migrations | Atlas lint; squawk | `ci.yml` `migration-lint`; `migration-locks.yml` | Atlas yes; squawk reports |
| The browser | The app's headers: scripts, sending, framing, HTTPS only, no Referer | plan 0158; `scripts/what-a-browser-may-do-with-the-app.unit.test.ts`; `scripts/app-headers.mjs` at a deploy | Yes |
| Row security | Two `*-under-row-security.integration.test.ts`, seventeen `*-under-rls*` tests, `force-rls.unit.test.ts` and `force-rls-managed.unit.test.ts` | `apps/api`, `apps/worker`, `packages/ledger`, `packages/managed` | Yes |
| Running stacks | E2E: `e2e.yml`, `e2e-managed.yml`, `e2e-live-target.yml`, all on the self-hosted runner, nightly or on dispatch; the managed UI smoke over the built bundle on every pull request (`test/ui/managed-ui.ui.test.ts`) | | E2E blocks nothing by itself; the UI smoke yes |
| From outside | The exposure probe | `exposure-probe.yml` | — |

**What is not there.** No CodeQL analysis runs: no workflow, and 0166 counted no CodeQL upload.
No test of the running API is generated from its description. Nothing scans a running stack for
faults; the E2E tests prove that it works, not that it refuses.

## 3. Each class of fault against what catches it

"A guard" means a test in this repository that reads the code or runs it, named by file. "A
rule" means one of Semgrep's eight.

| Class | What catches it today | What is missing |
|---|---|---|
| **Injection through raw SQL** | The ledger builds queries with the tagged template and `$n` parameters. The few places that put a value into the text each check it first against a pattern or a constant list (`assertRoleName`, tested in `rls-in-force.unit.test.ts`). | **Nothing lists those places.** A new `sql.raw(` or a string-built `.query(` is caught by review only. G2 (§5.1); CodeQL's `js/sql-injection` would follow a request value to one (§4.1). |
| **SSRF through a host or URL a person gives** | **Held.** `packages/shared/src/reachable-host.ts` checks each address after resolution and connects to the address it checked. `scripts/a-client-that-reaches-a-tenant-host.unit.test.ts` holds every client to it; `scripts/a-rule-nothing-switched-on.unit.test.ts` holds that the managed API switches it on; three unit tests in `packages/shared` and `packages/core` hold the refusals. | Nothing. A generic SSRF query would flag the guarded clients as false positives. |
| **Open redirect** | **Held in the web app.** `apps/web/src/services/address-to-follow.ts` refuses any address that is not `https:` on the one host its flow expects (0163 T4); `a-grant-button-that-goes-only-to-google.unit.test.tsx` holds it. The API sends no redirect of its own. Rule `js-open-redirect-from-function` reports. | Nothing new. CodeQL's client-side redirect query is a second opinion. |
| **XSS, and `dangerouslySetInnerHTML`** | No `dangerouslySetInnerHTML`, `innerHTML` assignment or `document.write` outside tests today. The API's few HTML pages use a JSON-in-script encoder and a hash-based CSP; tested. The site's build escapes. 0158's headers. Rules `react-href-var` and `unknown-value-with-script-tag` report. | **Nothing keeps the count at zero.** G1 (§5.1). CodeQL's XSS queries for the pages the API renders (§4.1). |
| **Path traversal** | Archive members are lookup keys, never paths (`archive-tree.ts`). The appliance's static files check a prefix and refuse NUL (`static-ui.ts`). Rule `path-join-resolve-traversal` reports. | No shared rule for a path built from a remote name. CodeQL's `js/path-injection` follows one across files. |
| **ReDoS** | Rules `detect-non-literal-regexp` and `detect-redos`, never blocking (0163 D3); some inputs capped in length. | **A check that knows whether input reaches a pattern.** Semgrep's rules read how a pattern is built. CodeQL's `js/redos` and `js/polynomial-redos` read the pattern itself and follow input to it (§4.1, D8). |
| **Prototype pollution** | No deep merge in the code; bodies are parsed by schemas; dynamic keys come from fixed lists. | Nothing keeps it so. CodeQL's `js/prototype-pollution` and `js/prototype-polluting-assignment` (§4.1). |
| **Token and JWT checks** | **Held.** `apps/api/src/middleware/auth.ts` verifies against the issuer's keys with issuer, audience and required claims, and pins the algorithm in local mode; `auth-verify.unit.test.ts`, `auth.unit.test.ts` and the issuer guards hold it. Grant links and gift codes are random, stored as a hash and compared in constant time; tested. | Nothing for a scanner. |
| **Authorisation that a route forgets** | Each router signs in itself. `openapi-spec.unit.test.ts` holds that the description lists every router and route, and that sign-in is the default. The door guards (`a-hold-that-holds-every-door`, `an-organisation-closed-at-every-door`, `a-route-that-opened-the-owners-pool`). Row security under the tenant's data. | **Two gaps.** Nothing ties an operation's `security: []` in the description to whether its handler signs in (G3, §5.1). And nothing sends a request without a token to every operation of a running API (Schemathesis, §6). |
| **Logging of secrets or personal data** | The shared logger strips the value-carrying fields of an error; the access log strips links and OAuth's code and state; `a-log-that-kept-the-link.unit.test.ts`, `a-database-fault-logged-without-its-values.unit.test.ts` and four `scripts/` guards. | **A value handed to the logger by name** is printed as given. G4 (§5.1); CodeQL's `js/clear-text-logging` (§4.1). |
| **Unsafe configuration in compose files and Dockerfiles** | **Held.** `a-dockerfile-that-ends-as-root`, `a-privilege-no-service-uses`, `a-port-published-on-purpose`, `a-network-the-tenant-cannot-see` and five more image guards; hadolint; Trivy's image scans. | Nothing. Trivy's config scan reads no compose file and repeats hadolint (0163 §4.4). |

**What got past before.** 0006's records of outside findings (§M to §V) are, by class: errors
dropped, an SBOM's list, a door open on purpose, a path from the command line, an address
followed, a comparison read as a secret's, and HTML built from constants. Every one was either a
false positive or a fault of a kind this table now holds. None was a fault in a running app
that only a dynamic test could have seen. That is a reason to keep DAST small (§6).

## 4. SAST: the options weighed

### 4.1 CodeQL for JavaScript and TypeScript

- **What it would add.** Taint tracking across files and functions, from a request to a sink.
  Of the queries in its default suite, these answer classes in §3 that nothing follows today:
  `js/sql-injection`, `js/path-injection`, `js/reflected-xss` and `js/xss`,
  `js/prototype-pollution` and `js/prototype-polluting-assignment`, `js/redos` and
  `js/polynomial-redos`, `js/clear-text-logging`, and `js/client-side-unvalidated-url-redirection`.
  Semgrep's free engine tracks taint within one function only (below), so it cannot see a body
  read in a route and used in a store.
- **What it costs.**
  - **Money:** none. Code scanning is available for public repositories on GitHub.com
    ([GitHub Docs, *Configure code scanning*](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning),
    read through a search on 2026-11-26), and standard GitHub-hosted runners are free for a public
    repository (`ci.yml`'s header, the owner's own reading; and
    [Microsoft Learn, *What is code scanning?*](https://learn.microsoft.com/en-us/training/modules/configure-code-scanning/2-what-code-scanning),
    2026-11-26). GitHub's billing page could not be read from where this plan was written.
  - **Minutes:** not measured. A tree of this size (about 2,500 source files) is expected to
    take ten to twenty minutes per run on a hosted runner. T5 measures it.
  - **False positives:** not measured. The default suite is the precise one;
    `security-extended` is noisier and is not proposed. The likeliest false positives are the
    SSRF query on clients `reachable-host.ts` already guards, and ReDoS on patterns that read
    this repository's own files.
- **How it fits 0163.** As a workflow of its own (advanced setup), not GitHub's default setup:
  the workflow pins `github/codeql-action` by commit (v4.39.5, released 24 November, with
  CodeQL bundle 2.27.6;
  [releases](https://github.com/github/codeql-action/releases), read 2026-11-26), runs on a push
  to `main`, weekly and on dispatch, and uploads to code scanning beside Trivy and Semgrep.
  **Not on pull requests at first**, for the reason `semgrep.yml` gives: code scanning adds a
  check of its own to a pull request, which can fail on a new alert, and this repository
  decides itself what blocks. A query blocks later only through a report script of
  `semgrep-report.mjs`'s kind, which reads the SARIF and fails on the named queries alone (T9).
- **A risk to measure.** CodeQL parses TypeScript with its own bundled compiler, not this
  repository's TypeScript 7. Every source rule here (`erasableSyntaxOnly`, extensions on
  imports) is plain TypeScript, so it should parse; T5's first run says whether every file
  was extracted, and a file that was not is a scan that did not finish.

### 4.2 Semgrep: taint mode, or more named rules

- **Taint mode** in Semgrep's free engine follows a value within a single function
  ([Semgrep, *Semgrep AppSec Platform versus Semgrep Community Edition*](https://semgrep.dev/docs/semgrep-pro-vs-oss);
  cross-file taint needs the paid engine,
  [*Perform cross-file analysis*](https://semgrep.dev/docs/semgrep-code/semgrep-pro-engine-intro);
  both read 2026-11-26). In this code a body is read in a route and used in a store or a
  client, in another file. Taint rules here would see little, and they already reach Semgrep's
  time limit on this tree (`semgrep.yml`'s header on `react-href-var`). **Not advised.**
- **More named rules.** Each gap in §3 that a pattern can hold is held better by a guard in the
  house style (§5.1): it knows the list of allowed places by name, gives its reason in the
  repository's words, and needs neither the registry nor the Semgrep Rules License question that
  0163 D3 raised. **Not advised, except as 0163 already plans** (each of the eight blocking
  when it is quiet).

### 4.3 Trivy's config scan, or another IaC check

- **Trivy's config scan** read 14 Dockerfiles and no compose file on this tree, and repeated
  hadolint and a guard (0163 §4.4, measured with v0.76.2). **Not advised.**
- **KICS** (v2.2.1, released 9 November;
  [releases](https://github.com/Checkmarx/kics/releases), read 2026-11-26) is said to read
  compose files. Its platform page could not be read from where this plan was written, so that
  is unverified. The compose classes that matter here (privileged services, a socket mounted,
  a port on every interface, root) are each held by a guard (§3). **Not advised.**

### 4.4 ESLint security rules

Measured on this checkout, 2026-11-26: `eslint-plugin-security` 4.2.1 (npm registry, last
modified 2026-10-30), its recommended rules, over `apps`, `packages`, `site` and `scripts`. It
read 2,531 files in 31 seconds and reported 5,423 spots, 1,274 outside test files:

| Rule | All | Outside tests |
|---|---|---|
| `detect-object-injection` | 2,528 | 1,016 |
| `detect-non-literal-fs-filename` | 2,317 | 153 |
| `detect-non-literal-regexp` | 355 | 23 |
| `detect-unsafe-regex` | 197 | 80 |
| `detect-possible-timing-attacks` | 26 | 1 |

Every rule flags a shape, not a flow: any `obj[key]`, any file name that is not a literal. The
two ReDoS rules repeat Semgrep's. The one timing spot outside tests is a release script that
compares a file's checksum, not a secret. **Not advised:** no rule could ever block honestly, and a list of a
thousand is not read. Microsoft's `@microsoft/eslint-plugin-sdl` (1.1.0, npm registry,
2026-11-20) has rules such as `no-inner-html`; G1 holds the same thing with this repository's
own list.

## 5. SAST: what is advised

### 5.1 Four guards, in the house style

Each is a `scripts/*.unit.test.ts`, joins `docs/LESSONS.md` by its header, and has a known-bad
case in its own test: a fixture source text the guard must refuse, as every guard here proves
itself.

- **G1 (T1). No HTML put into a page as HTML.** Refuses `dangerouslySetInnerHTML`, an
  assignment to `innerHTML` or `outerHTML`, `insertAdjacentHTML` and `document.write` in
  `apps/`, `packages/` and `site/`, outside a named list with a reason per entry. **Today's
  list is empty.** Known-bad: a fixture component with `dangerouslySetInnerHTML`. **Blocks.**
- **G2 (T2). Raw SQL only at named places.** Finds `sql.raw(`, `.unsafe(` and a `.query(` whose
  text is a template with a substitution or a concatenation, and holds each to a list: the
  file, and the check that comes first (a pattern, or a constant list). Today's places are
  those §3 names. Known-bad: a fixture `.query(\`… ${id}\`)`. **Blocks.**
- **G3 (T3). Every door signs in, or is public in both places.** For each operation in
  `apps/api/docs/openapi.yaml` with `security: []` (31 today), the router that serves it is in
  a list of public doors with its reason (a probe, a public request form, a payment
  provider's call, a link that is its own credential, and the rest); and every router that is
  not in that list calls `authenticate` before any handler. `openapi-spec.unit.test.ts`
  already matches routes to the description, so G3 adds the one link it lacks. Known-bad: a
  fixture router that serves an operation the description secures, with no `authenticate`.
  **Blocks.**
- **G4 (T4). A secret-named key handed to the logger.** Finds a call to the shared logger
  whose argument holds a key named like a credential (`password`, `secret`, `token`,
  `refreshToken`, `authorization`, `cookie`) or a mail address. **Measured first:** if `main`
  has none, it blocks; if it has some, each is read, and it blocks once they are answered.
  Known-bad: a fixture `log.info({ password })`.

### 5.2 CodeQL, report only first (T5, T6, T9)

§4.1, and §8 steps 2 and 5.

## 6. DAST

### 6.1 Where it may run

**Only against a stack the job composes itself, on a GitHub-hosted runner, reached at the
runner's own loopback, and removed with the runner.** Never the live service, never the
acceptance stack, never any machine of the owner's, never a deployed host.

**Not the managed E2E's stack.** `e2e-managed.yml` says why itself: it runs against a
long-lived stack that keeps its databases, its identity provider and its `.env` between runs,
on the self-hosted runner, and during the alpha that machine holds live (`ci.yml`'s header).
A scan there would write junk into a stack the next run uses, compete with the E2E for one
machine, and run beside testers' credentials. It is not a throwaway stack, so this plan
advises against it (D3).

**What the job composes.** The API from this checkout, with Postgres as a service of the job,
both migration chains applied at start-up as `runMigrations` does, in local sign-in mode with a
secret the run makes for itself (24 random bytes, masked, as the E2E's passwords are since
0163). No identity provider, no mail, no outside provider. The integration tests already run
Postgres on these runners, so nothing new is needed underneath.

**The test identities.** The E2E's own: seeded members of a test organisation, with tokens the
run signs, as `deploy/compose/smoke-managed.sh` signs them for its seeded members. A second
organisation for §6.3. The managed sign-in through an issuer is not exercised; its unit tests
hold it (§3).

### 6.2 Schemathesis (advised)

- **What it is.** Property tests generated from the OpenAPI description: every operation is
  called with generated input, valid and invalid, and each answer checked. Version 4.34.2,
  released 2026-11-24 ([PyPI](https://pypi.org/project/schemathesis/), read 2026-11-26); its
  GitHub Action is 3.1.0, released 18 October
  ([releases](https://github.com/schemathesis/action/releases), read 2026-11-26). The
  description is OpenAPI 3.1.0 with 171 paths, a bearer scheme applied by default and 31
  opt-outs.
- **What it would catch that nothing does.**
  - **An operation declared secured that answers without a token** (its `ignored_auth` check).
    That is the running half of class 9, and the one question in this plan no static check
    answers.
  - **A 500 on input the description allows or refuses** (`not_a_server_error`): an unmasked
    crash, which rule 9 of `AGENTS.md` wants loud.
  - An answer whose status or body the description does not allow (`status_code_conformance`,
    `response_schema_conformance`). `openapi-spec.unit.test.ts` holds the description to the
    routes; this holds it to the answers.
- **Authenticated, and not.** Both: every operation once with a seeded member's token, and once
  without, which is what `ignored_auth` needs.
- **Cost.** Free on a hosted runner. The run's length is set by a cap on examples per
  operation; T7 measures it, and the aim is under ten minutes nightly and under five per pull
  request. False positives: the description's conformance checks will find real mismatches
  first, which are documentation faults; that is why they never block (§8).

### 6.3 A second identity (later)

With two seeded organisations, every operation that takes an id is called with the other
organisation's ids and must not answer with its data. Row security holds this at the database;
this would hold it at the door, where a connection that is not under row security could open it
(the class `a-route-that-opened-the-owners-pool` guards). It is a short script of this
repository's own beside Schemathesis, not a tool. D7.

### 6.4 ZAP, nuclei, and header and TLS checks (not advised now)

- **ZAP baseline** (`zaproxy/action-baseline` v0.15.0, released 24 October,
  [releases](https://github.com/zaproxy/action-baseline/releases), read 2026-11-26; the page
  shows no year) is a passive scan: it reads answers for headers, cookies and leaks. The app sets
  no cookies, its headers are held by 0158's guard and checked at each deploy, and the API's few
  pages have their own tested headers. It would report what is already held.
- **ZAP API scan** (`zaproxy/action-api-scan` v0.10.0, released 24 October,
  [releases](https://github.com/zaproxy/action-api-scan/releases), read 2026-11-26) is an
  active scan from the same description: injection payloads at every parameter. It overlaps
  Schemathesis, is slower (an active scan of 171 paths is expected to take tens of minutes), and
  its injection findings are mostly about server stacks this code does not have. Parked (T11,
  D5).
- **nuclei** (v3.11.1, released 8 August,
  [releases](https://github.com/projectdiscovery/nuclei/releases), read 2026-11-26) runs
  templates for known products' known faults. Against an API this repository wrote, nearly
  every template is beside the point, and the stack's products are scanned as images already.
  Not advised (D6).
- **Header and TLS checks.** Headers are held (0158). A stack on a runner's loopback has no real
  TLS to check, and the deployed service is the exposure probe's ground, which this plan leaves
  to it and does not repeat. Not advised (D6).

### 6.5 Staying out of the E2E's way

- **It never takes the self-hosted runner.** Every DAST job runs on `ubuntu-24.04`. A
  `pull_request` trigger never reaches the self-hosted runner (`ci.yml`'s policy), and the
  nightly runs on a hosted runner too. So it never competes with the one self-hosted E2E that
  runs at a time, never holds that machine's Docker, and cannot run between R1 and R2 of a
  deploy, because it never runs on the machine a deploy uses.
- **It needs no secret.** The run makes its own; no `secrets.*` and no `environment:`.
- **A guard holds that** (part of T7): the workflow's every `runs-on` is a GitHub-hosted label,
  it reads no secret, its target is the runner's loopback only, and it shares no
  `concurrency` group with an E2E workflow.
- **Its time.** The nightly is placed clear of the E2E's firings, though on separate runners
  this only spreads GitHub's queue.

## 7. What blocks and what reports

| Tool | Reports | Blocks, and when |
|---|---|---|
| G1, G2, G3 | — | At once: each is quiet on `main` by construction |
| G4 | Until its first list is answered | Then |
| CodeQL | Every query, into code scanning | A named query, once it reports nothing on `main` and the owner agrees (T9, D8) |
| Schemathesis `ignored_auth`, `not_a_server_error` | Nightly first | Per pull request, after 14 quiet nights on `main` (T8) |
| Schemathesis conformance checks | Always | Never: a mismatch is a fault of the description, fixed in its own change |
| The second identity (§6.3) | First runs | Once quiet, with the two above |

## 8. The steps, in order

Each step is its own pull request, and each proves itself with a known-bad case before it
counts.

1. **The four guards (T1 to T4).** No new tool. Proof: each guard's own fixture, refused. G1 to
   G3 block; G4 as §5.1 says.
2. **CodeQL, report only (T5, then T6).** One workflow, `codeql.yml`, pinned by commit, on a
   push to `main`, weekly and on dispatch, the default suite, uploading to code scanning.
   **Proof:** the run on the branch that adds it is dispatched with one extra source root, a
   fixture file outside the shipped code with an Express handler that passes `req.query` into a
   string-built SQL query and into `res.send`. The run must report `js/sql-injection` and
   `js/reflected-xss` there, or the workflow is not reading what it should. The fixture stays,
   excluded from the normal run's paths and read by the proof on each dispatch that asks for
   it. Then T6 reads the first list from `main`, alert by alert, as 0166 did.
3. **Schemathesis, nightly, report only (T7).** A workflow on `ubuntu-24.04`: Postgres as a
   service, the API from the checkout in local sign-in mode with a per-run secret, the seed, the
   tokens, then Schemathesis pinned by version (and the Python it runs on, by the image's
   digest), checks `not_a_server_error`, `ignored_auth`, `status_code_conformance` and
   `response_schema_conformance`, a cap on examples, and a summary per operation. **Proof
   first, in the same job:** a fixture server of a few lines with its own two-operation
   description, one operation declared secured that answers without a token and one that
   throws. Schemathesis runs against it before the API, and must flag `ignored_auth` on the
   first and `not_a_server_error` on the second; if it does not, the run did not finish and is
   red. Its guard (§6.5) holds the job to the runner and to no secret.
4. **Schemathesis per pull request (T8).** After 14 quiet nights on `main`, the same job on
   every pull request, with a smaller cap, blocking on `ignored_auth` and `not_a_server_error`
   only. It becomes a required check by its job's name, as Semgrep's did, and so has no
   `paths:` filter.
5. **CodeQL queries that may block (T9).** One query at a time, each quiet on `main`, read
   through a report script that fails on that query alone. The fixture of step 2 is its
   known-bad case.
6. **The second identity (T10).** §6.3, with the step 3 job. Proof: a fixture route in the
   fixture server that answers another organisation's id; the script must flag it.

## 9. Decisions for the owner

- **D1. Add CodeQL, which 0163 D3 set aside on 2026-11-20 (*"CodeQL not now"*)?**
  (a) Yes, a workflow of its own, report only, on `main`, weekly and on dispatch, not on pull
  requests. (b) GitHub's default setup, switched on in the settings: no file to keep, but it runs
  on pull requests with a check this repository does not control. (c) Not now.
  **Advice: (a).** It is the one tool that follows a request's value across files, which is
  what four of §3's gaps need, and it costs nothing here but minutes. 0163 chose Semgrep because
  its version could match the outside check's; that still holds for Semgrep, and CodeQL is
  added beside it, not instead.
- **D2. The four guards, G1 to G4, with G1 to G3 blocking at once?** (a) Yes. (b) Report only
  first. **Advice: (a).** Each is quiet on `main` by construction, each names its allowed places
  with a reason, and a guard cannot be quieted by a comment in the code.
- **D3. Where DAST runs.** (a) Only on a stack the job composes on a GitHub-hosted runner.
  (b) Also against the managed E2E's stack. **Advice: (a).** That stack is long-lived, on the
  shared machine, beside live during the alpha (§6.1).
- **D4. Schemathesis: nightly on `main` and report only first, then per pull request, blocking
  `ignored_auth` and `not_a_server_error` only?** (a) Yes. (b) Nightly and report only for
  good. (c) Not at all. **Advice: (a).** A route that forgets sign-in is the fault this
  repository most needs to see before a merge, and a nightly only sees it after.
- **D5. ZAP.** (a) Not now, parked with its trigger (T11). (b) The baseline scan, weekly,
  report only. (c) Baseline and API scan, weekly, report only. **Advice: (a).** It would report
  what 0158 and Schemathesis already hold (§6.4).
- **D6. nuclei, and header and TLS checks in CI.** (a) No. (b) Yes. **Advice: (a)** (§6.4).
- **D7. The second identity (§6.3), after Schemathesis?** (a) Yes, as step 6. (b) No: row
  security is enough. **Advice: (a).** It is small, and it holds the one way past row security
  that a guard already watches statically.
- **D8. May a CodeQL ReDoS query ever block?** 0163 D3 made Semgrep's two ReDoS rules never
  block, because they read how a pattern is built and not what reaches it. CodeQL's read the
  pattern and follow input to it. (a) Report only until T6 has read its list, then the owner
  decides. (b) Never, like Semgrep's. **Advice: (a).**

- **D9. When to build** (the maintainer's addition, put to the owner with D1 to D8, as
  written to the owner). (a) CodeQL now; the guards and Schemathesis after alpha.21's builds
  are merged, so no new blocking guard lands under a builder's feet. (b) All after alpha.21.
  Advice: (a).

**Answered 2026-11-26:** *"D1–D9: as advised."* Each decision above takes its advice. The
Status entry of that day says what that changes.

## 10. Done means

- **Step 1:** four guards in `scripts/`, each with its fixture refused, in `docs/LESSONS.md`,
  green on `main`.
- **Step 2:** `codeql.yml` pinned and in the pin watch; its proof run reports both queries on
  the fixture; a run on `main` finished with every file extracted; T6's reading is in this
  plan's Status block.
- **Step 3:** the Schemathesis workflow, its guard, and its fixture proof red when the fixture's
  faults are taken out of what it flags; a nightly on `main` finished, with its summary read
  here.
- **Steps 4 to 6:** as §8, each with its proof, and `docs/testing.md`'s required checks updated
  where a check becomes one.
- At every step: nothing runs on the self-hosted runner, nothing reads a secret, nothing
  reaches beyond the runner.

## 11. Not in this plan

- Any scan of the live service, the acceptance stack or the owner's machines. The deployed
  service is the exposure probe's.
- A paid engine: Semgrep's cross-file engine, GitHub's paid features for private repositories.
- Fuzzing the connectors against real providers.

## 12. Risks

- **CodeQL's TypeScript.** §4.1: T5's first run says whether every file is extracted.
- **The API may not start alone.** It may want a service the job does not compose. T7 finds out;
  a fake of the kind the integration tests already use is the answer, never a real one.
- **Schemathesis's first list is long.** The conformance checks will find the description's
  own faults. That is why they report only, and why step 4 waits for quiet nights.
- **A scanner's fixture in a public repository** reads like a vulnerability. Each lives under a
  folder whose name says it is a fixture, is never imported by shipped code, and is held out of
  the build by the guards that already keep test code out of images.

## 13. What was read

At `fc78f79`: `AGENTS.md`; `docs/workplans/README.md`; plans 0006, 0158, 0163, 0166 and 0177;
`.github/workflows/` (all of them); `.gitleaks.toml`; `.github/dependabot.yml`;
`scripts/semgrep-report.mjs`; `eslint.config.js`; `apps/api/docs/openapi.yaml`;
`apps/api/src/middleware/auth.ts`; `apps/api/src/openapi-spec.unit.test.ts`;
`test/ui/managed-ui.ui.test.ts`; `SECURITY.md`; `docs/security-fix-fast-path.md`; and the
guards and sources §3 names. On the web, on 2026-11-26: the pages linked above.
