# ADR-0022: IMAP Dependency Security Strategy

**Status:** Accepted — and **the migration this deferred was carried out on 2026-08-06**; since 2026-10-25 it also records the owner's decisions on the Stalwart test fixture's pin  
**Date:** 2026-07-08 (updates: 2026-08-06, 2026-10-25)  
**Authors:** OpenHands Agent  
**Supersedes:** None

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- The vulnerable chain is **gone, not overridden**: `imap-simple`→`utf7`→`semver@5.3.0` left the lockfile with the imapflow migration (workplan 0032).
- The `semver` pnpm override **stays** — it was never only about that chain; removing it is a separate decision with its own blast radius. Since 2026-10-21 it is one scoped entry per fixed line (5.7.2, 6.3.1, 7.5.2): a 5.x, 6.x or 7.x below its fix is lifted within its major, and nothing is moved to 7.
- The Stalwart test fixture is pinned at **v0.16.27** (2026-10-25). It moves only on the owner's decision, recorded here as a dated update, with every copy in one change, as `docs/stalwart-integration-fix.md`, "Moving the pin", lists.

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
