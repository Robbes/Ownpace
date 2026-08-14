# Workplan 0041 — One connector builder, two ways in

## Status — 2026-08-14 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 locate the duplication precisely | ✅ **Done** | Three matched builder pairs, by line number, in the table below. |
| T1 normalise the two input shapes into one credential type | ⬜ Not started | — |
| T2 collapse the two source builders (graph, imap) onto it | ⬜ Not started | — |
| T3 collapse the target writer | ⬜ Not started | — |

## What this is

`packages/orchestration` has two entry points that construct the same dependency objects from
different sources of truth:

| | `build-deps.ts` (713 lines) | `build-deps-from-mapping.ts` (599 lines) |
|---|---|---|
| Input | a `MappingConfig` — **a config file** | `(pool, tenantId, mappingId)` — **the database** |
| Edition | self-host | managed |
| Entry | `buildDeps`, `buildDomainDeps` | `buildDepsFromMapping`, `buildDomainDepsFromMapping` |

Both end up producing the same four shapes — `ReconcileDeps`, `CalendarSyncDeps`,
`ContactSyncDeps`, `FileSyncDeps` — and to get there each carries its own copy of the connector
construction:

| what it builds | from a config file | from database credentials |
|---|---|---|
| Graph mail source | `buildGraphMailSource` :277 | `buildGraphMailSourceFromCredentials` :383 |
| IMAP source | `buildImapSource` :336 | `buildImapSourceFromCredentials` :443 |
| Target writer | `buildTargetWriter` :448 | `buildTargetWriterFromCredentials` :556 |

The first two pairs are within a line of each other in length (~59/60 and ~112/113), which is
what a copy looks like. The third is not (229 vs ~43) and should be read before assuming it is
the same kind of duplicate.

## Why it matters, stated without exaggeration

This is **not** currently broken, and the obvious hazard has already been closed: the audit
flagged a third concurrency default living here, and `build-deps.ts` now takes
`DEFAULT_CONCURRENCY` from `@openmig/shared` with `one-concurrency-default.unit.test.ts`
guarding it. That guard passes.

What remains is the general form of that same risk. Hard rule 5 says the editions do not differ
in behaviour, and right now the code that decides how each edition talks to a source is written
twice. Any fix to connector construction — a timeout, a retry, an auth quirk — has to be made in
both places, and nothing fails if it is made in only one. The concurrency default is the proof
that this is a real failure mode here and not a hypothetical: it happened, and it took a
bespoke guard test to catch.

## T1 — the shape both paths can produce

The cut is a normalised credential/endpoint type — what a connector actually needs, with no trace
of whether it came from a file or a row. Both entry points become resolvers into it:

```
MappingConfig ──┐
                ├──> ResolvedSourceCreds ──> buildSource(creds)  (one implementation)
DB credentials ─┘
```

Do T1 as its own commit with no behaviour change, so the two later commits are pure deletions.

## T2 / T3 — collapse, one pair per commit

Graph first (smallest, and its two versions are closest), then IMAP, then the target writer.
Each commit deletes one duplicate and leaves the suite green.

## What "done" has to show

Not "it compiles". The construction path feeds **both editions**, so:

1. Every existing test in `build-deps.unit.test.ts` and `build-deps-from-mapping.unit.test.ts`
   passes **unchanged** — if a test needs editing to accommodate the refactor, that is a
   behaviour change wearing a refactor's clothes, and it needs saying out loud.
2. `dav-sync.integration.test.ts` and `sync-job.integration.test.ts` green in CI, since those
   exercise real construction against real servers.
3. Mutation check on the collapsed builder: break it once, confirm **both** editions' tests fail.
   That is the whole point — one implementation means one place to break.

## Note on sequencing

This was deferred out of [0040](./0040-orchestration-is-a-library.md) deliberately: doing it
inside the package move would have made the move unreviewable. It is now unblocked, and it wants
a session with the context budget to read all 1,312 lines properly. A half-finished collapse of
the code that builds every connector for both editions is worse than none, because the two copies
would then differ *and* look intentional.
