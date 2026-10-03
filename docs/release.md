# Cutting a release

The runnable form of workplan 0025's prose — before this file, the procedure
existed only as narrative inside that workplan and only its author could
repeat it. Everything here is ordinary git and GitHub; the workflows do the
publishing.

The **root `package.json` is the version source** (workspace packages
stay `0.0.0` deliberately — they are never published individually). The
`/version` endpoints and the Windows build stamp both read it.
`apps/api/docs/openapi.yaml`'s `info.version` is a copy, held to it by
`scripts/a-release-that-names-itself.unit.test.ts`, so the bump below names
both.

## 1. Before the tag

- [ ] `main` is green: lint, typecheck, unit, integration.
- [ ] `CHANGELOG.md`: rename `[Unreleased]` to the version + date, and start a
      fresh empty `[Unreleased]` above it. The release body links to this
      section — it is the release's prose.
- [ ] Bump `version` in the root `package.json` to the version being cut, and
      `info.version` in `apps/api/docs/openapi.yaml` to the same: the API
      contract's copy, which `scripts/a-release-that-names-itself.unit.test.ts`
      fails on while the two differ.
- [ ] **Upgrade gates against the PREVIOUS release** (these skip silently
      without the ref present — a skip here is a hole, not a pass):
  - [ ] `git fetch origin tag <previous-tag>` and run
        `pnpm vitest run --project unit packages/ledger/src/migrate-upgrade.unit.test.ts`
        — confirm the six `skipIf(!HAVE_REF)` tests **executed**, including
        the downgrade refusal.
  - [ ] `scripts/upgrade-drill.sh` on a Docker host (the Spark box): previous
        release image, real volumes, swap to HEAD in place, healthy after a
        further restart. The drill says when it is vacuous (tag == HEAD) —
        a vacuous pass does not count.
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
      assertion).

## 2. The tag

Before pushing it, `git fetch origin --tags` and run
`node scripts/release-names-agree.mjs v<X.Y.Z>`: it refuses a tag that is not
`v` plus the root version, a version with no `## [<X.Y.Z>] - <YYYY-MM-DD>`
section in `CHANGELOG.md`, and a tag SemVer orders at or below a release
already tagged. `images.yml`, `security-scan.yml` and `windows-payload.yml`
run the same check as their first step after the checkout, so a tag whose
names disagree publishes nothing (workplan 0146 T2).

Run it with the commit you are about to tag checked out: it reads
`package.json` and `CHANGELOG.md` from the working tree, and the tag goes on
the commit you name, which T2's step 5 picks from the nightly runs. And once a
newer release is tagged, a re-run or a dispatch of an older tag's workflows is
refused by the same rule, because that tag now sorts below one that exists.
Cut a new tag instead of re-running an old one.

```bash
git tag -a v<X.Y.Z> -m "Ownpace v<X.Y.Z>"
git push origin v<X.Y.Z>
```

A hyphenated version (`v0.2.0-rc.1`) is a SemVer pre-release: the GitHub
release is marked prerelease and **`latest` image tags are withheld**
(metadata-action `latest=auto`). The first non-hyphenated tag is the first
time the `latest` channel exists — check it appeared.

## 3. What the tag fires (verify each)

| Workflow | Produces | Check |
|---|---|---|
| `ci.yml` | the test gate on the release ref | green before announcing |
| `images.yml` | `ownpace-{api,web,selfhost}:<X.Y.Z>` multi-arch on GHCR, cosign-signed by digest | `cosign verify ghcr.io/robbes/ownpace-selfhost:<X.Y.Z> --certificate-identity-regexp '^https://github\.com/Robbes/(open-migrate|ownpace|Ownpace)/' --certificate-oidc-issuer https://token.actions.githubusercontent.com` |
| `security-scan.yml` | the GitHub release itself, with `bom.json` (CycloneDX SBOM) attached and the generated body (pull lines, verify one-liner, changelog link) | the release page reads like a release, not an unlabelled SBOM |
| `windows-payload.yml` | `ownpace-appliance-win-x64-v<X.Y.Z>.zip` attached to the release (unsigned — SmartScreen prompt documented in the runbook) | asset present; `SHA256SUMS.txt` inside |

## 4. After

- [ ] Edit prose into the release body if the generated pointers need
      context (the workflow appends, never overwrites, an existing body).
- [ ] `GET /version` on a pulled image reports the new version + commit.
- [ ] Announce; the changelog section is the text.

## 5. Deploying a release to ownpace-live

`ownpace-live`, the stack testers use, runs release tags and nothing else
(workplan 0146 T5). The procedure is
[workplan 0132](./workplans/0132-the-alpha-and-the-nightly-gate-on-one-box.md)
T6, *one way to deploy live, from a tag*, and its script is
`deploy/compose/deploy-live.sh <tag>`, run from `~/ownpace-live` with the hold
on and the drain done. The steps, and what the script refuses and checks, are
in [managed-bring-up.md](./managed-bring-up.md#updating-a-running-deployment),
*`ownpace-live`: a release tag, with `deploy-live.sh`*.

- [ ] The tag is the one §2 made: annotated, pushed to origin, and the root
      `package.json` at its commit says the tag without its `v`. The script
      refuses anything else: *"live runs releases: name a release tag"*.
- [ ] Its commit is one the nightly gate ran green on the OTA stack, as many
      times as workplan 0141's rule asks, or the owner accepts fewer in writing
      in the deploy log.
- [ ] Its commit has `deploy/compose/exposure-check.sh` (on `main` since
      #1271), and live's `.env` has `EXPOSURE_ALLOW` naming every address,
      other than loopback, that a container on the machine is published on on
      purpose. A tag without the script cannot pass the exposure check, and
      neither can a machine with such an address the list leaves out: the
      deploy does not take.
- [ ] With the hold on and the drain done, `deploy-live.sh --dry-run <tag>`
      said one-way or reversible, and moved nothing. If one-way, and you want
      a way back that is not forward, dump live's database then, before the
      deploy.
- [ ] The script said the deploy took: `/api/version` on live names the tag's
      commit and version, `/api/ready` answers 200, `/api/auth/mode` answers
      `managed`, and the exposure check passed.
- [ ] Read whether it called the deploy one-way or reversible before lifting
      the hold, which you do yourself. During the alpha a bad deploy is fixed
      forward, with a fix and a new `alpha.N` tag; a reversible one can also be
      undone by deploying the previous tag with the same script.

The OTA stack is not deployed this way: the nightly gate brings `main` up on it
every night.

## Known deferred (owner decisions, tracked in workplans)

- Code signing for the Windows payload — 0025 T6 / 0015 T4.
- MSI packaging — 0015 T3.
- SLSA build provenance — named gap, SAD §22.1.
