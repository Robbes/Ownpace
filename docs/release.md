# Cutting a release

A release is cut by the **Release workflow** (`.github/workflows/release.yml`),
dispatched from `main` in the Actions tab. It reads the record, waits for the
owner's approval, scans the exact commit, cuts the annotated tag itself, and
then publishes in an order that holds: Security Scan on the tag first (the
release, its body and `bom.json`), and the images and the Windows zip only once
that scan is green. A tag pushed by hand still works exactly as before, and is
the break-glass path (§2), with the gap it always had.

Why it exists: `v0.2.0-alpha.1` was pushed by hand on 2026-10-06, and the four
workflows a tag fires ran side by side. Its Security Scan (run 37523297841)
failed at the advisory gate, so the release has no generated body and no
`bom.json`, while the images were already pushed and signed and the zip was
attached to a release `windows-payload.yml` had made (workplan 0146, Status of
2026-10-23).

The **root `package.json` is the version source** (workspace packages
stay `0.0.0` deliberately — they are never published individually). The
`/version` endpoints and the Windows build stamp both read it.
`apps/api/docs/openapi.yaml`'s `info.version` is a copy, held to it by
`scripts/a-release-that-names-itself.unit.test.ts`, so the bump below names
both.

## 1. Before the tag

**Release checks these** (its `preflight` job, `scripts/release-preflight.mjs`;
one line per check, `pass` or `refuse`, every reason at once):

- The inputs, and that it was dispatched from `main`.
- The commit C is on `main`'s first-parent line. Left empty, C is the commit
  the counted nights ran (below). Under the owner's waiver of the nights it is
  given, never empty (§2, *When the owner waives the nights*).
- The tag is free, or is an annotated tag Release itself made at C (a re-run);
  no branch is named like it.
- The names agree: the candidate's own `scripts/release-names-agree.mjs`, and
  `openapi.yaml`'s `info.version`.
- **The changelog is folded:** `[Unreleased]` holds no entries, and the
  version's section is dated no more than seven days before the run and no
  later than the day after.
- **`main` is green for C:** C's own push run of CI on `main` ran and passed
  `lint`, `unit-tests (all)`, `ui-tests`, `integration-tests (self-hosted)` and
  `ci-complete`, none skipped (a docs-only merge skips the suite and still
  reports success), and C's push run of Security Scan is green.
- **The nights**, as [workplan 0141](./workplans/0141-proof-before-strangers.md)
  T14 defines them (`scripts/release-nights.mjs`): the newest two completed
  scheduled runs of E2E (managed) both ran C and are green on every attempt, no
  night is missing, and the four scheduled E2E (self-hosted) runs of those
  nights ran C and are green on every attempt. Unless the owner waives them
  (§2, *When the owner waives the nights*): their refusals are then notes.
- **Upgrade gates against the PREVIOUS release**, read rather than eyeballed
  (`scripts/release-upgrade-gates.mjs`): each chain's upgrade test runs with
  `UPGRADE_FROM_REF` set to the release before (without it each starts from
  its own default, which is not the previous release), and every case must
  have run and passed; a skip is a hole, not a pass. A chain whose test does
  not exist at C is "not exercised", and the preflight refuses. The line for
  each chain gives its migration count at the release before and at C.
  `two-chains.unit.test.ts` is not an upgrade proof and is not counted: it
  adopts a database that predates the managed chain. By hand, after
  `git fetch origin tag <previous-tag>`:
  - **the shared chain's gate:**
    `UPGRADE_FROM_REF=<previous-tag> pnpm vitest run --project unit packages/ledger/src/migrate-upgrade.unit.test.ts`,
    and confirm the six `skipIf(!HAVE_REF)` tests **executed**, including the
    downgrade refusal;
  - **the managed chain's upgrade proof:** the same with
    `packages/managed/src/migrate-upgrade.unit.test.ts`, and confirm the seven
    `skipIf(!HAVE_REF)` tests **executed**. It applies both chains as the
    previous release did, with that release's own migrators, then this
    build's, and compares the result with a fresh install. A release before
    the managed chain (rc.1) is refused by name.
- The workflows Release dispatches, as C has them, take the inputs it passes.
- And it says, without refusing: whether the `release` environment asks a
  reviewer, the open critical and high code-scanning alerts on `main` (the
  pull request's `Trivy` check blocks new ones, and the advisory gate is what
  refuses), the commits on `main` after C, what the release before is
  missing, and what it does not check. The alerts are read whole, every page,
  and printed as a total and then one `note code-scanning` line per tool and
  category: the repository's filesystem scan, and each image of the weekly
  image scan (`trivy-image-<name>`, which names the image), with the
  category's counts and its five most alerted rule ids, critical first. That
  is where to start a triage before the fold.

**You do these:**

- [ ] **The fold**: rename `[Unreleased]` to the version and the date (the day
      the pull request merges, in your own time zone), and start a fresh empty
      `[Unreleased]` above it. The release body links to this section: it is
      the release's prose. It is a pull request like any other, and it merges
      **last**: it is C, its own push run is the CI that counts, and **the
      freeze** starts with it (0141 T14 says what the freeze is). Merge it
      before 23:30 UTC, so the appliance nightly's runs that night are on C.
- [ ] The version bump, if it is not done yet: `version` in the root
      `package.json` and `info.version` in `apps/api/docs/openapi.yaml`.
- [ ] `scripts/upgrade-drill.sh` on a Docker host (the Spark box): previous
      release image, real volumes, swap to HEAD in place, healthy after a
      further restart. The drill says when it is vacuous (tag == HEAD, or the
      chain has no new migration) — a vacuous pass does not count, and the
      drill compares the ledger chain only. Release lists it as not checked.
      **Not applicable for `v0.2.0-alpha.2`** (workplan 0146, 2026-10-23).
      The drill upgrades the appliance, which applies the shared chain only,
      and that chain is the same 65 files, byte for byte, in
      `v0.2.0-alpha.1` and on `main`: from alpha.1 the drill, and the shared
      chain's unit gate, would exercise no migration, and each says so. The
      alpha is managed-only, so no tester runs an appliance. What moved is the
      managed chain (46 files in alpha.1, 59 on `main`), and its proof is the
      managed chain's upgrade test above, which the preflight runs. If a
      shared migration lands before the tag, the drill applies again. What it
      alone would still show is an appliance opening a PGlite directory
      alpha.1's image wrote, across PGlite 0.5.8 to 0.5.10: the appliance's
      question, for the first release an appliance tester runs.
- [ ] **Before the first non-demo tenant beyond the alpha** (not per release,
      but check it here because this list is what gets read): CI and the live
      managed stack are not on the same machine — see the operator runbook,
      "This box also runs CI". The alpha is the one exception, by the owner's
      decision of 2026-09-24: `ownpace-live` runs on the reference machine
      beside the OTA stack and CI, under
      [workplan 0132](./workplans/0132-the-alpha-and-the-nightly-gate-on-one-box.md)'s
      conditions (names per project on one Docker daemon; the gate refuses
      live's `.env`; live moves only by hand, from a tag). Demo data and a
      hand-picked alpha make it tolerable; a customer's mailbox credentials do
      not.
- [ ] Managed stack smoke if the release touches it:
      `deploy/compose/smoke-managed.sh` (includes the web `/api` proxy
      assertion); the nightly runs it every night.

## 2. The tag: dispatch Release

1. **Any day:** Actions → Release → Run workflow, `version` set
   (`v0.2.0-alpha.2`), `mode=preflight`. It writes nothing. Its summary lists
   every refusal.
2. **After the fold and two green nights on it:** the same, `mode=release`,
   `commit` empty. The preflight runs again, and the run waits at the
   **approve** job until you approve it in the `release` environment. That
   click is the say-so workplan 0025 T2 asks for, recorded with your name and
   the time. It is a record and a guard against accidents, not a boundary:
   anyone with write access can still push a tag by hand.
3. After the approval it runs, in this order:
   - **gate scan:** a branch `release-gate/<tag>` at exactly C, Security Scan
     dispatched on it (`image_scans: false`) and waited for, the branch
     deleted. Advisories are read live, so this scan, minutes before the tag,
     is the one that counts. The branch is made only when C is on `main`
     (a dispatch on it runs C's own workflow file, with a write token), and
     the gate passes only when every image job of that run was skipped.
   - **tag:** peels the tag first: when it is already Release's at C (a
     re-run), it carries on and reads nothing else. Otherwise it reads the
     nights again (the approval may have waited days), checks C is still on
     `main`, peels the tag again, and makes the annotated tag with the
     workflow's own token (`POST git/tags`, `POST git/refs`). Its message names
     the Release run and every run that proved it: cite it in the deploy log.
     A tag counts as Release's only when that run is a release-mode dispatch
     of `release.yml` on `main` and its `tag` job ran: a message can be typed
     by hand. A tag is never moved.
   - **publish:** Security Scan on the tag, then `images.yml` and
     `windows-payload.yml` (`platform=win-x64`) on the tag, each dispatched
     and waited for. Before each, the tag must still be Release's at C and no
     branch may share its name: a dispatch names the tag by its short name,
     which a branch of that name would answer to.
   - **verify** (§3).

A tag made with the workflow's own token starts no `push` workflow, which is
why Release dispatches each publisher on the tag itself: each sees
`github.ref` = `refs/tags/<tag>` and `github.sha` = C, exactly as on a pushed
tag, so their tag conditions and the names check hold as they are.

**When something fails.** Re-run the run's failed jobs, or dispatch
`mode=release` again: the tag is reused when it is Release's at C; a
publisher run that already passed on the tag is reused, one still running is
waited for, and a failed one has its failed jobs re-run, once, never a fresh
dispatch (that would rebuild and re-push every image). A dispatch is never
sent twice: after an error it looks for the run, and when it finds none it
stops and says so. Re-running the failed jobs is the way back when the tag
job failed after it made the tag: the tag job then finds its own tag and
carries on without reading the nights, while a fresh dispatch refuses that
tag (its run's tag job did not succeed). A fresh dispatch days later is
refused at the preflight if newer nights ran another commit; use
`mode=verify` then, and dispatch a single publisher on the tag by hand from
the Actions tab if one is missing. A run you cancel stops: only the gate
branch and the rehearsal tag are cleaned up after it.

**The other modes:** `rehearse` is the preflight plus the gate scan, and no
tag; while the nights pick no commit it needs `commit` set to a commit on
`main`'s first-parent line (`main`'s head, for instance). A commit that is not
on that line ends the run red at the preflight, before any gate branch is
made: the record's refusals are carried to the end of the run, the ones that
say which commit it is are not. It ends red with the preflight's count when
the real run would have stopped there, and its gate scan shows the three
image jobs skipped. `rehearse-tag` makes a throwaway annotated tag
`rehearsal-<run number>` at `main`'s head, dispatches Security Scan on it,
expects the names check to refuse it ("not a release name") before anything
installs and with no release made, and deletes it. `verify` checks what an
existing tag published (§3).

**The names check, by hand.** `git fetch origin --tags`, then
`node scripts/release-names-agree.mjs v<X.Y.Z>`: it refuses a tag that is not
`v` plus the root version, a version with no `## [<X.Y.Z>] - <YYYY-MM-DD>`
section in `CHANGELOG.md`, and a tag SemVer orders at or below a release
already tagged. `images.yml`, `security-scan.yml` and `windows-payload.yml` run
the same check as their first step after the checkout, so a tag whose names
disagree publishes nothing (workplan 0146 T2). Run it with the commit you are
about to tag checked out: it reads `package.json` and `CHANGELOG.md` from the
working tree. Once a newer release is tagged, a re-run or a dispatch of an
older tag's workflows is refused by the same rule, because that tag now sorts
below one that exists. Cut a new tag instead of re-running an old one.

### When the owner waives the nights

The owner's call, and only for a release no tester runs yet. The first was
alpha.3, on 2026-10-30: *"I approve alpha.3 tag now, we skip the waiting days.
No one is in the alpha yet."* (workplan 0146, Status of 2026-10-30). It
replaces the tag pushed by hand for that case, so the order above holds.

**Which versions.** Only those in `WAIVER_VERSIONS` in
`scripts/release-nights.mjs`, each there with the owner's words and the day:
today `v0.2.0-alpha.3` alone. A waiver for any other version is refused. The
next one is a pull request that adds its version there, quoting the owner,
merged before the dispatch; the guard holds that each is a pre-release.

Dispatch Release **from your own account** with `waive_nights` set to the
reason, in your own words, and `commit` set to the full commit to tag: the
fold's squash on `main`. Whoever dispatches is the one the tag names, so a run
whose actor is an app's bot (`…[bot]`) is refused, and an agent does not
dispatch a waiver in your name. There are no nights to pick a commit, so a
waiver with `commit` empty is refused. Run `mode=preflight` first, then
`mode=release`.

**What it does.** In `preflight`, `rehearse` and `release` mode the nights are
read as always. If they do not hold, their refusals become notes, the first of
them quoting your words and naming the run's actor; the preflight's summary
says so under its title, the tag job's summary lists it, and the tag's message
has a line of its own after *Proved by*, your words as a JSON string (a `"` in
them comes out as `\"`):

```text
Nights waived by <actor>, in their words: "<the reason>"
```

If the nights hold, the waiver is not used: the preflight's summary says so,
and the tag's message names the nights as it always does. **The tag job is
bound by what the preflight did** (its output `waived`): when the nights held
there, the tag job reads them again as in a run without a waiver, and if they
stopped holding between the preflight and the tag, it refuses and writes
nothing. Dispatch again; that preflight then uses the waiver, and says so. A run
that refused before it read the nights (a waiver with `commit` empty, for one)
says the nights were not read, never that they were waived.

**What it does not waive.** Everything else refuses as it does without it: C
on `main`'s first-parent line, the tag free, the names and `openapi.yaml`'s
version, the changelog folded and dated, C's own push run of CI with the whole
suite run and Security Scan's push run green, the callees, the upgrade gates,
the gate scan minutes before the tag, and the approval in the `release`
environment.

**The text.** It is written into a public tag and two job summaries, so it is
one line of at most 300 characters, with a letter or a digit, and no backtick,
`<`, `$(`, `${`, `@`, control character or character that shows nothing (a
private-use or unassigned one, a lone surrogate, a Hangul filler, the braille
blank). The preflight refuses anything else, says why, and does not repeat it.
It reaches the scripts only as an environment variable, like every input.
`verify` and `rehearse-tag` read no nights and refuse a waiver.

**A record, not a boundary.** Like the approval: anyone who can dispatch can
type it, and in release mode the run still waits for your click. Nor is the
preflight a boundary against C's own code: C's names check and install run in
the preflight job before its check and its verdict, and can rewrite their
environment, the lines file and the summary. What counts is the tag job's own
read of the input, in a job of its own, with the version and actor checks
above. The release page's body is Security Scan's and does not carry the
waiver: when you write the release's prose (§4), say it there too.

### Break-glass: a tag pushed by hand

When Release cannot run (GitHub refuses the workflow's token, for instance;
fewer nights is the waiver above, not this), the tag is pushed by hand, from
the commit the names check passed on:

```bash
git tag -a v<X.Y.Z> -m "Ownpace v<X.Y.Z>"
git push origin v<X.Y.Z>
```

Its gap is the one alpha.1 fell into: the four workflows run side by side,
nothing waits for the scan, a red scan leaves the release without its body and
`bom.json` while the images and the zip ship, and CI runs beside them without
holding anything back. Write the acceptance in the deploy log, and run
Release with `mode=verify` on the tag afterwards.

A hyphenated version (`v0.2.0-rc.1`) is a SemVer pre-release: the GitHub
release is marked prerelease and **`latest` image tags are withheld**
(metadata-action `latest=auto`). The first non-hyphenated tag is the first
time the `latest` channel exists — check it appeared.

## 3. What a tag publishes (verify checks each)

| Workflow | Produces | What `verify` checks |
|---|---|---|
| `security-scan.yml` | the GitHub release, first under Release, with its generated body (pull lines, verify one-liner, changelog link) and `bom.json` (CycloneDX SBOM) | published, the pre-release flag right, exactly one generated block, the changelog link, `bom.json` attached, CycloneDX, naming the version |
| `images.yml` | `ownpace-{api,web,selfhost}:<X.Y.Z>` multi-arch on GHCR, cosign-signed by digest | linux/amd64 and linux/arm64, the revision label C, `sha-<C>` the same index, `latest` withheld from a pre-release, and `cosign verify` by digest with the exact identity `https://github.com/Robbes/Ownpace/.github/workflows/images.yml@refs/tags/<tag>` and then the documented one: `cosign verify ghcr.io/robbes/ownpace-selfhost:<X.Y.Z> --certificate-identity-regexp '^https://github\.com/Robbes/(open-migrate|ownpace|Ownpace)/' --certificate-oidc-issuer https://token.actions.githubusercontent.com` |
| `windows-payload.yml` | `ownpace-appliance-win-x64-v<X.Y.Z>.zip` attached to the release (unsigned — SmartScreen prompt documented in the runbook) | attached, and its `SHA256SUMS.txt` holds for every file |

And `GET /version` on the selfhost image, started on PGlite: the version and C.

**CI.** A tag the Release workflow makes runs no CI: its token's events start
no push run, and Release dispatches only the three publishers. C's own push
run on `main` stands in for it, and the preflight refused C unless that run
ran the suite. A tag pushed by hand runs `ci.yml` beside the publishers; it
holds nothing back.

**Who creates the release.** Under Release, Security Scan on the tag, before
anything else ships. Under a hand-pushed tag, whichever of Security Scan and
`windows-payload.yml` attaches first: for alpha.1 it was
`windows-payload.yml`, with no body.

**The half-published state.** Security Scan attaches the body and `bom.json`
before its last step, which fails the run when Trivy or the SARIF upload
failed. So a scan on the tag can end red with the release page already made,
listing pull lines for images that are not published yet: Release stops there
and publishes nothing else. Read why the scan failed. When it was an outage,
re-run Release: it re-runs the scan's failed jobs, which appends the body a
second time, and says so; verify then refuses two generated blocks until you
delete one from the release body by hand. When it was an advisory, the way out
is a new version: the tag's lockfile will fail the same way every time.

**`mode=verify` on an existing tag.** `v0.2.0-alpha.1` refuses: its tag's
scan failed before the SBOM step, so it has no `bom.json`, and nothing
regenerates one (a re-run fails the same way on the tag's lockfile). Its
body is the standard text (what *Compose release body* in
`security-scan.yml` writes) without its last sentence, which says the
attached `bom.json` is the build's SBOM, and a note on that failed scan that
says `bom.json` is missing, pasted in by the owner by hand: a session does not
edit releases (the owner's answer of 2026-10-23). Leaving that sentence out
does not change what verify says about the body: it finds the block by its
`cosign verify` line and checks the changelog link. The owner pasted it on
2026-10-23; since then verify refuses only the missing `bom.json`.
`v0.1.0-rc.1` refuses: no generated body and no Windows zip.

## 4. After

- [ ] Edit prose into the release body if the generated pointers need
      context (the workflow appends, never overwrites, an existing body).
- [ ] Announce; the changelog section is the text.

`GET /version` on a pulled image is checked by Release's verify job.

## 5. Deploying a release to ownpace-live

`ownpace-live`, the stack testers use, runs release tags and nothing else
(workplan 0146 T5). The procedure is
[workplan 0132](./workplans/0132-the-alpha-and-the-nightly-gate-on-one-box.md)
T6, *one way to deploy live, from a tag*, and its script is
`deploy/compose/deploy-live.sh <tag>`, run from `~/ownpace-live` with the hold
on and the drain done. The steps, and what the script refuses and checks, are
in [managed-bring-up.md](./managed-bring-up.md#updating-a-running-deployment),
*`ownpace-live`: a release tag, with `deploy-live.sh`*.

- [ ] The tag is the one §2 made: annotated, on origin, and the root
      `package.json` at its commit says the tag without its `v`. The script
      refuses anything else: *"live runs releases: name a release tag"*.
- [ ] Its commit is one the nightly gate ran green, as workplan 0141 T14
      reads it. Release refused to tag otherwise, and the tag's message names
      the Release run and the runs that proved it: cite that in the deploy
      log. A tag cut under the owner's waiver says so in its message
      (*Nights waived by …*): cite that line as the acceptance. A tag pushed
      by hand carries no such proof, and the owner accepts fewer in writing in
      the deploy log.
- [ ] Its commit has `deploy/compose/exposure-check.sh` (on `main` since
      #1271), and live's `.env` has `EXPOSURE_ALLOW` naming every address,
      other than loopback, that a container on the machine is published on on
      purpose, and, when containers that are not Ownpace's publish beyond
      loopback, `EXPOSURE_NOT_OURS` naming them. A tag without the script
      cannot pass the exposure check, and neither can a machine with such an
      address or container the lists leave out, nor a tag whose script
      predates `EXPOSURE_NOT_OURS` (workplan 0132's Status of 2026-10-05) on a
      machine that needs it: the deploy does not take.
- [ ] With the hold on and the drain done, `deploy-live.sh --dry-run <tag>`
      said one-way or reversible, and moved nothing. If one-way, and you want
      a way back that is not forward, dump live's database then, before the
      deploy.
- [ ] The script said the deploy took: `/api/version` on live names the tag's
      commit and version, `/api/ready` answers 200, `/api/auth/mode` answers
      `managed`, and the exposure check passed.
      **The deploy from `v0.2.0-alpha.2` (or earlier) to `v0.2.0-alpha.3` (or
      later) runs twice** (workplan 0146 T13, the owner's decision of
      2026-10-26). The first run is alpha.2's script, the copy the checkout had
      before it moved, and it asks the api container with `printenv`, which
      the distroless API has not got. Live moves to the tag, and that run
      prints this, then that the copy before this update is kept and that
      the deploy is logged as `did-not-take`, and exits 3:

      ```text
      [deploy-live] the deploy did not take: v0.2.0-alpha.3 is checked out, and
          NODE_ENV: the api container could not be asked (docker compose exec -T api printenv NODE_ENV).
      [deploy-live] The hold stays on. Nothing was lifted. Fix the cause and run this again with v0.2.0-alpha.3, or name another tag; the next deploy is compared with v0.2.0-alpha.3 too.
      ```

      When that `NODE_ENV` line is the only one under it, run it again, the
      hold still on, naming the tag the first run named; the tag's own script
      reads `NODE_ENV` from Docker and says the deploy took
      ([managed-bring-up.md](./managed-bring-up.md#the-deploy-from-alpha2-to-alpha3-runs-twice)):

      ```bash
      git checkout -- apps/worker/package.json    # the task deploy strips its last newline; the second run refuses a tree that is not clean
      ./deploy/compose/deploy-live.sh <tag>       # the same tag the first run named: v0.2.0-alpha.3 for the alpha.2 to alpha.3 deploy
      ```

      For the alpha.2 to alpha.3 deploy, keep the copy before the update once
      the second run says it took, before a pass can prove the update: it is
      live's only quick way back from the Trigger.dev images built here
      (workplan 0146 T16). Delete it by hand with
      `./deploy/compose/copy-before-update.sh delete` once the task runner has
      run real work for a few days, and set the key back before the next deploy
      ([managed-bring-up.md](./managed-bring-up.md#the-deploy-from-alpha2-to-alpha3-runs-twice)):

      ```bash
      ./deploy/compose/env-upsert.sh deploy/compose/.env COPY_DELETE_WHEN_PROVEN=false
      ```
- [ ] Read whether it called the deploy one-way or reversible before lifting
      the hold, which you do yourself. During the alpha a bad deploy is fixed
      forward, with a fix and a new `alpha.N` tag; a reversible one can also be
      undone by deploying the previous tag with the same script.
- [ ] After you lifted the hold, `./deploy/compose/live-pass-check.sh` said
      `verdict: succeeded` (or a pass of your own completed), and about an
      hour after the lift the box checks mailed *Update proven* (or you ran
      `./deploy/compose/copy-before-update.sh delete`).

The OTA stack is not deployed this way: the nightly gate brings `main` up on it
every night. Nothing in the Release workflow touches live: it runs on
GitHub-hosted runners only.

## Settings the owner makes once

- **The `release` environment** (Settings → Environments), before the first
  `mode=release` run: you as required reviewer; "Prevent self-reviews" off
  (you dispatch and approve); deployment branches and tags: selected, `main`
  only; no wait timer. Until it exists, the approve job creates it unprotected
  and passes without a click; the preflight says which it is.

That is the only one. Two notes beside it:

- **Optional, and not now: a tag ruleset** (the owner's answer of
  2026-10-23). Release does not need one. It would be a ruleset on
  `refs/tags/v*` with *Restrict updates* and *Restrict deletions*, you as the
  bypass actor, so that a published tag, which `deploy-live.sh` trusts,
  cannot be moved or deleted. Without it, anyone with write access can move
  or delete a tag (Release never does), and `deploy-live.sh` still refuses a
  tag that is not annotated, not on origin, or not the version its
  `package.json` names (§5). If it is ever added: not
  *Restrict creations*, because the workflow's token cannot be a bypass
  actor, and it would refuse Release's own tag.
- **Immutable releases stay off.** Security Scan and `windows-payload.yml`
  attach to the release separately, after it is published; with immutability
  on, the second attach would fail.

## Known deferred (owner decisions, tracked in workplans)

- Code signing for the Windows payload — 0025 T6 / 0015 T4.
- MSI packaging — 0015 T3.
- SLSA build provenance — named gap, SAD §22.1.
