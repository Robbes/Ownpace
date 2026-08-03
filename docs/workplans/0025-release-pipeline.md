# Workplan 0025 — the release pipeline

## Status — 2026-08-02 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Image build + publish workflow | ✅ **Done — shakedown PASSED 2026-08-03** | `images.yml` merged (#258) and the first main-branch run published for real: all three multi-arch (amd64+arm64) builds green in ~4 min each, `Build + push` completing — `ghcr.io/robbes/open-migrate-{api,web,selfhost}` now carry `edge` + `sha-2707a42`. **Compose's `…-selfhost:edge` default is finally an image something produces.** PRs touching the Dockerfiles build amd64-only with no push (the rule-8 self-proof — ran green on #258 itself); `v*` tags publish semver + `latest` and stay never-run until T2 cuts the first release, by design. GITHUB_TOKEN only (rule 3), all actions SHA-pinned, registry layer cache. Same merge also fixed `migration-lint` for main pushes: the atlasgo.sh installer's sudo step has no passwordless sudo on the Spark runner (latent since #232 — the first main push to touch migrations exposed it); now a direct binary download into RUNNER_TEMP, proven green on `spark-openmig` on this very push. |
| T2 First tagged release (owner decision + execution) | ⬜ Needs the owner | — |
| T3 Signing + SBOM publication + doc truth | 🟡 **Built 2026-08-03; signing's first live run lands with the next main push** | `images.yml` signs every published image with cosign — keyless (GitHub OIDC, `id-token: write`, zero stored key material), **by digest** so one signature covers every tag and a retag can't claim it, failing loud (rule 9: a soft-failed signing step is the pipeline lying about what it shipped); PR builds don't sign (nothing is published). SBOM decision taken in-task as the item allowed: **CycloneDX stays** (cheapest true statement — it already runs per-commit; the release-attach step goes live with T2's first tag). Doc truth: SAD §17.1 table + §22.1 prose rewritten against what runs (syft→CycloneDX, Renovate→Dependabot, and the honest SLSA-provenance gap named), deployment.md gains the `cosign verify` one-liner, SECURITY.md's supply-chain bullet now describes reality. |
| T4 Action pinning + digest hygiene | 🟡 **Action half done 2026-08-03** | The three TODO-marked actions are SHA-pinned to their tag commits (trivy-action v0.36.0, codeql upload-sarif v4.37.4, action-gh-release v3.0.2 — peeled SHAs from `git ls-remote`), the TODOs removed; every `uses:` in `.github/workflows/` is now SHA-pinned. The compose digest-pinning half waits on T1 (an image nothing produces cannot be pinned). |
| T5 Scheduled e2e + the missing §22.1 gates | 🟡 **Schedule half done 2026-08-03** | `e2e.yml` runs nightly on BOTH backends: two staggered crons (01:30 UTC postgres, 03:30 UTC pglite — staggered because the Spark runner is one shared box), the backend derived from which cron fired since schedule events carry no inputs; dispatch behavior unchanged; seed-count defaults were already schedule-safe. First scheduled firing is the shakedown (this workflow cannot be validated off the runner — its own header's rule). The three §22.1 gates (upgrade path N-1→N, per-migration idempotent re-run, backup/restore drill) remain, each its own task. |
| T6 Code-signing purchase (shared with 0015 T4) | ⬜ Needs the owner | — |

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
