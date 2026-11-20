# Workplan 0163 — Checks before the merge

> **In one line:** Which scanners and checks CI should add so that what an outside, read-only check finds is caught before a merge: what runs today, what each finding is, and in what order to add Semgrep, osv-scanner, zizmor's secrets audit, gitleaks and the rest, each failing the build or only reporting.

## Status — 2026-11-20 (update this block at the end of every session)

**2026-11-20, latest: finding 7 is set aside, on the owner's word (T10, D6).** Docs only. Told
that no community rule reports finding 7 and that four candidates fit it, the owner answered:
*"Leave that Finding 7 / unfindable for now."* It is parked as T10, and §4.3 keeps the four
candidates for when it is taken up. D6 now asks the owner for finding 4's two spots alone; T4
covers findings 8 and 9 and the small fixes.

**2026-11-20, last: D7 answered and built as #1980; findings 8 and 9 found; 4 and 7 asked of the
owner (T9, T4, D6).** Docs only on this branch.
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
| T0 The decisions | owner | ✅ **Decided 2026-11-20** (D1 to D6, as advised); ⏳ **Owner** (D7) | §6. The owner's answers are quoted in the Status entry of 2026-11-20, later. |
| T1 Secrets into environments | builder | 📋 **Planned** (D2) | Finding 1. Two GitHub environments if D7 deletes the O365 lane (`e2e-managed`, `exposure-probe`), three if it does not. The secrets move in Settings, by the owner; the pull request adds `environment:` to those jobs. Then zizmor's `secrets-outside-env`, report only (§5, step 2). |
| T2 osv-scanner | builder | 📋 **Planned** (D1) | Finding 3 and "no malicious packages". Fail the build on a malicious package; report the rest (§5, step 1). |
| T3 Semgrep, report only | builder | 📋 **Planned** (D3) | Findings 5 and 6, plus `gcm-no-tag-length` and the template injection. A short named list of rules, not whole packs. The community rules do not reproduce findings 7 to 9 (§4.3; §5, step 3). |
| T4 Fix or answer each spot | builder | 📋 **Planned**; ⏳ **Owner** (D6: the spots of finding 4) | §4.3. Fix `secrets.ts`'s `authTagLength`; the `base_ref` line goes with GEN-26. Findings 8 and 9 (`Billing.tsx:760`, `ProviderConsent.tsx:593`): one `https:`-and-host check where the web app follows or links an address from the API, with a guard. Finding 7 is parked (T10). |
| T5 Semgrep fails the build, rule by rule | builder | 📋 **Planned** (D3) | A rule moves to blocking once it reports nothing on `main` (§5, step 5). `detect-non-literal-regexp` never blocks. |
| T6 gitleaks on a pull request's own commits | builder | 📋 **Planned** (D4) | Fails the build, with an allowlist of test-file paths (`*.unit.test.ts`, `*.integration.test.ts`) and `docs/o365-setup.md`, and no inline ignore comments (§5, step 4). |
| T7 Image findings: keep, do not add | — | 📋 **Proposed** | Findings 2, 11 and 12 are covered today, report only. §3 says why nothing is added. |
| T8 Not worth a check | — | 📋 **Proposed** | Findings 4 and 10, and Trivy's misconfiguration scan: §3 and §5 say why. D3 (no CodeQL now) and D5 (the SBOM as it is) answer two parts of it. |
| T9 The O365 lane | builder | ✅ **Decided 2026-11-20** (*"D7: yes"*); 🔨 **Built** in #1980, a draft, not merged | `e2e-o365.yml` deleted, with what §6 D7 lists; 0141's Status of 2026-11-20, last, has the proof. |
| T10 Finding 7, secrets not compared in constant time | owner | 🅿️ **Parked 2026-11-20, by owner decision** (*"Leave that Finding 7 / unfindable for now."*; trigger: the owner takes it up) | No community rule reports it (§4.3). Four candidates fit it, all from the Cirrux change of 2026-11-19, and none compares a secret with a value someone else supplies. |

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
| — | GEN-21, the socket proxy as root | Handled in its own work. | Listed only. |
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
| 1 | osv-scanner over `pnpm-lock.yaml`, in the Security Scan's repository job | 3; malicious packages | **Fail the build** on a malicious-package record (`MAL-…`). **Report only** for vulnerabilities, because pnpm audit stays the vulnerability gate with the owner's `--fail-at=high` | osv-scanner 2.6.0 (the outside check's version), `osv-scanner_linux_amd64` and `_arm64` from its GitHub release, sha256 per architecture (amd64 `ca69b3d3…`) | pull request, push to `main`, tag, Monday (the job's triggers) | under 10 s (2 s measured, plus the download) | 1 known moderate, listed and passing; 0 malicious | a pin-watch row against osv-scanner's GitHub releases; the guard family that holds Trivy's sha256 form |
| 2 | Finding 1 fixed (T1), then zizmor's `secrets-outside-env` | 1 | **Report only** | zizmor as GEN-26 pins it (1.30.1). A second invocation with `--persona auditor`, reading only this audit's results; the auditor persona's other findings are not proposed | as GEN-26's zizmor job | seconds | 0 once T1 is done; 9 before, or 2 once D7 deletes the O365 lane | GEN-26's pin-watch row |
| 3 | Semgrep with a short list of named rules (§4.3), not whole packs: `path-join-resolve-traversal`, `js-open-redirect-from-function`, `react-href-var`, `gcm-no-tag-length`, `run-shell-injection`, `unknown-value-with-script-tag`, and `detect-non-literal-regexp` and `detect-redos` (both report only for good). The rules are fetched by id, so a rule in no pack is as easy to name as one in a pack | 5, 6, 8, 9 | **Report only**, to the job summary and code scanning (SARIF) | `semgrep/semgrep:1.178.0@sha256:32e45996…` (the outside check's version). The rules are a file in the repository that names the chosen rule ids, fetched from the registry by id, or written in the repository where a rule is short | pull request, push to `main` | 1 to 2 minutes for a named list (measured: 37 s to 102 s per whole pack; the image pull is one more) | §4.3 | a pin-watch row against Docker Hub's tags of the same shape, as hadolint's; the guard that holds the whole reference (as `HADOLINT`) |
| 4 | gitleaks over a pull request's own commits (`base..head`) | the "no secrets" pass, kept passing | **Report only** until D4 is answered; then fail the build | gitleaks 8.30.1 (the outside check's version), `gitleaks_8.30.1_linux_x64.tar.gz` and `_arm64` from its GitHub release, sha256 (x64 `551f6fc8…`) | pull request | under 15 s | today's 67 do not appear unless a pull request touches those lines | a pin-watch row against gitleaks' releases |
| 5 | Semgrep moves to failing the build, one rule at a time, except `detect-non-literal-regexp` | 6 and the extras | **Fail the build**, per rule, once that rule reports nothing on `main` | as step 3 | as step 3 | as step 3 | 0 by construction | as step 3 |

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
  finding 4's two spots alone.
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
