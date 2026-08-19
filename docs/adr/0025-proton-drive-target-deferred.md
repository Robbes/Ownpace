# ADR-0025: Proton Drive as a files target — deferred on authentication, not on effort

- **Status:** Accepted (deferred, with named revisit conditions)
- **Date:** 2026-07-30
- **Relates to:** ADR-0011 (targets are managed EU/CH platforms; self-hosted permitted but user-operated), ADR-0019 (packaging; JS-native), ADR-0020 (ledger is a rebuildable cache), ADR-0024 (`apply`), SAD §9.1/§9.4 (Proton positioning), §17 (secret handling), §20 (verification).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- The **entire Proton destination is deferred** (Drive, Bridge mail, ICS/vCard snapshots); nothing Proton is in the scope manifest.
- Drive's revisit needs **both**: SDK general availability **and** a non-interactive credential a headless worker may hold — the second is the real gate.
- The reverse-engineered rclone/Proton-API-Bridge route is **rejected outright, now and later** (idempotency cannot survive an undocumented per-account protocol).

## Context

Proton is Swiss, end-to-end encrypted, and exactly the kind of destination this
product exists to make reachable. It has been carried since the first
architecture draft as an **optional** family/individual target (SAD §9.1),
never as a continuous-shadow one, on the grounds that its zero-access
encryption blocks open protocols: no CalDAV, no CardDAV, mail only via Bridge.

The **files** half of that judgement was recorded as "weak/no sync API", and
that specific line is now out of date. In 2026 Proton shipped two things:

- an official **Drive SDK** — `github.com/ProtonDriveApps/sdk`, MIT-licensed,
  with a **TypeScript** client alongside the C# one;
- an official **Drive CLI** — released 9 June 2026 for Windows, macOS and
  Linux, with machine-readable `--json` output.

So the question was reopened: can Proton Drive now be a `FileTargetWriter`?

## What we checked, and what we found

**The port fit is good.** The SDK covers folder listing, upload, download,
move, rename, trash, and event-based change polling. That maps onto our ports
with nothing left over:

| Our port | Proton SDK capability |
|---|---|
| `FileTargetWriter.ensureDirectory` | folder create/list |
| `FileTargetWriter.upsertFile` | upload |
| `FileTargetWriter.findFileByNaturalKey` | folder listing by path |
| `TargetReindexer.listEntries` (ADR-0020) | folder listing, recursive |
| `TargetRemover.removeItem` (ADR-0024) | **trash** → an honest `kind: 'binned'` |

Being TypeScript, it would also not reintroduce the shell-out dependency
ADR-0019's update note just finished removing.

**Four things block it anyway**, in order of severity:

1. **Authentication is browser-interactive with no headless path.** The
   official CLI signs in through a browser and caches the session in the OS
   secret store. There are no app passwords, no API keys and no long-lived
   tokens — nothing equivalent to the IMAP app passwords or DAV credentials
   every other target here accepts. This product is a **headless worker on a
   schedule**. A credential that must be re-established interactively cannot
   back an unattended continuous shadow sync. This is a contradiction, not an
   inconvenience, and it is the decisive one.
2. **The SDK is pre-GA.** Proton states it is "not yet ready for third-party
   production use", with interface changes expected until general availability,
   targeted **end of 2026 / early 2027**. It also deliberately excludes login
   and session management, leaving that to other Proton libraries — i.e. the
   one part that blocks us is the part it does not cover.
3. **E2E encryption means key custody.** Every other target receives bytes over
   TLS and encrypts server-side. Proton requires the client to encrypt with the
   user's own keys, so the worker would hold that key material. Defensible in
   the **self-host** edition, where it never leaves the owner's hardware — the
   same reasoning that already confines Bridge there (§9.4) — and not
   defensible in the **managed** edition, where §17 minimises exactly this.
4. **There is still no WebDAV**, so this can never be a `webdav` target with a
   different URL. It is a new connector either way. (WebDAV remains one of the
   most-requested Proton Drive features and is not on the published roadmap.)

**Verification (§20) is also affected.** With no server-side content hash to
compare against, checksum sampling means download-and-decrypt. Workable, but it
prices the verification gate differently from every other target, and that
should be measured rather than assumed when the time comes.

## Decision

**Defer.** Do not build a Proton Drive target now. Revisit when **both** of
these are true:

1. The Proton Drive SDK reaches **general availability**, and
2. Proton offers a **non-interactive credential** — an app password, an API
   key, or a documented long-lived session — that a headless worker may hold.

Condition 2 is the real gate. Condition 1 alone would let us write the
connector; it would not let us run it the way this product runs.

**If it is built before condition 2 exists**, it belongs in the **self-host
edition only**, and the mapping must be labelled **operator-attended** rather
than scheduled — the confirm page and `/status` must say that this target needs
a human to re-authenticate, rather than silently reporting a stalled sync as
healthy (hard rule 9). It must not ship in the managed edition under any
circumstances until condition 3's key-custody question has its own answer.

**The reverse-engineered route is rejected outright**, now and later. rclone's
`protondrive` backend (over `henrybear327/Proton-API-Bridge`) works, and is the
obvious shortcut, but: it is Beta; it is implemented by reading client source
and **observing browser traffic**, because Proton publishes no API
documentation; and it self-declares that the protocol has changed over time and
there may be accounts it is not compatible with. Hard rule 1 — idempotency is
sacred — does not survive a target that may behave differently per account, and
"we could not tell whether your file was already there" is the precise
condition under which this product duplicates or destroys data. A migration
tool is the wrong place to spend that risk.

## Consequences

- SAD §9.4 is updated with this reassessment; the §9 domain table's Proton
  files cell no longer says "weak/no sync API", which was true in 2025 and is
  not true now. The **conclusion** is unchanged; only the reason moved.
- Proton's position in the product is unchanged: optional, family/individual,
  Easy Switch import + forwarding, never a continuous-shadow target (§9.1,
  §9.4). Cluster B (Soverin + Nextcloud) remains the recommended default.
- `parseTarget` keeps its five standards-based types. Nothing in the config
  surface changes, so there is no half-supported Proton option for an operator
  to find and be disappointed by.
- Workplan `0014-proton-drive-target.md` records the port mapping, the open
  questions and the task breakdown, so the work can start the day the revisit
  conditions are met rather than being re-derived then.

## Alternatives considered

- **Build it now on the pre-GA SDK, self-host only, operator-attended.**
  Genuinely viable and was seriously considered. Rejected for now because the
  interfaces churn until GA, the auth flow is the part most likely to change
  (it is the part Proton has not yet built), and an operator-attended target in
  a product whose whole promise is an unattended shadow sync is a support
  burden out of proportion to the number of people asking for it. Revisit as a
  package if demand appears before the conditions are met.
- **Wrap the official Drive CLI instead of the SDK.** Rejected: it reintroduces
  a shell-out binary immediately after ADR-0019's update note recorded that
  there are none left, it breaks the native-Windows packaging story, and it
  does not solve the auth problem — the CLI has the same browser-only sign-in,
  because that is a Proton constraint rather than a binding one.
- **Proton Drive as a SOURCE rather than a target** (migrating *off* Proton).
  Out of scope for this ADR, and a different question: the same auth blocker
  applies, but the key-custody objection is weaker (reading needs the keys too,
  but the managed edition's exposure is the same either way). Worth its own
  assessment if anyone asks.
- **Wait for WebDAV specifically.** Rejected as a gating condition: it would be
  the cheapest possible integration, but it has been requested for years, is
  not on the roadmap, and is arguably incompatible with Proton's client-side
  encryption model. The SDK is the path Proton is actually building.

## Update 2026-08-02 — the deferral now covers the whole Proton destination

The 2026-08-02 sweep (workplan 0026 T3 row 9) found that this ADR deferred
only **Drive**, while the rest of the Proton story — mail via Bridge in the
local edition, calendar/contacts via scheduled ICS/vCard snapshots (SAD
§15.1) — was promised in the **user-facing scope manifest** with zero code
behind it and no deferral covering it. Owner decision 2026-08-02:
**retract for now.**

- The deferral above extends to the **entire Proton destination**: Bridge
  mail, ICS/vCard snapshots, and Drive. Nothing Proton is built until the
  work is deliberately picked up — for Drive that remains the two revisit
  conditions above; for the Bridge/snapshot half the trigger is simply
  demand (it was never blocked on anything but priority, and Bridge keeps
  its §9.4 confinement to the local edition whenever it is built).
- The scope manifest's "Proton calendar/contacts (ICS/vCard snapshots
  only)" row is **removed** (version `2026-08-02`) — the manifest promises
  only what is built. SAD §15.1 and §11.2's manifest listing carry dated
  notes of the same day.
- Proton's product position is unchanged, again: optional
  family/individual destination, never continuous-shadow, cluster B stays
  the default. Workplan 0014 remains the parking spot for the Drive work.
