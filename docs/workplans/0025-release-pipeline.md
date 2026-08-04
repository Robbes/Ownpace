# Workplan 0025 — the release pipeline

## Status — 2026-08-03 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Image build + publish workflow | ✅ **Done — shakedown PASSED 2026-08-03** | `images.yml` merged (#258) and the first main-branch run published for real: all three multi-arch (amd64+arm64) builds green in ~4 min each, `Build + push` completing — `ghcr.io/robbes/open-migrate-{api,web,selfhost}` now carry `edge` + `sha-2707a42`. **Compose's `…-selfhost:edge` default is finally an image something produces.** PRs touching the Dockerfiles build amd64-only with no push (the rule-8 self-proof — ran green on #258 itself); `v*` tags publish semver + `latest` and stay never-run until T2 cuts the first release, by design. GITHUB_TOKEN only (rule 3), all actions SHA-pinned, registry layer cache. Same merge also fixed `migration-lint` for main pushes: the atlasgo.sh installer's sudo step has no passwordless sudo on the Spark runner (latent since #232 — the first main push to touch migrations exposed it); now a direct binary download into RUNNER_TEMP, proven green on `spark-openmig` on this very push. |
| T2 First tagged release (owner decision + execution) | ✅ **Decided 2026-08-03, tagged 2026-08-04 — `v0.1.0-rc.1`, not `v0.1.0`** | Owner decision, in the owner's own words: *"B, since it's the same needed to unblock, but not yet the promise."* A release candidate produces the identical artifact set — multi-arch images, cosign signature by digest, SBOM — so **T5's N-1→N upgrade gate gets something real to upgrade FROM**, which is the whole reason the tag was on the critical path. What it does not do is claim `0.1.0`: shared addresses (0027), the drift detectors (0028 T2/T3) and the permission inventory (0029) are unbuilt, and a version people might pin should not imply otherwise. The rc is the honest shape for a pipeline that is proven while the feature set is still moving. **Not yet executed:** the CHANGELOG, version bumps and release notes get prepared first; the tag itself is pushed only on the owner's explicit say-so at the time, because a tag is outward-facing and effectively permanent. **Prepared 2026-08-03, not tagged.** The CHANGELOG has its `[0.1.0-rc.1]` section and the root version is bumped. The section is written to be read by somebody deciding whether to run this: what works (shadow sync in four domains across both target families, the three queues, gated `apply`, the verification gate and rollback, both editions, bilingual UI, notifications, signed multi-arch images) and — at the same length — **what is not in it**: no shared mailboxes or distribution lists, no drift detection, no permission inventory, one-way only (bidirectional was retracted, not deferred), verify-only DNS, no signed installers, and byte parity reported as *not measured* rather than fabricated where it is not measured. It also notes that prerelease images do **not** take `latest`, gives the `cosign verify` line, and says the N-1→N upgrade path is testable from this tag onward and not yet proven. **Tagged 2026-08-04 on the owner's explicit say-so — and NOT at the commit that prepared it.** Preparing the entry on 2026-08-03 and tagging it a day later would have published a signed appliance image carrying `socket.io-parser` 4.2.6 (CVE-2026-69185, HIGH), which main had already fixed — a poor first artifact for anyone to pin, and the one thing the whole signing pipeline exists to make trustworthy. So rc.1 is cut from 2026-08-04 and the CHANGELOG entry was rewritten to describe that tree. **Rewriting it is legitimate precisely because rc.1 was never published**: the rule that a released entry must not quietly change protects readers who already hold the artifact, and there were none — the entry's own note now records that reasoning rather than leaving a date discrepancy for somebody to find. The rewrite also had real work in it, because three of the original *what is NOT in it* bullets had become false: shared addresses, drift detection and the permission inventory are all built. They did not simply move to the *what works* list — they went into a section of their own, **in it, but not yet proven against a live tenant**, which says the machinery exists and has never read a real directory, and names the one thing that changes that. Collapsing that distinction into either list would have been the release note lying in one direction or the other. |
| T3 Signing + SBOM publication + doc truth | ✅ **Done — first signed publish PASSED 2026-08-03** (Images run #6 on the #259 merge, `5459e7a`: all three images published and cosign-signed by digest; the sign step fails loud, so green IS the signing evidence) | `images.yml` signs every published image with cosign — keyless (GitHub OIDC, `id-token: write`, zero stored key material), **by digest** so one signature covers every tag and a retag can't claim it, failing loud (rule 9: a soft-failed signing step is the pipeline lying about what it shipped); PR builds don't sign (nothing is published). SBOM decision taken in-task as the item allowed: **CycloneDX stays** (cheapest true statement — it already runs per-commit; the release-attach step goes live with T2's first tag). **That last clause was wrong, and reviewing the tag path before the first tag was pushed is what found it (2026-08-04).** `security-scan.yml` triggered on `push: branches: [main]` and pull requests — never on tags — while its attach step was gated on `startsWith(github.ref, 'refs/tags/')`. The condition could not become true, so the step was unreachable and would have stayed unreachable through the first release, silently: nothing fails, nothing warns, and the claim *a CycloneDX SBOM is attached to the release* would have been false the whole time. **A guard that reads as deliberate while gating something unreachable is the worst shape a guard can have** — it survives review precisely because it looks considered. Fixed by adding `tags: ['v*']` to the trigger, and a second bug fell out on the way: the job ran with `contents: read`, so creating or updating a release would have failed with a 403 even once it became reachable. `contents: write` is now on that job alone, not the workflow. The step also marks a pre-release from the hyphen in the tag name, and deliberately sets **no** body — the two obvious sources are both wrong (`head_commit.message` on a tag push is the pointed-at commit, not the tag annotation; generated notes are a list of commit subjects), and `CHANGELOG.md` is where the real text lives. Doc truth: SAD §17.1 table + §22.1 prose rewritten against what runs (syft→CycloneDX, Renovate→Dependabot, and the honest SLSA-provenance gap named), deployment.md gains the `cosign verify` one-liner, SECURITY.md's supply-chain bullet now describes reality. |
| T4 Action pinning + digest hygiene | ✅ **Done 2026-08-03** | Action half: the three TODO-marked actions SHA-pinned to their tag commits (trivy-action v0.36.0, codeql upload-sarif v4.37.4, action-gh-release v3.0.2), TODOs removed; every `uses:` in `.github/workflows/` is SHA-pinned. Digest half (unblocked by T1): `deploy/selfhost/README.md`'s channel section now names the REAL channels (`edge`, `sha-<commit>`, semver+`latest` arriving with T2's first release — the "stable" channel it promised was never produced) and gives the verify-then-pin procedure (cosign verify against the repo's workflow identity → `SELFHOST_IMAGE=…@sha256:<digest>`); the quickstart points at it. The app image staying a tag by default is design — `edge` is a channel; production pins the digest. |
| T5 Scheduled e2e + the missing §22.1 gates | 🟡 **Two of three gates DONE + PROVEN on the runner 2026-08-03; only the upgrade-path gate remains — **unblocked 2026-08-03** by T2's `v0.1.0-rc.1` decision, buildable as soon as that tag exists** | `e2e.yml` runs nightly on BOTH backends: two staggered crons (01:30 UTC postgres, 03:30 UTC pglite — staggered because the Spark runner is one shared box), the backend derived from which cron fired since schedule events carry no inputs; dispatch behavior unchanged; seed-count defaults were already schedule-safe. First scheduled firing is the shakedown (this workflow cannot be validated off the runner — its own header's rule). **The idempotent re-run gate landed 2026-08-03**: `migrate-rerun.unit.test.ts` runs the REAL migration chain on PGlite — first pass applies every file on disk by name, second and third passes apply nothing (the boot-loop shape: the appliance migrates on every start); every future migration joins the gate the moment it lands in the directory. Runs in the unit suite, so it gates every PR, not a schedule. **The backup/restore drill landed 2026-08-03** (`selfhost-backup-restore.e2e.test.ts`, wired into `e2e.yml` after the apply gates and before Finish — the position is load-bearing: the ledger is richest there and the mapping is still active, which is what makes the closing assertion available). It runs the DOCUMENTED procedure per backend: Postgres dumps with `pg_dump`, PGlite tars the state directory with the app stopped; then it **destroys the database** (volume removed / directory deleted — the real disaster shape, not a truncate), restores per the runbook, and asserts the appliance returns with identical per-domain counts, an identical direct ledger row count (Postgres), and — the assertion the counts exist to support — **a further pass creates nothing**, i.e. the ledger came back as working state rather than merely as rows. Writing it found two bugs in the documented procedures, both fixed in the same commit: `pg_dump` omits the cluster-global `app_user` role that every GRANT and RLS policy names (a bare-volume restore died on the first GRANT), and the PGlite tar path was `state/pglite` when `appdata` mounts AT `/data/state`, so the correct path inside the volume is `pglite`. **Shakedown PASSED on both backends** (dispatch runs #94 Postgres / #95 PGlite, and Postgres re-confirmed green after the Finish fix): a real volume destroyed and rebuilt, counts and direct row count identical, and the post-restore pass creating nothing under the failing-domain guard. Three rounds to get there, each finding something real: (1) the drill recreated the app WITHOUT `compose.dev.yml`, so the restored appliance came back healthy but unable to resolve `stalwart` — and the drill PASSED while that happened, because a ledger that cannot reach anything also cannot grow (the rule-9 hole is now closed by a failing-domain snapshot compared across the drill); (2) run #93's Nextcloud 500 did not reproduce — recorded as a flake, not a defect; (3) **the Finish gate's precondition turned out to be a coin flip** — "awaiting a decision" needs `MAX_ITEM_ATTEMPTS` (5) attempts, the plant step ran ONE pass and left the every-minute cron to supply four more inside a 200s poll that fits three, so it had been passing on where in the minute the plant landed. The drill's extra 19s shifted the phase and exposed it; the plant step now drives five explicit passes and the gate's timeout message names the threshold. Remaining gate: upgrade path N-1→N, blocked on T2 (nothing to upgrade FROM until a release exists). |
| T6 Code-signing purchase (shared with 0015 T4) | 🟢 **Decided 2026-08-03 — DEFERRED, deliberately** | Owner decision: neither certificate now. Their reasoning, which is the right one: *"I didn't even ever run it on my own windows laptop. I first want it to work, tested by myself, and then I'll buy signing certs."* Buying a certificate before the thing it would sign has ever been run is spending money on a warning nobody has met yet. **And there is nothing to sign:** 0015 T3's status is *payload done, MSI not* — the relocatable 27.6 MB directory exists and is proven to start as a real child process outside the repo, but the MSI/WiX half, the service registration and the shortcut are unbuilt. A code-signing certificate signs an installer that does not exist. **Revisit before `v0.1.0` proper** — the moment strangers are pointed at a download, an unsigned installer is a SmartScreen full-page block and a Gatekeeper refusal, and *"the security warning is expected, click through it"* is not a sentence to put in the quickstart of a tool that holds somebody's mail. Until then the docs state the warnings plainly. |

## Why this exists

The 2026-08-02 full sweep found that the repo's release story is prose with
no pipeline behind it — the largest coherent block of promised-but-unbuilt
work left after the 0021 truth pass:

- **No workflow builds or publishes any image.** `.github/workflows/` has
  zero `docker build`/`push`/`buildx` steps, yet
  `deploy/selfhost/compose.yml` defaults to
  `ghcr.io/robbes/open-migrate-selfhost:edge` — **an image nothing
  produces**. SAD §22 promises multi-arch (amd64+arm64) images.
- **No tags, no releases.** `git tag` count is zero, every `package.json`
  is `0.0.0`, and `CHANGELOG.md` has exactly one `##` header:
  `[Unreleased]`. 0021 T6 recorded "decide when the first tagged release is
  cut" as an open owner decision and closed without it.
- **Signing is promised, absent.** `SECURITY.md` ("sign release images"),
  SAD §22.1 ("signed (cosign), with an SBOM (syft) and build provenance"),
  `docs/deployment.md` — all claim it; a repo-wide grep for
  cosign/sigstore/provenance finds only that prose.
- **The SBOM is generated but never published.** `security-scan.yml` builds
  a CycloneDX SBOM per run into a 90-day private Actions artifact; the
  "attach to release" step is gated on tags and has therefore **never
  run**. (Also: the SAD says syft; the repo uses cyclonedx-npm.)
- **The SAD names Renovate; the repo runs Dependabot.** Functionally
  equivalent, documented wrongly.
- **Three actions are unpinned with in-file TODOs**
  (`codeql-action/upload-sarif@v4`, `softprops/action-gh-release@v3`,
  `trivy-action@v0.36.0`) — recorded since workplan 0006.
- **"e2e nightly" (§22) is not scheduled.** Both e2e workflows are
  dispatch-only; the only scheduled workflow is the security scan.
- **§22.1 promises six CI gates; two exist** (fresh-install integration,
  the Atlas destructive-change lint). Missing: upgrade-path N-1→N on
  representative data, idempotent re-run of each migration, a
  backup/restore drill; the migration-lock test exists only as a unit test
  against a fake driver.

## Tasks

- **T1 — image build + publish.** A workflow that builds the three
  Dockerfiles (api, web, selfhost), multi-arch amd64+arm64, and pushes to
  ghcr.io: `edge` on every merge to `main`, version tags on release tags.
  This is what makes the compose default real. Includes making the
  self-hosted-runner/buildx question explicit (the CI runners are arm64;
  amd64 needs qemu or a matrix).
- **T2 — the first tagged release.** Owner decides the number (`v0.1.0` is
  the conventional opener) and the moment. Execution: cut the
  `[Unreleased]` block into a dated version section, tag, let T1+T3 produce
  the artifacts, write the upgrade note (§22.1 promises one per release).
- **T3 — signing + SBOM + doc truth.** Cosign keyless signing (GitHub OIDC,
  `id-token: write`) on published images; attach the SBOM to the release
  (the step exists, tags make it live); then make the prose match reality
  wherever it doesn't: Renovate→Dependabot, syft→CycloneDX (or adopt syft —
  decide in-task, cheapest true statement wins), and SECURITY.md's
  supply-chain bullet rewritten against what actually runs.
- **T4 — pinning.** SHA-pin the three TODO-marked actions; digest-pin what
  compose can reasonably pin once T1 exists (the app image stays a tag by
  design — `edge` is a channel — but the runbooks should say how to pin).
- **T5 — scheduled e2e + missing gates.** A nightly schedule for `e2e.yml`
  (both persistence backends alternating or matrixed); then the §22.1
  gates: an upgrade-path job (install release N-1, migrate to N on seeded
  data), per-migration idempotent re-run, and a backup/restore drill (the
  runbook procedure, executed in CI). Each gate lands separately — they are
  independent and individually valuable.
- **T6 — the code-signing purchase (Windows).** The same unmade purchasing
  decision blocks 0015 T4 (the MSI) and any EXE distribution: EV
  certificate vs Azure Trusted Signing, a recurring cost. Recording the
  owner's choice here or in 0015 — one decision, two consumers. Not needed
  for T1–T5 (cosign is free/keyless); needed before the MSI ships.

## Hard rules that bite here

- **Rule 3 (no secrets in the repo):** registry credentials and any signing
  material are Actions secrets/OIDC only.
- **Rule 8 (gates before done):** every new workflow proves itself green on
  its own PR before the task closes (the migration-lint pattern).
- **Rule 9 (never mask):** a signing or SBOM step that soft-fails into a
  warning is the pipeline lying about what it shipped — publish steps fail
  loud.
