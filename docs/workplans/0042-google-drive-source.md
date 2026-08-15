# Workplan 0042 — Google Drive as a file source

## Status — 2026-08-15 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 decide the three questions that have no precedent here | ⬜ Not started | — |
| T1 the delta shape: a per-drive changes feed behind a per-folder port | ⬜ Not started | — |
| T2 identity: opaque fileId vs the path-shaped natural key | ⬜ Not started | — |
| T3 native Google editor files: export, or refuse | ⬜ Not started | — |
| T4 the connector itself, against a fake transport | ⬜ Not started | — |
| T5 wiring: config schema, both editions, credentials | ⬜ Not started | — |
| T6 proof against a real Drive | ⬜ Not started | — |

## What this is

A `GoogleDriveSource` implementing the existing `FileSource` port
(`packages/shared/src/ports.ts:171`), so a Google Workspace tenant can be a **source** for the
file domain the way OneDrive/SharePoint already is.

**This is the second connector of its kind, not the first.** `packages/connectors/src/
graph-drive-source.ts` (521 lines) is a delta-capable, OAuth2, opaque-id file source that already
implements this port, and everything downstream of it — the sync loop, the ledger, the file
targets, both editions' builders — is provider-neutral. So the seams exist and this workplan is
mostly about the places where Google's model does **not** line up with the one those seams assume.

Answering the question that prompted this directly: **today there is no Google connector of any
kind.** `SourceConfig` (`packages/shared/src/config.ts:253`) is

```
ImapOAuth2Source | CalDAVSource | CardDAVSource | WebDAVSource
| GraphCalendarSource | GraphContactsSource | GraphMailSource
```

and Drive is not reachable indirectly either: Google withdrew WebDAV support years ago, so
`WebDAVSource` cannot be pointed at it.

## Why the OneDrive precedent does not make this easy

Three of Drive's properties conflict with assumptions this repo has baked in. Each is a decision
before it is code, which is why T0 exists.

| | OneDrive via Graph (built) | Google Drive |
|---|---|---|
| delta granularity | **per folder** — `{scope}/drive/root:/{path}:/delta` | **per drive** — `changes.list` from a `startPageToken` |
| file identity | GUID **and** a stable server path | `fileId` only; path is derived by walking `parents` |
| content | every file has bytes and a `quickXorHash` | native Docs/Sheets/Slides have **no bytes** and no checksum |

### The delta mismatch is structural, not cosmetic

`FileSource.listSince(folder, cursor)` is **per folder** — the sync loop calls it once per folder
and stores one cursor per folder. Graph fits because its delta can be scoped by folder path;
`graph-drive-source.ts:118-133` does exactly that, and its comment records what happened when it
did not:

> the files sync calls this […] delta, so every folder's poll processed every item on the drive
> […] cost per pass — 0026 T1 item 1

Drive has no folder-scoped changes feed. `changes.list` reports the whole drive. Implementing
`listSince` naively — call `changes.list` per folder and filter — reproduces that exact defect,
deliberately, in a connector written after the lesson. **T1 is a design decision, not an
implementation detail**, and it must be made before any connector code is written.

### Identity is the one that can duplicate customer data

The file domain keys items by **normalized path** (§10; `graph-drive-source.ts` header calls it
"Path normalization as natural key"). A Drive file has no intrinsic path — it has a `fileId` and a
`parents` array, and its path is a derived walk. Two consequences:

1. A file **moved** between folders keeps its `fileId` and changes its derived path. The keyed
   path in `domain-sync.ts` treats that as a new item and copies it again — the behaviour
   `test/e2e/move-dav-source.mjs` documents for files: *"a moved FILE is keyed by its path, so the
   pass copies it again under the new path and — nothing ever being deleted from a target — the
   target legitimately ends up holding both."* Acceptable in WebDAV where moves are rare; Drive
   users reorganise constantly.
2. Two files can hold the **same name in the same folder**. Drive permits it; a path-shaped key
   cannot express it, so one would silently overwrite or collide with the other.

Note the port already carries the machinery for a better answer: `listSince` returns `removed`
**source refs** rather than paths, matched through `Ledger.findBySourceRef`, precisely because
*"a deleted delta entry is not guaranteed to carry usable path metadata, while its `id` always is
present and never changes"* (`ports.ts:203-207`). The identity question for Drive is whether the
natural key should follow that lead. **T2 owns this and it is the highest-risk decision in the
workplan** — getting it wrong duplicates or loses customer files, and does so silently.

### Native editor files have no bytes

A Google Doc is not a file with content; it is a server-side document exported on request through
`files.export`, choosing a target format (`.docx`, `.pdf`, …). This collides with three things at
once:

- **`contentHash`** — the repo hashes the bytes it will write. If an export is not byte-stable
  across runs, every pass sees a changed file and rewrites it forever. Whether Google's export is
  byte-stable **is not something to assume**; T3 must measure it.
- **§20 verification** — checksum sampling compares the target against what was written. Same
  dependency.
- **fidelity** — an exported `.docx` is a lossy rendering, and the original is not recoverable
  from it. Copying a Doc as `.docx` and reporting it migrated is a claim the product would be
  making on the owner's behalf.

Refusing native files with a named reason is a legitimate outcome of T3, and a better one than a
silent lossy export. `imap-groups.ts` is the precedent for that shape: an honest, tested "no"
rather than an empty result that reads as "there was nothing".

## T0 — decide the three questions

No code. Write the answers into this file, with reasoning, so T1–T3 implement a decision rather
than discover one:

1. **Delta**: one whole-drive poll shared across folders, or per-folder filtering, or a change to
   the `FileSource` port. Name the cost of each.
2. **Identity**: path-shaped natural key (consistent with every other file source) versus
   `fileId`-anchored (correct for Drive, divergent from the rest). A per-source difference in
   keying is a real cost — §20 and the ledger read the same column for every provider.
3. **Native files**: export with a fixed format map, export with an owner-chosen map, or refuse
   with a reason. Measure export byte-stability before choosing, because two of the three options
   depend on it.

## T1 — the delta shape

Implement whatever T0 decided, with the cursor stored in the existing `SyncCursor` shape. The
acceptance property is the one 0026 T1 already paid for: **a pass over N folders must not process
every item on the drive N times.** Assert it directly — count transport calls in a unit test with
a fake, the way the existing connector tests do.

## T2 — identity

Implement the T0 decision. Whichever way it goes, two properties must be pinned by test:

- A file **moved** between folders does not silently become a second copy on the target, or, if it
  does, that is stated in the workplan as accepted behaviour with the reason.
- Two files sharing a name in one folder both migrate, distinguishably.

## T3 — native editor files

Implement the T0 decision. If exporting: pin byte-stability with a test that exports the same
unchanged document twice and asserts identical bytes — and if it is NOT stable, say so here and
change the decision rather than shipping a connector that rewrites every Doc on every pass.

## T4 — the connector

`GoogleDriveSource implements FileSource`, driven in tests by a **fake transport**, following
`graph-drive-source.unit.test.ts`. No network in unit tests. Cover at minimum: folder
enumeration, a delta page, a removal reported by the changes feed, a native file, a binary file,
throttling, and an expired-token refresh.

## T5 — wiring

The checklist the existing sources establish:

1. `SourceConfig` union + validation (`packages/shared/src/config.ts`).
2. Construction in **both** editions — `build-deps.ts` (self-host, env) and
   `build-deps-from-mapping.ts` (managed, decrypted credentials), through the factory modules.
   Note 0041 collapsed the mail builders onto shared factories; the file path should follow that
   shape rather than growing a fourth copy.
3. Credentials: OAuth2 client id/secret/refresh token through `SecretStore`, with the
   least-privilege read-only scope (`drive.readonly`) — the same posture the O365 e2e already
   holds itself to.
4. `enabled-domains` / discovery surfaces, if a Drive mapping needs to appear in them.
5. The guard tests that enumerate providers — check `no-managed-leakage`, `enabled-domains`, and
   the config round-trip tests for lists that need a new entry.

## T6 — proof against a real Drive

The integration harness runs Postgres, Stalwart and Nextcloud in containers; **Google Drive cannot
be containerised**, so this tier cannot prove the connector the way `dav-sync.integration.test.ts`
proves WebDAV. Options, to be chosen when T4 lands: a recorded-fixture contract test (the "recorded
contract" tier `docs/testing.md` already names), or a manual-dispatch e2e against a real
throwaway Workspace tenant, in the shape of `e2e-o365.yml`.

Whichever is chosen, **say plainly in this Status block which one, and what it does not cover.**
An integration tier that silently skips when a credential is absent is the failure mode workplan
0043 and the `harness-exports-what-tests-guard-on` guard exist to prevent.

## What "done" has to show

1. A migration of a real Drive folder containing: a binary file, a native Google Doc, a file that
   moved between folders since the last pass, two files sharing a name, and a deleted file —
   with the pass's counts matching what a human can see in the target.
2. The idempotency property every other source is held to: **second pass creates 0.**
3. The per-folder cost property from T1, asserted rather than assumed.
4. The three T0 decisions written down here with their reasoning, including anything refused.

## Note on sequencing

**T0 before everything.** Each of its three questions has a wrong answer that is invisible until
a customer's data is already on the target: a delta that costs a full drive scan per folder, a key
that duplicates every moved file, an export that rewrites every document every night.

Independent of workplan 0043; they share no code.

## What this workplan does NOT include, and why

**Google Groups.** Group discovery in this repo answers one question —
*which shared mail addresses exist, and does each have a store?* — and it is a **mail** concern
throughout: `listMailEnabledGroups` (`graph-groups.ts:88`), the honest IMAP refusal
(`imap-groups.ts`), and `patternForSource` (`mapping-pattern.ts:39`), which returns a §14.1 pattern
only when the source type starts with `graph-` **and** names a `mailbox`, and `undefined` for
everything else. `assertMappingPattern` states the boundary outright: *"The only pattern a mailbox
mapping can carry is `shared_s`."*

Nothing in the file domain consumes it. A Drive migration therefore needs no Google Groups
connector, and adding one would not move this workplan forward by a line.

The Drive-shaped analogue of the same question is **Shared Drives** (a store owned by no single
user, which is structurally what Pattern S describes) versus My Drive. That is answered by
Drive's own API (`drives.list`), not by Groups, and it belongs to T0's scoping decision.

Google Groups becomes worth revisiting only if **Gmail** is added as a mail source — at which
point the question returns in its original form, and a Google Group with a Collaborative Inbox is
the natural Pattern S analogue while a plain mailing list is Pattern D. The judgement itself is
already provider-neutral: `graph-groups.ts` keeps only the Microsoft-specific *"has a store"*
signal, and hands the pattern decision to `@openmig/core`. That seam is the reason a second
provider would be cheap — but it is Gmail's cost to pay, not Drive's.
