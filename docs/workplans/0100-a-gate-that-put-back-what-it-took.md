# 0100 — A gate that put back what it took

## Status — 2026-08-23 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Give the seeder a way to take a set back | ✅ **Done 2026-08-23** | `seed-demo-dav-content.sh --remove <tag>` — tag REQUIRED, deletes the six tagged resources, treats 404 as gone (hard rule 1) and any other status as a refusal, then PROPFINDs to prove nothing tagged is left. **Executed** in `scripts/seed-demo-dav-content.unit.test.ts` (23 → 29 cases) against the stubbed Nextcloud that suite already runs: the six deletes land on exactly the paths `--fresh` writes; 404 converges; 403 refuses naming the resource and the code; a survivor refuses even though every DELETE said 204; a missing tag refuses before issuing a single request; pointed at the target account, all six move there. |
| T2 Fix the ordering bug in that new code | ✅ **Done 2026-08-23** | `count()` was defined beside the verification at the bottom of the file, and `--remove` calls it near the top — `count: command not found`, **after** the deletes. Moved above every caller and pinned by a case that compares the two line numbers. |
| T3 Make the smoke take back what it added | ✅ **Done 2026-08-23** | New `balance` section: the prepare phase now CHOOSES the tag (`BALANCE_TAG`) rather than letting the seeder mint one in a subprocess, and the end of the run removes the target copies, the source set and the ledger rows — in that order, and the ledger only if the objects really went. |
| T4 Pin all of it | ✅ **Done 2026-08-23** | `scripts/gate-net-zero.unit.test.ts` — 11 cases, each proved by breaking it (table below). |

## What was happening every night

`smoke-managed.sh`'s prepare phase seeds **six** DAV resources into the demo
source with `--fresh`. A real sync copies them into the demo target. The apply
half spends exactly one. Nothing ever removed the other eleven.

The gate runs nightly against a **long-lived** stack, and it measures those same
two accounts — so it was changing the thing it measures, one run at a time. That
is the same shape as run #20's fixture exhaustion, running the other way: there
the gate ate its fixtures until none were left, here it accumulates them until
nobody can tell a demo account from a landfill.

## The unit that stays truthful

Source object, target copy and ledger row go **together**. Any two of the three
without the third leaves a record that disagrees with reality:

| Removed | What that leaves |
|---|---|
| The ledger row alone | The record of objects that still exist, destroyed. The next sync meets them as brand new. |
| The objects alone | A ledger describing things that are gone — and `pick_disposable` handing a later run an item whose target vanished, which fails with no visible cause. |
| All three | What is left describes exactly what is there. |

So the ledger delete is **conditional** on the objects having actually gone, not
merely sequenced after it. That distinction is the reason T4 exists: putting the
delete last reads identical to guarding it, and is not the same thing. The first
draft here had exactly that bug, and a stubbed run of the section found it — the
removals failed, and the ledger rows were deleted anyway.

## The one row that survives, on purpose

The tombstone. `applyDeletion` wrote it to say a natural key was erased, and
`classifyKnownItem` must never re-create it (ADR-0024, hard rule 2). Deleting it
to make a number come out round would be the exact trade this script exists to
refuse.

**So the gate is net zero minus one tombstone per run**, and the section prints
which is which rather than asserting a round number.

## An earlier note that had to be reconciled

`seed-demo-dav-content.sh`'s header said: *"If that ever needs bounding, prune
the tagged resources from the source; do NOT prune the ledger rows, which are
the record."*

That is right about pruning the ledger **alone**, and wrong about the
coordinated removal above — so the header now says both, rather than leaving the
file contradicting what the smoke does.

## What this does NOT do

**It does not clean up the backlog.** The removal is scoped to the tag this run
minted, which is the only set this run can honestly claim to know about. Every
`--fresh` set from runs before this change is still in both accounts, and their
tags are only recoverable from old logs. Bounding those is a one-off:
`--remove <tag>` per tag, or a hand-audit of `openmig-demo-*-<something>-*` in
the two demo accounts.

**A hand-run smoke now needs `SMOKE_PREPARE_APPLY=1`.** Before this, a manual run
could feed on leftovers from a previous CI run. There are none now — which is
the point — so it seeds its own or refuses, and the refusal already says so.

## Gates

| Break | Case that fails |
|---|---|
| `--remove` falls back to `SEED_DAV_TAG` | requires the tag, and does not invent one |
| `count()` moved back below its caller | defines count() above every caller |
| the `objects_gone` guard removed | deletes ledger rows only once the objects are actually gone |
| `status <> 'tombstoned'` dropped | never deletes the tombstone |
| the target removal deleted | takes the copies out of the TARGET account |
| the leftover-row assertion deleted | asserts the balance rather than reporting it |
| `--fresh` left to invent its tag | chooses the tag itself rather than parsing it out of a log |

`pnpm lint` clean · `pnpm typecheck` clean (all four projects) · `pnpm test`
319 files, 3568 tests, all passing (2026-08-23).

**The removal is proved against a stubbed Nextcloud and a stubbed psql, not
against the Spark.** This environment has no Docker daemon. The `--remove`
behaviour runs for real in CI against the suite's existing docker stub; the
balance section's control flow — including the guard that was wrong in the first
draft — was run the same way, with `q` answering from a fixture.

What no stub can establish is whether the target's copies really live under
`calendars/<target-user>/personal/`. The target writer re-homes a collection
under `collectionSlug(folder.name, …)` (`caldav-target-writer.ts`), which for the
source's `personal` should be `personal`. If it is not, `--remove` refuses with
"no personal calendar for 'tenant-b-target'" and the smoke says the removal is
looking in the wrong place — rather than reporting a balance it did not achieve.
The next dispatch is what answers that.
