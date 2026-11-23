# ADR-0022: IMAP Dependency Security Strategy

**Status:** Accepted — and **the migration this deferred was carried out on 2026-08-06**; since 2026-10-25 it also records the owner's decisions on the Stalwart test fixture's pin  
**Date:** 2026-07-08 (updates: 2026-08-06, 2026-10-25, 2026-11-20)\
**Authors:** OpenHands Agent  
**Supersedes:** None

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- The vulnerable chain is **gone, not overridden**: `imap-simple`→`utf7`→`semver@5.3.0` left the lockfile with the imapflow migration (workplan 0032).
- The `semver` pnpm override **stays** — it was never only about that chain; removing it is a separate decision with its own blast radius. Since 2026-10-21 it is one scoped entry per fixed line (5.7.2, 6.3.1, 7.5.2): a 5.x, 6.x or 7.x below its fix is lifted within its major, and nothing is moved to 7.
- The Stalwart test fixture is pinned at **v1.2.0**, its Alpine build, by tag and index digest (2026-11-23, on the owner's word, its three days waived; v1.1.1 from 2026-11-20). It moves only on the owner's decision, recorded here as a dated update, with every copy in one change, as `docs/stalwart-integration-fix.md`, "Moving the pin", lists.

> ## Update, 2026-08-06 — the workaround is no longer load-bearing
>
> This ADR chose a `pnpm` override over migrating, and listed as its own
> negative consequence that *"if `imap-simple` or `utf7` are deprecated,
> migration will still be needed"*, with `imapflow` named as the eventual
> destination. Workplan 0032 did that migration; T3b removed the last
> `imap-simple` declaration.
>
> **The dependency path this ADR is about no longer exists.** `imap-simple` →
> `imap` → `utf7` → `semver@5.3.0` is gone from `pnpm-lock.yaml` entirely — the
> lockfile carried three `utf7` entries before T3b and carries none after. The
> vulnerability is now absent rather than overridden, which also removes the
> scanner noise recorded above as the third negative.
>
> **The `semver: ^7.5.2` override stays.** It was never only about this chain,
> and removing it is a separate decision with its own blast radius across every
> transitive dependency in the workspace. Nothing here asks for that.
>
> Everything below stands as the record of the decision that was made in July,
> and is deliberately not rewritten.

> ## Update, 2026-10-25 — the Stalwart pin moves to v0.16.27, on the owner's decision
>
> AGENTS.md puts the decisions about Stalwart here: the reference target that
> the integration tests, E2E (self-hosted) and the OTA demo start, and that
> `docs/stalwart-integration-fix.md` pinned at v0.16.10 with *"DO NOT change
> the pinned version"*. Stalwart is a test fixture only. Live never runs it:
> the bring-up starts it only with `--with-demo`, which live refuses
> (workplan 0132 T5).
>
> **Why it moves.** The image-scan triage of 2026-10-23 (workplan 0146 T11 (b))
> read v0.16.10 at 3 critical and 114 high findings, and v0.16.27 (Debian 13.7)
> at 0 critical and 47 high, none of the 47 with a fix upstream. The fix doc's
> rule made that the owner's call. **The owner decided yes on 2026-10-25.**
>
> **Why it is safe to move within v0.16.** Upstream's notes for every v0.16.x
> release say a v0.16 install upgrades by replacing the binary or pulling the
> image. Its changelog from v0.16.11 to v0.16.27 renames no setting, no
> recovery-mode variable and no object the provisioning plan upserts. Run in
> the session that made the change: the two-phase `setup-stalwart.sh` with
> `stalwart-cli` 1.0.13, the eleven integration files that use Stalwart (44
> tests), the JMAP spike (`recurrenceRules` is still refused, so workplan 0031
> T1 stays parked), and one volume taken from v0.16.10 to v0.16.27 and back
> twice, its mail and contacts read back each time. What comes with it is in
> the fix doc: the x86_64 images need an x86-64-v2 CPU from v0.16.26 on, the
> WebUI comes from release v1.0.11 and in recovery mode too, and a new
> database fetches its ASN lists from GitHub instead of jsDelivr.
>
> **How it merges.** Main is frozen from the alpha.2 fold to its tag, so the
> change merges after the tag, for alpha.3, once the CI integration tests,
> E2E (self-hosted) and E2E (managed) are green on it.
>
> **The rule for the next move** is the operative bullet above, and its
> checklist lives in the fix doc. The `semver` decision is untouched.

> ## Update, 2026-11-20 — the Stalwart pin moves to v1.1.1, on the owner's decision
>
> **The question and the answer.** Put to the owner on 2026-11-19: *"Move
> the test mail server to Stalwart v1.1.1? Yes, after alpha.12, on its own
> branch, with the two-step run proven first. It fixes the brotli and apt
> CVEs, but not zlib."* The owner answered at about 18:36 UTC that day:
> *"3. Yes"*.
>
> **Why it moves.** The scan of v0.16.27 reads Debian's brotli 1.1.0-2
> (CVE-2026-111497, on CISA's list of exploited vulnerabilities) and apt
> 3.0.3, both fixed in Debian, and no v0.16 release follows it (workplan
> 0119, 2026-11-19). v1.1.1's image carries brotli 1.1.0-2+deb13u1 and apt
> 3.0.4; zlib is still unfixed there. It was pushed to Docker Hub on
> 2026-11-16 at 11:47 UTC, so CONTRIBUTING.md's three days passed on
> 2026-11-19.
>
> **Why it is not a binary swap.** v1 is another line: upstream's 1.0.0
> entry says a v0.16 deployment cannot be upgraded in place, because the
> database layout is new, and v1.1.1 refuses at start a store an earlier
> line made. Upstream wrote no `UPGRADING/` note for it, so the move was read
> from the changelog between the two tags and the source at both. The
> recovery-mode variables, `config.json` and every object the provisioning
> plan upserts read the same, and stalwart-cli 1.0.14 stays. One connector
> changes with it: JMAP files follow a newer FileNode draft on v1, so
> `JmapFileTarget` speaks both, chosen by what the account's session says.
> The fix doc, "Moving the pin", has the detail.
>
> **How it merges.** On its own branch, after alpha.12, as the owner said:
> first the CI integration tests on the new tag (the two-phase run), then
> E2E (self-hosted), and E2E (managed) on the branch after alpha.12's tag.
> v1.1.1 refuses the OTA demo's Stalwart volume, which v0.16.10 made, so
> what happens to that volume is decided before that run.
>
> **The OTA demo's switch, decided the same day.** Put to the owner at
> about 10:25 UTC on 2026-11-20: *"For later (alpha.13), Stalwart v1.1.1 on
> the test stack (OTA): the new mail server can't read the old test-mail
> data, and the test stack's database still lists those test mails as
> copied, so the nightly test would fail after the switch. How should the
> switch go?"* The owner chose *"One-time reset (Recommended)"*, whose
> description read: *"Right after a nightly test, you run one reset command
> I prepare (it clears only the test fixtures' mail data and their copy
> records on OTA, nothing real). I then run the branch test and merge
> straight away. Least code, nothing left behind."* The command is
> `deploy/compose/reset-demo-mail.sh`. Run by hand with `--yes` once a
> nightly E2E (managed) of `main` has finished, it removes the demo's
> Stalwart container and its data volume and clears the demo mail
> migration's rows. E2E (managed) then runs on the branch, and the merge
> follows before the next nightly; a nightly in between means the reset
> runs again. Nothing calls it by itself. The fix doc, "Moving the pin", has
> the order and what it clears.
>
> **The rule for the next move** is the operative bullet above, unchanged
> but for the version.

> ## Update, 2026-11-23 — the Stalwart pin moves to v1.2.0's Alpine build, on the owner's decisions, its three days waived
>
> **The questions and the answers.** An outside, read-only check of
> 2026-11-23, and that day's image scan, found Debian's krb5 libraries and
> `zlib1g` in `stalwartlabs/stalwart:v1.1.1` with fixes that no Stalwart
> release or rebuild had carried by then (workplan 0166 T9). Asked whether to
> wait for Stalwart's next release or take v1.1.1's Alpine build, the owner
> answered: *"Stalwart: in alpha 19"*. So the pin stayed at v1.1.1 in
> alpha.18. Stalwart pushed v1.2.0, and its Alpine build, the same day at
> 18:25 UTC. After alpha.18's tag the owner chose it: *"Pick stalwart v1.2.0,
> since it's part of our test/dev setup. Not part of our own pace
> solution."*, and, on its three days: *"v1.2.0 now (waive)"*. So the pin
> moves from v1.1.1 to `v1.2.0-alpine` for alpha.19, every copy by the tag
> and the digest of its index (`sha256:2b7dfee6…`). CONTRIBUTING.md's
> three-day floor is waived for this test image alone; live never runs it.
>
> **What moves, and what does not.** The base: Alpine 3.24.4 for Debian
> 13.7, with no krb5, zlib 1.3.2-r1 (the build Alpine fixed CVE-2026-85091
> in) and musl for glibc. The release: another minor of v1, which upstream
> upgrades in place; its one upgrade note is permissions that default roles
> an earlier version made lack, for mail rules, junk-mail lists, calendar
> settings and Exchange, none of which this repository uses. The image: the
> same entrypoint, command, user `stalwart` (uid and gid 2000), volumes,
> ports and healthcheck as v1.1.1's, for linux/amd64 and linux/arm64. The
> store: schema version 7, as v1.1.1's, with no migration at start, so a
> volume v1.1.1 wrote, the OTA demo's included, opens as it was: no reset,
> and nothing one-way in it. stalwart-cli v1.0.14 still reads its schema.
> The fix doc, "Moving the pin", has what was read.
>
> **How it merges.** After alpha.18's tag, on its own branch: the CI
> integration tests on the new tag (the two-phase run, on amd64 and arm64),
> then E2E (self-hosted) on Postgres and on PGlite, and E2E (managed).

## Context

The project uses `imap-simple` as the IMAP client library for connecting to O365 and generic IMAP servers. This library has a transitive dependency chain that includes `utf7@1.0.2`, which depends on `semver@5.3.0`.

**Vulnerability:** CVE-2022-25883 (Prototype Pollution in semver@5.3.0)
- **Severity:** Low to Medium
- **Affected Package:** `semver@5.3.0`
- **Dependency Path:** `imap-simple` → `imap` → `utf7` → `semver@5.3.0`
- **Impact:** Prototype pollution could potentially lead to denial of service or code execution in specific contexts

## Decision

We will use **pnpm overrides** to force the use of a patched `semver` version (`^7.5.2`) throughout the dependency tree, rather than immediately migrating to a different IMAP library.

### Implementation

In `pnpm-workspace.yaml`:
```yaml
overrides:
  semver: ^7.5.2
```

This ensures that all packages, including transitive dependencies, use the secure `semver@7.8.5` (or later 7.x version) instead of the vulnerable `5.3.0`.

## Consequences

### Positive
- **Immediate remediation:** The vulnerability is eliminated without code changes
- **Low risk:** No breaking changes to existing functionality
- **Fast implementation:** Resolved in minutes
- **Maintainable:** Documented in workspace configuration
- **Cost-effective:** No development time required for migration

### Negative
- **Temporary workaround:** The underlying `utf7` package still has the vulnerable dependency declaration
- **Future maintenance:** If `imap-simple` or `utf7` are deprecated, migration will still be needed
- **Security scanner noise:** Some scanners may still flag the dependency chain even though the actual version used is patched

### Alternatives Considered

**Option 1: Ignore the vulnerability**
- Rejected: Even low-severity vulnerabilities should be addressed, especially when easy fixes exist

**Option 2: pnpm override (Selected)**
- Pros: Immediate fix, no code changes, low risk
- Cons: Temporary workaround, doesn't address root cause

**Option 3: Migrate to `imapflow`**
- **Pros:** 
  - Modern, actively maintained library (last update: July 2026)
  - No vulnerable dependencies
  - Better TypeScript support
  - More features (async iterators, mailbox locking, etc.)
- **Cons:**
  - Significant code refactoring required
  - API differences require testing
  - Higher risk of introducing bugs
  - Takes days/weeks to complete

**Option 4: Fork and patch `utf7`**
- Rejected: Overly complex, creates maintenance burden

## Future Consideration

If the project requires long-term maintenance of IMAP functionality, consider migrating to **imapflow** (https://github.com/andris9/imapflow):

- Modern, actively maintained (weekly updates)
- No vulnerable dependencies
- Better TypeScript support with built-in type definitions
- More features: async iterators, mailbox locking, SOCKS proxy support
- Cleaner API design with promise-based interface

Migration would involve:
1. Replacing `imap-simple` with `imapflow` in `packages/connectors/package.json`
2. Refactoring `packages/connectors/src/imap-source.ts` to use `ImapFlow` API
3. Refactoring `packages/connectors/src/imap-dav-target.ts` to use `ImapFlow` API
4. Comprehensive testing of IMAP operations (list folders, search, fetch, append)
5. Update documentation

This migration is **not urgent** given the pnpm override fix, but should be considered for:
- Major version upgrades of `imap-simple`
- Addition of new IMAP features
- Long-term maintenance strategy

## References

- CVE-2022-25883: https://nvd.nist.gov/vuln/detail/CVE-2022-25883
- pnpm overrides documentation: https://pnpm.io/next/settings#overrides
- imapflow library: https://github.com/andris9/imapflow
- imap-simple (deprecated): https://www.npmjs.com/package/imap-simple
