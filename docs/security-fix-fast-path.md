# A security fix that must go out today

Several deliberate waits stand between a published fix and live. Each one has a reason, and the
owner can waive each of them. This page puts the four switches and the fast path on one page.
The typical case is a security fix in an npm package, or in a container image (Nextcloud's,
which carries PHP, for example).

Rules for the whole page:

- **A waiver is never silent.** Each switch below says where the owner's words are written down.
  Quote the words exactly, with the day.
- **Waive only what is in the way.** A fix older than three days needs no waiver for its age.
- **The owner gives the waivers.** An agent may ask for one, but never assumes it, and never
  dispatches anything in the owner's name.

## The four switches

### 1. npm packages: pnpm's minimum release age

- **What waits.** `minimumReleaseAge: 4320` (three days, **in minutes**) in
  [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) (line 309). The comment above it (lines
  265–308) explains why. pnpm 11 checks the whole lockfile on every install, so a version that
  is too new fails every CI job and every image build (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`).
- **Why a fix cannot wait.** The advisory gate, `scripts/audit-advisories.mjs`, run as
  `--fail-at=high` (`.github/workflows/security-scan.yml`, line 245), blocks a merge at high and
  critical. That gate reads the whole tree, not the diff, so one new advisory turns every pull
  request red until the fix is installed.
- **The waiver.** Add one `name@version` entry to `minimumReleaseAgeExclude`
  (`pnpm-workspace.yaml`, line 310 onward), **in the same pull request** as the fix, with a
  one-line reason above it. The `body-parser@2.4.0` entry is the model to copy. If the fix is a
  transitive package, the override that lifts it goes in `overrides:` in the same file, with a
  dated comment naming the advisory.
- **Never a bare name.** pnpm treats `name` with no version as "exempt every version, forever".
  [`scripts/a-gate-that-was-never-switched-on.unit.test.ts`](../scripts/a-gate-that-was-never-switched-on.unit.test.ts)
  refuses a bare name (line 107). It also refuses an entry for a version the lockfile does not
  install (line 119), so the entry expires once the tree moves on. Delete it then.
- **The owner says:** *"Take `<name>@<version>` inside its three-day cooldown: it fixes
  `<advisory>`."*
- **Recorded in:** the exclude entry and its comment line, the override's comment if there is
  one, and the CHANGELOG entry under `[Unreleased]`.
  [CONTRIBUTING.md](../CONTRIBUTING.md) (*If CI fails on `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`*)
  says the same for contributors.

### 2. Container images and other pins: the three-day floor

- **What waits.** The same three days, applied to every image, binary and tool pin
  (CONTRIBUTING.md, line 52; [workplan 0119](./workplans/0119-what-runs-and-what-moves-it.md)).
  No install-time check enforces it. It is policy, held by review.
- **What moves.** Pins are by digest, for example `nextcloud:35.0.3-apache@sha256:…` in
  `deploy/compose/managed.yml`. Every copy of a pin moves together. The pin watch
  (`scripts/idp-pin-watch.mjs`, weekly) keeps one issue open that lists what is behind. Read the
  new digest from the registry yourself, and never copy it from the issue alone.
- **The security-fix exception.** If the move clears a finding that the image scan reads on the
  current pin, it is taken under the floor's exception for a security fix. Name the finding and
  the scan run. MinIO on 2026-10-31 is the model: 0119's Status entry of that day, *Why the
  exception*. A move that only keeps a pin current is not the exception. It needs the owner's
  waiver.
- **The owner says:** *"I waive the three-day floor for `<image>` `<version>`: it fixes
  `<advisory>`."* A recent example of the same form: *"Pull pnpm, zizmor and squawk earlier. I
  waive unneeded days/waiting."* (2026-11-23). It is quoted in 0119's Status, lines 7–10, 53–55 and
  67–69, and in CHANGELOG.md's `[Unreleased]` entries for pnpm 11.29.0, squawk 2.74.0 and zizmor
  1.33.1.
- **Recorded in:** a dated Status entry in workplan 0119 that quotes the owner and says "inside
  its three-day floor", the comment beside the pin (where the pin has one), and the CHANGELOG
  entry. Then regenerate the index: `node scripts/workplan-index.mjs --write`.

### 3. Dependabot's cooldown

- **What waits.** `cooldown: default-days: 3` on every entry in
  [`.github/dependabot.yml`](../.github/dependabot.yml) (lines 37–38, 71–72, 107–108 and the
  docker entries after them). zizmor is held to the same three days by `.github/zizmor.yml`.
- **It only delays Dependabot's own version-update pull requests.** It does not apply to
  Dependabot's security updates (the comments at lines 4–8 and 27–32), and it does not hold a pull
  request made by hand. A transitive fix that the lockfile cannot lift was never Dependabot's
  to make anyway: it takes an override (switch 1).
- **The owner says:** nothing. There is nothing to waive. Make the pull request by hand, and do
  not change the cooldown.
- **Recorded in:** nothing extra. The hand-made pull request carries the records of switch 1 or 2.

### 4. Release nights

- **What waits.** A tag needs two counted scheduled nights of E2E (managed) on the commit, plus
  the appliance nightly runs of those nights (`scripts/release-nights.mjs`, header lines 9–23;
  [release.md](./release.md) §1, *The nights*).
- **The waiver.** It is per version, in `WAIVER_VERSIONS` (`scripts/release-nights.mjs`,
  line 215), with the owner's words on the line above the version. Use **one release per pull
  request**: the version, plus its guards (`a-release-preflight-that-said-yes-too-soon` and
  `a-tag-that-already-pointed-elsewhere` each name the list and the next refused version) and
  the list in [release.md](./release.md) §2, *When the owner waives the nights*. #2118 (alpha.19)
  is the form to copy. Only a pre-release can be waived.
- **At the tag.** The owner dispatches Release from their own account, with `commit` set to C
  and `waive_nights` set to the reason in their own words. A bot actor is refused.
- **The owner says:** *"I waive the nights for `v0.2.0-alpha.<N>`."* If the words could mean
  more than one release, ask which version they cover, and quote the answer too, as #2118 did.
- **Recorded in:** the comment above the version in `WAIVER_VERSIONS`, a dated Status entry in
  workplan 0146, and the tag's message: `Nights waived by <actor>, in their words: "<the reason>"`.
  The deploy log cites that line as the acceptance (release.md §5).
- **What it does not waive.** Everything else in Release refuses as before: CI on C, Security
  Scan, the fold, the gate scan, the approval (release.md §2, *What it does not waive*).

## The fast path, in order

1. **The pull request.** The fix and its records go in **one** pull request:
   - the exclude entry or the floor entry;
   - the override or the moved pin (every copy of it);
   - the 0119 Status entry, if it is a pin;
   - the CHANGELOG entry under `[Unreleased]`.

   If the nights will need a waiver, open that pull request now too, in parallel (switch 4).
2. **CI.** Wait for the pull request's own checks to go green: `ci-complete`, Security Scan's
   advisory gate (now green, because the fix is installable) and `Trivy`. Do not re-run the
   checks to get past a red one. Read the failure.
3. **E2E, by kind of fix.** E2E never runs on a pull request by itself: it runs nightly or on
   dispatch, on the shared machine, one run at a time ([testing.md](./testing.md), *CI mapping*).
   - **The managed stack only** (an image in `managed.yml`, such as Nextcloud, Zitadel or
     MinIO, or code only `apps/api`, `apps/worker` or `packages/managed` load): run **E2E
     (managed)** on the branch before the merge. Its head must have `main` merged in, and only
     one draft may use the OTA stack at a time (workplan 0146, T11 (a); Status, 2026-11-11).
   - **The appliance** (`deploy/selfhost`, `apps/selfhost`, or its Postgres build): run **E2E
     (self-hosted)** with `persistence` set to `postgres` **and** to `pglite`
     (`.github/workflows/e2e.yml`, the `persistence` input at line 99). The appliance ships on
     both backends ([testing.md](./testing.md), line 40).
   - **A runtime npm package that both editions load** (most of `packages/`): run all three
     lanes.
   - **A tool CI alone runs** (zizmor, squawk, Atlas): no E2E. Nothing deployed changes
     (0119, Status of 2026-11-23).

   The owner or the maintainer dispatches these, never an agent on its own.
4. **Merge.** Then the release, exactly as [release.md](./release.md) §1 and §2 describe it:
   - **The fold.** It merges last, and its squash is C. The freeze starts there.
   - **The version bump.**
   - **The Windows payload run on C.**
   - **Under waived nights,** E2E (managed) plus E2E (self-hosted) on Postgres and on PGlite,
     dispatched on `main` at C, one at a time (workplan 0146, Status, the alpha.18 fold of 2026-11-23).
   - **Release.** The owner dispatches it, `mode=preflight` first and then `mode=release` with
     `commit` and `waive_nights`, and approves it in the `release` environment.
5. **After the tag.** Dispatch Security Scan's image scan on `main` at C (release.md §4).
6. **The live deploy.** Run `deploy/compose/deploy-live.sh <tag>` from live's checkout:
   - put the hold on, finish the drain, and run `--dry-run` first;
   - cite the tag's `Nights waived by …` line in the deploy log.

   The steps are in [release.md](./release.md) §5 and
   [managed-bring-up.md](./managed-bring-up.md#ownpace-live-a-release-tag-with-deploy-livesh).

## See also

- [`release.md`](./release.md): cutting a release, and the nights.
- [`incident-runbook.md`](./incident-runbook.md): when something is wrong on live.
- [`pnpm-workspace.yaml`](../pnpm-workspace.yaml): the cooldown, and why its unit is minutes.
- Workplan 0119: what runs, what moves it, and every floor taken early.
