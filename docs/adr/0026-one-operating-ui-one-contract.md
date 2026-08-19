# ADR-0026: One operating UI, one contract, both editions

- **Status:** Accepted
- **Date:** 2026-07-30
- **Relates to:** ADR-0016 (ledger schema), ADR-0019 (packaging), ADR-0020 (ledger is a rebuildable cache), ADR-0023 (Postgres everywhere), ADR-0024 (`apply`), SAD §11.1/§11.2 (owner decides; decision queues), §17 (personal data), §20 (verification). Prerequisite for workplan 0015 (native Windows installer).

## Operative rules

<!-- What holds NOW. Amend these bullets in place when a later decision changes them;
     the narrative below stays append-only. Assembled into OPERATIVE.md by
     scripts/adr-operative.mjs (drift-guarded by scripts/adr-operative.unit.test.ts). -->

- **One operating UI and one wire contract for both editions**; shapes live in `packages/shared/src/operating-contract.ts`; the managed API implements the same operating surface.
- The appliance UI is **not** a reduced or "basic" mode.
- Refusal prose is operating semantics: rendered verbatim, never decorated away.

## Context

Everything before the green light has a UI. Everything after it does not.

The self-host appliance renders one page — `apps/selfhost/src/confirm-page.ts`,
135 lines of dependency-free HTML: discovery counts, the §11.2 scope manifest,
and a "Start migration" button. After that button is pressed, the entire
operating surface is JSON over HTTP:

| Surface | Self-host | Managed API | UI |
|---|---|---|---|
| `/status` | ✅ | ✅ (per-mapping) | partial |
| `/verify` (§20 gate) | ✅ | via cutover job | ❌ |
| `/failures` + retry/accept | ✅ | ❌ **absent** | ❌ |
| `/moves` + keep | ✅ | ❌ **absent** | ❌ |
| `/deletions` + keep/**apply** | ✅ | ❌ **absent** | ❌ |
| `/mappings/:id/finish` | ✅ | ❌ **absent** | ❌ |

So the product's central promise — §11.1's "the owner stays in control", made
concrete by §11.2's decision queues — is reachable only by an operator willing
to `curl http://localhost:8081/deletions` and read a hash out of the response.
That includes `apply`, the one destructive operation in the product.

This became blocking rather than merely unfortunate when workplan 0015 (a
native Windows installer, for users who must never open a terminal) reached its
packaging task. An MSI that installs an appliance whose only operating surface
is `curl` does not serve the person the installer exists for. The workplan
records the UI as a hard prerequisite, not a parallel track.

Two structural facts shaped the decision:

1. **The managed API does not implement the operating surface at all.** It has
   migrations CRUD, discovery, start, sync and runs. It has no deletions, moves,
   failures, verify or finish endpoints. The asymmetry runs the opposite way to
   the usual assumption: self-host is *ahead*.
2. **The self-host shapes were never typed.** All three queues were built inline
   as `Record<string, unknown>`, so nothing checked them and no client could
   consume them without guessing.

## Decision

**One React application, served by both editions, against one contract that is
extracted from what self-host already serves.**

Three parts:

### 1. The contract lives in `@openmig/shared`, and it is extracted, not designed

`packages/shared/src/operating-contract.ts` carries the wire shapes for the
three queues, `/status`, and the decision outcomes.

They are taken from the endpoints the appliance already answers, unchanged, and
not designed fresh. Self-host is the edition with working operating semantics
and an e2e gate over them; the managed edition has opinions but no
implementation. Extracting from the working one means the contract describes
behaviour rather than intention, the existing gates keep their meaning, and the
managed edition implements a specification that something has already proved
serveable.

The item rows are re-used verbatim from the ledger's own types (`ItemFailure`,
`ItemMove`, `ItemDeletion`). The queues are envelopes — grouping, lifecycle and
guidance — and add no per-item field of their own, so there is nothing to keep
in sync.

### 2. The operator-facing prose is part of the contract

`whatThisMeans` and `howToResolve` move into shared alongside the shapes.

This is the part most likely to be argued with, so: these strings are the
operating semantics, not decoration. They are what tells somebody that
"inferred" evidence is a suspicion rather than a fact, that `apply` is the only
destructive action in the product, and that the usual answer to a deletion is
to keep the copy. If each edition wrote its own, the two would drift, and the
drift would be in exactly the explanations that stop somebody destroying data by
accident. One source, both editions, and the UI renders the same words the JSON
carries rather than paraphrasing them — a screen that summarised "refused for
inferred evidence" into "not available" would delete the reason, which is the
part that matters.

### 3. The UI knows which edition it is, at build time

`VITE_EDITION` selects `managed` (default) or `selfhost`. It decides two things:

- **Whether authentication exists.** The appliance is single-user, binds to
  localhost by default (`SELFHOST_BIND`), and its HTTP surface — including
  `apply` — has been unauthenticated since workplan 0010. The UI matching that
  is consistent with what already ships; the protection is the bind address, and
  an operator who changes it is changing that decision. A login there would be a
  password to lose in front of a port nobody else can reach.
- **Which navigation exists.** Tenants and billing are managed concepts and are
  hidden rather than shown broken.

The flag **defaults to `managed`**, deliberately: the safe default for a flag
that gates authentication is the one that keeps the login, so a misconfigured
build over-protects rather than serving the decision queues to whoever asks.

## Consequences

**The appliance stops being terminal-only**, which unblocks workplan 0015 T2.

**The managed edition now has a specification to implement.** Its missing
endpoints are no longer an unwritten intention; they are a typed contract with a
working reference implementation and an e2e gate. That work is not done here.

**`apps/selfhost` gains a bundler dependency it deliberately did not have.**
`confirm-page.ts` says "no bundler, no framework — hard rule 5", and that
rationale is superseded for the operating UI. Hard rule 5 forbids a
*managed-only* dependency in `apps/selfhost`; a React bundle served by both
editions is not one. The confirm page itself stays as it is — it works, it is
unit-tested, and rewriting it buys nothing. *(Superseded 2026-07-30: it was
folded in and deleted — see the second update note. The reasoning above held
until the duplication it left behind was shown to have already drifted.)*

**Two UI idioms exist during the transition** (the server-rendered confirm page,
and the React operating screens). Accepted rather than resolved now: folding
confirm into the React app is a follow-up, and doing it in the same change would
have coupled a UI-architecture decision to a rewrite of the one screen that
already works. *(Done 2026-07-30 — see the second update note below.)*

**A gap this closed on the way.** `apps/web` was not typechecked by anything —
the root tsconfig includes `apps/*/src/**/*.ts` and never `.tsx`, so its pages
and components were invisible to the gate and its own `tsc` had been failing.
That is how the app came to hold a second, drifted zod copy of `DiscoveryRecord`
whose stripping silently dropped the adoption count from the confirm screen. The
duplicate is the exact mistake this ADR argues against, found in our own
codebase while writing it up, and it is the strongest available evidence for the
decision: a client that redeclares the server's contract will drift, and without
a gate nobody will notice.

## Update — 2026-07-30: the managed edition implements it, and one refinement

The managed API now serves the three queues, the `keep`/`retry`/`accept`
decisions and `finish`, from the same `@openmig/shared` shapes and the same
prose. Two things this surfaced are worth recording, because both qualify the
decision above rather than merely implementing it.

**The editions share the shapes but NOT the URLs.** The appliance answers
`/deletions` for every mapping in its config directory — there are a handful,
and its operator wants all of them. A managed tenant can have many, so its
queues are scoped: `/api/migrations/{id}/deletions`. Returning every mapping's
queue in one response would be a slow, unbounded answer to a question nobody
asked.

Both still return the contract's `ByMapping<T>`, so a screen iterating the
response works unchanged against either — managed simply always has one key.
The difference is confined to one function in the client
(`services/edition.ts`), and asking managed for a queue without naming a mapping
**throws rather than defaulting**: "all of them" would be the unbounded query,
and picking one would show somebody another migration's data.

**`apply` and `verify` are deliberately not in the managed API.** Both touch the
target — one removes a message, the other counts and samples every domain — and
in that edition target I/O belongs to the worker behind Trigger.dev (ADR-0004),
not to a request thread holding connector credentials for minutes. A synchronous
version bolted into the API would make the two editions differ in exactly the
operation that destroys data. They need a job and an async result shape, which is
a deliberate piece of work rather than a line in a route file; until then the
managed edition has no `apply` and no `verify` screen, which is an honest gap
rather than a broken button.

That piece of work is now scheduled, and its shape is decided:
[workplan 0017](../workplans/0017-managed-apply-and-verify.md) — start + poll,
both verbs on both editions, with `apply`'s ledger-side refusals still answered
synchronously because "you may not do that, here is why" must not become "check
back later".

`startTransition`/`finishTransition` moved to `@openmig/shared` at the same time.
They are pure decisions — most importantly that finishing is refused while items
await a decision — and an edition that quietly allowed what the other refused
would be a different product wearing the same UI. They decide; each edition
still acts for itself, which genuinely differs: self-host unschedules an
in-process croner job, managed lets its poller stop seeing a row that is no
longer `active`.

## Update — 2026-07-30: the confirm page is folded in, and the transition is over

`apps/selfhost/src/confirm-page.ts` is deleted. `GET /` now redirects to
`/ui/confirm`, and the appliance runs **one** UI technology instead of two.

The duplication was not hypothetical. The discovery counts table, the scope
manifest columns, and the two warnings that tell a customer what we will change
(generated Message-IDs written onto *their copy*; matching items on the
destination *adopted rather than overwritten*) existed twice — once as
hand-rolled HTML, once as JSX — and had already drifted: the React copy was
typed against a stale local `DiscoveryRecord` that silently dropped the adoption
count, which is precisely the number a customer is supposed to see before
pressing start. Both now render `DiscoveryCounts` and `ScopeManifestPanel`.

Two containers remain, and that is deliberate rather than unfinished. They are
different flows over the same pieces: the appliance's operator holds a config
directory and wants **every** configured mapping listed on a landing screen,
while a managed customer is confirming the **one** mapping they just created, as
a step in a wizard. Forcing one component to be both would make it worse at both.

**One capability was given up.** The appliance previously had a usable screen
with no build step. It now requires `pnpm --filter @openmig/web build:selfhost`,
which the image runs — but a source checkout that skips it gets the "not built"
message at `/ui` rather than a working page. That is the honest cost of removing
the second idiom, and the message names the command rather than leaving somebody
to guess.

`POST /mappings/:id/start` changed with it: it answered `303 See Other` back to
the old HTML form (Post/Redirect/Get), and now answers JSON, because a redirect
is silently *followed* by the `fetch` the React screen uses. It reports
`activated` so a first click and an idempotent second one are distinguishable.

## Alternatives considered

- **Design a fresh shared API contract first, then build against it.** Rejected:
  a contract with no consumer and one non-implementing edition is a guess. The
  self-host shapes have been exercised by an e2e gate for several workplans;
  extracting them costs nothing and starts from something true.
- **Build the appliance UI server-rendered, as `confirm-page.ts` is, and leave
  managed to its React app.** Rejected: it is the status quo that produced the
  asymmetry, and it doubles every future queue screen. The decision queues are
  interactive per item, which is where server-rendered HTML stops being the
  cheap option.
- **Put the guidance prose in the UI instead of the contract.** Rejected for the
  reason in part 2, and because a JSON consumer that is not this UI — an
  operator with `curl`, a script, a future mobile client — would then get the
  data without the meaning.
- **Give the appliance a login so one auth model covers both.** Rejected: it
  authenticates nothing. There are no accounts on the appliance, and adding a
  credential to a localhost-bound single-user process adds a thing to lose
  without adding a boundary.

## Update — 2026-08-01: the last deliberate gap is closed

`apply` and `verify` are no longer absent from the managed API. Workplan 0017
built the start + poll pair on both editions (`verify/start` + `verify/report`;
`apply` as evaluate-then-enqueue with a polled receipt), and workplan 0018
deployed the Trigger.dev execution plane that makes the managed job loop real —
proven live 2026-08-01 (verify: 202 → `done` in 1.7 s with the per-domain
report). The capability tables at the top of this ADR describe the world this
decision was made in and are left as history; every ❌ in them is now ✅.

One qualification joined the contract with it: for `apply`, the editions share
the refusal shapes and prose but not the SUCCESS shape — the appliance answers
the outcome synchronously, managed answers `202 ApplyQueuedResponse` plus a
polled `ApplyReceipt`. The shared client currently assumes the appliance's
shape, which is exactly the kind of drift this ADR exists to name: closing it
is workplan 0019 T1. *(Update 2026-08-03: closed — 0019 T1 shipped the typed
`ApplyOutcome` split, the one success-shape difference this contract permits.)*
