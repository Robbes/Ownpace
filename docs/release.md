# Cutting a release

The runnable form of workplan 0025's prose — before this file, the procedure
existed only as narrative inside that workplan and only its author could
repeat it. Everything here is ordinary git and GitHub; the workflows do the
publishing.

The **root `package.json` is the single version source** (workspace packages
stay `0.0.0` deliberately — they are never published individually). The
`/version` endpoints and the Windows build stamp both read it.

## 1. Before the tag

- [ ] `main` is green: lint, typecheck, unit, integration.
- [ ] `CHANGELOG.md`: rename `[Unreleased]` to the version + date, and start a
      fresh empty `[Unreleased]` above it. The release body links to this
      section — it is the release's prose.
- [ ] Bump `version` in the root `package.json` to the version being cut.
- [ ] **Upgrade gates against the PREVIOUS release** (these skip silently
      without the ref present — a skip here is a hole, not a pass):
  - [ ] `git fetch origin tag <previous-tag>` and run
        `pnpm vitest run --project unit packages/ledger/src/migrate-upgrade.unit.test.ts`
        — confirm the five `skipIf(!HAVE_REF)` tests **executed**, including
        the downgrade refusal.
  - [ ] `scripts/upgrade-drill.sh` on a Docker host (the Spark box): previous
        release image, real volumes, swap to HEAD in place, healthy after a
        further restart. The drill says when it is vacuous (tag == HEAD) —
        a vacuous pass does not count.
- [ ] **Before the first non-demo tenant** (not per release, but check it
      here because this list is what gets read): CI and the live managed stack
      are not on the same machine — see the operator runbook, "This box also
      runs CI". Demo data makes it tolerable; a customer's mailbox
      credentials do not.
- [ ] Managed stack smoke if the release touches it:
      `deploy/compose/smoke-managed.sh` (includes the web `/api` proxy
      assertion).

## 2. The tag

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
| `images.yml` | `open-migrate-{api,web,selfhost}:<X.Y.Z>` multi-arch on GHCR, cosign-signed by digest | `cosign verify ghcr.io/robbes/open-migrate-selfhost:<X.Y.Z> --certificate-identity-regexp '^https://github.com/Robbes/(open-migrate|Ownpace)/' --certificate-oidc-issuer https://token.actions.githubusercontent.com` |
| `security-scan.yml` | the GitHub release itself, with `bom.json` (CycloneDX SBOM) attached and the generated body (pull lines, verify one-liner, changelog link) | the release page reads like a release, not an unlabelled SBOM |
| `windows-payload.yml` | `openmig-appliance-win-x64-v<X.Y.Z>.zip` attached to the release (unsigned — SmartScreen prompt documented in the runbook) | asset present; `SHA256SUMS.txt` inside |

## 4. After

- [ ] Edit prose into the release body if the generated pointers need
      context (the workflow appends, never overwrites, an existing body).
- [ ] `GET /version` on a pulled image reports the new version + commit.
- [ ] Announce; the changelog section is the text.

## Known deferred (owner decisions, tracked in workplans)

- Code signing for the Windows payload — 0025 T6 / 0015 T4.
- MSI packaging — 0015 T3.
- SLSA build provenance — named gap, SAD §21.
