# Workplan 0042 — Google Drive as a file source

## Status — 2026-08-15 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 decide the FOUR questions that have no precedent here | ⬜ Not started | — |
| T1 the delta shape: a per-drive changes feed behind a per-folder port | 🟢 **Sidestepped for the first slice** | The slice enumerates per folder like `WebdavFileSource` and lets the natural key + ledger give idempotency — a pass costs a listing per folder and creates zero on the second run. Slower than a delta, and correct, which is the right order. `changes.list` remains unbuilt and unneeded until someone measures that the listing cost hurts. |
| T2 identity: opaque fileId vs the path-shaped natural key | ⬜ Not started | — |
| T3 native Google editor files: export, or refuse | 🟡 **Both paths built; the default is refuse, and byte-stability is still unmeasured** | `NativeFilePolicy` is `refuse` (default) / `export-office` / `export-pdf`, per migration as the owner chose. A refusal is thrown INSIDE the per-item boundary, so it lands in the failures queue with a verbatim reason and the rest of the folder still migrates — not skipped, which would report "migrated" for a file nobody copied. **The export paths must not be enabled for a real migration until `files.export` byte-stability is measured**: if it is not stable, `contentHash` sees a change every pass and every document is rewritten forever. |
| T4 the connector itself, against a fake transport | ✅ **First slice done 2026-08-15** | `google-drive-source.ts` implements `FileSource`, modelled on **WebDAV rather than Graph** — full folder enumeration, no `changes.list`, `removed` never populated. 11 tests against a fake transport, no network. Mutation-verified: silently skipping native files, dropping `trashed=false`, and downloading a native file instead of exporting it each fail exactly one test. |
| T5 wiring: config schema, both editions, credentials | ⬜ Not started | — |
| T6 proof against a real Drive | ⬜ Not started | — |

## What this is

A `GoogleDriveSource` implementing the existing `FileSource` port
(`packages/shared/src/ports.ts:171`), so a Google Workspace tenant can be a **source** for the
file domain the way OneDrive/SharePoint already is.

`packages/connectors/src/graph-drive-source.ts` (521 lines) is a delta-capable, OAuth2, opaque-id
file source that already implements this port, and it is the closest thing to a template.

**Corrected 2026-08-15, after a read-only audit of this plan's own claims.** The first draft said
"the seams exist" and called this "the second connector of its kind". That was too generous:
`GraphDriveSource` is **wired into nothing** — `SourceConfig` has no drive variant, and neither
edition's builder constructs it. It is a class with tests, not a working source. So T5 is not
"follow the existing wiring"; there is no existing wiring for a file source of this shape, and
whoever does T5 will be cutting that path for the first time.

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

**And it cannot be papered over inside the connector.** The sync loop owns the cursor, not the
source: it reads and writes one per folder (`domain-sync.ts:679`) against a store keyed
`uk_cursor_tenant_mapping_folder` (`schema-pg.ts:743`). A connector is handed one cursor per folder
and must hand one back per folder; there is no way for it to say "this source has a single
cursor".

### Identity is the one that can duplicate customer data

The file domain keys items by **normalized path** (§10; `graph-drive-source.ts` header calls it
"Path normalization as natural key"). A Drive file has no intrinsic path — it has a `fileId` and a
`parents` array, and its path is a derived walk. Two consequences:

1. A file **moved** between folders keeps its `fileId` and changes its derived path, so it is
   copied again under the new path while the old copy stays. What the move DETECTOR then does is
   the part that matters, and it is covered below — the target converges through the deletions
   queue rather than through the key.
2. Two files can hold the **same name in the same folder**. Drive permits it; a path-shaped key
   cannot express it, so one would silently overwrite or collide with the other.

**Corrected again, 2026-08-15 — and this is the important correction.** The first draft offered
"`fileId`-anchored keying" as a free choice; the audit said it required superseding ADR-0020. Both
framings were wrong, because **moves are already correlated by CONTENT HASH, not by path.**

`detectPathKeyedMoves` (`domain-sync.ts:1588-1698`) takes a disappeared ledger row, looks up its
`contentHash` among the arrivals of this pass, and pairs them — consuming each arrival so that
three identical files deleted and one created is one move and two deletions, not three moves.

That changes the whole question:

- A Drive file moved between folders keeps its bytes. **Its move is detectable today**, with no
  identity change at all.
- A `fileId` is not merely barred by ADR-0020 — it is **unnecessary**. The correlation work is
  already being done by something the target can produce.
- And that is precisely why the ADR bars it: a content hash **is** recoverable from the target
  (hash what is there), while a `fileId` never can be. ADR-0020's own **Decision 4** already
  establishes content-hash as a legitimate anchor for items lacking an intrinsic id.

**So T2 does not need an ADR change and should not have one.**

Worse, the same-name-siblings case is not a design decision at all — it is a hard blocker.
`fileNaturalKeyHash(path) = sha256('file:' + path)` (`hash.ts:87-89`) feeds a **database unique
index**, `uk_item_tenant_mapping_natural_key_hash` on `(tenantId, mappingId, naturalKeyHash)`
(`schema-pg.ts:282-286`). Two Drive files with the same name in one folder produce one key. They
cannot both be represented, whatever the connector does.

### `removed` does not mean deleted, and this repo treats it as proof

**Found by the audit; the first draft of this plan missed it, and it is the most dangerous of the
four.**

`resolveReportedRemovals` (`domain-sync.ts:1410-1467`) describes itself as *"the only place in
this product where a deletion is KNOWN rather than suspected… No corroboration is required and
none would help."* Items arriving that way go straight into the owner's deletions queue with
`confirmed: true, evidence: 'reported'`, and under ADR-0024 the owner can then **apply** that
decision — the only destructive operation in the product.

Google's `changes.list` sets `removed: true` for changes that are **not** deletions: losing access,
a file leaving a shared drive's scope, a sharing change. Feeding those into this path would present
an owner with confirmed deletion evidence for files that still exist, and offer to delete the
target's copy. **This is a blocker, and it is a data-destruction blocker rather than a duplication
one.** A Drive source must either not populate `removed` at all, or populate it only from a change
class it can prove means deletion.

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

## T0 — decide the four questions

No code. Write the answers into this file, with reasoning, so T1–T3 implement a decision rather
than discover one. **A fourth was added on 2026-08-15** — the audit of this plan found a blocker
the first draft missed, and it is the one that can destroy data rather than duplicate it:

1. **Delta**: one whole-drive poll shared across folders, or per-folder filtering, or a change to
   the `FileSource` port. Name the cost of each.
2. **Identity**: path-shaped natural key (consistent with every other file source) versus
   `fileId`-anchored (correct for Drive, divergent from the rest). A per-source difference in
   keying is a real cost — §20 and the ledger read the same column for every provider.
3. **Native files**: export with a fixed format map, export with an owner-chosen map, or refuse
   with a reason. Measure export byte-stability before choosing, because two of the three options
   depend on it.
4. **`removed` semantics**: whether a Drive source populates `removed` at all. It feeds the one
   path in this product where a deletion is treated as KNOWN and becomes owner-actionable
   destructive evidence, and Drive sets the flag for access and scope changes that are not
   deletions. The safe default is to populate nothing and let the existing absence-based detector
   do its slower, corroborated job; departing from that needs a change class provably meaning
   deletion.

## T1 — the delta shape

Implement whatever T0 decided, with the cursor stored in the existing `SyncCursor` shape. The
acceptance property is the one 0026 T1 already paid for: **a pass over N folders must not process
every item on the drive N times.** Assert it directly — count transport calls in a unit test with
a fake, the way the existing connector tests do.

## T2 — identity, and the two real gaps

Keep the path-shaped natural key. No ADR change. What is left is narrower than "moves do not
work", and it is two specific things:

1. **A rename IN PLACE is not detected as a move.** `domain-sync.ts:1641` requires the arrival's
   collection to differ: `candidates.findIndex((c) => c.collection !== row.collection)`. Same
   folder, new name therefore degrades to a disappearance plus an unrelated arrival, and after
   `DELETION_CONFIRMATIONS` clean passes it is reported as a deletion. Relaxing that condition is
   nearly a one-liner — and needs care, because same-folder-same-hash is also exactly what a
   genuine duplicate looks like. Whichever way it goes, pin it with a test.

2. **Convergence waits on a human.** Detection reports a move or a deletion into the owner's
   queue; the target only follows once the owner *applies* (ADR-0024). For a target nobody is
   working in — the owner's stated case — that wait is the whole gap. A per-mapping **auto-apply**
   would close it, and it is the only destructive path in the product, so it wants its own ADR
   rather than a flag added here.

Two things stay true regardless and must be said out loud to the owner rather than discovered:

- Two files sharing a name in one folder **cannot both be represented** — the DB unique index on
  `(tenantId, mappingId, naturalKeyHash)` makes that a hard stop, not a tuning question.
- A file **edited and moved in the same pass** has a new hash and will not correlate: it appears as
  a delete plus an add. Against an untouched target that still converges to the right end state.

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

## The first slice, approved 2026-08-15

The owner has a real customer waiting and will test against a real Drive later, so the first slice
is scoped to avoid every decision that can destroy or duplicate data:

- **Binary files only.** Native Google editor files are reported un-migratable with a named reason.
- **`removed` populated with nothing.** The absence-based detector does its slower, corroborated
  job instead; nothing enters the owner's queue as *known* deletion evidence on Drive's say-so.
- **Export format wired as a per-migration setting, defaulting to refuse.** The owner chose
  per-migration choice (T0 Q3); the default stays `refuse` until byte-stability is measured.
- **Path-keyed, no ADR change**, with the two limits above stated in the product's own words.

That yields a usable Drive source without touching the two decisions that can lose customer data.

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
