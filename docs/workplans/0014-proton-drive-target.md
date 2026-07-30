# Workplan 0014 — Proton Drive as a files target

## Status — 2026-07-30 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| All | ⏸️ **Blocked, deliberately** | Not started, and must not be started until the ADR-0025 revisit conditions are met. This plan exists so the work can begin the day they are, rather than being re-derived then. |

> **Read [ADR-0025](../adr/0025-proton-drive-target-deferred.md) before anything here.** It
> records why this is deferred and what has to become true first. This file is
> the *how*; the ADR is the *whether*, and the *whether* is not settled by
> finding this plan and following it.

## The two conditions that unblock this

1. **Proton Drive SDK reaches GA.** Currently "not yet ready for third-party
   production use", interfaces changing until general availability, targeted
   **end of 2026 / early 2027**.
2. **Proton offers a non-interactive credential** — app password, API key, or a
   documented long-lived session a headless worker may hold. Today sign-in is
   browser-interactive and the session lands in the OS secret store.

**Condition 2 is the real gate.** Condition 1 alone lets us *write* the
connector; it does not let us *run* it the way this product runs. Check both
before opening this file's first task — if only 1 has landed, the answer is
still no, and the ADR's operator-attended carve-out is the only route.

## How to check whether they are met

- SDK GA: `github.com/ProtonDriveApps/sdk` README status section, and whether
  `client/js` is published to npm with a stable major.
- Credential: `proton.me/support/drive-cli` and the SDK's auth documentation —
  look specifically for app passwords, API keys, service accounts, or a
  documented long-lived refresh token. The absence of a browser step is the
  test, not the presence of a `--password` flag.

## What is already known to fit

The SDK's surface maps onto our existing ports with nothing left over, which is
why this is a plan and not an open research question:

| Our port | Proton SDK capability | Notes |
|---|---|---|
| `FileTargetWriter.ensureDirectory` | folder create / list | |
| `FileTargetWriter.upsertFile` | upload | Must stay **create-if-absent** (ADR-0020) |
| `FileTargetWriter.findFileByNaturalKey` | folder listing by path | Our file natural key is the normalised path |
| `TargetReindexer.listEntries` | recursive folder listing | Needed for ADR-0020 recovery |
| `TargetRemover.removeItem` | **trash** | Gives an honest `kind: 'binned'` (ADR-0024) |
| change detection | event-based update polling | May be cheaper than re-listing; measure |

It is **TypeScript**, so it does not reintroduce the shell-out dependency
ADR-0019's update note removed. Use the SDK, never the CLI — see ADR-0025's
alternatives for why.

## Open questions to settle FIRST, before writing a connector

These are the ones that could invalidate the plan, so answer them against a
real account before building on top of them.

1. **Is there a content hash without downloading?** §20 verification samples
   checksums, and `runDomainSync` compares content hashes to decide
   create/update/skip. If the only way to hash a file is download-and-decrypt,
   both get materially more expensive than for any other target, and the
   sampling rate may need to differ per target — which nothing currently
   supports. Measure before designing around it.
2. **Is there a per-file version marker** (an ETag equivalent) that survives a
   re-read? `UpsertOptions.expectedTargetVersion` and `TargetRemover`'s
   conflict check are how hard rule 2 is enforced at the moment of writing. If
   there is none, this target has no overwrite protection, and that has to be
   stated plainly rather than discovered. Revisions may serve; check.
3. **What does the natural key survive?** Our file key is the normalised path.
   If Proton stores an opaque node id and the path is derived, a rename by the
   owner changes our key and the item looks new. That is the move-detection
   problem (§11.1) in a sharper form; `sourceRef` may be the right home for the
   node id.
4. **Where does the session live in a container?** The CLI uses the OS secret
   store. The self-host appliance is a container with a bind-mounted config
   directory. Whatever the GA credential turns out to be, it has to be
   presentable via the existing `SecretStore` / env-var path (§17), not a
   keychain that does not exist in the image.
5. **What does a quota or size rejection look like?** Files is the domain where
   `left_behind` and the §11.2 failure queue actually get used. The error has to
   be distinguishable and verbatim (hard rule 9).

## Tasks (draft — re-check against the GA SDK before starting)

- **T1 — Spike against a real account.** Answer the five open questions above
  with evidence, in this file's Status block. No connector code. If Q1 or Q2
  comes back badly, stop and amend ADR-0025 rather than working around it.
- **T2 — `ProtonDriveTarget` implementing `FileTargetWriter`.** Create-if-absent
  keyed on the normalised path; `ensureDirectory`; `upsertFile` with the
  overwrite guard from Q2 if one exists, and an explicit refusal to overwrite
  if not. Unit tests against a faked SDK client, in the shape of
  `imap-dav-target.unit.test.ts`.
- **T3 — `TargetReindexer.listEntries`.** ADR-0020 recovery. Must enumerate
  **completely or fail loudly** — the IMAP/DAV target's own history is the
  cautionary tale: a partial listing that looks complete makes the next sync
  re-upload everything it could not see.
- **T4 — `TargetRemover.removeItem`.** Trash → `binned`. Read back after the
  removal and refuse to record a tombstone if the file is still there, as the
  JMAP and IMAP/DAV writers both do.
- **T5 — Credential handling.** Whatever the GA answer to Q4 is, wired through
  `SecretStore` and the self-host config, with the secret-leak assertion test
  extended to cover it. Self-host only until ADR-0025's key-custody question
  has an answer for managed.
- **T6 — Config + wiring.** `proton-drive` added to `parseTarget` and to
  `buildDomainDeps*`. This is the point of no return for operator visibility —
  do not land it before T1–T5 are green, because a target type that parses is a
  target type someone will configure.
- **T7 — Integration coverage against a real account.** The DAV target writers
  have real-server integration tests; this needs the same, and cannot use a
  container fixture, so decide early how CI gets a Proton account (or accept
  that this suite is manual-only and label it so — never a skipped test that
  reads as green).
- **T8 — Docs + gates.** `target-providers.md` entry, operator-runbook coverage
  tables (deletion evidence + `apply` support), SAD §9 table and §9.4, ADR-0025
  status flipped from deferred to superseded, CHANGELOG.

## What would make this NOT worth doing even once unblocked

Worth writing down, because a plan that only argues for itself is not much use:

- If Q1 lands badly (no hash without download), every pass costs a full
  download of the target corpus to verify, and the shadow-sync model stops
  being cheap. That is a different product for this target, and it should be
  labelled as such rather than shipped as if it were the same thing.
- If Proton's GA credential turns out to be per-device rather than per-account,
  a migration appliance may not be a legitimate holder of it under Proton's own
  terms. Check the terms, not just the API.
- If demand is one or two users, the honest answer may remain Easy Switch plus
  the existing manual path (§9.1), and this plan gets closed rather than built.
