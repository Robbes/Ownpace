# 0096 — A guard that had stopped guarding

## Status — 2026-08-23 (update this block at the end of every session)

| Task | Status | Evidence |
|---|---|---|
| T1 Find what the spec guard no longer sees | ✅ **Done 2026-08-23** | Three routers were mounted in `index.ts` and absent from `MOUNTS` in `openapi-spec.unit.test.ts`: `/api/me`, `/api/access-requests`, and readiness at both `/ready` and `/api/ready`. **Seven operations**, including the only unauthenticated WRITE in the whole API. Both of that file's directional checks run over `MOUNTS` alone, so those routes were not undocumented — they were invisible, and the suite was green. |
| T2 Document the seven | ✅ **Done 2026-08-23** | `apps/api/docs/openapi.yaml` — two new tags (`Account`, `Access`), seven operations, one shared parameter and eleven schemas. Response shapes are described precisely because they are pinned by integration tests; nothing is invented to look complete. |
| T3 Make the table itself unable to drift | ✅ **Done 2026-08-23** | `lists EVERY router index.ts mounts` reads `app.use('<prefix>'` straight out of `index.ts` and fails when one is missing from `MOUNTS`. Proved by removing a mount: three cases go red and the new one names the forgotten prefix. |

## What happened

`openapi-spec.unit.test.ts` exists because `openapi.yaml` spent its life as
markdown wearing a spec's name — no `openapi:`, no `paths:`, unreadable by any
tool, and drifted from the routes it claimed to describe. The test was written
so that could not happen twice. It checks both directions:

- **documented but absent** — a client built against an endpoint that 404s;
- **present but undocumented** — the quiet one, which is exactly how the old
  file rotted.

Both of those run over a hand-kept table, `MOUNTS`. And a router missing from
that table is not caught by either: it is simply not part of the comparison.

Three routers arrived after the table was written, and none was added to it.
Two of them are mine, from 0093 and 0094. So the guard against silent drift had
silently drifted, in the same shape and for the same reason as the file it was
protecting: **a description of the system, kept by hand, next to the system.**

## The fix that matters is T3, not T2

Documenting seven operations closes today's gap. It does nothing about the
fourth router, and there will be one.

`index.ts` is the truth about what this service serves. The new case reads the
mounts out of it directly, so the table is checked against the code rather than
against somebody's memory of the code. A forgotten `app.use` is now a red test
naming the prefix, instead of a guard that quietly covers less than it did.

That check is proved by breaking it, not by watching it pass: removing
`/api/access-requests` from `MOUNTS` turns three cases red, and the new one
reports `mounted in index.ts but absent from MOUNTS — its routes are unchecked`.

## What is deliberately still shallow

The spec's own stated policy is kept: response bodies are described precisely
where the shape is verified and left as open objects where it is not. Everything
added here is pinned by integration tests, so it is described — but nothing was
invented to round out a document, because a generated client that is confidently
wrong is worse than one that says "there is a body and this spec does not pin
its fields yet".

`Readiness` deserves one note. It publishes STATES and never reasons, and the
schema says so, because the endpoint is unauthenticated: a body explaining *why*
the database was unreachable would describe internal topology to anybody who
asked.

## Gates

`pnpm lint` · `pnpm typecheck` · `pnpm test` — green (2026-08-23).
