# ADR-0026: One operating UI, one contract, both editions

- **Status:** Accepted
- **Date:** 2026-07-30
- **Relates to:** ADR-0016 (ledger schema), ADR-0019 (packaging), ADR-0020 (ledger is a rebuildable cache), ADR-0023 (Postgres everywhere), ADR-0024 (`apply`), SAD §11.1/§11.2 (owner decides; decision queues), §17 (personal data), §20 (verification). Prerequisite for workplan 0015 (native Windows installer).

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
unit-tested, and rewriting it buys nothing.

**Two UI idioms exist during the transition** (the server-rendered confirm page,
and the React operating screens). Accepted rather than resolved now: folding
confirm into the React app is a follow-up, and doing it in the same change would
have coupled a UI-architecture decision to a rewrite of the one screen that
already works.

**A gap this closed on the way.** `apps/web` was not typechecked by anything —
the root tsconfig includes `apps/*/src/**/*.ts` and never `.tsx`, so its pages
and components were invisible to the gate and its own `tsc` had been failing.
That is how the app came to hold a second, drifted zod copy of `DiscoveryRecord`
whose stripping silently dropped the adoption count from the confirm screen. The
duplicate is the exact mistake this ADR argues against, found in our own
codebase while writing it up, and it is the strongest available evidence for the
decision: a client that redeclares the server's contract will drift, and without
a gate nobody will notice.

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
