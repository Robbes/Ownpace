# Workplan 0041 — One connector builder, two ways in

## Status — 2026-08-14 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T0 locate the duplication precisely | ✅ **Done** | Three matched builder pairs, by line number, in the table below. |
| T1 normalise the two input shapes into one credential type | ✅ **Done (graph)** | `mail-source-factory.ts` — `GraphMailEndpoint` + `ResolvedGraphCreds`, no trace of file-vs-row origin. |
| T2 collapse the two source builders (graph, imap) onto it | ✅ **Done** | Graph and IMAP both collapsed. 26 existing tests pass **unchanged** throughout; three separate mutations of shared code each fail tests across **BOTH** suites (5, 14 and 3). |
| T3 collapse the target writer | ⬜ Not started | — |

### T1/T2-graph, 2026-08-14

The two graph builders were byte-identical from the mailbox refusal onward and differed only in
where three values came from. That tail is now one function; the collapse deleted ~37 duplicated
lines.

**The validation deliberately did NOT collapse.** Each caller still checks presence itself and
refuses in its own vocabulary: self-host names the environment variable an operator must set
(`OAUTH2_CLIENT_ID`), managed names the missing credential field (`clientId`). Unifying those
would tell a managed operator to set an env var that has no effect there — worse than the
duplication it removes. Both suites assert on their own vocabulary (`/OAUTH2_CLIENT_ID/` and
`/clientId/`), so this is also what let every test pass unchanged.

**Found while collapsing, deliberately not fixed here.** The mailbox refusal names
`OAUTH2_REFRESH_TOKEN` / `OAUTH2_CLIENT_SECRET` even on the managed path, where neither is read.
Both copies said exactly that beforehand, so carrying it over verbatim is what keeps this a
refactor. It is now wrong in one place instead of two — which is the argument for the collapse,
and a one-line follow-up rather than something to smuggle into a no-behaviour-change commit.

### T2-imap, 2026-08-14

The warning above held: the IMAP builders are ~112/113 lines and look like a matched pair by
length, but only **part** of each is a copy. Three pieces were genuinely identical and collapsed;
three are genuinely different and deliberately did not.

| | collapsed? | why |
|---|---|---|
| TLS defaults + `imapConfig` assembly | ✅ `buildImapSourceFrom` | identical, comments verbatim in both — and the TLS default encodes an asymmetry argument that must not drift |
| `new ImapFlowSource(...)` | ✅ same function | identical |
| Graph-fallback **rule** | ✅ `withGraphFallback` | `tenantId && clientId && (secret \|\| refresh)`, written twice; an edition changing its mind about accepting a refresh token would have silently disagreed with the other about when a mailbox gets a second chance |
| `authType` derivation | ❌ passed in | **self-host follows the DECLARED `auth.kind`; managed follows which credential is PRESENT.** Both defensible — a config file states intent, a credential store only has contents — and reconciling them is a behaviour change, not a refactor |
| token provider | ❌ stays with caller | self-host: `/common/` endpoint, fixed IMAP scope, built only when `auth.kind === 'xoauth2'`. Managed: `/{tenantId}/`, scope varies by `clientSecret`, and the whole 0037 T6 app-registration path the env version has no equivalent of |
| validation | ❌ stays with caller | managed refuses naming all three options; self-host does not validate here at all |

Net **−45 lines** across the two callers. The `authType` split is the one worth revisiting
deliberately some day — it is a real behavioural difference between the editions, not an accident
of duplication, and it is now stated in one place instead of being implicit in two.

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
