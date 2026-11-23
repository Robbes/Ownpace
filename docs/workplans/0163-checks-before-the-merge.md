# Workplan 0163 — Checks before the merge

> **In one line:** Which scanners and checks CI should add so that what an outside, read-only check finds is caught before a merge: what runs today, what each finding is, and in what order to add Semgrep, osv-scanner, zizmor's secrets audit, gitleaks and the rest, each failing the build or only reporting.

## Status — 2026-11-23 (update this block at the end of every session)

**2026-11-23: the outside check's 25 ReDoS places read again; six quadratic on what a remote
server sends, now linear.** On `claude/ownpace-public-readiness-y7orc6-redos`, from `main` at
`db37bf49`. An outside, read-only check at `5b51a82b`, with Semgrep 1.178.0, listed 25 places as
regular expressions that can be slow (CWE-1333).
- **Reproduced, all 25, on `db37bf49`,** with Semgrep 1.178.0 and the two rules taken from Semgrep's
  rules repository, since the registry refused the network it was checked from: 8 are
  `detect-redos` and 17 `detect-non-literal-regexp`. The same two rules also report eight places
  outside the 25 and outside tests, all in `scripts/` (`migration-locks-report.mjs:74`, `release-names-agree.mjs:58`
  and `:149`, `workplan-index.mjs:150`, `nginx-config.mjs:141`, `release-preflight.mjs:177`,
  `release-verify.mjs:174` and `:175`), which were not read here.
- **How each was read.** The input's source, then a crafted input at three lengths, timed. The §4.3
  reading of 2026-11-20 ("none needs a fix"), and `semgrep.yml`'s "every spot outside the tests was
  read as fed a constant or an escaped value", were too broad: `detect-non-literal-regexp` also
  flags patterns built from a fixed name, and six of those were quadratic.

  | Place | Input | Super-linear | Done |
  | --- | --- | --- | --- |
  | `caldav-source.ts:1048`, `carddav-source.ts:496` | a DAV server's PROPFIND answer | yes, quadratic | `elementsIn` |
  | `dav-multistatus.ts:30`, `:62` | a DAV target's 207 answer | yes, quadratic | `elementsIn`; a tag at a time |
  | `dav-refusal.ts:104` | a DAV server's refusal | yes, quadratic | `elementsIn` |
  | `measure-google-sync.ts:295` | Google's CalDAV answer | yes, quadratic | `elementsIn` |
  | `scripts/dav-target-probe.mjs:225` | the host a tester names | yes, quadratic | `elementsIn` |
  | `Docs.tsx:282` | the guides the web app ships | yes, quadratic | the end is `(?:\|\s*)?$` |
  | `calendar-scheduling.ts:260` | an invitation | no | two literal patterns |
  | `mail-headers.ts:60` | a mail's headers | no | a line at a time |
  | `remote-refusal.ts:107` | a DAV server's refusal | no | `indexOf`, the prefix as written |
  | `takeout-archive-reader.ts:546` | the uploaded archive's file names | no (escaped, anchored) | left |
  | `failure-answer.ts:160` | a provider's error text | no | left |
  | `reachable-host.ts:324` | an operator's setting | no (`{0,61}`) | left |
  | `unreadable-body.ts:87` | a body parser's error type | no | left |
  | `exposure-probe.mjs:335`, `:342` | an issuer and a redirect host | no | left |
  | `measure-google-sync.ts:267` | its own output, against fixed shapes | no | left |
  | `idp-pin-watch.mjs` ×6, `llms-docs.mjs:85` | this repository's files, pinned upstream files | no | left |

- **What changed.** `@openmig/shared` gains `xml-elements.ts`: `elementsIn` reads a body a tag at
  a time (`<` to the next `>`, no `<` or `>` inside) and each caller says in code which tag opens
  and which closes, so no pattern is built from a name. An element runs to the first closing tag
  after its opening one, as the lazy pattern did, and when none follows, the read stops. Two
  literal patterns in the same files got `[^<>]*` for `[^>]*`: `GDATA_ERRORS` in `dav-refusal.ts`
  (a crafted body of 100,000 `<errors ` took 94 s) and `A_CALENDAR` in `measure-google-sync.ts`;
  the caldav and carddav `href` pattern too, and the probe's `<response` count. Neither rule
  flagged them.
- **Behaviour.** A differential run, kept out of the repository, of 300,000 random bodies of
  well-formed tags against each original pattern (the 207 reader, the CalDAV and CardDAV home
  sets, the refusal's text, the Google measurement's elements and the probe's count) and 300,000
  header sections, found no difference.
  The one kind of difference is a `<` inside a tag, which XML does not allow: the patterns'
  `[^>]*` crossed it. Names compare as the `i` flag without `u` did: only A to Z fold.
  `TABLE_DELIMITER`'s new end was compared exhaustively over seven characters and on 2,000,000
  random lines: the same answers.
- **Evidence.** Each place that was quadratic has a test of a crafted input with a bound of 1.5 s.
  Run against `db37bf49`'s code they took 4 s (the guides' table), 15 s (the Google measurement),
  19 s and 22 s (CalDAV, CardDAV), 21 s (a Sabre refusal), 23 s and 30 s (the 207 reader), 80 s
  (the probe) and 94 s (Google's refusal). Run against this change, milliseconds. Every test that
  was there before passes on both.
- **What Semgrep says now** on the changed files: `detect-non-literal-regexp` at
  `measure-google-sync.ts:267` (left, above) and at a test of `Docs.tsx` that was there before;
  `detect-redos` at `TABLE_DELIMITER`, whose repeated group starts with a literal `|`, which
  Semgrep's analysis does not credit. It is linear now (80,000 spaces in under 1 ms).
- **Why the rest were left.** Each is linear on what reaches it, by its shape or by timing: every
  repetition starts at a literal the item before it cannot match (`failure-answer`'s `\`, the
  hosts' `.`, a path's `/`), or a quantifier is bounded (`{0,61}`), or the pattern is anchored over
  an escaped name (`takeout`). `takeout-archive-reader.ts` stays as it is, because a rewrite with
  `toLowerCase` would compare a non-ASCII name differently from the `i` flag. The scripts and the
  shapes read this repository's own text, and a rewrite there would be churn.
- **The guard.** Not built. D3 keeps both ReDoS rules from blocking, and they still report on
  `main`: the places left above, the eight outside the 25, and the tests. Both rules flag a
  pattern's shape, not what reaches it, so neither could block cleanly as they stand. If the owner
  revisits D3, the step is a separate pull request, after the eight are read, that turns `never`
  off and `blocks` on for `detect-non-literal-regexp` in `RULES` once it reports nothing on
  `main`.

**2026-11-23: the second round of swallowed errors, 14 places, read and settled.** On
`claude/ownpace-public-readiness-y7orc6-swallowed-errors`, from `main` at `db37bf49`. An outside,
read-only check, at `5b51a82b`, named 14 places where an error is caught and lost, at medium
severity: 3 in production, 11 in tests and fakes. All 14 were still on `main`. The first round
(#1944, recorded in workplan 0006) set the style: a catch lets go only the failure it expects, or
the failure is said or passed on, and no suppression or ignore comment.
- **`closeJobRunner` (`apps/api/src/job-runner.ts`).** The only one that lost an error. A close
  while the producer's start failed dropped that failure: the press that made the producer was
  handed it, but the close said nothing. It now logs it once, at warn, through the API's `log` and
  `loggableError`, and stops nothing; a test in `job-runner.unit.test.ts` shows the warn line, the
  press's own rejection and the one stop.
- **`oneAtATime` (`apps/selfhost/src/address-changes.ts`).** Lost nothing: the catch quieted only
  the copy kept for ordering, and the caller had `next` with its error. The copy is now
  `Promise.allSettled([next])`, with the same order. `one-address-write-at-a-time.unit.test.ts`
  shows a failed write's error reaching its caller and the next write running after it settles.
- **`partUrls` (`packages/connectors/src/cirrux-drive-api.ts`).** Lost nothing: the promise was
  returned. Now `async`/`await`, the same behaviour; the existing test of an answer without
  `part_urls` in `cirrux-drive-target.unit.test.ts` still shows the throw reaching the pass.
- **Tests and fakes.** A runner's stop in a teardown that nothing else stops
  (`a-job-on-pg-boss`, `operator-jobs` twice in its first `afterAll` and once in its second) now
  fails the hook when it fails. Where the tests stop most runners themselves (the scheduler's
  `job-runner` and `a-jobs-role-that-owns-only-its-queue`), the teardown's second stop ends the pool
  again, and only pg's `Called end on pool more than once` is let go. The worker's wait for
  `/health` lets go only `ECONNREFUSED`, before it listens. The members test's requests are settled
  from the start with `Promise.allSettled`, and a failed one is thrown after the commit, as
  `Promise.all` threw it; the connection test's press is an `async` function, awaited with the
  other. The Cirrux fake's rotation queue keeps its order with `Promise.allSettled`, as
  `oneAtATime` does. The appliance's address-change E2E keeps the last refused pass and says it if
  the wait runs out, as `driveUntil` in `apply-deletion-lib.ts` does.

**2026-11-22: T5's first rule that blocks, `run-shell-injection`, built; `react-href-var` waits on
its time-outs.** On `claude/ownpace-alpha16-semgrep-blocking`, from `main` at `0683eb04`. It
takes over #1997, a draft from `45a758af`, which stopped on the two problems below; its blocking
logic is carried over onto #1993's and #2006's report.
- **What blocks.** A spot of `run-shell-injection` fails the `Semgrep` check on a pull request, a
  push and a dispatch, as an error on its line. No `KNOWN_FINDINGS` entry excuses it, no inline
  `nosemgrep` hides it (`--disable-nosem`), and a `.semgrepignore` the checkout tracks, at any
  depth, is a scan that did not finish. So is a workflow or action file the checkout tracks that
  Semgrep did not scan (`paths.scanned`), said by name: Semgrep's built-in ignore list leaves
  `build/`, `vendor/`, `test/` and more out at any depth, and it skips a file over its size limit,
  a link and an upper-case extension, all without a word. A note on other YAML (`pnpm-lock.yaml`,
  `openapi.yaml`, compose files) is a note. The other
  seven rules report only. A scan that did not finish now fails a pull request too (it was a
  warning there), since the check vouches for the rule that blocks. The job is renamed from
  `Semgrep (report only)` to `Semgrep`. Code scanning still gets the upload from `main` when the
  rule that blocks failed the job (`!cancelled()`).
- **The time-out reading, narrower.** `RULES` names each rule's languages, read from each rule's
  `languages:` in Semgrep's rules repository on 2026-11-22 (at `a5ad1714`, 2026-11-10; the
  registry itself refused this session's network): `run-shell-injection` reads YAML, the other
  seven JavaScript and TypeScript. A place where more than one rule timed out now counts only
  against the rules whose languages include its file (`timedOut`, by `languageOf` its
  extension); a place with no file, a file of no language here, or a first rule that does not
  read the file still counts against every rule. The extensions are Semgrep 1.186.0's own
  `lang.json` (`a5844e7c`): `.cjs .js .jsx .mjs` less `.min.js`, `.ts .tsx` less `.d.ts`, `.yml
  .yaml`. `run-shell-injection` has no `mode: taint`, so it never reaches the taint analysis's time
  limit. Semgrep's per-file time limit (`--timeout`, 5 s) and a file it could not parse still apply
  to it: they land in its errors, and a note on a workflow or action file, or on no file naming
  the rule that blocks, is now a scan
  that did not finish (none on `main`'s YAML files today).
- **Why `react-href-var` does not block yet.** It does use taint mode (`mode: taint`, over
  TypeScript and JavaScript), so it can time out, and it did: `main`'s Semgrep run 45025731298
  at `0683eb04` read 13 places only in part, and names `react-href-var` first at
  `scripts/a-deploy-from-a-named-tag.unit.test.ts:1` (3 rules). Ten of the 13 are a JavaScript or
  TypeScript file where more than one rule timed out, each of which can hide a spot of it.
  Blocking it would make such a run a scan that did not finish, so it waits
  for a reading of its own time-outs: for example a scan of it alone, whose time-outs Semgrep
  would name exactly.
- **The check's class.** `every-pr-check-is-classified` lists `Semgrep` among the checks required
  outside `ci.yml`, and `docs/testing.md`'s required-checks paragraph names it as the fifth
  intended one, saying that a repository ruleset on `main` holds four today (classic branch
  protection has required checks off). Both state the intent; neither can read the ruleset.
  **The owner's step,** once this pull request has merged and not before (until then every other
  pull request runs `main`'s `semgrep.yml`, whose job is `Semgrep (report only)`, so a required
  `Semgrep` would never report there): add `Semgrep` to that ruleset's required status checks,
  with GitHub Actions as its source. From then on a Semgrep registry outage, or anything else that leaves the
  scan unfinished, fails a pull request until a re-run. The rules are fetched by id and not
  pinned, so a rule renamed or withdrawn upstream fails every pull request and a re-run does not
  help, and an upstream edit to `run-shell-injection` changes what blocks with no change here.
- **Tests:** `a-finding-only-an-outside-check-saw` has 37 tests (26 before), among them `main`'s
  own 13 places, read as a scan that finished with `run-shell-injection` blocking, and as one that
  did not, in 10 places, with `react-href-var` blocking, and one that runs the script as the
  workflow does, a `docker` on `PATH`, for its exit; `every-pr-check-is-classified` has 6 (5
  before). Twenty-seven mutations each fail one of them: the old reading (any rule where several
  timed out) with 6 tests, each of the first review's fixes, and each of the second's (a tracked
  workflow or action file not scanned, a note on any YAML, a note on no file, the note's rule id,
  extensions read in any case, a workflow known in one case only, `run()` holding no files, a
  leading `./`, and a trigger filter in either guard).

**2026-11-21, after #2007 merged: T1 and T6 are on `main`, D8 and the six rules' upload too, and
the secrets are in their environments.** In merge order (times UTC):
- **#2006** (`2448f0a8`, 16:05): code scanning gets only the spots of the six rules that may block.
  Semgrep's next upload from `main` (run 44922596746, 16:06) sent 4 and kept the two ReDoS rules'
  204 in its job summary.
- **#1992** (`17a9a460`), T6: gitleaks reads every commit a pull request adds, and a finding fails
  it. CI was green on its head (run 44922717586), its own `gitleaks` job included.
- **#1998** (`58e10d96`), D8: GoAccess's pinned commit is the build argument `UPSTREAM_COMMIT`.
  On its head, with #1992 merged in, `gitleaks` read the renamed line and found nothing (CI run
  44924152362).
- **#2001** (`6afa68cd`), T1's first half: the two jobs name their environments. E2E (managed) run
  44922496092 was green with its job in `e2e-managed`, whose workflow files are the merged head's.
- **#2007** (`66138ba9`), T1's second half: the report lists each secret read outside an
  environment. On its merged head it listed none: 32 findings for the auditor persona, 0 of them
  `secrets-outside-env` (Workflow audit run 44927704872).
- **The owner's steps in Settings, done the same evening, as #2001 lists them and as the owner
  reported them:**
  - `exposure-probe` holds `EXPOSURE_PROBE_HOST`, with deployment branches limited to `main`;
  - `e2e-managed` holds `TRIGGER_ACCESS_TOKEN`, with no branch rule and no reviewer, so E2E
    (managed) still runs on a pull request's branch;
  - both repository secrets are deleted.
- **The proof after the deletion:** E2E (managed) run 44930541955, dispatched on `main` at
  `66138ba9`, was green: `verify: done   apply: applied`, SMOKE PASS, nothing unhealthy. Its tasks
  deployed with the token from the environment, since no repository secret of that name is left.
  The exposure probe's secret is read at its next dispatch.

**2026-11-21, after T1's first half: zizmor's `secrets-outside-env`, report only, step 2's
second half (T1), built as #2007, a draft.** On
`claude/ownpace-public-readiness-y7orc6-zizmor-secrets-report`, from `main` at `ad2ffbe7`. The
first half, the two jobs naming their environments, is #2001.
- **Why a second run.** zizmor has shown `secrets-outside-env` only under `--persona auditor`
  since 1.24.0, and `zizmor.yml`'s audit, which blocks, takes no persona
  (`a-workflow-zizmor-would-flag` holds that). So nothing before a merge named a secret read by a
  job with no environment, the shape of finding 1.
- **What it does.** After the audit, and after a red one too, the same image runs once more, as
  the audit runs it (offline, no network, the one config, `--no-ignores`), with `--persona
  auditor` and `--format json-v1`. `scripts/zizmor-secrets-report.mjs` reads the JSON:
  - each `secrets-outside-env` finding is listed in the summary, by file and line, job and the
    `secrets.*` it reads, and as a warning on its line, and passes (D2);
  - the persona's other findings are counted, not listed (§5, step 2);
  - the step fails only when zizmor did not finish: an exit other than 0 or 11 to 14, a report it
    cannot read or that is not zizmor's shape, or an exit that does not match the report's highest
    severity.
- **What it reads, by zizmor's own source at v1.32.0, read only.**
  - The audit (`crates/zizmor/src/audit/secrets_outside_env.rs`) flags each `secrets.*` context in
    the body of a job that names no environment. `GITHUB_TOKEN` is never flagged, and neither is a
    job of a reusable workflow. A workflow's top-level `env:` is not read, which is why #2001's
    guard reads it.
  - The JSON (`crates/zizmor/src/output/json/v1.rs`) is a flat list of findings. A finding's
    primary location names the file, the line counted from 0, and the route to the job.
  - The exit code is the highest severity's, 11 to 14, or 0 for no finding
    (`crates/zizmor/src/registry.rs`).
- **Guards.** The new `a-secret-no-environment-holds` (18 tests) holds the report and the step.
  `a-workflow-zizmor-would-flag` tells the report from the audit by its name, and refuses a
  second audit, a second report and the report renamed; the audit is held as before. Each of
  14 hand-made breaks of the report fails its guard.
- **What the real zizmor showed.**
  - #2007's own zizmor job (run 44909520962): the audit passed, and the report listed one
    `secrets-outside-env` finding, in `.github/workflows/exposure-probe.yml`, the read #2001
    moves into an environment. The persona's other findings were counted, not listed, and the
    exit matched the report.
  - On the measuring branch (run 44910211278), each tree run as the step runs it: one finding
    on this branch, on the line zizmor's own plain output gives; the same report handed exit 0
    failed; none on #2001's branch; in a made-up workflow, only the secret read by a job with no
    environment, not `GITHUB_TOKEN` nor a secret read in a job that names one; and a tree with
    no workflow, where zizmor exits 3, failed the step.
  - Once #2001 merges, the report lists none.
- **CI:** green on `d7e23038`, with `main` at `8fd68a35` merged in (CI run 44909520986).

**2026-11-21, after #1995 merged: T1, the two secrets left, each in its job's environment, built
as #2001 (a draft, not merged).** On `claude/ownpace-public-readiness-y7orc6-secrets-environments`,
from `main` at `02e88d52`; the first half of step 2 of §5, as D2 decided.
- **Two secrets, not nine.** D7 took the O365 lane out with its seven, so two are left, each read
  by one job: `TRIGGER_ACCESS_TOKEN` by `e2e-managed.yml`'s `e2e-managed`, and
  `EXPOSURE_PROBE_HOST` by `exposure-probe.yml`'s `probe`.
- **What it does.** Each job names a GitHub environment, `e2e-managed` and `exposure-probe`.
  - The token moved from the workflow's top-level `env:`, which no environment reaches, into its
    job's `env:`, with `TRIGGER_API_URL` beside it.
  - The new guard `a-secret-kept-where-its-job-is` holds each secret to its one job, read nowhere
    else, and that job to its environment. A secret added later is left to zizmor's
    `secrets-outside-env` report (step 2's second half, report only by D2).
- **Nothing changes until Settings does.** A job in an environment still reads the repository's
  secrets, and GitHub makes an environment the first time a job names it. So both jobs run as
  before until the owner moves the secrets.
- **The owner's part, in Settings → Environments:**
  1. `exposure-probe`: add the secret `EXPOSURE_PROBE_HOST`. Deployment branches: selected,
     `main`, since the probe is dispatched from `main`.
  2. `e2e-managed`: add the secret `TRIGGER_ACCESS_TOKEN`, with no required reviewer, since the
     nightly runs unattended. Deployment branches is the owner's choice:
     - `main` alone keeps a workflow changed on a branch away from the token, which is D2's point.
       But E2E (managed) could then no longer run on a pull request's branch, as it does today
       before a merge.
     - With no branch rule, it runs as today. The token is then out of reach of every job that
       does not name the environment, and a job on a branch that names it can still read it.
  3. Then delete the two repository secrets (Settings → Secrets and variables → Actions).
- **zizmor's own audit, as the outside check reads finding 1** (the measure branch, run
  44888863792): zizmor 1.32.0 as `zizmor.yml` pins it, offline and read-only, with the auditor
  persona, the only one that shows `secrets-outside-env` since zizmor 1.24.0. On `main` it finds
  one, in `.github/workflows/exposure-probe.yml`, the probe's step that reads
  `EXPOSURE_PROBE_HOST`; on the T1 branch, none. It does not read a workflow's top-level `env:`,
  where the token sat on `main`, so it never flagged `e2e-managed.yml`; the guard does.
- **Not in this:** zizmor's `secrets-outside-env` report, a second zizmor run in `zizmor.yml`
  (step 2's second half). Since it does not read a top-level `env:`, the guard stays beside it.
- **Tests:** the new guard (4 tests, its mutations among them). With the 21 guards that read the
  two workflows, the guards that read every workflow and the doc guards: 55 files, 1,641 tests.
  `pnpm typecheck` and ESLint pass.

**2026-11-21, after the merges: T6, gitleaks on a pull request's own commits, built as #1992 (a
draft, not merged).** On `claude/ownpace-public-readiness-y7orc6-gitleaks`, from `main` at
`45dfead1`; step 4 of §5, as D4 decided: it fails the build.
- **What it does.** A job of its own in `ci.yml`, `gitleaks`, on pull requests only, like
  `commit-convention`, and needed by `ci-complete`, so a finding stops the merge with no setting
  changed.
  - It installs gitleaks v8.30.1 from its GitHub release. Both architectures' archives are checked
    against the sums read from the release's checksums file and from the archives themselves; then
    the native one is unpacked, and the binary must call itself 8.30.1.
  - `scripts/gitleaks-report.mjs` runs `gitleaks git` over `base..head`, the commits the pull
    request adds, with `.gitleaks.toml`: gitleaks' default rules and one allowlist of paths, unit
    and integration test files and `docs/o365-setup.md`, as D4 has it.
  - A finding fails the job, its file, line, rule and commit named. The value is redacted, and
    neither the commit's author, address nor message is printed.
- **No line excuses itself.** `--ignore-gitleaks-allow` turns `gitleaks:allow` comments off.
  gitleaks reads a `.gitleaksignore` at the root whatever its flags say (its `cmd/root.go` at
  v8.30.1), so the report refuses to run while one exists.
- **A scan that did not finish fails too.** gitleaks exits 1 for a finding and for a failure alike,
  so the job gives a finding its own code, 3, and fails on any other exit, a report it did not
  write or one that disagrees with the exit, and a range with no commit in it.
- **8.30.1 is both the outside check's version and gitleaks' newest release**, its assets of
  2026-03-21, so there was no version to choose. The pin watch has a `gitleaks` row against
  upstream's git tags.
- **Proved with the real gitleaks and this config**, on the measure branch (run 44880864945).
  Throwaway repositories on the runner each held the branch's `.gitleaks.toml` and report, and one
  made-up commit with a value shaped like a GitHub token, made for the run and committed nowhere
  else. Every case ended as it must:
  - a clean change passes;
  - the token in a source file fails, and so does the token in another document;
  - the same token in a unit test file, an integration test file and `docs/o365-setup.md` passes;
  - a `gitleaks:allow` comment excuses nothing, and neither does a later commit that removes the
    token;
  - a `.gitleaksignore` that lists the finding is refused.
  - No log line printed the value.
- **A merge's own lines are read too, added after that proof.** `git log -p` shows a merge commit
  with no diff, so a line written while resolving a conflict went unread, and every branch here
  merges `main` in. The log options now carry `--diff-merges=remerge`: git's remerge diff shows
  what a merge itself wrote, against git's own merge of its parents, and not the lines it brings
  from `main`, which their own pull requests were read for. Proved the same way (run
  44882209561): the nine cases above again, and five merges, every one as it must:
  - a token written while resolving a conflict fails in a source file, passes in a unit test file
    and fails in `docs/o365-setup.md`. gitleaks' diff parser (go-gitdiff 0.9.1) names a file
    inside a conflict's resolution with git's `b/` in front, so the anchored path does not match
    it there, and such a hit fails as any other would;
  - a clean merge that brings the other side's token-shaped line passes;
  - a token in a file the merge commit adds beside what it merges fails.
- **What it would flag in today's tree, read again.** Of §4.2's 67 hits in the files, none is in
  a `.tsx` test file, so the allowlist's `.ts` suffixes miss none. Three lines are outside the
  allowlist: one in each of two workplans, 0132 and 0133, and `deploy/compose/goaccess/Dockerfile`'s
  `ARG GOACCESS_COMMIT=` line, which `generic-api-key` matches because the name holds `access`. A
  pull request that rewrites one of them fails. The next GoAccess bump rewrites the third: D8,
  which the owner answered on 2026-11-21 with the rename, built as #1998.
- **The pull request's own run** read its one commit (about 76 KB of added lines) and found
  nothing: both sums as pinned, the binary calling itself 8.30.1.
- **Tests:**
  - the new guard `a-secret-a-pull-request-could-add` (17 tests): the config line for line, the
    allowlist against every tracked file, the job's shape and `ci-complete`'s account of it, and
    the report against a stubbed gitleaks and git;
  - a gitleaks block in `a-pin-that-knows-it-is-behind`, which also runs the install step under
    bash against archives built in the test.
  - Locally: 310 files, 7,549 tests passed, 33 skipped; after the remerge change, the 15 guards
    that read `ci.yml` (419 tests). Fourteen mutations of the report each fail its guard, the last
    one dropping `--diff-merges=remerge`.

**2026-11-21, after the Dutch sentence: code scanning lists the spots of the six rules that may
block, and the two ReDoS rules' stay in the job summary (a T3 follow-up).** On
`claude/ownpace-public-readiness-y7orc6-semgrep-six`, from `main` at `ad2ffbe7`.
- **Why.** `main`'s Semgrep run uploads its SARIF to code scanning. On `45dfead1` that was 206
  spots, 202 of them under `detect-non-literal-regexp` and `detect-redos`, the two rules that
  never block (D3), every one of them read. Those 202 filled the Security tab beside the
  4 spots of the six rules that may block.
- **What it does.** `scripts/semgrep-report.mjs` writes a second SARIF,
  `semgrep-code-scanning.sarif` (`forCodeScanning`): Semgrep's own, with each result of a rule
  marked `never` taken out, its rules list kept whole. The upload step sends that one. Semgrep's
  own report is not changed, and the job summary lists and counts every spot as before, with a
  line saying how many went to code scanning and how many stayed. At the first upload from
  `main` after the merge, code scanning closes the two rules' open alerts, since their spots are
  no longer in it.
- **Tests.** `a-finding-only-an-outside-check-saw` has 26 tests, 4 new: the six rules' spots
  are what is uploaded, Semgrep's own SARIF keeps all eight, a rule that never blocks is taken out
  by its id, a prefixed id or its own name, and an empty report keeps its shape. Four mutations
  each fail it: nothing taken out (2 tests), everything taken out (2), Semgrep's own SARIF
  uploaded (4), and the summary line dropped (1).

**2026-11-21, at the end: the Dutch sentence for a payment Mollie gives no checkout says
*om via te betalen* (a T4 follow-up), merged as #2005 on 2026-11-21 (`55eab78b`).** On `claude/ownpace-public-readiness-y7orc6-pay-sentence`,
from `main` at `ad2ffbe7`.
- **What changed.** `NO_CHECKOUT.nl` in `apps/api/src/routes/billing/index.ts` now reads *Mollie
  gaf geen betaalpagina om via te betalen. Probeer het over een minuut opnieuw.* It said *om op te
  betalen*. The English sentence is unchanged, and so is the 502 `no_checkout` it comes with.
  `a-draft-is-not-paid.unit.test.ts` holds the new sentence.
- **The two other sentences stand** as #1990 and #1996 wrote them: `billing.payNotMollie` and
  `account.consent.notTheProvider`.

**2026-11-21, after T5's first part: the grant page's two buttons go to Google's own page only,
built as #1996 (a T4 follow-up), merged on 2026-11-21 (`40bb3476`).** On `claude/ownpace-public-readiness-y7orc6-grant-consent-host`,
from `main` at `45a758af`.
- **What #1990 found and left.** `apps/web/src/pages/Grant.tsx` sends the whole page to the
  consent address the API answers, with `location.assign`: *Continue with Google* on a migration's
  link, and one button per account on a person's link. Both followed whatever came back. No rule
  reports the two lines, and neither finding names them.
- **What it does.** Both go through `consentToFollow('google', …)`, the check *Pay* and the
  consent window use (`apps/web/src/services/address-to-follow.ts`): `https:` on
  `accounts.google.com` exactly, and the address followed is the one parsed. Anything else opens
  nothing. The page then says the address is not Google's own page, in the reader's language, with
  the consent's own sentence (`account.consent.notTheProvider`), and gives the button back.
- **Tests.** The new guard `apps/web/src/pages/a-grant-button-that-goes-only-to-google.unit.test.tsx`
  has 22 tests over both buttons. Google's page is followed as parsed. Refused, each for its own
  reason: `http:` on Google's host, another host, Google's name inside another host, credentials in
  front of another host, another port, `javascript:` (also one naming Google's host), no address,
  and a path of our own. The refusal in Dutch. Four mutations each fail it: either button left
  unchecked (10 tests each), the refusal shown as an unreadable answer (20), and the button left
  disabled (9).

**2026-11-21, latest: before any rule blocks, a place Semgrep read only in part is no longer
silent (T5, its first part), built as #1993, merged on 2026-11-21 (`87663d70`).** On
`claude/ownpace-public-readiness-y7orc6-semgrep-timeouts`, from `main` at `75d7949d`.
- **Why.** `main`'s first Semgrep run, on #1986's squash (`fbd73f93`, run 44856257160), read 207
  spots, 202 of them under the two ReDoS rules. #1986's last run read 208 on the same tree, 203 of
  them there.
  - The cause, reproduced: Semgrep's taint analysis gives each function, and each file's top
    level, a time limit of its own. A rule that reaches it reports nothing in that function, and
    Semgrep still exits 0.
  - Semgrep names such a place only in the timing section that `--time` adds to its JSON report
    (`time.fixpoint_timeouts`), never among its errors. The report did not ask for it, so it
    could not see the place.
  - In the reproduction, each such place named `detect-non-literal-regexp` first, a rule that
    never blocks, which fits a spot lost under the ReDoS rules.
- **What it does.** `scripts/semgrep-report.mjs` runs Semgrep with `--time` and lists each place
  under "Read only in part": its file and line, how many rules timed out there, and the first of
  them. Semgrep names no other.
  - A place where only a rule that never blocks timed out is listed.
  - A place where a rule that may block can have timed out is also marked on its line. That
    includes any place where more than one rule timed out, since only the first is named.
  - A place where a rule that blocks can have timed out is a scan that did not finish: a warning
    on a pull request, a failure on `main`. So is a report without the timing section.
  - `RULES` now says per rule whether it blocks (`blocks`). None does yet, so no time-out fails a
    run today. A guard test fails once one does, so the pull request that turns a rule blocking
    names it there, and makes that rule's findings fail the job too (§5, step 5).
- **What CI read.** #1993's first Semgrep run on GitHub's runner (44881446419) read 207
  spots and listed 7 places, each with 2 to 4 rules timed out: 5 naming
  `js-open-redirect-from-function` first and 2 naming `path-join-resolve-traversal`. So in CI a
  time-out can hide a spot of a rule that may block.
  - Semgrep's limit is 0.2 s of taint analysis per function (`taint_FIXPOINT_TIMEOUT` in its
    `src/configuring/Limits_semgrep.ml`). No option raises it, and a slower machine reaches it in
    more places.
  - Turning either rule blocking as things stand would make every run on `main` a scan that did
    not finish. So step 5 first chooses how that rule's time-outs are read.
- **Tests:** the guard `a-finding-only-an-outside-check-saw` has 22 tests (18 before). Twelve
  mutations of the report each fail it.

**2026-11-21, last: T4's fix for findings 8 and 9, with the Pay button, built as #1990, merged
on 2026-11-21 (`5d5c5f55`; *was:* a draft held for alpha.14).** On
`claude/ownpace-public-readiness-y7orc6-t4-pay-checkout`, from `main` at `45dfead1`. `main` was
frozen until the alpha.13 tag, so it merged after that tag.
- **The Pay button reaches Mollie.** `MollieService` keeps the checkout address Mollie gives a
  payment (`checkoutUrl`, from the client's `getCheckoutUrl()`), and `POST
  /api/billing/invoices/:id/pay` answers it as `paymentUrl`, not the `redirectUrl` Mollie sends
  the customer back to. A payment Mollie gives no checkout is refused with 502 (`no_checkout`),
  in English and Dutch, before the invoice records it, so the payment the webhook matches stays
  the one the customer was last sent to.
- **One check where the web app follows or links an address from the API**
  (`apps/web/src/services/address-to-follow.ts`): `https:` on the one host of its flow, the host
  compared whole, and what is followed is the address as parsed.
  - *Pay* follows only `www.mollie.com` (finding 8, `Billing.tsx:760`).
  - A consent's link (finding 9, `ProviderConsent.tsx:593`) and its window
    (`consent-window.ts:123`, which no rule reports) go only to the provider's consent host:
    `accounts.google.com`, `www.dropbox.com`, `login.microsoftonline.com` or `api.cirrux.co`.
    These are read from the endpoints the API builds the addresses on, so Google's and Dropbox's
    authorize endpoints moved to `packages/shared/src/consent-endpoints.ts`.
  - Anything else is refused, and the screen says so: at the invoice's row, or in the consent's
    note, with the blank window closed.
- **Mollie's checkout host, `www.mollie.com`, is read from Mollie's API reference.**
  `@mollie/api-client` 4.6.0 says to send the customer to `_links.checkout`, but gives no example
  address. Mollie's API reference for creating and getting a payment (docs.mollie.com, read on
  2026-11-21, which the client's types cite) gives every `_links.checkout.href` on
  `www.mollie.com`, under `/checkout/`, test mode's `/checkout/test-mode` included, and no
  checkout on any other host; its API is `api.mollie.com`. The billing rehearsal's step 4
  (`docs/billing-rehearsal-on-ota.md`) shows it again with a real test payment. On any other host,
  the row says the address is not Mollie's checkout.
- **Tests.**
  - The new guard `apps/web/src/an-address-followed-on-the-apis-word.unit.test.tsx` (78 tests,
    English and Dutch) holds each refusal by the check that makes it: `http:`, another host, a
    lookalike host (`www.mollie.com.evil.example`, credentials before another host, another
    port, no `www.`), `javascript:` (including one whose host is Mollie's), and no checkout link
    (empty, a path, and our own billing page). It also holds the Pay row, the consent link and
    both consent doors.
  - `apps/api/src/services/mollie/a-checkout-address-read-nowhere.unit.test.ts` (2 tests): the
    service's payment carries the checkout, with the return page apart from it.
  - `a-draft-is-not-paid.unit.test.ts`: its stand-in for Mollie gave the pay address as its
    `redirectUrl`, so it passed with the mistake in. It now answers as Mollie does, and two new
    cases hold the checkout answered and the 502.
  - Two consent tests now name Google's real host, since `accounts.google.example` is refused.
  - **Thirteen mutations**, each a check broken by hand, all fail a test, and each file was put
    back `cmp`-equal: the scheme, the host, the host without its port, the host by its start, the
    parse refusal; the Pay row, the consent door, the link, the Cirrux door and the provider's own
    host each left unchecked; the route answering `redirectUrl` again; the route's 502 removed;
    the service keeping `redirectUrl` as the checkout.
- **What Semgrep read on the pull request** (run 44868411020, on `0b6ec4d7` merged into
  `45dfead1`): 206 spots, one fewer than `main`'s 207 (run 44861980857). Of those, 202 are under
  the two rules that never block, 2 are known and 2 are to read.
  - `react-href-var` no longer reports `ProviderConsent.tsx`.
  - `js-open-redirect-from-function` still reports `Billing.tsx:770`, the
    `window.location.href = checkout` line. The rule follows `result` through
    `checkoutToFollow` and does not take that for a check, so the spot is reported though it is
    safe now. It stays to read: no known-finding entry is added without the owner.
  - The other spot to read is still the Cirrux test fake's decipher.
- **Found, not done:** `apps/web/src/pages/Grant.tsx:180` and `:360` send the page to Google's
  consent address from the API with `location.assign`, which no rule reports and neither finding
  names. `consentToFollow('google', …)` is ready for them.
- **Still open in T4:** the Cirrux test fake's decipher (`cirrux-fake.ts:135`).

**2026-11-21, later: T2, T3, T9 and T4's first fix are on `main`, for alpha.13.** They merged in
this order, each with `main` merged in and CI green on its last head: #1985, the tag length
(`032bae95`); #1984, osv-scanner (`6265a94c`); #1980, the O365 lane deleted (`a4e9f331`); and #1986,
Semgrep report only (`fbd73f93`). On #1986's last head Semgrep read 208 spots from its eight
rules: 203 under the two ReDoS rules, 2 known, and 3 to read, the Cirrux test fake's decipher
and the two spots T4's `https:`-and-host check is for. GEN-26, which T4's `base_ref` line goes
with, merged as #1977 (`5cac662b`). Still open: T1, whose secrets move in Settings; the rest of
T4 (the Cirrux test fake's decipher, findings 8 and 9, and the Pay button); T5; and T6.

**2026-11-21: T3, Semgrep report only, merged as #1986 on 2026-11-21 (`fbd73f93`; *was:* built as a
draft, not merged).** On
`claude/ownpace-public-readiness-y7orc6-semgrep-report`, from `main` at `5a0a2eff`; step 3 of §5,
as D3 decided.
- **What it does.** `semgrep.yml` is a workflow of its own, in the shape of `hadolint.yml`. It runs
  on every pull request, on a push to `main` and on dispatch, on a GitHub-hosted runner, and is not
  a required check.
  - `scripts/semgrep-report.mjs` runs Semgrep once over the checkout, mounted read-only, as the
    image's own user, with the eight rules of step 3. Each rule is fetched from the registry by
    id, so no copy is kept here and D3's licence question does not arise.
  - It writes each rule's spots to the job summary, and marks a spot of a rule that may block on
    its line.
  - On a push to `main` the SARIF goes to code scanning, never from a pull request. Since
    2026-11-21 it holds the spots of the six rules that may block only (Status, 2026-11-21,
    after the Dutch sentence).
- **Known, never ignored:** the two spots §4.3 read as false positives, `apps/worker/src/index.ts`
  (the worker CLI's own `--config`) and `google-consent.ts` (its value goes through `jsString`).
  The two ReDoS rules are listed apart and never block.
- **Report only, and a scan that did not finish is not green:** a warning on a pull request, a
  failure on `main`. Finished means Semgrep exited 0, wrote both reports, calls itself the pinned
  release, ran the eight rules and no other, and read at least 1,000 files.
- **1.186.0, not 1.178.0**, for T2's reason: 1.178.0 is eight releases behind. The pin watch now
  has a `semgrep/semgrep` row. 1.186.0 was pushed on 2026-11-18 at 00:21 UTC, three days before it
  was pinned.
- **What the pull request's runs read** (44844096091 and 44844804194, the same both times): 210
  spots.
  - 203 are the two ReDoS rules': 185 from `detect-non-literal-regexp` (§4.3 counted 174, on an
    older tree with an older Semgrep) and 18 from `detect-redos`.
  - 2 are known.
  - 5 are to read, the spots that keep a rule from blocking:
    - `packages/core/src/secrets.ts:194` (`gcm-no-tag-length`), fixed in #1985;
    - `packages/connectors/src/__testing__/cirrux-fake.ts:135` (`gcm-no-tag-length`), the
      Cirrux test server's decipher, which wants the same option;
    - `apps/web/src/pages/Billing.tsx:760` and `apps/web/src/components/ProviderConsent.tsx:593`,
      findings 8 and 9 (T4);
    - `.github/workflows/no-committed-artifacts.yml:41` (`run-shell-injection`), which goes with
      GEN-26.
- **Tests:**
  - the new guard `a-finding-only-an-outside-check-saw` (18 tests);
  - a Semgrep block in `a-pin-that-knows-it-is-behind`;
  - the check classified as not required.
  - Locally: 307 files, 7,465 tests passed, 33 skipped. Sixteen mutations of the report and
    three of the pin row each fail a guard.
- **GEN-21**, which this plan only lists, was fixed on `main` in its own work (`7cbb1093`,
  workplan 0119): the Docker socket proxy runs as HAProxy's uid 99, no longer as root.
- **Found while reading finding 8's spot for T4: the Pay button never reaches Mollie.**
  - `POST /api/billing/invoices/:id/pay` (`apps/api/src/routes/billing/index.ts`) creates the
    payment with `redirectUrl: ${WEB_URL}/billing`, the page Mollie sends the customer back to.
    It then returns that same `redirectUrl` as `paymentUrl`.
  - So `Billing.tsx:760` sends the customer to the app's own billing page. Mollie's checkout
    address, which `@mollie/api-client` 4.6.0 gives as `getCheckoutUrl()`, is read nowhere:
    `MollieService.toMolliePayment` keeps only `redirectUrl`.
  - `a-draft-is-not-paid.unit.test.ts` stubs Mollie with a pay address as its `redirectUrl`, so
    the test passes with the mistake in it.
  - T4's fix for finding 8 takes this on. The API returns the checkout address and refuses a
    payment that has none, and the web app follows it only when it is `https:` on Mollie's host.

**2026-11-20, after T2: #1984's CI is green, and T4's first fix is built as #1985, merged on
2026-11-21 (`032bae95`; *was:* a draft, not merged).**
- **#1984** passed every workflow on its pull request. CI run 44838311907 includes the
  integration tests on amd64 and arm64 and `ci-complete`; Security Scan run 44838311872 includes
  the two osv-scanner steps.
- **#1985, the tag length**, on `claude/ownpace-public-readiness-y7orc6-gcm-tag-length` from
  `main` at `5a0a2eff`. This is the fix §4.3 calls real and small, and the one
  `gcm-no-tag-length` needs before it may block.
  - `packages/core/src/secrets.ts`'s `createCipheriv` and `createDecipheriv` both pass
    `authTagLength: AUTH_TAG_LENGTH` (16 bytes). That is GCM's default, which both sides
    already used, so every stored secret decrypts as before.
  - A new case cuts a real tag to 12 bytes and holds both calls to the option. Dropping the
    option fails it. With the length check removed, Node itself still refuses the tag.
  - `packages/core`'s unit tests pass (98 files, 1,067 tests), as do ESLint and the typecheck.

**2026-11-20, at the end: T2, osv-scanner, built as #1984, merged on 2026-11-21 (`6265a94c`;
*was:* a draft, not merged).** On the branch
`claude/ownpace-public-readiness-y7orc6-osv-scanner`, from `main` at `8b8fac07`; step 1 of §5, as
D1 decided.
- **What it does.** The Security Scan's repository job installs osv-scanner from its GitHub
  release, checked by its sha256 for both architectures, and reads `pnpm-lock.yaml` with it on
  every pull request, push to `main`, tag and Monday. `scripts/osv-report.mjs` reads the result:
  - a package an OSV `MAL-` record names, by its id or an alias, fails the job;
  - a scan that did not finish fails it too: an exit code other than 0 or 1, a report it cannot
    read, findings that disagree with the exit code, or fewer than 100 packages read;
  - every other advisory is listed in the job summary and passes.

  Both steps run after a red audit. The pin watch has an `osv-scanner` row against upstream's git
  tags.
- **The version is v2.7.1, not §5's 2.6.0.** 2.6.0 is two releases behind, so the pin watch would
  have called it behind on its first run. Its results come from the live OSV database, so the
  engine's version matters little for agreeing with the outside check. v2.7.1's assets were
  uploaded on 2026-11-09, past the three-day floor.
- **Proved.** The pull request's own Security Scan, run 44838311872, passed with both new steps on
  `ubuntu-24.04`. By construction, that means both sums matched, the binary called itself 2.7.1,
  and the report found no malicious package in a lockfile read whole. The steps' own output could
  not be read from here: the log tool returns the last 5,000 lines, and this session's network
  refuses the log archive's host. Locally, on Node 22.23.5:
  - every guard and the e2e unit tests pass: 305 files, 7,453 tests, the same 33 skipped;
  - the new guard (`a-malicious-package-nothing-read`, 17 tests) fails on each of seven mutations
    of the report and the workflow, and the files were put back `cmp`-equal;
  - the pin guard's new block holds each refusal and each runtime fault by a mutation of the step;
  - ESLint and `pnpm typecheck` pass.

**2026-11-20, latest: findings 7 and 4 are set aside, on the owner's word (T10, T11, D6).** Docs
only.
- **Finding 7.** Told that no community rule reports it and that four candidates fit it, the
  owner answered: *"Leave that Finding 7 / unfindable for now."* It is parked as T10, and §4.3
  keeps the four candidates for when it is taken up.
- **Finding 4.** Then: *"finding 4: also park, we pick up later"*. It is parked as T11; its two
  spots are still not named here (§3).
- **So D6 asks the owner for nothing now.** T4 covers findings 8 and 9 and the small fixes.

**2026-11-20, last: D7 answered and built as #1980, merged on 2026-11-21 (`a4e9f331`); findings 8
and 9 found; 4 and 7 asked of the owner (T9, T4, D6).** Docs only on this branch.
- **D7.** The owner answered *"D7: yes"*. The deletion is its own draft pull request, #1980, on
  `claude/ownpace-public-readiness-y7orc6-o365-lane-withdrawn`. 0141's Status of the same day has
  what it changes and what was proved. Once it merges, finding 1's spots are two, and D2 needs two
  environments.
- **D6.** The owner asked what was expected for findings 4, 7 and 8. Before answering, a third
  measure run (44829612242) ran every community rule under Semgrep's JavaScript and TypeScript
  namespaces, in a pack or not (`r/javascript` and `r/typescript`, 179 and 36 seconds). It
  reports one spot each for findings 8 and 9, the counts the outside check gives, each at the
  first candidate §4.3 had named:
  `js-open-redirect-from-function` at `apps/web/src/pages/Billing.tsx:760`, and `react-href-var`
  at `apps/web/src/components/ProviderConsent.tsx:593`. No community rule reports finding 7.
- **So the owner is asked for two things only**, each as the outside check lists it: the file
  and line (or the route) of finding 4's two spots, and the file and line of finding 7's two
  spots. §4.3 names four candidates for 7, all from the Cirrux change merged on 2026-11-19.

**2026-11-20, later: the owner's decisions, D1 to D6, and a question that becomes D7 (T0).** Docs
only. The owner answered §6 the same day:
- **D1**, osv-scanner blocks only on a malicious package: *"yes"*.
- **D2**, the nine secrets into three environments, starting with the O365 one: *"yes, but why do
  we still have an O365 workflow? Perhaps we need to delete that file."*
- **D3**, Semgrep as a named list, report only, the ReDoS rule never blocking: *"yes; CodeQL not
  now"*.
- **D4**, gitleaks may ignore test-file paths and the one placeholder doc, with no inline ignore
  comments: *"yes."*
- **D5**, the release SBOM keeps listing what is installed: *"keep as is"*.
- **D6**, the exact spots for findings 4, 7, 8 and 9, copied from the outside check's detail:
  *"ok"*. The owner supplies them, and T4's spots for 7 to 9 and finding 4's two routes wait for
  them.

**The O365 lane, read on 2026-11-20 to answer D2's question (now D7).** `e2e-o365.yml` is the
read-only, dispatch-only dry run of the Microsoft 365 source against the real SMB tenant
(`docs/test-tenant.md`, 0008 T7). 0141 carries it as T13 (a). It has never run a test:
- **Four runs, none of them past its first step.** The two of 2026-09-06 were cancelled before a
  runner took them. 41273625023 (2026-11-01) waited about 21 hours for a runner label no runner
  carried yet, and was cancelled. 41418432093 (2026-11-02) got the runner and failed at
  *Validate required secrets*: `O365_CLIENT_ID` and `O365_TENANT_ID` reached it empty, because
  they are not set as repository secrets. 0141's Status of 2026-11-20 says they are still not set,
  and that run is still the newest.
- **No release needs it.** Release does not read the lane. Every alpha since alpha.4 was tagged
  without it, under the owner's waiver for alpha.4 to alpha.11 (0141 T13).
  `scripts/connector-coverage.unit.test.ts` records the Graph sources as *owed*, not driven.
- **So seven of finding 1's nine spots name secrets that do not exist.** Moving them into an
  environment would move nothing. Deleting the workflow removes them, and leaves two secrets for
  D2: `e2e-managed.yml`'s `TRIGGER_ACCESS_TOKEN` and `exposure-probe.yml`'s `EXPOSURE_PROBE_HOST`.

§6 D7 puts the deletion to the owner, with what it changes. The deletion is a workflow change, so
it is not made on this plan's branch.

**2026-11-20: proposed.** An evaluation, not a build. Nothing in `.github/` changes on this plan's
branch. Each recommendation below is the owner's to accept, change or refuse (§6). The candidate
tools were run once, report only, on a separate branch that is never merged and has no pull request
(`claude/ownpace-public-readiness-y7orc6-ci-scan-measure`, runs 44823064781 and 44824596099, on
`main` at `bf9ede7`). §4 has what each one found. In short: osv-scanner reproduces finding 3 exactly
and Semgrep reproduces findings 5 and 6, but nothing free reproduces 7 to 9, and every Semgrep and
gitleaks spot read so far is a false positive or low risk. The two exceptions are
`packages/core/src/secrets.ts`'s missing `authTagLength`, and finding 1, which is real and is a
settings change.

The outside check read `main` around `b4d11ee7` on 2026-11-19 and 2026-11-20. Its findings are
transcribed from a screenshot, so a count here is the screenshot's count. Two of them belong to
other work and are only listed here: GEN-21 (the Docker socket proxy runs as root) and GEN-26
(three `setup-node` steps that zizmor 1.30.1 flags, and zizmor in CI).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The decisions | owner | ✅ **Decided 2026-11-20** (D1 to D6, as advised; D7, *"yes"*, built as T9) | §6. The owner's answers are quoted in the Status entry of 2026-11-20, later. |
| T1 Secrets into environments | builder | ✅ **Merged** on 2026-11-21: #2001 (`6afa68cd`), the jobs name their environments, and #2007 (`66138ba9`), the report; ✅ **the secrets moved** in Settings by the owner the same day (Status, 2026-11-21, after #2007 merged) | Finding 1. Two GitHub environments if D7 deletes the O365 lane (`e2e-managed`, `exposure-probe`), three if it does not. The secrets move in Settings, by the owner; the pull request adds `environment:` to those jobs. Then zizmor's `secrets-outside-env`, report only (§5, step 2). |
| T2 osv-scanner | builder | ✅ **Merged** as #1984 on 2026-11-21 (`6265a94c`) (D1) | Finding 3 and "no malicious packages". Fail the build on a malicious package; report the rest (§5, step 1). |
| T3 Semgrep, report only | builder | ✅ **Merged** as #1986 on 2026-11-21 (`fbd73f93`) (D3) | Findings 5, 6, 8 and 9, plus `gcm-no-tag-length`, the template injection and the script tag. A short named list of rules, not whole packs. Finding 7 has no community rule (§4.3; §5, step 3). |
| T4 Fix or answer each spot | builder | 📋 **Planned** (the Cirrux test fake's decipher); ✅ **the tag length merged** as #1985 on 2026-11-21 (`032bae95`); ✅ **findings 8 and 9, with the Pay button, merged** as #1990 on 2026-11-21 (`5d5c5f55`; Status, 2026-11-21, last); ✅ **the grant page's two buttons, merged** as #1996 on 2026-11-21 (`40bb3476`; Status, 2026-11-21, after T5's first part); ✅ **the no-checkout sentence in Dutch, merged** as #2005 on 2026-11-21 (`55eab78b`; Status, 2026-11-21, at the end) | §4.3. Fix `secrets.ts`'s `authTagLength`, and the Cirrux test fake's decipher (`cirrux-fake.ts:135`), which #1986's run found; the `base_ref` line goes with GEN-26. Findings 8 and 9 (`Billing.tsx:760`, `ProviderConsent.tsx:593`): one `https:`-and-host check where the web app follows or links an address from the API, with a guard. Findings 7 and 4 are parked (T10, T11). |
| T5 Semgrep fails the build, rule by rule | builder | 📋 **Planned** (D3); ✅ **the time-outs first, merged** as #1993 on 2026-11-21 (`87663d70`); 🔨 **`run-shell-injection` blocks, built** to supersede #1997, with the time-out reading by language; `react-href-var` waits on its time-outs (Status, 2026-11-22) | A rule moves to blocking once it reports nothing on `main` (§5, step 5). `detect-non-literal-regexp` never blocks. Before any rule blocks, the report lists each place Semgrep's taint analysis read only in part, and one where a rule that blocks can have timed out is a scan that did not finish. In CI those time-outs fall on `js-open-redirect-from-function` and `path-join-resolve-traversal`, so this step first chooses how a blocking rule's time-outs are read (Status, 2026-11-21, latest). |
| T6 gitleaks on a pull request's own commits | builder | ✅ **Merged** as #1992 on 2026-11-21 (`17a9a460`) (D4) | Fails the build, with an allowlist of test-file paths (`*.unit.test.ts`, `*.integration.test.ts`) and `docs/o365-setup.md`, and no inline ignore comments (§5, step 4). |
| T7 Image findings: keep, do not add | — | 📋 **Proposed** | Findings 2, 11 and 12 are covered today, report only. §3 says why nothing is added. |
| T8 Not worth a check | — | 📋 **Proposed** | Findings 4 and 10, and Trivy's misconfiguration scan: §3 and §5 say why. D3 (no CodeQL now) and D5 (the SBOM as it is) answer two parts of it. |
| T9 The O365 lane | builder | ✅ **Decided 2026-11-20** (*"D7: yes"*); ✅ **Merged** as #1980 on 2026-11-21 (`a4e9f331`) | `e2e-o365.yml` deleted, with what §6 D7 lists; 0141's Status of 2026-11-20, last, has the proof. |
| T10 Finding 7, secrets not compared in constant time | owner | 🅿️ **Parked 2026-11-20, by owner decision** (*"Leave that Finding 7 / unfindable for now."*; trigger: the owner takes it up) | No community rule reports it (§4.3). Four candidates fit it, all from the Cirrux change of 2026-11-19, and none compares a secret with a value someone else supplies. |
| T11 Finding 4, the overview of routes and who may use them | owner | 🅿️ **Parked 2026-11-20, by owner decision** (*"finding 4: also park, we pick up later"*; trigger: the owner takes it up) | The outside check's own rules; the screenshot does not name its two spots (§3). When it is taken up, each spot gets a case in `apps/api`'s door guards or is recorded as intended (§5). |

## 1. Why

The outside check reads `main` daily or weekly, after the merge. Most of what it reported was not
caught before the merge. That is not because CI missed it: no step here looks for those kinds of
problem. Moving a check into CI means a finding reaches the author before the merge, while the
change is still theirs. A check that fails the build must be quiet on `main` first. Otherwise it is
red for every pull request, and a red that is always there stops being read (the argument
`scripts/audit-advisories.mjs` makes for its `--fail-at`).

## 2. What CI runs today

Read from `.github/workflows/*.yml`, `.github/dependabot.yml`, `.hadolint.yaml` and
`scripts/idp-pin-watch.mjs` on `main` at `bf9ede7`.

| Check | Where | Version, and how it is pinned | When | Fails the build? |
|---|---|---|---|---|
| pnpm audit, read by `scripts/audit-advisories.mjs` | `security-scan.yml`, job `security-scan` | the pnpm `packageManager` names; the advisory list is npm's, read live | pull request, push to `main`, tag, Monday 06:00 UTC, dispatch | **Yes** on high and critical; moderate and low are listed and pass |
| Trivy filesystem scan (vulnerabilities, plus secrets by Trivy's default), HIGH and CRITICAL, SARIF to code scanning | same job | Trivy v0.76.2 from its GitHub release, sha256 per architecture; `trivy-action` by commit (v0.36.0) | same | No (`continue-on-error`); the job fails only if no report was written or uploaded |
| CycloneDX SBOM (`bom.json`) | same job | `@cyclonedx/cyclonedx-npm` ^7.0.0, a root devDependency, from the lockfile | same; attached to the release on a tag | Only on a tag, where a missing SBOM would leave the release unmade |
| Image scans: every image the stacks run, Trivy, `linux/arm64`, HIGH and CRITICAL, SARIF to code scanning except test-only images, one issue per image past its end of life | `security-scan.yml`, jobs `image-list`, `image-scan` (about 26 legs), `image-scan-report` | Trivy v0.76.2 as above | Monday schedule, and a dispatch unless `image_scans: false` (Release passes false) | No; the report job fails only when a leg wrote no report |
| hadolint over every Dockerfile git lists, DL3008 and DL3018 ignored, ignore pragmas disabled | `hadolint.yml` | `hadolint/hadolint:v2.15.1@sha256:32dac941…`, held whole by a guard | pull request, push to `main`, dispatch | No (report only, the owner's decision of 2026-11-19) |
| Atlas migration lint | `ci.yml`, `migration-lint` | Atlas community v1.4.0, sha256 per architecture | pull request, push | Yes |
| ESLint (typescript-eslint, type-aware; no security plugin) and `tsc` | `ci.yml`, `lint` and others | lockfile | pull request, push | Yes |
| The repository's own guards: `scripts/*.unit.test.ts`, indexed in `docs/LESSONS.md` (for example a Dockerfile that ends as root, a binary the stack never runs, a pipeline its own consumer can kill, a gate on a version nothing ships) | `ci.yml`, `unit-tests` | the tree | pull request, push | Yes |
| Commit convention, docs hygiene, generated-index drift | `ci.yml` | the tree | pull request (convention), pull request and push | Yes |
| No committed build output | `no-committed-artifacts.yml` | the tree | pull request | Yes |
| Image signing (cosign) and its verification | `images.yml` (sign; `task-base-pin` verifies), `release.yml` `verify` | cosign v3.1.4 through `cosign-installer` by commit (v4.1.3) | push to `main`, tag; release | Yes |
| Dependabot version updates | `.github/dependabot.yml` | — | weekly, Monday 06:00 UTC: npm (grouped), GitHub Actions (grouped), the Dockerfiles' FROM lines (several entries) | Opens pull requests |
| Dependabot security updates and alerts | the repository's settings, not a file | — | as GitHub publishes | Pull requests and alerts, while the setting is on |
| The pin watch: every pin Dependabot cannot see (compose images, Trivy, cosign, Atlas, stalwart-cli, hadolint, binfmt and BuildKit, Node keys, pnpm, Trigger.dev and others) | `idp-pin-watch.yml` | — | Monday 06:23 UTC, dispatch | Opens or updates issues; a row that cannot read upstream fails the run |
| CodeQL | **none in a workflow.** Code scanning receives Trivy's SARIF only. Whether GitHub's default CodeQL setup is on is a repository setting this plan could not read | — | — | — |
| Secret scanning and push protection | a repository setting this plan could not read; in CI, only Trivy's secret scanner inside the filesystem scan, report only | — | — | — |
| zizmor | none today; GEN-26 adds zizmor 1.30.1 | — | — | — |

## 3. Each finding against what runs

The numbers are the outside check's, in its order. "Measured" means the candidate ran on the
measure branch (§4).

| # | Finding (count) | Today | What is missing |
|---|---|---|---|
| 1 | Secrets used by the build automation not in the right place (9) | **Not covered.** | Measured by reading: exactly nine `secrets.*` references sit in jobs with no `environment:`. Seven are in `e2e-o365.yml` (O365 client, tenant, scope, refresh token, user name, password), one is in `e2e-managed.yml` (`TRIGGER_ACCESS_TOKEN`) and one is in `exposure-probe.yml` (`EXPOSURE_PROBE_HOST`). This is zizmor's `secrets-outside-env` audit (added in v1.23.0). Since v1.24.0 it reports only under the `auditor` persona, so the zizmor run GEN-26 adds will not show it at the default persona. The outside check names gitleaks as the tool; the count and the wording match zizmor's audit. Only `release.yml`'s publish job has an environment today (`release`). |
| 2 | Base-image vulnerabilities with a fix (15) | **Covered, report only:** the Monday image scans, SARIF in code scanning. | Nothing to add. The count depends on the day's database. A fix arrives through Dependabot or the pin watch, and the next scan confirms it. |
| 3 | A known vulnerability in a package (1, one lockfile) | **Covered, report only:** pnpm audit lists it as moderate on every run. | Measured: osv-scanner 2.6.0 finds exactly one, GHSA-g3hv-75wg-m249 in minimatch 10.2.6, `pnpm-lock.yaml`. It is the one path `pnpm-workspace.yaml` deliberately keeps on 10.x for the Trigger.dev deploy CLI. The comment there gives the reason, and why the advisory's code does not run on that path. Known, accepted and documented. |
| 4 | Overview of routes and who may use them (2) | **Partly covered:** `apps/api` holds guards over its doors (`openapi-spec`, `a-hold-that-holds-every-door`, `an-organisation-closed-at-every-door`, `a-route-that-opened-the-owners-pool` and others). | The check uses its own rules, and the screenshot does not name the two spots, so this plan cannot say which routes they are. Parked by the owner on 2026-11-20 (T11). |
| 5 | ReDoS-prone regular expressions (32) | **Not covered.** | §4.3. |
| 6 | A file path built from input (1) | **Not covered.** | §4.3. |
| 7 | Secrets not compared in constant time (2) | **Not covered.** | §4.3. |
| 8 | A redirect to an address from input (1) | **Not covered.** | §4.3. |
| 9 | React: a `javascript:` address (1) | **Not covered.** | §4.3. |
| 10 | The repository's SBOM disagrees with the check's (2) | **Partly:** the SBOM is made on every run and attached at a tag. | Measured: the repository's CycloneDX lists 660 components, and syft 1.52.0 reads 934 from the lockfile alone. The difference is mostly platform-only optional packages that are never installed on the runner (`@esbuild/*` for other systems, `@depot/cli-*`). The CycloneDX SBOM describes what is installed; syft describes everything the lockfile could resolve. Which two spots the check means is not named in the screenshot. |
| 11 | Dockerfile rules (34 in 14 Dockerfiles) | **Covered, report only:** hadolint 2.15.1 in `hadolint.yml`, the same version the check uses. | Nothing to add. Blocking waits for the Trigger.dev Dockerfiles' pass (0119 §3 item 14). |
| 12 | Outdated base images (4) | **Covered:** Dependabot's docker entries and the pin watch's rows, both weekly. | Nothing to add. |
| — | Passed: no secrets in history or files | Partly: Trivy's secret scanner, report only, files only. | Measured: gitleaks 8.30.1 with its default rules reports 77 in history and 67 in the files. All of them look like test fixtures, documentation placeholders or a checksum (§4.2). The check passed, so it must allowlist or verify; a CI gitleaks needs the same (D4). |
| — | Passed: no malicious packages | Not covered in CI. | osv-scanner reads OSV's malicious-package records (`MAL-…`); pnpm audit does not. |
| — | Passed: SBOM made and scanned (syft, 950 packages) | Covered (CycloneDX, Trivy). | — |
| — | Passed: React build variables, source maps, agent configuration, Express settings, secrets in image layers, images as root and risky ports | Partly, by the repository's own guards. | Nothing proposed; each passed. |
| — | Measured: tools in an image production does not need (3) | Partly: `a-binary-the-stack-never-runs`. | Not named in the screenshot; nothing proposed. |
| — | Partly measured: other infrastructure files (Trivy 0.74.0, 14 Dockerfiles) | Not run in CI. | Measured with the Security Scan's Trivy v0.76.2: 14 config files read and 14 failures. One is CRITICAL DS-0031 in the socket proxy's Dockerfile: it matches the proxy's `AUTH=0` and `SECRETS=0` switches, which are API permissions, not secrets, so it is a false positive. One is HIGH DS-0002, the same file ending as root (GEN-21). Twelve are LOW DS-0026, no HEALTHCHECK, which overlaps hadolint's findings. |
| — | GEN-21, the socket proxy as root | Handled in its own work, and fixed on `main` on 2026-11-21 (`7cbb1093`, workplan 0119): the proxy runs as HAProxy's uid 99. | Listed only. |
| — | GEN-26, three `setup-node` steps zizmor flags; zizmor in CI | Handled in its own work. | Listed only. |

## 4. What the candidates found on this tree

Measure runs 44823064781 and 44824596099 (the second for Semgrep's audit packs), on `main` at `bf9ede7` with one added workflow, on `ubuntu-24.04`. Every
tool was pinned (release sha256, or the image's index digest). Every exit status was recorded and
nothing failed on a finding. Nothing was uploaded to code scanning. Below, a finding is named by
its rule and file only.

### 4.1 osv-scanner 2.6.0

It read `pnpm-lock.yaml`, the only lockfile in the tree: 934 packages, 2 seconds. It reported one
advisory, GHSA-g3hv-75wg-m249 (CVE-2026-118764) in minimatch 10.2.6, and exited 1. This is finding 3
(§3), and it is already known. It reported no malicious-package record.

### 4.2 gitleaks 8.30.1, default rules

- **History** (2,955 commits, 5 seconds): 77 findings. Most are the same test files as below, or
  their earlier names and copies. The one file no longer in the tree is `.env.managed`, with 3
  `generic-api-key` findings. It was added on 2026-07-20 and deleted on 2026-08-01. All five values
  in it are placeholders: three are the sequence `0123…cdef` or its reverse, and two are one
  character repeated 32 times. None is a credential.
- **Files** (1.4 seconds): 67 findings. 60 are `generic-api-key` in unit and integration test files
  (fake tokens built for a test). 5 are in documentation: three in `docs/o365-setup.md`, whose
  placeholders read like `your…` and its example `abc123~XYZ…`, and one each in two workplans. 1 is in
  `deploy/compose/goaccess/Dockerfile`; 1 is `jwt` in `scripts/redact-evidence.unit.test.ts`,
  whose job is to redact such tokens.
- **Read as:** no real secret found. The outside check passed the same tree, so it allowlists or
  verifies before it reports. Blocking on gitleaks' default rules today would fail every pull
  request that touches one of those 50-odd test files.

### 4.3 Semgrep 1.178.0

Three runs, all on Semgrep's community rules from its registry:
- run 44823064781 ran `p/default`, `p/javascript`, `p/typescript`, `p/react`, `p/nodejs`,
  `p/expressjs` and `p/secrets` (9 minutes for the seven, one after another);
- run 44824596099 ran `p/security-audit`, `p/owasp-top-ten`, `p/r2c-security-audit`, `p/xss` and
  `p/jwt` (4 minutes, of which `p/owasp-top-ten` took 102 seconds);
- run 44829612242 ran every rule whose id starts with `javascript.` or `typescript.`, in a pack or
  not (`r/javascript`, 179 seconds, 1,443 results; `r/typescript`, 36 seconds, 1,039 results). Most
  of those results are style and i18n rules (878 `i18next-key-format`, 410
  `missing-template-string-indicator`), which no proposal here takes.

Each pack scanned 2,209 to 2,929 files; the outside check counts 2,939. Every pack also logged
parse errors (6 to 234 per pack), which Semgrep skips.

**What they reproduce of the outside check's five classes:**

| # | Class | Community rule that matched | Spots here | Read as |
|---|---|---|---|---|
| 5 | ReDoS | `detect-non-literal-regexp`; and `detect-redos`, in no pack (third run) | 174 in all, 20 outside test files; `detect-redos` 18, 10 outside test files | False positives in kind (below) |
| 6 | Path from input | `path-join-resolve-traversal` | 1: `apps/worker/src/index.ts:92` | False positive: the path is the worker CLI's own `--config` argument, given by whoever runs the command |
| 7 | Constant-time comparison | none, in any of the three runs | 0 | Not reproduced; four candidates (below) |
| 8 | Redirect from input | `js-open-redirect-from-function`, in no pack (third run) | 1: `apps/web/src/pages/Billing.tsx:760` | Real, low (below) |
| 9 | React `javascript:` address | `react-href-var`, in no pack (third run) | 1: `apps/web/src/components/ProviderConsent.tsx:593` | Real, low (below) |

- **Class 5, the 20 spots outside tests:**
  - `packages/connectors/src`: `caldav-source.ts:536`, `carddav-source.ts:496`,
    `takeout-archive-reader.ts:546`;
  - `packages/engines/src/dav-multistatus.ts`: lines 30 and 62;
  - `packages/shared/src`: `calendar-scheduling.ts:241`, `dav-refusal.ts:104`,
    `mail-headers.ts:60`, `remote-refusal.ts:107`;
  - `scripts/`: `dav-target-probe.mjs:225`, `idp-pin-watch.mjs` (five), `nginx-config.mjs:141`,
    `release-names-agree.mjs:149`, `release-preflight.mjs:177`, `release-verify.mjs` (two).

  The rule flags any regular expression built at run time, whatever goes into it. Read here, every
  value interpolated in `packages/` is either a constant at its call site, or escaped first
  (`escapeForPattern`, `escapeRegExp`). The constants are element names such as `'response'`,
  `'address-data'` | `'calendar-data'`, `'code'` and `'CN'`. The one value read from a remote
  answer is `remote-refusal.ts`'s namespace prefix, which `XML_ROOT` has already limited to
  `[A-Za-z_][A-Za-z0-9_-]*`, so it cannot add a quantifier. The `scripts/` ones read this
  repository's own files. The other 154 are in test files. Which 32 the outside check counts, it
  does not say; it presumably excludes part of the tests. So the rule would only ever fail the
  build by being rewritten around: each spot would become a literal per element name, which is
  churn with no safety gained. It stays out of any blocking set (D3).
- **Classes 8 and 9 have community rules, but in no pack;** the third run found them. Each
  reports one spot, as the outside check does:
  - **8,** `js-open-redirect-from-function` at `apps/web/src/pages/Billing.tsx:760`:
    `window.location.href = result.paymentUrl`. The address is Mollie's checkout address, from
    this repository's own API, not from the visitor. Low risk, but real: the browser follows
    whatever comes back, and a `javascript:` address would run in the page.
  - **9,** `react-href-var` at `apps/web/src/components/ProviderConsent.tsx:593`:
    `href={unopened.url}`, the provider's consent address, from this API. Low risk and real, for
    the same reason.
  - **The fix for both** is one check that the address is `https:` on the host the flow expects,
    before it is followed or linked (T4). `apps/web/src/services/consent-window.ts:123`, which
    sends the consent window to the same kind of address, takes the same check, although no rule
    reports it.
- **Class 7 has no community rule** under `javascript.` or `typescript.` that reports anything
  here. The outside check dates it "since 2026-11-20". The Cirrux Drive change (`4db06696`), on
  `main` since 2026-11-19 at 18:29 UTC, is the only code of those days that compares tokens with
  `===`:
  - `packages/connectors/src/cirrux-token-provider.ts:293`: the cached access token against the
    one a server just refused;
  - `packages/connectors/src/__testing__/cirrux-fake.ts`, a test server: lines 72 and 78 (its
    stored refresh token against the one presented) and 376 (the PKCE challenge).

  None of the four compares a secret with a value someone else supplies, so each reads as a
  false positive, but which two the check counts is not known. The owner set the finding aside
  on 2026-11-20 (T10). Elsewhere in `apps/` and
  `packages/`, the comparisons with secret-like names are presence checks (`!== ''`, `!== null`),
  and the two places that compare a presented token with a stored one already use
  `timingSafeEqual` (`google-consent.ts`, `packages/ledger/src/mapping-link-store.ts`).
- **`detect-redos`, the 10 spots outside tests:** `apps/api/src/failure-answer.ts:160` (a
  provider's error text), `apps/api/src/unreadable-body.ts:87`, `apps/web/src/pages/Docs.tsx:282`,
  `packages/shared/src/reachable-host.ts:324`, and six in `scripts/`. Read by hand, none needs a
  fix:
  - the one that reads remote input, `failure-answer.ts`, tests patterns whose repeated parts are
    each separated by a literal, so they cannot backtrack exponentially;
  - `Docs.tsx`'s table pattern can backtrack polynomially, but it reads the documentation the web
    app ships, not input;
  - the rest read a library's error type, an operator's setting, or this repository's own files.

  Which rule, or which mix, the outside check's 32 counts is not known. Both ReDoS rules stay
  report only (D3).
- **What the packs found besides the five classes**, outside tests:
  - `gcm-no-tag-length` at `packages/core/src/secrets.ts:194`: `createDecipheriv` without
    `authTagLength`. The tag's length is checked by hand two lines above, so it is not exploitable
    as written, but the option is a one-line hardening. **Real, small; fix.**
  - `run-shell-injection` at `.github/workflows/no-committed-artifacts.yml:41`:
    `${{ github.base_ref }}` inside `run:`. The base branch is one of this repository's own, so the
    risk is low, but the fix is the usual one (pass it through `env:`). zizmor's
    `template-injection` audit (GEN-26) reports the same line, so it belongs there.
  - `gha-workflow-env-secret`, 8 spots: finding 1's secrets again, seen from another rule.
  - `unknown-value-with-script-tag` at `apps/api/src/routes/migrations/google-consent.ts:832`:
    false positive; the value goes through `jsString` (JSON) inside the script.
  - `bypass-tls-verification` at `packages/connectors/src/smtp-transport.ts:83`: intended for a
    self-signed test catcher, and `readNotifierConfig` refuses the setting in production. Also at
    `scripts/clock-watch.mjs:344`. Accepted as written.
  - `request-host-used` (nginx), 3 spots, and `last-user-is-root` (GEN-21).
  - The supply-chain settings rules: `dependabot-missing-cooldown` (11 entries in
    `.github/dependabot.yml`), and the pnpm ones (`pnpm-trust-policy`,
    `pnpm-block-exotic-sub-dependencies`, `pnpm-minimum-release-age` at `pnpm-workspace.yaml:448`).
    These are settings questions for 0119, not code findings. They are listed so the owner can
    choose, not proposed here.
- **What the third run added outside tests,** besides the above: `raw-html-join` at
  `site/build.mjs:899` (the site's build joins HTML from this repository's own content);
  `detect-non-literal-fs-filename` at `apps/worker/src/index.ts:93` (the worker CLI's `--config`
  again); and `unsafe-dynamic-method` at four places in `packages/` that call a method by a name
  from a closed set. `insecure-innerhtml` and `insecure-document-method` report one test file
  only.
- **In test files:** 25 `hardcoded-jwt-secret`, 14 `detected-*` token look-alikes, 3
  `react-insecure-request`, `unsafe-formatstring` and others. All are fixtures.

### 4.4 Trivy v0.76.2, misconfiguration (`trivy config`)

It read 14 config files (all Dockerfiles; compose files are not a type it checks) in 3 seconds and
reported 14 failures. Those are the CRITICAL DS-0031 (a false positive), the HIGH DS-0002 (GEN-21)
and twelve LOW DS-0026 (no HEALTHCHECK) listed in §3. hadolint already covers every Dockerfile, and
the repository's guard covers ending as root (`a-dockerfile-that-ends-as-root`), so this scan would
report the same things a second time with more noise.

### 4.5 syft 1.52.0 against the repository's SBOM

On the lockfile alone, syft read 934 name@version entries; the repository's CycloneDX SBOM has 660.
The rest of §3, finding 10, applies.

## 5. Recommendations, in order

Each step is its own pull request. A tool is pinned the way Trivy, Atlas and stalwart-cli are
pinned here today: a GitHub release download checked by its sha256 per architecture, or an image
by its index digest, never a floating tag. A pin-watch row (`scripts/idp-pin-watch.mjs`) keeps each
one current, and the guard that holds the pin's form fails a pull request that loosens it. That
matches the owner's rule that CI tools are pinned and kept current by the pin watch. No step adds
an exact apk or apt pin, and hadolint stays report only.

| Step | Add | Finding | Fail or report | Tool and pin | Trigger | CI time | Noise today | Kept current by |
|---|---|---|---|---|---|---|---|---|
| 1 | osv-scanner over `pnpm-lock.yaml`, in the Security Scan's repository job | 3; malicious packages | **Fail the build** on a malicious-package record (`MAL-…`). **Report only** for vulnerabilities, because pnpm audit stays the vulnerability gate with the owner's `--fail-at=high` | osv-scanner 2.6.0 (the outside check's version), `osv-scanner_linux_amd64` and `_arm64` from its GitHub release, sha256 per architecture (amd64 `ca69b3d3…`). Built with v2.7.1, the newest release past the three-day floor (Status, 2026-11-20, at the end) | pull request, push to `main`, tag, Monday (the job's triggers) | under 10 s (2 s measured, plus the download) | 1 known moderate, listed and passing; 0 malicious | a pin-watch row against osv-scanner's GitHub releases; the guard family that holds Trivy's sha256 form |
| 2 | Finding 1 fixed (T1), then zizmor's `secrets-outside-env` | 1 | **Report only** | zizmor as `zizmor.yml` pins it (1.32.0 since 2026-11-21; GEN-26 pinned 1.30.1). A second invocation with `--persona auditor`, reading only this audit's results; the auditor persona's other findings are not proposed | as GEN-26's zizmor job | seconds | 0 once T1 is done; 9 before, or 2 once D7 deletes the O365 lane | GEN-26's pin-watch row |
| 3 | Semgrep with a short list of named rules (§4.3), not whole packs: `path-join-resolve-traversal`, `js-open-redirect-from-function`, `react-href-var`, `gcm-no-tag-length`, `run-shell-injection`, `unknown-value-with-script-tag`, and `detect-non-literal-regexp` and `detect-redos` (both report only for good). The rules are fetched by id, so a rule in no pack is as easy to name as one in a pack | 5, 6, 8, 9 | **Report only**, to the job summary and code scanning (SARIF) | `semgrep/semgrep:1.178.0@sha256:32e45996…` (the outside check's version). The rules are a file in the repository that names the chosen rule ids, fetched from the registry by id, or written in the repository where a rule is short. Built with 1.186.0, the newest release past the three-day floor, and the ids in `RULES` in `scripts/semgrep-report.mjs` (Status, 2026-11-21) | pull request, push to `main` | 1 to 2 minutes for a named list (measured: 37 s to 102 s per whole pack; the image pull is one more) | §4.3 | a pin-watch row against Docker Hub's tags of the same shape, as hadolint's; the guard that holds the whole reference (as `HADOLINT`) |
| 4 | gitleaks over a pull request's own commits (`base..head`) | the "no secrets" pass, kept passing | **Report only** until D4 is answered; then fail the build | gitleaks 8.30.1 (the outside check's version), `gitleaks_8.30.1_linux_x64.tar.gz` and `_arm64` from its GitHub release, sha256 (x64 `551f6fc8…`) | pull request | under 15 s | today's 67 do not appear unless a pull request touches those lines | a pin-watch row against gitleaks' releases. Built as `ci.yml`'s `gitleaks` job, failing the build, with 8.30.1, still gitleaks' newest release (Status, 2026-11-21, after the merges) |
| 5 | Semgrep moves to failing the build, one rule at a time, except `detect-non-literal-regexp` | 6 and the extras | **Fail the build**, per rule, once that rule reports nothing on `main` | as step 3 | as step 3 | as step 3 | 0 by construction | as step 3 |

**Not worth adding:**
- **Trivy's misconfiguration scan.** §4.4: it repeats hadolint and a guard, and its one CRITICAL
  is a false positive.
- **A second SBOM tool (syft).** The two lists answer different questions (installed against
  resolvable). A check that compares them would fail on platform packages forever. If the owner
  wants the release SBOM to list every resolvable package, that is a change to how `bom.json` is
  made, not a new check (D5).
- **A route-inventory tool** for finding 4: the repository's own door guards are the right place.
  Once the two spots are known, each one becomes a guard case or an answer. Parked for now
  (T11).
- **Anything more for findings 2, 11 and 12.** They are covered, report only, by owner decisions
  already in force.
- **Whole Semgrep packs.** Twelve packs found 174 plus about 100 more spots, almost all in tests,
  and still not findings 7 to 9. A named list keeps the signal and runs in a minute or two.
- **CodeQL**, unless D3 says so. Its JavaScript queries overlap the Semgrep classes above. Semgrep
  is proposed instead because its version can match the outside check's, so classes 5 and 6
  agree.

**Findings 8 and 9 have rules, and finding 7 has none.** `js-open-redirect-from-function` and
`react-href-var` are community rules in no pack, and each reports one spot, the count the outside
check gives (§4.3). They join step 3's list and fail the build in step 5 once T4's fix is in: one helper
that refuses an address that is not `https:` on the host its flow expects, used wherever the web
app follows or links an address the API returned. A `scripts/` guard in this repository's own
style can hold the third place, `consent-window.ts:123`, which no rule reports. Finding 7 has no
community rule, and the owner set it aside on 2026-11-20 (T10).

**What has to be fixed first.** Before a Semgrep rule may fail the build: `secrets.ts`'s
`authTagLength` (`gcm-no-tag-length`), and the `base_ref` line (`run-shell-injection`), which goes
with GEN-26. `path-join-resolve-traversal` and `unknown-value-with-script-tag` each have one false
positive. Each is answered in the plan, and the rule waits until the spot is reworded, or stays
report only; it is never silenced in the code (§4.3). Finding 1 is fixed by moving secrets (T1), which is a repository-settings change plus
two or three `environment:` lines (D7). osv-scanner's one finding is accepted and is not a malicious-package
record, so step 1 can fail the build at once. gitleaks blocks only on what a pull request adds,
so nothing in the tree has to change first. Only D4's allowlist question has to be answered.

## 6. Decisions for the owner

- **D1. osv-scanner fails the build on a malicious package, and only reports vulnerabilities?**
  Advice: yes. pnpm audit stays the vulnerability gate, so the two never disagree about what
  blocks, and OSV's malicious-package records are something nothing here reads today.
  **Answer, 2026-11-20: yes.**
- **D2. Move the nine secrets into three GitHub environments (`e2e-o365`, `e2e-managed`,
  `exposure-probe`)?** Advice: yes, starting with `e2e-o365`, whose seven secrets reach the real
  tenant. An environment can be limited to `main` (deployment branch rule), so a workflow changed on
  a branch cannot read them. This is a settings change the owner makes; the pull request only adds
  `environment:`. Then report `secrets-outside-env` only (it stays report only because zizmor marks
  it as needing judgement). **Answer, 2026-11-20: yes, with the question D7 answers.** If D7
  deletes the O365 lane, two environments are left, `e2e-managed` and `exposure-probe`.
- **D3. Semgrep with a named list of rules, report only first, and `detect-non-literal-regexp`
  report only for good?** Advice: yes to both. The ReDoS rule flags the way a regular expression is
  built, not what reaches it. Every one of its 20 spots outside tests is fed a constant or an
  escaped value (§4.3), so it can never be made quiet honestly. Before rules from the Semgrep
  Registry are vendored into this public repository, the owner reads the Semgrep Rules License
  v1.0. The registry repository's licence file points to it, and this plan
  could not read the page from where it was written. Fetching a rule by id at run time keeps no
  copy here; writing a short rule in the repository's own words avoids the question entirely.
  CodeQL: not now. **Answer, 2026-11-20: yes; CodeQL not now.**
- **D4. gitleaks on a pull request's own commits: what may be allowlisted?** Advice: allowlist by
  path pattern for test files only (`*.unit.test.ts`, `*.integration.test.ts`) and for the one
  documentation placeholder file, `docs/o365-setup.md`. Never use inline `gitleaks:allow`
  comments. Then fail the build. The alternative, no allowlist, keeps gitleaks report only for
  good. **Answer, 2026-11-20: yes.** gitleaks reads what a commit adds, so the other hits in §4.2
  (two workplans and the GoAccess Dockerfile) come back only if a pull request adds those lines
  again, and then they are read like any new hit.
- **D5. Should the release SBOM list what is installed (as today) or everything the lockfile
  resolves?** Advice: keep today's. It describes what ships, and a release that lists platform
  binaries it never contains would be the less accurate document. **Answer, 2026-11-20: keep as
  is.**
- **D6. The spots this plan cannot name: finding 4's two routes, finding 7's two comparisons,
  and which of §4.3's candidates are findings 8 and 9.** Advice: copy the file and line of each
  from the outside check's detail into the next piece of work. Each one then gets a fix and a
  guard case, or is recorded as intended. **Answer, 2026-11-20: ok.** The owner supplies the spots.
  Asked then what was expected for 4, 7 and 8, and answered after the third measure run, which
  found 8 and 9 itself (Status, 2026-11-20, last): only the file and line (or the route) of
  finding 4's two spots and of finding 7's two, as the outside check lists them. The owner then
  set finding 7 aside (*"Leave that Finding 7 / unfindable for now."*, T10), so D6 asks for
  finding 4's two spots alone. Then finding 4 too (*"finding 4: also park, we pick up later"*,
  T11), so D6 asks for nothing now.
- **D7. Delete `e2e-o365.yml`?** The owner asked it with D2: *"why do we still have an O365
  workflow? Perhaps we need to delete that file."* The Status entry of 2026-11-20, later, has the
  facts. Advice: **yes, in a pull request of its own.** It has never run a test in four runs. Its
  secrets were never set. Every alpha since alpha.4 shipped without it. Kept and wired, it would
  put a real SMB's credentials on the self-hosted runner, which holds live during the alpha
  (`security-scan.yml`'s header), for a dry run the owner can make by hand.
  - **What that pull request changes.**
    - It deletes `.github/workflows/e2e-o365.yml`.
    - It keeps the harness: `test/e2e/o365-scenario.ts`, its `.e2e.test.ts` and its unit test, so
      that the owner, who holds the tenant's credentials, can still run it by hand with Docker as
      `docs/testing.md` describes. `docs/test-tenant.md` says so, in place of the seven CI secrets.
    - The guards that name the file change with it:
      - `scripts/connector-coverage.unit.test.ts` reads it among the E2E workflows; its Graph rows
        stay *owed*, with the reason updated.
      - `scripts/a-token-the-job-never-asked-for.unit.test.ts` and
        `scripts/a-gate-on-a-version-nothing-ships.unit.test.ts` list its job.
      - `scripts/a-machine-called-by-its-product-name.unit.test.ts` uses its name in a fixture and
        in its header's history.
      - `.github/workflows/ci.yml`'s header names it.
    - The docs change too: `docs/testing.md`, `docs/test-tenant.md`, and the architecture's §22,
      whose pyramid names an end-to-end run against the real SMB O365 source (no ADR carries the
      lane). 0141 T13 (a) closes as withdrawn, not owed. `docs/LESSONS.md` is regenerated.
    - In Settings, the owner deletes any `O365_*` repository secret. None is set, by the run of
      2026-11-02 and 0141's Status.
  - **What it costs.** The Microsoft 365 source then has no lane against a real tenant in CI; it
    never had one that ran. Its unit and contract tests stay. A live-account proof in 0141's Live
    proofs table stays the way to prove it on a real account.
  - **The alternative.** Keep the lane: set its seven secrets in an `e2e-o365` environment
    limited to `main`, with the owner as a required reviewer, and run it once, so that 0141 T13 (a)
    closes. That keeps a real SMB's credentials in CI for a dry run.
  - **Answer, 2026-11-20: yes.** Built as #1980, a draft. The guard that held the workflow's
    variables to the suite now holds `docs/test-tenant.md`'s table to it, both ways.
- **D8. The next GoAccess bump fails the gitleaks job: rename the build argument, or allow that one
  line?** `deploy/compose/goaccess/Dockerfile` pins upstream's source as
  `ARG GOACCESS_COMMIT=<40 hex characters>`, and `generic-api-key` matches it: the name holds
  `access` and the value is long and varied enough. As D4 has it, the line is read like any new
  hit when a pull request rewrites it, and a bump does. The commit that rewrites it stays in that
  pull request's history, so a later commit in the same pull request cannot clear it. Advice:
  **rename the argument before that bump**, to a name holding none of gitleaks' keywords (for
  example `UPSTREAM_COMMIT`), in a pull request of its own, with
  `a-service-that-phones-home`'s check of that line renamed with it. The allowlist stays as D4
  has it. The alternative: a second allowlist entry for that one file and that one line's shape
  (`^ARG GOACCESS_COMMIT=[0-9a-f]{40}$`), which widens D4. **Answer, 2026-11-21: rename the
  argument.** Built as #1998, a draft: the argument is `UPSTREAM_COMMIT`, with a comment saying
  why, and the image is built from the same commit.
