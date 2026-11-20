# Workplan 0163 — Checks before the merge

> **In one line:** Which scanners and checks CI should add so that what an outside, read-only check finds is caught before a merge: what runs today, what each finding is, and in what order to add Semgrep, osv-scanner, zizmor's secrets audit, gitleaks and the rest, each failing the build or only reporting.

## Status — 2026-11-20 (update this block at the end of every session)

**2026-11-20: proposed.** An evaluation, not a build. Nothing in `.github/` changes on this plan's
branch. Each recommendation below is the owner's to accept, change or refuse (§6). The candidate
tools were run once, report only, on a separate branch that is never merged and has no pull request
(`claude/ownpace-public-readiness-y7orc6-ci-scan-measure`, run 44823064781, on `main` at
`bf9ede7`). §4 has what each one found.

The outside check read `main` around `b4d11ee7` on 2026-11-19 and 2026-11-20. Its findings are
transcribed from a screenshot, so a count here is the screenshot's count. Two of them belong to
other work and are only listed here: GEN-21 (the Docker socket proxy runs as root) and GEN-26
(three `setup-node` steps that zizmor 1.30.1 flags, and zizmor in CI).

| Task | Owner | Status | Notes |
|---|---|---|---|
| T0 The decisions | owner | 📋 **Proposed** | §6: D1 to D6, each with advice. |
| T1 Secrets into environments | builder | 📋 **Proposed** | Finding 1. Three GitHub environments, nine secrets moved, `environment:` on three jobs. Then zizmor's `secrets-outside-env`, report only (§5, step 2). |
| T2 osv-scanner | builder | 📋 **Proposed** | Finding 3 and "no malicious packages". Fail the build on a malicious package; report the rest (§5, step 1). |
| T3 Semgrep, report only | builder | 📋 **Proposed** | Findings 5 to 9. A short list of named rules, not whole packs (§5, step 3). |
| T4 Fix or answer each Semgrep spot | builder | 📋 **Proposed** | §4.3. Each spot is fixed or recorded as not reachable, one pull request per class. |
| T5 Semgrep fails the build, rule by rule | builder | 📋 **Proposed** | A rule moves to blocking once it reports nothing on `main` (§5, step 5). |
| T6 gitleaks on a pull request's own commits | builder | 📋 **Proposed** | Report only first; D4 decides on the allowlist (§5, step 4). |
| T7 Image findings: keep, do not add | — | 📋 **Proposed** | Findings 2, 11 and 12 are covered today, report only. §3 says why nothing is added. |
| T8 Not worth a check | — | 📋 **Proposed** | Findings 4 and 10, and Trivy's misconfiguration scan: §3 and §5 say why. |

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
| 4 | Overview of routes and who may use them (2) | **Partly covered:** `apps/api` holds guards over its doors (`openapi-spec`, `a-hold-that-holds-every-door`, `an-organisation-closed-at-every-door`, `a-route-that-opened-the-owners-pool` and others). | The check uses its own rules, and the screenshot does not name the two spots, so this plan cannot say which routes they are. The owner reads them from the check's detail (D6). |
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
| — | GEN-21, the socket proxy as root | Handled in another session. | Listed only. |
| — | GEN-26, three `setup-node` steps zizmor flags; zizmor in CI | Handled in another session. | Listed only. |

## 4. What the candidates found on this tree

Measure run 44823064781, on `main` at `bf9ede7` with one added workflow, on `ubuntu-24.04`. Every
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

Pending: the measure run's Semgrep job had not finished when this was written.

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
| 1 | osv-scanner over `pnpm-lock.yaml`, in the Security Scan's repository job | 3; malicious packages | **Fail the build** on a malicious-package record (`MAL-…`). **Report only** for vulnerabilities, because pnpm audit stays the vulnerability gate with the owner's `--fail-at=high` | osv-scanner 2.6.0 (the outside check's version), `osv-scanner_linux_amd64` and `_arm64` from its GitHub release, sha256 per architecture (amd64 `ca69b3d3…`) | pull request, push to `main`, tag, Monday (the job's triggers) | under 10 s (2 s measured, plus the download) | 1 known moderate, listed and passing; 0 malicious | a pin-watch row against osv-scanner's GitHub releases; the guard family that holds Trivy's sha256 form |
| 2 | Finding 1 fixed (T1), then zizmor's `secrets-outside-env` | 1 | **Report only** | zizmor as GEN-26 pins it (1.30.1). A second invocation with `--persona auditor`, reading only this audit's results; the auditor persona's other findings are not proposed | as GEN-26's zizmor job | seconds | 0 once T1 is done; 9 before | GEN-26's pin-watch row |
| 3 | Semgrep with a short list of named rules (§4.3), not whole packs | 5–9 | **Report only**, to the job summary and code scanning (SARIF) | `semgrep/semgrep:1.178.0@sha256:32e45996…` (the outside check's version). The rules are a file in the repository that names the chosen rule ids, fetched from the registry by id, or written in the repository where a rule is short | pull request, push to `main` | pending (§4.3) | §4.3 | a pin-watch row against Docker Hub's tags of the same shape, as hadolint's; the guard that holds the whole reference (as `HADOLINT`) |
| 4 | gitleaks over a pull request's own commits (`base..head`) | the "no secrets" pass, kept passing | **Report only** until D4 is answered; then fail the build | gitleaks 8.30.1 (the outside check's version), `gitleaks_8.30.1_linux_x64.tar.gz` and `_arm64` from its GitHub release, sha256 (x64 `551f6fc8…`) | pull request | under 15 s | today's 67 do not appear unless a pull request touches those lines | a pin-watch row against gitleaks' releases |
| 5 | Semgrep moves to failing the build, one rule at a time | 5–9 | **Fail the build**, per rule, once that rule reports nothing on `main` | as step 3 | as step 3 | as step 3 | 0 by construction | as step 3 |

**Not worth adding:**
- **Trivy's misconfiguration scan.** §4.4: it repeats hadolint and a guard, and its one CRITICAL
  is a false positive.
- **A second SBOM tool (syft).** The two lists answer different questions (installed against
  resolvable). A check that compares them would fail on platform packages forever. If the owner
  wants the release SBOM to list every resolvable package, that is a change to how `bom.json` is
  made, not a new check (D5).
- **A route-inventory tool** for finding 4: the repository's own door guards are the right place.
  Once the two spots are known, each one becomes a guard case or an answer (D6).
- **Anything more for findings 2, 11 and 12.** They are covered, report only, by owner decisions
  already in force.
- **CodeQL**, unless D3 says so. Its JavaScript queries overlap the Semgrep classes above. Semgrep
  is proposed instead because its version can match the outside check's, so the two agree.

**What has to be fixed first.** Only Semgrep's spots stand between a rule and failing the build
(T4, §4.3). Finding 1 is fixed by moving secrets (T1), which is a repository-settings change plus
three `environment:` lines. osv-scanner's one finding is accepted and is not a malicious-package
record, so step 1 can fail the build at once. gitleaks blocks only on what a pull request adds,
so nothing in the tree has to change first. Only D4's allowlist question has to be answered.

## 6. Decisions for the owner

- **D1. osv-scanner fails the build on a malicious package, and only reports vulnerabilities?**
  Advice: yes. pnpm audit stays the vulnerability gate, so the two never disagree about what
  blocks, and OSV's malicious-package records are something nothing here reads today.
- **D2. Move the nine secrets into three GitHub environments (`e2e-o365`, `e2e-managed`,
  `exposure-probe`)?** Advice: yes, starting with `e2e-o365`, whose seven secrets reach the real
  tenant. An environment can be limited to `main` (deployment branch rule), so a workflow changed on
  a branch cannot read them. This is a settings change the owner makes; the pull request only adds
  `environment:`. Then report `secrets-outside-env` only (it stays report only because zizmor marks
  it as needing judgement).
- **D3. Semgrep with a named list of rules, report only first?** Advice: yes, and not whole packs:
  §4.3 shows how much more the packs report than the five classes the outside check counts. Before
  rules from the Semgrep Registry are vendored into this public repository, the owner reads the
  Semgrep Rules License v1.0. The registry repository's licence file points to it, and this plan
  could not read the page from where it was written. Fetching a rule by id at run time keeps no
  copy here; writing a short rule in the repository's own words avoids the question entirely.
  CodeQL: not now.
- **D4. gitleaks on a pull request's own commits: what may be allowlisted?** Advice: allowlist by
  path pattern for test files only (`*.unit.test.ts`, `*.integration.test.ts`) and for the one
  documentation placeholder file. Never use inline `gitleaks:allow` comments. Then fail the build.
  The alternative, no allowlist, keeps gitleaks report only for good.
- **D5. Should the release SBOM list what is installed (as today) or everything the lockfile
  resolves?** Advice: keep today's. It describes what ships, and a release that lists platform
  binaries it never contains would be the less accurate document.
- **D6. Finding 4's two routes.** Advice: read them from the outside check's detail and bring them
  to a session. Each one either gets a case in the existing door guards or is recorded as intended.
